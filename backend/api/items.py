"""
Items API router — complete implementation with AI integration.
All endpoints, full filtering, sorting, search, and priority recalculation.
"""

import asyncio
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Any, Optional, List
from datetime import datetime, timezone, timedelta

from schemas.item import ItemCreate, ItemUpdate, ItemEdit
from services.extractor import extract_content, detect_source_type, resolve_platform_info
from services.ai_service import get_ai_service
from services.audio_service import AudioService
from services.vector_service import index_item_by_id, delete_embedding, perform_hybrid_search
import threading
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from utils.schema_fallback import fallback_db

_thread_local = threading.local()

class ThreadLocalSupabaseProxy:
    @property
    def _client(self):
        if not hasattr(_thread_local, "supabase"):
            _thread_local.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        return _thread_local.supabase

    def __getattr__(self, name):
        return getattr(self._client, name)

supabase = ThreadLocalSupabaseProxy()
from middleware.auth import get_current_user

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/items", tags=["items"])

ingestion_debug_info = {}

import collections
item_locks = collections.defaultdict(asyncio.Lock)

def update_ingestion_debug(item_id: str, stage: str, message: str, error: Optional[str] = None):
    if item_id not in ingestion_debug_info:
        ingestion_debug_info[item_id] = {
            "pipeline_stage": stage,
            "logs": [],
            "error": None
        }
    ingestion_debug_info[item_id]["pipeline_stage"] = stage
    timestamp = datetime.now(timezone.utc).isoformat()
    log_line = f"[{timestamp}] [{stage}] {message}"
    ingestion_debug_info[item_id]["logs"].append(log_line)
    if error is not None:
        ingestion_debug_info[item_id]["error"] = error
    logger.info(f"[INGESTION DEBUG] [{item_id}] [{stage}] {message}")
    print(f"[INGESTION DEBUG] [{item_id}] [{stage}] {message}")



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------




def get_user_id(user: dict = Depends(get_current_user)) -> str:
    return user.get("id") or user.get("sub")


def item_to_response(item: dict) -> dict:
    """Normalise a DB row into the canonical response shape."""
    # Ensure tags is always a list
    tags = item.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    # Dynamic branding fallback for missing fields in the database row
    url = item.get("url", "")
    source_name = item.get("source_name")
    source_type = item.get("source_type")
    source_domain = item.get("source_domain")
    logo_url = item.get("logo_url")
    
    if url and (not source_name or not source_type or not source_domain or not logo_url):
        try:
            info = resolve_platform_info(url)
            if not source_name:
                source_name = info["source_name"]
            if not source_type:
                source_type = info["source_type"]
            if not source_domain:
                source_domain = info["source_domain"]
            if not logo_url:
                logo_url = info["logo_url"]
        except Exception as e:
            logger.warning("Dynamic branding resolution failed for %s: %s", url, e)

    return {
        "id": item.get("id"),
        "user_id": item.get("user_id"),
        "url": url,
        "title": item.get("title"),
        "description": item.get("description"),
        "content_type": item.get("content_type", "generic"),
        "status": item.get("status", "unread"),
        "processing_status": item.get("processing_status", "completed"),
        "is_favorite": item.get("is_favorite", False),
        "added_at": item.get("added_at"),
        "completed_at": item.get("completed_at"),
        "created_at": item.get("created_at") or item.get("added_at"),
        "audio_url": item.get("audio_url"),
        "thumbnail_url": item.get("thumbnail_url"),
        "source_name": source_name,
        "source_type": source_type or item.get("content_type"),
        "source_domain": source_domain,
        "logo_url": logo_url,
        # ── Fields that were previously missing ──
        "ai_summary": item.get("ai_summary"),
        "full_summary": item.get("full_summary"),
        "tags": tags,
        "extracted_text": item.get("extracted_text"),
        "author": item.get("author"),
        "estimated_read_time": 0 if item.get("status") == "completed" else item.get("estimated_read_time"),
        "estimated_time_minutes": 0.0 if item.get("status") == "completed" else item.get("estimated_time_minutes"),
        "actual_time_spent": item.get("actual_time_spent") or 0.0,
        "duration_seconds": 0 if item.get("status") == "completed" else item.get("duration_seconds"),
        "priority_score": item.get("priority_score", 50.0),
        "collection_id": item.get("collection_id"),
        "read_progress": item.get("read_progress", 0),
        "notes": item.get("notes"),
    }


def is_valid_content_for_summary(text: str) -> bool:
    if not text:
        return False
    text = text.strip()
    if not text:
        return False
    
    # Check if it is a URL
    if text.startswith("http://") or text.startswith("https://"):
        return False
        
    # Check if it is just a generic fallback/placeholder
    fallbacks = {
        "content could not be extracted for summarization.",
        "summary unavailable.",
        "ai summary could not be generated.",
        "generating ai summary...",
        "limited text available",
        "no metadata or transcript available for this video.",
        "summary could not be generated."
    }
    if text.lower() in fallbacks:
        return False

    # Check if it is metadata / too short
    if len(text) < 30:
        return False
        
    return True


def is_placeholder_summary(summary: str) -> bool:
    """Detect whether an ai_summary is a metadata-only fallback that should be regenerated."""
    if not summary:
        return True
    s = summary.strip().lower()
    # Exact known placeholder strings
    placeholders = {
        "generating ai summary...",
        "summary could not be generated.",
        "content could not be extracted for summarization.",
        "summary unavailable.",
        "limited text available",
        "no metadata or transcript available for this video.",
        "ai summary could not be generated.",
        "transcript unavailable",
    }
    if s in placeholders or len(s) < 30:
        return True
    # Prefix-based detection: metadata fallback patterns
    placeholder_prefixes = (
        "a video on youtube titled",
        "a github repository titled",
        "a reddit post titled",
        "a tweet/post titled",
        "a resource titled",
    )
    if any(s.startswith(p) for p in placeholder_prefixes):
        return True
    return False


def reject_footer_and_navigation_text(text: str) -> str:
    """
    Reject footer/navigation/cookie lines from content before AI processing.
    Rejects lines containing keywords like About, Privacy, Terms, Copyright, Advertise, Creators, YouTube, Google LLC, etc.
    """
    if not text:
        return ""
    import re
    lines = text.split("\n")
    cleaned_lines = []
    
    reject_keywords = {
        "about", "privacy", "terms", "copyright", "advertise", "creators", 
        "youtube", "google llc", "press copyright", "contact us", "developers",
        "try new features", "policy & safety", "how youtube works", "test new features",
        "all rights reserved", "cookie policy", "terms of service", "terms of use",
        "privacy policy", "sign in", "subscribe", "footer", "navigation"
    }
    
    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            cleaned_lines.append("")
            continue
            
        line_lower = line_strip.lower()
        is_rejected = False
        
        # Check if line contains any reject keyword in a footer-like context
        for kw in reject_keywords:
            if kw in line_lower:
                # If the line is short (e.g. less than 12 words), it is likely a footer link or copyright notice
                if len(line_strip.split()) < 12:
                    is_rejected = True
                    break
                # If it contains delimiters typical of link lists (|, •, ·, bullet points, etc.)
                if any(sep in line_strip for sep in ["|", "•", "·", "  "]):
                    is_rejected = True
                    break
                    
        if not is_rejected:
            cleaned_lines.append(line)
            
    # Remove excessive blank lines
    result = "\n".join(cleaned_lines)
    return re.sub(r'\n{3,}', '\n\n', result).strip()


def get_usable_content(item_data: dict) -> Optional[str]:
    """
    Resolve any available content for AI summary / audio generation.
    Strictly returns ONLY the transcript (for YouTube) or extracted article/body text (for others)
    if the content is at least 50 characters. Return None otherwise (prevents falling back to metadata summaries).
    """
    source_type = (item_data.get("source_type") or item_data.get("content_type") or "").strip().lower()

    transcript_val  = (item_data.get("transcript") or "").strip()
    webpage_val     = (item_data.get("extracted_text") or item_data.get("full_text") or "").strip()

    MIN_CONTENT_CHARS = 50

    if source_type == "youtube":
        if transcript_val and len(transcript_val) >= MIN_CONTENT_CHARS and not is_placeholder_summary(transcript_val):
            print(f"[PIPELINE LOG] [get_usable_content] Using TRANSCRIPT ({len(transcript_val)} chars) for YouTube item.")
            return transcript_val
        print(f"[PIPELINE LOG] [get_usable_content] Transcript is missing or under {MIN_CONTENT_CHARS} chars. Returning None.")
        return None

    # For Articles, PDFs, and generic webpages
    if webpage_val and len(webpage_val) >= MIN_CONTENT_CHARS and not is_placeholder_summary(webpage_val):
        print(f"[PIPELINE LOG] [get_usable_content] Using EXTRACTED_TEXT/FULL_TEXT ({len(webpage_val)} chars) for {source_type} item.")
        return webpage_val

    print(f"[PIPELINE LOG] [get_usable_content] Extracted content is missing or under {MIN_CONTENT_CHARS} chars. Returning None.")
    return None


def ensure_summary(item: dict) -> dict:
    """Ensure the item has a non-empty ai_summary. If missing, generate one and update DB.
    Returns the possibly updated item dict.
    """
    ai_summary = item.get("ai_summary")
    if ai_summary and ai_summary not in ["Summary could not be generated.", "Content could not be extracted for summarization.", "Summary unavailable.", "Limited text available"]:
        return item

    title = item.get("title") or ""
    content_type = item.get("content_type") or "generic"
    transcript_val = item.get("transcript") or ""
    extracted_text_val = item.get("extracted_text") or ""
    if not transcript_val and extracted_text_val and content_type == "youtube":
        if "--- METADATA ---" in extracted_text_val:
            transcript_val = extracted_text_val.split("--- METADATA ---")[0].strip()
        else:
            transcript_val = extracted_text_val

    resolved_content = get_usable_content({
        "transcript": transcript_val,
        "extracted_text": extracted_text_val,
        "title": title,
        "description": item.get("description"),
        "author": item.get("author"),
        "url": item.get("url")
    })

    title_for_ai = "" if content_type == "youtube" else title
    summary = None
    full_summary = ""
    db_updated = False
    
    print(f"[PIPELINE LOG] [ensure_summary] Starting summary generation for item {item.get('id')}...")
    
    try:
        if not resolved_content:
            summary = "Summary could not be generated."
            print(f"[PIPELINE LOG] [ensure_summary] No valid content for summary.")
        else:
            ai = get_ai_service()
            
            is_transcript_available = False
            if transcript_val and len(transcript_val.strip()) > 30 and not is_placeholder_summary(transcript_val):
                is_transcript_available = True
            elif content_type != "youtube" and extracted_text_val and len(extracted_text_val.strip()) > 50 and not is_placeholder_summary(extracted_text_val):
                is_transcript_available = True

            # Attempt 1
            print(f"[PIPELINE LOG] [ensure_summary] Attempt 1...")
            analysis = None
            try:
                analysis = ai.analyze_content(
                    title=title_for_ai, 
                    content=resolved_content, 
                    content_type=content_type,
                    transcript_available=is_transcript_available
                )
                summary = analysis.get("summary")
                full_summary = analysis.get("full_summary") or ""
                print(f"[PIPELINE LOG] [ensure_summary] Attempt 1 succeeded.")
            except Exception as e:
                logger.warning(f"[ensure_summary] attempt 1 failed: {e}")
                print(f"[PIPELINE LOG] [ensure_summary] Attempt 1 failed: {e}")
            
            # Check fallback/failure
            if not summary or summary in ["Content could not be extracted for summarization.", "Summary could not be generated.", "Summary unavailable."]:
                # Retry once
                print(f"[PIPELINE LOG] [ensure_summary] Attempt 2 (Retry)...")
                try:
                    analysis = ai.analyze_content(
                        title=title_for_ai, 
                        content=resolved_content, 
                        content_type=content_type,
                        transcript_available=is_transcript_available
                    )
                    summary = analysis.get("summary")
                    full_summary = analysis.get("full_summary") or ""
                    print(f"[PIPELINE LOG] [ensure_summary] Attempt 2 succeeded.")
                except Exception as e:
                    logger.error(f"[ensure_summary] retry failed: {e}")
                    print(f"[PIPELINE LOG] [ensure_summary] Attempt 2 failed: {e}")
                    raise e # never swallow exceptions
            
            if not summary or summary in ["Content could not be extracted for summarization.", "Summary could not be generated.", "Summary unavailable."]:
                raise ValueError(f"AI Analysis failed to generate a valid summary. Got: {summary}")

        transcript_len = len(transcript_val)
        extracted_text_len = len(extracted_text_val)
        summary_input_len = len(resolved_content)
        summary_output_len = len(summary) if summary else 0

        print(f"[PIPELINE LOG] ensure_summary - transcript_length: {transcript_len}")
        print(f"[PIPELINE LOG] ensure_summary - extracted_text_length: {extracted_text_len}")
        print(f"[PIPELINE LOG] ensure_summary - summary_input_length: {summary_input_len}")
        print(f"[PIPELINE LOG] ensure_summary - summary_output_length: {summary_output_len}")

        # Update DB
        processing_status = "completed" if summary and summary != "Summary could not be generated." else "failed"
        print(f"[PIPELINE LOG] [Database] [ensure_summary] Updating DB with status='{processing_status}'...")
        update_data = {
            "ai_summary": summary,
            "processing_status": processing_status,
            "extracted_text": extracted_text_val or resolved_content
        }
        if fallback_db.has_full_summary:
            update_data["full_summary"] = full_summary
            
        supabase.table("items").update(update_data).eq("id", item.get("id")).execute()
        
        # Save full_summary locally if not supported on remote
        local_meta_updates = {}
        if full_summary:
            local_meta_updates["full_summary"] = full_summary
        if local_meta_updates:
            try:
                fallback_db.update_item_metadata(item.get("user_id") or user_id, item.get("id"), local_meta_updates, supabase)
            except Exception as local_err:
                logger.error(f"Failed to update metadata locally in ensure_summary: {local_err}")
                
        db_updated = True
        item["ai_summary"] = summary
        item["full_summary"] = full_summary
        item["processing_status"] = processing_status
        print(f"[PIPELINE LOG] [Database] [ensure_summary] DB update completed successfully.")
    except Exception as e:
        logger.error(f"ensure_summary failed for item {item.get('id')}: {e}", exc_info=True)
        print(f"[PIPELINE LOG] [ensure_summary] Failed: {e}")
        
        if not db_updated:
            try:
                print(f"[PIPELINE LOG] [Database] [ensure_summary] Updating DB with failed status...")
                update_data = {
                    "ai_summary": "Summary could not be generated.",
                    "processing_status": "failed",
                    "extracted_text": extracted_text_val or resolved_content
                }
                supabase.table("items").update(update_data).eq("id", item.get("id")).execute()
                item["ai_summary"] = "Summary could not be generated."
                item["processing_status"] = "failed"
                print(f"[PIPELINE LOG] [Database] [ensure_summary] DB updated to 'failed' successfully.")
            except Exception as db_err:
                logger.error(f"Failed to update item {item.get('id')} on failure: {db_err}")
                print(f"[PIPELINE LOG] [Database] [ensure_summary] CRITICAL: Failed to update DB on failure: {db_err}")
        
        raise e
        
    return item


def _generate_audio(item_id: str, summary: str) -> None:
    """Background task to generate audio summary and store URL."""
    try:
        audio_url = AudioService.generate_summary_audio(item_id, summary)
        if audio_url:
            supabase.table("items").update({"audio_url": audio_url}).eq("id", item_id).execute()
    except Exception as e:
        logger.error(f"Background audio generation failed for item {item_id}: {e}")


def _get_user_interests(user_id: str) -> List[str]:
    """Fetch tags from completed items to derive user interests."""
    try:
        res = (
            supabase.table("items")
            .select("tags")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .execute()
        )
        all_tags: List[str] = []
        for row in res.data or []:
            t = row.get("tags") or []
            if isinstance(t, list):
                all_tags.extend(t)
        ai = get_ai_service()
        return ai.get_user_interests_from_history(all_tags)
    except Exception:
        return []


async def run_recalculate_priorities(user_id: str) -> int:
    try:
        # Fetch all non-completed items
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .neq("status", "completed")
            .execute()
        )
        items = result.data or []
        if not items:
            return 0

        # Merge local SQLite metadata (collection_id, notes, progress) if missing
        items = fallback_db.merge_items_metadata(user_id, items)

        ai = get_ai_service()
        user_interests = _get_user_interests(user_id)
        now = datetime.now(timezone.utc)
        updated = 0

        for item in items:
            try:
                created_at_str = item.get("created_at") or now.isoformat()
                try:
                    created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                    days_since = (now - created_at).days
                except Exception:
                    days_since = 0

                tags = item.get("tags") or []
                new_score = ai.calculate_priority(
                    title=item.get("title") or "",
                    summary=item.get("ai_summary"),
                    tags=tags,
                    source_type=item.get("content_type", "generic"),
                    estimated_time=item.get("estimated_read_time"),
                    days_since_added=days_since,
                    user_interests=user_interests,
                    is_favorite=item.get("is_favorite", False),
                    read_progress=item.get("read_progress", 0)
                )
                await asyncio.to_thread(
                    lambda: supabase.table("items").update({"priority_score": new_score}).eq("id", item["id"]).execute()
                )
                updated += 1
            except Exception as e:
                print(f"[items] Priority recalc failed for {item.get('id')}: {e}")

        return updated
    except Exception as e:
        print(f"[items] run_recalculate_priorities error: {e}")
        return 0


def format_tag_to_collection_name(tag: str) -> str:
    """Format raw tags (like 'software-development') into clean, capitalized names ('Software Development')."""
    # Remove leading hash if present
    tag = tag.lstrip('#')
    # Replace dashes/underscores with space
    words = tag.replace('-', ' ').replace('_', ' ').split()
    return " ".join(word.capitalize() for word in words)


def generate_fallback_tags(title: str) -> List[str]:
    import re
    words = re.findall(r'[a-zA-Z]{3,}', title.lower())
    stop_words = {
        "and", "the", "for", "you", "gonna", "never", "give", "with", "that", "this",
        "from", "youtube", "video", "article", "page", "about", "your", "what", "how",
        "who", "whom", "whose", "why", "where", "when", "which", "http", "https"
    }
    fallback_tags = [w for w in words if w not in stop_words]
    seen = set()
    result_tags = []
    for t in fallback_tags:
        if t not in seen:
            seen.add(t)
            result_tags.append(t)
            if len(result_tags) >= 3:
                break
    return result_tags if result_tags else ["uncategorized"]


def create_fallback_summary_from_text(title: str, text: str, description: str = "", source_type: str = "generic") -> str:
    # Clean up title
    clean_title = (title or "").strip()
    if clean_title.lower() in ("untitled video", "untitled", ""):
        clean_title = "Untitled Resource"
        
    # Detect if it's a coding problem/LeetCode video
    import re
    lower_title = clean_title.lower()
    is_leetcode = "leetcode" in lower_title or "l51" in lower_title or "two sum" in lower_title or "bst" in lower_title or "binary search tree" in lower_title or re.search(r'\b(l|leetcode)\s*\d+\b', lower_title)
    
    desc_clean = (description or "").strip()
    placeholders = {
        "content could not be extracted for summarization.",
        "summary unavailable.",
        "ai summary could not be generated.",
        "generating ai summary...",
        "limited text available",
        "no metadata or transcript available for this video.",
        "summary could not be generated.",
        "untitled video"
    }
    
    if desc_clean.lower() in placeholders:
        desc_clean = ""
        
    # Standardize LeetCode problem name extraction (e.g. "L51. Two Sum in BST" -> "Two Sum in BST")
    problem_name = clean_title
    for pattern in [
        r'(?i)leetcode\s*\d+\s*-?\s*',
        r'(?i)l\d+\.?\s*-?\s*',
        r'(?i)-\s*leetcode\s*\d+\s*-?\s*.*$',
        r'(?i)-\s*python.*$',
        r'(?i)-\s*java.*$',
        r'(?i)-\s*c\+\+.*$',
    ]:
        problem_name = re.sub(pattern, '', problem_name).strip()
    problem_name = problem_name.strip(" -|.")
    if not problem_name:
        problem_name = clean_title
        
    # Generate coding/LeetCode specific fallback summary
    if is_leetcode or "leetcode" in desc_clean.lower():
        algorithms = "algorithmic"
        if "bst" in lower_title or "binary search tree" in lower_title or "iterator" in lower_title:
            algorithms = "BST iterator/two-pointer"
        elif "stack" in lower_title:
            algorithms = "stack-based simulation"
        elif "two sum" in lower_title:
            algorithms = "hash map or two-pointer"
        elif "graph" in lower_title or "dfs" in lower_title or "bfs" in lower_title:
            algorithms = "depth-first search (DFS) or breadth-first search (BFS) traversal"
        elif "dp" in lower_title or "dynamic programming" in lower_title:
            algorithms = "dynamic programming optimization"
            
        return f"This video explains the LeetCode {problem_name} problem. It covers the {algorithms} approach, complexity analysis, implementation details and interview tips."

    # General YouTube fallback summary
    if source_type == "youtube" or "youtube.com" in text or "watch?v=" in text:
        if desc_clean and len(desc_clean) > 30:
            sentences = re.split(r'(?<=[.!?])\s+', desc_clean)
            summary_sentences = []
            for s in sentences:
                s_clean = s.strip()
                if s_clean and not any(p in s_clean.lower() for p in placeholders) and len(s_clean.split()) > 3:
                    summary_sentences.append(s_clean)
                    if len(summary_sentences) >= 3:
                        break
            if summary_sentences:
                return f"This video covers '{clean_title}'. " + " ".join(summary_sentences)
        return f"This video walkthrough provides a comprehensive overview of '{clean_title}', highlighting key insights, essential context, and useful demonstrations."

    # General article/webpage/PDF fallback summary
    if desc_clean and len(desc_clean) > 30:
        sentences = re.split(r'(?<=[.!?])\s+', desc_clean)
        summary_sentences = []
        for s in sentences:
            s_clean = s.strip()
            if s_clean and not any(p in s_clean.lower() for p in placeholders) and len(s_clean.split()) > 3:
                summary_sentences.append(s_clean)
                if len(summary_sentences) >= 3:
                    break
        if summary_sentences:
            return " ".join(summary_sentences)
            
    if text and len(text.strip()) > 30:
        sentences = re.split(r'(?<=[.!?])\s+', text)
        summary_sentences = []
        for s in sentences:
            s_clean = s.strip()
            if s_clean and not any(p in s_clean.lower() for p in placeholders) and len(s_clean.split()) > 3:
                summary_sentences.append(s_clean)
                if len(summary_sentences) >= 3:
                    break
        if summary_sentences:
            return " ".join(summary_sentences)

    return f"This document explores '{clean_title}', offering a structured guide with key concepts, background context, and detailed analysis."


async def _run_background_extraction_and_enrichment_impl(
    item_id: str,
    clean_url: str,
    user_id: str,
    title_override: Optional[str] = None
) -> None:
    """Background task to extract content, fetch user interests, analyze with AI, compute priority/embeddings, and update DB."""
    import time
    import traceback
    import math

    def log_stage(stage: str, message: str):
        update_ingestion_debug(item_id, stage, message)

    def log_stage_error(stage: str, message: str, error_trace: str):
        update_ingestion_debug(item_id, stage, message, error=error_trace)

    log_stage("metadata_extraction", f"Starting background extraction for URL: '{clean_url}'")

    async def safe_db_update(data: dict) -> None:
        SAFE_COLUMNS = {
            "title", "description", "content_type", "source_name", "thumbnail_url",
            "estimated_read_time", "duration_seconds", "extracted_text", "author", "tags",
            "ai_summary", "priority_score", "processing_status"
        }
        if fallback_db.has_collection_id:
            SAFE_COLUMNS.add("collection_id")
        if fallback_db.has_source_type:
            SAFE_COLUMNS.add("source_type")
        if fallback_db.has_source_domain:
            SAFE_COLUMNS.add("source_domain")
        if fallback_db.has_logo_url:
            SAFE_COLUMNS.add("logo_url")
        if fallback_db.has_full_summary:
            SAFE_COLUMNS.add("full_summary")
        if fallback_db.has_estimated_time_minutes:
            SAFE_COLUMNS.add("estimated_time_minutes")
            
        cleaned_data = {k: v for k, v in data.items() if k in SAFE_COLUMNS}
        
        if "content_type" in cleaned_data and not cleaned_data["content_type"]:
            cleaned_data["content_type"] = "generic"
            
        try:
            await asyncio.to_thread(
                lambda: supabase.table("items").update(cleaned_data).eq("id", item_id).execute()
            )
        except Exception as update_err:
            logger.warning(f"Database update failed, retrying fallback: {update_err}")
            exclude_cols = {"source_type", "source_domain", "logo_url", "collection_id", "full_summary", "estimated_time_minutes"}
            fallback_data = {k: v for k, v in cleaned_data.items() if k not in exclude_cols}
            await asyncio.to_thread(
                lambda: supabase.table("items").update(fallback_data).eq("id", item_id).execute()
            )

    # Transition to processing state initially
    print(f"[PIPELINE LOG] [Stage Transition] {item_id}: queued -> processing")
    print(f"[PIPELINE LOG] [Stage Transition] Queued -> Processing")
    await safe_db_update({"processing_status": "processing"})

    extracted = {}
    user_interests = []
    
    # 1. Extraction Stage
    try:
        print(f"[PIPELINE LOG] [Extraction] Start: {clean_url}")
        log_stage("metadata_extraction", "Running content extraction tasks...")
        extracted_task = extract_content(clean_url)
        user_interests_task = asyncio.to_thread(_get_user_interests, user_id)
        
        extracted, user_interests = await asyncio.gather(extracted_task, user_interests_task)
        log_stage("metadata_extraction", "Content extraction tasks completed.")
        print(f"[PIPELINE LOG] [Extraction] Success: transcript length = {len(extracted.get('transcript') or '')}, article length = {len(extracted.get('full_text') or '')}")
    except Exception as ext_err:
        tb = traceback.format_exc()
        log_stage_error("metadata_extraction", f"Extraction tasks failed: {ext_err}", tb)
        extracted = {}
        user_interests = []

    full_text_val = extracted.get("full_text") or ""
    description_val = extracted.get("description") or ""
    transcript_val = extracted.get("transcript") or ""
    title_val = title_override or extracted.get("title") or clean_url
    source_type = extracted.get("source_type", "generic")
    source_name = extracted.get("source_name")
    source_domain = extracted.get("source_domain")
    logo_url = extracted.get("logo_url")
    thumbnail_url = extracted.get("thumbnail_url")
    duration_seconds = extracted.get("duration_seconds")
    author = extracted.get("author")

    # 2. Transcript/Article Extraction Stage
    log_stage("transcript_extraction", f"Checking transcript / text availability for content type: '{source_type}'...")
    if source_type == "youtube":
        if transcript_val:
            content_source = "TRANSCRIPT"
            log_stage("transcript_extraction", f"YouTube transcript successfully extracted ({len(transcript_val)} chars).")
        else:
            content_source = "DESCRIPTION"
            log_stage("transcript_extraction", "YouTube transcript extraction failed/not found. Video description used.")
    elif source_type == "pdf":
        content_source = "PDF"
        if full_text_val:
            log_stage("transcript_extraction", f"PDF text successfully extracted ({len(full_text_val)} chars).")
        else:
            log_stage("transcript_extraction", "PDF text extraction failed or returned empty.")
    elif source_type == "article":
        content_source = "ARTICLE"
        if full_text_val:
            log_stage("transcript_extraction", f"Article body text successfully extracted ({len(full_text_val)} chars).")
        else:
            log_stage("transcript_extraction", "Article body text extraction failed or returned empty.")
    else:
        content_source = "WEBPAGE"
        if full_text_val:
            log_stage("transcript_extraction", f"Generic webpage body text successfully extracted ({len(full_text_val)} chars).")
        else:
            log_stage("transcript_extraction", "Generic webpage body text extraction failed or returned empty.")

    log_stage("transcript_extraction", f"content_source = {content_source}")
    print(f"[PIPELINE LOG] content_source = {content_source}")

    # 3. AI Summary Generation (with retries and fallback summary)
    content_to_use = get_usable_content({
        "transcript": transcript_val,
        "extracted_text": full_text_val,
        "title": title_val,
        "description": description_val,
        "author": author,
        "url": clean_url,
        "source_type": source_type
    })

    if content_to_use:
        content_to_use = reject_footer_and_navigation_text(content_to_use)

    summary = "Transcript unavailable"
    full_summary = "Transcript unavailable"
    tags = ["uncategorized"]
    priority_score = 40.0
    embedding = None
    quota_exhausted = False
    assigned_collection_id = None

    if content_to_use:
        ai = get_ai_service()
        embedding_task = asyncio.to_thread(ai.generate_embedding, content_to_use)
        
        # Log transcript and article lengths
        log_stage("ai_summary", f"extracted_text_length: {len(full_text_val)}, transcript_length: {len(transcript_val)}, content_to_use_length: {len(content_to_use)}")
        print(f"[PIPELINE LOG] [AI Summary] transcript length: {len(transcript_val) if transcript_val else 0}")
        print(f"[PIPELINE LOG] [AI Summary] article length: {len(full_text_val) if full_text_val else 0}")
        
        # Log content sent to Gemini
        try:
            print(f"[PIPELINE LOG] [AI Summary] content sent to Gemini: {content_to_use[:1000]}...")
        except Exception:
            pass

        # Fetch existing collections first (to pass to Gemini)
        user_cols = []
        collection_names = []
        try:
            user_cols = fallback_db.list_collections(user_id, supabase)
            collection_names = [c["name"] for c in user_cols]
        except Exception as col_list_err:
            logger.error(f"Failed to list collections for AI pass: {col_list_err}")

        analysis = None
        for attempt in range(3):
            try:
                log_stage("ai_summary", f"AI generation attempt {attempt + 1}/3... (content_chars={len(content_to_use)})")
                print(f"[PIPELINE LOG] [Gemini Request] Sending request to Gemini (attempt {attempt + 1})...")
                analysis = await asyncio.wait_for(
                    asyncio.to_thread(
                        ai.analyze_content,
                        title_val,
                        content_to_use,
                        source_type,
                        bool(transcript_val),
                        collection_names
                    ),
                    timeout=60.0
                )
                if analysis and analysis.get("summary"):
                    log_stage("ai_summary", f"AI generation attempt {attempt + 1}/3 succeeded.")
                    break
                else:
                    raise ValueError("AI returned empty result")
            except Exception as e:
                tb_ai = traceback.format_exc()
                log_stage_error("ai_summary", f"AI generation attempt {attempt + 1}/3 failed: {e}", tb_ai)
                print(f"[PIPELINE LOG] [AI Summary] AI generation attempt {attempt + 1}/3 failed with: {e}")
                err_str = str(e)
                if ("GenerateRequestsPerDayPerProjectPerModel" in err_str or 
                    "generate_content_free_tier_requests" in err_str or 
                    "Quota exceeded" in err_str or
                    "429" in err_str):
                    quota_exhausted = True
                    log_stage("ai_summary", "Gemini daily quota exhausted. Setting status to 'ai_pending' and stopping attempts.")
                    break
                if attempt < 2:
                    await asyncio.sleep(2.0)

        if analysis and analysis.get("summary"):
            summary = analysis.get("summary")
            full_summary = analysis.get("full_summary") or ""
            tags = analysis.get("tags") or ["uncategorized"]
            priority_score = analysis.get("priority", 50.0)
            suggested_col = analysis.get("collection")
            
            # Log response length
            response_len = len(summary) + len(full_summary)
            print(f"[PIPELINE LOG] [AI Summary] gemini_called=true gemini_success=true")
            print(f"[PIPELINE LOG] [AI Summary] Gemini response length: {response_len}")
            print(f"[PIPELINE LOG] [Gemini Response] Success: length={response_len}")
            
            # Resolve Collection Classification from Gemini suggestion
            if suggested_col:
                existing_cols_map = {c["name"].lower().strip(): c["id"] for c in user_cols}
                suggested_col_clean = suggested_col.strip()
                suggested_col_lower = suggested_col_clean.lower()
                
                if suggested_col_lower in existing_cols_map:
                    assigned_collection_id = existing_cols_map[suggested_col_lower]
                    log_stage("folder_classification", f"Classified into existing collection: '{suggested_col_clean}' (ID: {assigned_collection_id})")
                else:
                    try:
                        new_col = fallback_db.create_collection(
                            user_id=user_id,
                            name=suggested_col_clean,
                            color="blue",
                            supabase_client=supabase
                        )
                        assigned_collection_id = new_col["id"]
                        log_stage("folder_classification", f"Created and classified into new collection: '{suggested_col_clean}' (ID: {assigned_collection_id})")
                    except Exception as new_col_err:
                        logger.error(f"Failed to create new collection '{suggested_col_clean}': {new_col_err}")
        else:
            if quota_exhausted:
                summary = None
                full_summary = None
                tags = ["uncategorized"]
                priority_score = 50.0
                print(f"[PIPELINE LOG] [Gemini Response] Paused (Quota Exhausted)")
            else:
                log_stage("ai_summary", "AI generation failed after all attempts. Storing 'Transcript unavailable'...")
                summary = "Transcript unavailable"
                full_summary = "Transcript unavailable"
                tags = ["uncategorized"]
                priority_score = 40.0
                print(f"[PIPELINE LOG] [Gemini Response] Failed completely")

        try:
            print("[PIPELINE LOG] [Embedding] Awaiting embedding task...")
            embedding = await asyncio.wait_for(embedding_task, timeout=30.0)
            if embedding:
                log_stage("ai_summary", "Vector embedding generated successfully.")
                print(f"[PIPELINE LOG] [Embedding] Success: length={len(embedding)}")
        except Exception as emb_err:
            logger.warning(f"Embedding failed: {emb_err}")
            log_stage("ai_summary", f"Vector embedding generation failed/skipped: {emb_err}")
    else:
        log_stage("ai_summary", "No content available to summarize. Storing 'Transcript unavailable'...")
        print(f"[PIPELINE LOG] [AI Summary] transcript length: {len(transcript_val) if transcript_val else 0}")
        print(f"[PIPELINE LOG] [AI Summary] article length: {len(full_text_val) if full_text_val else 0}")

    # Fallback to Read Later if no collection was resolved
    if not assigned_collection_id:
        try:
            user_cols = fallback_db.list_collections(user_id, supabase)
            existing_cols_map = {c["name"].lower().strip(): c["id"] for c in user_cols}
            if "read later" in existing_cols_map:
                assigned_collection_id = existing_cols_map["read later"]
            else:
                new_col = fallback_db.create_collection(
                    user_id=user_id,
                    name="Read Later",
                    color="blue",
                    supabase_client=supabase
                )
                assigned_collection_id = new_col["id"]
        except Exception as def_col_err:
            logger.error(f"Failed to assign default collection: {def_col_err}")

    # 6. Estimated Time Calculation
    log_stage("estimated_time", "Calculating estimated read/watch/time system parameters...")
    if source_type == "youtube":
        dur = duration_seconds or 0
        estimated_read_time = max(1, math.ceil(dur / 60.0))
        if dur > 0:
            estimated_time_minutes = float(dur) / 60.0
        else:
            estimated_time_minutes = 5.0
        log_stage("estimated_time", f"YouTube: duration={dur}s -> estimated_read_time={estimated_read_time}m, estimated_time_minutes={estimated_time_minutes}m")
    elif source_type == "pdf":
        pages = extracted.get("page_count") or 1
        estimated_read_time = pages * 2
        words = len(full_text_val.split()) if full_text_val else 0
        if words > 0:
            estimated_time_minutes = float(math.ceil(words / 180.0))
        else:
            estimated_time_minutes = 5.0
        log_stage("estimated_time", f"PDF: pages={pages}, words={words} -> estimated_read_time={estimated_read_time}m, estimated_time_minutes={estimated_time_minutes}m")
    else:
        word_count = len(full_text_val.split()) if full_text_val else 0
        estimated_read_time = max(1, math.ceil(word_count / 200.0)) # 200 WPM
        if word_count > 0:
            estimated_time_minutes = float(math.ceil(word_count / 200.0))
        else:
            estimated_time_minutes = 5.0
        log_stage("estimated_time", f"Article: words={word_count} -> estimated_read_time={estimated_read_time}m, estimated_time_minutes={estimated_time_minutes}m")

    # 7. Database Update (ONE write transaction)
    log_stage("db_update", "Saving final record to database...")
    processing_status = "completed"
    if quota_exhausted:
        processing_status = "pending_quota"
        summary = "AI summary will be generated automatically after quota reset."
        full_summary = "AI summary will be generated automatically after quota reset."
    elif summary in ("Transcript unavailable", "Summary could not be generated.", None, ""):
        processing_status = "failed"
        
    print(f"[PIPELINE LOG] [Stage Transition] {item_id}: processing -> {processing_status}")
    print(f"[PIPELINE LOG] [Stage Transition] Processing -> {processing_status.capitalize() if processing_status != 'pending_quota' else 'PendingQuota'}")

    final_data = {
        "title": title_val,
        "description": description_val or None,
        "content_type": source_type,
        "source_name": source_name,
        "source_type": source_type,
        "source_domain": source_domain,
        "logo_url": logo_url,
        "thumbnail_url": thumbnail_url,
        "duration_seconds": duration_seconds,
        "estimated_read_time": estimated_read_time,
        "estimated_time_minutes": estimated_time_minutes,
        "extracted_text": full_text_val or None,
        "author": author,
        "ai_summary": summary,
        "full_summary": full_summary,
        "tags": tags,
        "priority_score": priority_score,
        "processing_status": processing_status
    }
    if assigned_collection_id:
        final_data["collection_id"] = assigned_collection_id

    try:
        # Log DB value BEFORE save
        try:
            before_res = await asyncio.to_thread(
                lambda: supabase.table("items").select("ai_summary, full_summary").eq("id", item_id).execute()
            )
            before_val = (before_res.data or [{}])[0] if before_res.data else {}
            print(f"[PIPELINE LOG] [DB] BEFORE SAVE: ai_summary={repr(str(before_val.get('ai_summary',''))[:80])} full_summary={repr(str(before_val.get('full_summary',''))[:80])}")
        except Exception as before_err:
            print(f"[PIPELINE LOG] [DB] Could not read before-save value: {before_err}")

        print(f"[PIPELINE LOG] [DB] Saving: ai_summary_chars={len(summary) if summary else 0} full_summary_chars={len(full_summary) if full_summary else 0} has_full_summary_col={fallback_db.has_full_summary}")
        await safe_db_update(final_data)

        # Log DB value AFTER save
        try:
            after_res = await asyncio.to_thread(
                lambda: supabase.table("items").select("ai_summary, full_summary").eq("id", item_id).execute()
            )
            after_val = (after_res.data or [{}])[0] if after_res.data else {}
            print(f"[PIPELINE LOG] [DB] AFTER SAVE: ai_summary={repr(str(after_val.get('ai_summary',''))[:80])} full_summary={repr(str(after_val.get('full_summary',''))[:80])}")
            # Detect if full_summary was overwritten or dropped
            saved_fs = after_val.get('full_summary') or ""
            if full_summary and len(full_summary.strip()) > 100 and len(saved_fs.strip()) < 50:
                print(f"[PIPELINE LOG] [DB] WARNING: Gemini full_summary was NOT saved to Supabase (has_full_summary={fallback_db.has_full_summary}). Will save to local SQLite.")
        except Exception as after_err:
            print(f"[PIPELINE LOG] [DB] Could not read after-save value: {after_err}")

        local_meta_updates = {}
        if assigned_collection_id:
            local_meta_updates["collection_id"] = assigned_collection_id
        if full_summary:
            local_meta_updates["full_summary"] = full_summary
        local_meta_updates["estimated_time_minutes"] = estimated_time_minutes
            
        if local_meta_updates:
            try:
                fallback_db.update_item_metadata(user_id, item_id, local_meta_updates, supabase)
            except Exception as assoc_err:
                logger.error(f"Failed to update metadata locally: {assoc_err}")
        log_stage("db_update", "Database updated successfully.")
        print(f"[PIPELINE LOG] [Database Update] Success for item {item_id}")
    except Exception as db_err:
        tb_db = traceback.format_exc()
        log_stage_error("db_update", f"Database update failed: {db_err}", tb_db)
        raise db_err

    # Trigger background vector indexing
    if embedding:
        try:
            from services.vector_service import calculate_text_hash, save_embedding
            h = calculate_text_hash(title_val, summary, tags)
            await asyncio.to_thread(save_embedding, item_id, user_id, embedding, h)
        except Exception as emb_save_err:
            logger.error(f"Failed to save embedding: {emb_save_err}")

    print("[PIPELINE LOG] [Priority Recalculation] Start recalculation...")
    await run_recalculate_priorities(user_id)
    print("[PIPELINE LOG] [Priority Recalculation] Success")

    # Schedule audio generation if summary is successful
    if summary and summary not in ["Summary could not be generated.", "No transcript or readable webpage content could be extracted for detailed summarization."]:
        print("[PIPELINE LOG] [Audio Generation] Scheduling background audio task...")
        asyncio.create_task(asyncio.to_thread(_generate_audio, item_id, summary))

    # 8. Frontend Refresh Stage
    log_stage("frontend_refresh", f"Ingestion completed with status '{processing_status}'. Frontend refresh automatically triggered.")
    update_ingestion_debug(
        item_id,
        processing_status,
        "Ingestion pipeline finished with SUCCESS." if not quota_exhausted else "Ingestion pipeline paused due to daily AI quota limit."
    )
    print(f"[PIPELINE LOG] Ingestion pipeline finished with status: {processing_status}")


async def run_background_extraction_and_enrichment(
    item_id: str,
    clean_url: str,
    user_id: str,
    title_override: Optional[str] = None
) -> None:
    lock = item_locks[item_id]
    if lock.locked():
        logger.info(f"[INGESTION] Duplicate job skipped for item {item_id}")
        print(f"[INGESTION] Duplicate job skipped for item {item_id}")
        return

    async with lock:
        try:
            await asyncio.wait_for(
                _run_background_extraction_and_enrichment_impl(item_id, clean_url, user_id, title_override),
                timeout=60.0
            )
        except asyncio.TimeoutError:
            logger.error(f"[INGESTION] Pipeline timed out (>60s) for item {item_id}")
            print(f"[INGESTION] Pipeline timed out (>60s) for item {item_id}")
            try:
                # Safe DB update to failed status so the UI is updated immediately
                await asyncio.to_thread(
                    lambda: supabase.table("items").update({
                        "processing_status": "failed",
                        "ai_summary": "Failed to generate summary: Ingestion pipeline timed out after 60 seconds"
                    }).eq("id", item_id).execute()
                )
                update_ingestion_debug(item_id, "failed", "Ingestion pipeline failed: Timeout after 60 seconds")
                print(f"[PIPELINE LOG] [Stage Transition] {item_id}: processing -> failed (Timeout)")
                print(f"[PIPELINE LOG] [Stage Transition] Processing -> Failed")
            except Exception as db_err:
                logger.error(f"Failed to update failed status in DB for item {item_id}: {db_err}")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            logger.error(f"[INGESTION] Pipeline crashed for item {item_id}: {e}\n{tb}")
            print(f"[INGESTION] Pipeline crashed for item {item_id}: {e}\n{tb}")
            try:
                # Safe DB update to failed status so the UI is updated immediately
                await asyncio.to_thread(
                    lambda: supabase.table("items").update({
                        "processing_status": "failed",
                        "ai_summary": f"Failed to generate summary: {str(e)}"
                    }).eq("id", item_id).execute()
                )
                update_ingestion_debug(item_id, "failed", f"Ingestion pipeline failed: {e}", error=tb)
                print(f"[PIPELINE LOG] [Stage Transition] {item_id}: processing -> failed (Crash)")
                print(f"[PIPELINE LOG] [Stage Transition] Processing -> Failed")
            except Exception as db_err:
                logger.error(f"Failed to update failed status in DB for item {item_id}: {db_err}")


async def recover_processing_items():
    print("[RECOVERY] Starting processing items recovery worker...")
    try:
        res = supabase.table("items").select("*").in_("processing_status", ["queued", "processing"]).execute()
        items = res.data or []
        print(f"[RECOVERY] Found {len(items)} items in 'queued' or 'processing' state.")
        now = datetime.now(timezone.utc)
        for item in items:
            item_id = item.get("id")
            added_at_str = item.get("added_at")
            ai_summary = item.get("ai_summary")
            url = item.get("url")
            user_id = item.get("user_id")
            title = item.get("title")

            has_valid_summary = False
            if ai_summary:
                has_valid_summary = is_valid_content_for_summary(ai_summary)

            if has_valid_summary:
                print(f"[RECOVERY] Item {item_id} has a valid summary. Marking as completed.")
                supabase.table("items").update({
                    "processing_status": "completed"
                }).eq("id", item_id).execute()
                continue

            is_stale = False
            if added_at_str:
                try:
                    clean_added = added_at_str.replace("Z", "+00:00")
                    added_at = datetime.fromisoformat(clean_added)
                    if now - added_at > timedelta(minutes=10):
                        is_stale = True
                except Exception as e:
                    logger.error(f"[RECOVERY] Error parsing added_at for item {item_id}: {e}")
            
            if is_stale:
                print(f"[RECOVERY] Item {item_id} has been processing for >10 mins. Marking as failed.")
                supabase.table("items").update({
                    "processing_status": "failed",
                    "ai_summary": "Summary could not be generated."
                }).eq("id", item_id).execute()
            else:
                print(f"[RECOVERY] Resuming AI processing for item {item_id}...")
                asyncio.create_task(
                    run_background_extraction_and_enrichment(
                        item_id,
                        url,
                        user_id,
                        title
                    )
                )
    except Exception as e:
        logger.error(f"[RECOVERY] Failed to run recovery: {e}", exc_info=True)
        print(f"[RECOVERY] Failed: {e}")


async def run_quota_retry_task():
    logger.info("[SCHEDULER] Fetching all items in pending_quota state...")
    print("[PIPELINE LOG] [SCHEDULER] Fetching all items in pending_quota state...")
    try:
        res = await asyncio.to_thread(
            lambda: supabase.table("items").select("*").eq("processing_status", "pending_quota").execute()
        )
        items = res.data or []
        logger.info(f"[SCHEDULER] Found {len(items)} items to retry.")
        print(f"[PIPELINE LOG] [SCHEDULER] Found {len(items)} items to retry.")
        
        for item in items:
            item_id = item.get("id")
            url = item.get("url")
            user_id = item.get("user_id")
            title = item.get("title")
            
            logger.info(f"[SCHEDULER] Retrying AI summary generation for item {item_id}...")
            print(f"[PIPELINE LOG] [SCHEDULER] Retrying AI summary generation for item {item_id}...")
            
            # Prevent duplicate AI jobs using processing_lock
            lock = item_locks[item_id]
            if lock.locked():
                logger.info(f"[SCHEDULER] Item {item_id} is already being processed. Skipping.")
                continue
                
            async with lock:
                try:
                    # Transition to processing for stage transition logging
                    print(f"[PIPELINE LOG] [Stage Transition] {item_id}: pending_quota -> processing")
                    print(f"[PIPELINE LOG] [Stage Transition] PendingQuota -> Processing")
                    await asyncio.to_thread(
                        lambda: supabase.table("items").update({
                            "processing_status": "processing"
                        }).eq("id", item_id).execute()
                    )
                    
                    # Run implementation
                    await asyncio.wait_for(
                        _run_background_extraction_and_enrichment_impl(item_id, url, user_id, title),
                        timeout=60.0
                    )
                    
                    # Verify final status
                    check_res = await asyncio.to_thread(
                        lambda: supabase.table("items").select("processing_status").eq("id", item_id).execute()
                    )
                    status_after = check_res.data[0].get("processing_status") if check_res.data else ""
                    if status_after == "completed":
                        print(f"[PIPELINE LOG] [SCHEDULER] Success for item {item_id}!")
                    else:
                        print(f"[PIPELINE LOG] [SCHEDULER] Item {item_id} did not complete successfully (status: {status_after}). Keeping as pending_quota.")
                        await asyncio.to_thread(
                            lambda: supabase.table("items").update({
                                "processing_status": "pending_quota",
                                "ai_summary": "AI summary will be generated automatically after quota reset."
                            }).eq("id", item_id).execute()
                        )
                        print(f"[PIPELINE LOG] [Stage Transition] {item_id}: processing -> pending_quota (Retry Keep Pending)")
                        print(f"[PIPELINE LOG] [Stage Transition] Processing -> PendingQuota")
                except Exception as e:
                    logger.error(f"[SCHEDULER] Failed to process item {item_id}: {e}")
                    print(f"[PIPELINE LOG] [SCHEDULER] Failed to process item {item_id}: {e}")
                    await asyncio.to_thread(
                        lambda: supabase.table("items").update({
                            "processing_status": "pending_quota",
                            "ai_summary": "AI summary will be generated automatically after quota reset."
                        }).eq("id", item_id).execute()
                    )
                    print(f"[PIPELINE LOG] [Stage Transition] {item_id}: processing -> pending_quota (Retry Failed Exception)")
                    print(f"[PIPELINE LOG] [Stage Transition] Processing -> PendingQuota")
    except Exception as e:
        logger.error(f"[SCHEDULER] Error in run_quota_retry_task: {e}")

async def quota_retry_scheduler():
    logger.info("[SCHEDULER] Starting quota retry scheduler...")
    while True:
        try:
            await asyncio.sleep(1800) # every 30 min
            await run_quota_retry_task()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[SCHEDULER] Error in quota retry scheduler: {e}")
            await asyncio.sleep(60)



# ---------------------------------------------------------------------------
# POST /api/items/suggest-collection — AI Collection Suggestion on Save
# ---------------------------------------------------------------------------

from pydantic import BaseModel

class SuggestCollectionRequest(BaseModel):
    url: str

@router.post("/suggest-collection")
async def suggest_collection(
    req: SuggestCollectionRequest,
    user_id: str = Depends(get_user_id)
):
    """
    Given a URL, fetch basic metadata (like title) and query the AI service
    to suggest the most appropriate collection from the user's existing collections.
    If none matches, suggest a new collection name and color.
    """
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL cannot be empty")
        
    try:
        # Step 1: Extract lightweight metadata
        metadata = await extract_content(url)
        title = metadata.get("title") or url
        description = metadata.get("description") or ""
        
        # Step 2: Fetch user's existing collections
        collections = fallback_db.list_collections(user_id, supabase)
        collection_names = [c["name"] for c in collections]
        
        # Step 3: Use Gemini via AI service to suggest a collection
        ai = get_ai_service()
        suggestion = ai.suggest_collection_for_content(
            title=title,
            description=description,
            existing_collections=collection_names,
            tags=metadata.get("tags")
        )
        
        # Match with existing collection id if exists
        suggested_id = None
        for c in collections:
            if c["name"].lower().strip() == suggestion["name"].lower().strip():
                suggested_id = c["id"]
                suggestion["is_new"] = False
                suggestion["color"] = c["color"]
                break
                
        return {
            "suggested_collection_id": suggested_id,
            "name": suggestion["name"],
            "color": suggestion["color"],
            "is_new": suggestion["is_new"]
        }
    except Exception as e:
        logger.error(f"Failed to suggest collection: {e}")
        # Default fallback
        return {
            "suggested_collection_id": None,
            "name": "Reading List",
            "color": "blue",
            "is_new": True
        }


# Helper background task for reclassifying all uncategorized items
async def run_reclassify_all_items(user_id: str):
    try:
        # Get all user items from DB
        res = await asyncio.to_thread(
            lambda: supabase.table("items").select("*").eq("user_id", user_id).execute()
        )
        items_data = res.data or []
        
        # Merge local metadata to find uncategorized items
        items = [item_to_response(r) for r in items_data]
        items = fallback_db.merge_items_metadata(user_id, items)
        
        uncategorized_items = [item for item in items if not item.get("collection_id")]
        if not uncategorized_items:
            print(f"[RECLASSIFY] No uncategorized items found for user {user_id}")
            return
            
        print(f"[RECLASSIFY] Found {len(uncategorized_items)} uncategorized items. Starting AI assignment...")
        
        ai = get_ai_service()
        
        for item in uncategorized_items:
            # Refresh user collections in each iteration (so we use any new collections created)
            user_cols = fallback_db.list_collections(user_id, supabase)
            collection_names = [c["name"] for c in user_cols]
            
            title = item.get("title") or item.get("url") or "Untitled"
            description = item.get("description") or ""
            summary = item.get("ai_summary") or ""
            tags = item.get("tags") or []
            
            suggestion = ai.suggest_collection_for_content(
                title=title,
                description=description or summary,
                existing_collections=collection_names,
                tags=tags
            )
            
            col_name = suggestion.get("name")
            col_color = suggestion.get("color") or "blue"
            
            if col_name:
                existing_cols_map = {c["name"].lower().strip(): c["id"] for c in user_cols}
                col_name_lower = col_name.lower().strip()
                
                assigned_col_id = None
                if col_name_lower in existing_cols_map:
                    assigned_col_id = existing_cols_map[col_name_lower]
                else:
                    try:
                        new_col = fallback_db.create_collection(
                            user_id=user_id,
                            name=col_name,
                            color=col_color,
                            supabase_client=supabase
                        )
                        assigned_col_id = new_col["id"]
                        print(f"[RECLASSIFY] Created collection '{col_name}' during reclassify")
                    except Exception as create_err:
                        logger.error(f"[RECLASSIFY] Failed to create collection '{col_name}': {create_err}")
                        
                if assigned_col_id:
                    try:
                        fallback_db.update_item_metadata(user_id, item["id"], {"collection_id": assigned_col_id}, supabase)
                        print(f"[RECLASSIFY] Reclassified item '{title}' into collection '{col_name}'")
                    except Exception as update_err:
                        logger.error(f"[RECLASSIFY] Failed to update item '{title}' to collection '{col_name}': {update_err}")
                        
        print(f"[RECLASSIFY] Completed reclassification for user {user_id}")
    except Exception as e:
        logger.error(f"[RECLASSIFY] Error during reclassification task: {e}", exc_info=True)


@router.post("/reclassify")
async def reclassify_items(background_tasks: BackgroundTasks, user_id: str = Depends(get_user_id)):
    """Trigger a background batch reclassification of all uncategorized items."""
    background_tasks.add_task(run_reclassify_all_items, user_id)
    return {"message": "Reclassification started in background"}


# ---------------------------------------------------------------------------
# POST /api/items — Create
# ---------------------------------------------------------------------------

@router.post("")
async def create_item(req: ItemCreate, background_tasks: BackgroundTasks, user_id: str = Depends(get_user_id)):
    try:
        clean_url = req.url.strip()

        # Duplicate check
        existing = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .eq("url", clean_url)
            .execute()
        )
        if existing.data:
            print(f"[items] Duplicate URL for user {user_id}, returning existing item")
            return item_to_response(existing.data[0])

        # Synchronous, instant source detection
        platform_info = resolve_platform_info(clean_url)
        title = req.title or clean_url

        # Resolve collection_id / Handle suggested collection creation
        collection_id = req.collection_id
        if not collection_id and req.suggested_collection_name:
            try:
                user_cols = fallback_db.list_collections(user_id, supabase)
                existing_col = None
                for c in user_cols:
                    if c["name"].lower().strip() == req.suggested_collection_name.lower().strip():
                        existing_col = c
                        break
                
                if existing_col:
                    collection_id = existing_col["id"]
                else:
                    new_col = fallback_db.create_collection(
                        user_id=user_id,
                        name=req.suggested_collection_name.strip(),
                        color=req.suggested_collection_color or "blue",
                        supabase_client=supabase
                    )
                    collection_id = new_col["id"]
            except Exception as col_err:
                logger.error(f"Failed to create suggested collection '{req.suggested_collection_name}': {col_err}")

        # Build initial DB row with 'processing' status
        item_data = {
            "user_id": user_id,
            "url": clean_url,
            "title": title,
            "content_type": platform_info["source_type"],
            "source_name": platform_info["source_name"],
            "source_type": platform_info["source_type"],
            "source_domain": platform_info["source_domain"],
            "logo_url": platform_info["logo_url"],
            "tags": ["uncategorized"],
            "ai_summary": None,
            "priority_score": 50.0,
            "status": "unread",
            "processing_status": "queued",
            "is_favorite": False,
        }
        if fallback_db.has_estimated_time_minutes:
            item_data["estimated_time_minutes"] = 5.0
        if fallback_db.has_collection_id and collection_id:
            item_data["collection_id"] = collection_id

        try:
            result = await asyncio.to_thread(
                lambda: supabase.table("items").insert(item_data).execute()
            )
        except Exception as e:
            if "column" in str(e).lower():
                logger.warning("Database insert failed due to missing branding columns. Retrying without new columns.")
                fallback_item_data = {k: v for k, v in item_data.items() if k not in ["source_type", "source_domain", "logo_url"]}
                if fallback_db.has_collection_id and collection_id:
                    fallback_item_data["collection_id"] = collection_id
                result = await asyncio.to_thread(
                    lambda: supabase.table("items").insert(fallback_item_data).execute()
                )
            else:
                raise e
        if not result.data:
            raise Exception("Failed to insert item into database")

        print("[PIPELINE LOG] Database saved initially")
        logger.info("Database saved initially")

        item_id = result.data[0].get('id')
        print(f"[items] Saved item id={item_id}")
        update_ingestion_debug(item_id, "validation", f"Initial validation and DB insert completed. URL: '{clean_url}'")
        
        # Save collection_id and initial estimated_time_minutes locally if needed (handles both remote/local SQLite fallback)
        meta_updates = {}
        if collection_id:
            meta_updates["collection_id"] = collection_id
        if not fallback_db.has_estimated_time_minutes:
            meta_updates["estimated_time_minutes"] = 5.0
            
        if meta_updates:
            try:
                fallback_db.update_item_metadata(user_id, item_id, meta_updates, supabase)
            except Exception as col_save_err:
                logger.error(f"Failed to save collection/time metadata: {col_save_err}")
        
        # Run the extraction and enrichment pipeline asynchronously
        background_tasks.add_task(
            run_background_extraction_and_enrichment,
            item_id,
            clean_url,
            user_id,
            req.title
        )
        
        # Fetch the initially inserted item row
        res_inserted = await asyncio.to_thread(
            lambda: supabase.table("items").select("*").eq("id", item_id).execute()
        )
        if not res_inserted.data:
            raise Exception("Failed to retrieve the inserted item from the database")
            
        final_item = fallback_db.merge_single_item_metadata(user_id, res_inserted.data[0])
        return item_to_response(final_item)

    except HTTPException:
        raise
    except Exception as e:
        print(f"[items] create_item error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/items — List with filtering, sorting, pagination
# ---------------------------------------------------------------------------

@router.get("")
async def get_items(
    status: Optional[str] = None,
    type: Optional[str] = None,
    tag: Optional[str] = None,
    collection_id: Optional[str] = None,
    search: Optional[str] = None,
    sort: Optional[str] = "newest",       # newest | priority | shortest | longest
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    user_id: str = Depends(get_user_id),
):
    try:
        select_cols = fallback_db.get_optimized_select_string()
        query = supabase.table("items").select(select_cols, count="exact").eq("user_id", user_id)

        # Filters
        if status:
            query = query.eq("status", status)
        if type:
            query = query.eq("content_type", type)
        if tag:
            # Supabase array contains
            query = query.contains("tags", [tag])
            
        # collection_id filter
        apply_collection_filter_in_memory = False
        if collection_id:
            if fallback_db.has_collection_id:
                if collection_id in ("none", "null"):
                    query = query.is_("collection_id", "null")
                else:
                    query = query.eq("collection_id", collection_id)
            else:
                apply_collection_filter_in_memory = True
                
        # Check if search is active (hybrid semantic search)
        if search and search.strip():
            # Retrieve all candidates matching status/type/tag/collection filters from DB
            result = await asyncio.to_thread(query.execute)
            items = [item_to_response(r) for r in (result.data or [])]
            
            # Merge local SQLite metadata
            items = fallback_db.merge_items_metadata(user_id, items)
            
            # Apply local collection filtering if necessary
            if apply_collection_filter_in_memory:
                if collection_id in ("none", "null"):
                    items = [item for item in items if not item.get("collection_id")]
                else:
                    items = [item for item in items if item.get("collection_id") == collection_id]

            # Map collection names to items before performing search
            try:
                collections = fallback_db.list_collections(user_id, supabase)
                collection_map = {c["id"]: c["name"] for c in collections}
                for item in items:
                    item["collection_name"] = collection_map.get(item.get("collection_id"), "")
            except Exception as map_err:
                logger.error(f"Failed to map collection names for search: {map_err}")
                for item in items:
                    item["collection_name"] = ""
            
            # Perform hybrid semantic search ranking
            ranked_items = perform_hybrid_search(user_id, search, items)
            
            # Apply sorting overrides if specified
            if sort == "priority":
                ranked_items.sort(key=lambda x: x.get("priority_score", 50.0), reverse=True)
            elif sort == "shortest":
                ranked_items.sort(key=lambda x: (x.get("estimated_read_time") is None, x.get("estimated_read_time") or 0))
            elif sort == "longest":
                ranked_items.sort(key=lambda x: (x.get("estimated_read_time") is None, -(x.get("estimated_read_time") or 0)))
            # relevance sorting is the default returned by perform_hybrid_search
            
            # Paginate
            total = len(ranked_items)
            items = ranked_items[offset:offset + limit]
            return {"items": items, "total": total}

        # Otherwise: standard database keyword-less listing path (pagination/sorting at database level)
        # Sort
        if sort == "priority":
            query = query.order("priority_score", desc=True)
        elif sort == "shortest":
            query = query.order("estimated_read_time", desc=False, nullsfirst=False)
        elif sort == "longest":
            query = query.order("estimated_read_time", desc=True, nullsfirst=False)
        else:  # newest (default)
            query = query.order("added_at", desc=True)

        # If filtering in memory, we cannot rely on remote range pagination
        if not apply_collection_filter_in_memory:
            query = query.range(offset, offset + limit - 1)

        result = await asyncio.to_thread(query.execute)
        items = [item_to_response(r) for r in (result.data or [])]
        
        # Merge local SQLite metadata (collection_id, notes, progress) if missing
        items = fallback_db.merge_items_metadata(user_id, items)
        
        # Apply local collection filtering if necessary
        if apply_collection_filter_in_memory:
            if collection_id in ("none", "null"):
                items = [item for item in items if not item.get("collection_id")]
            else:
                items = [item for item in items if item.get("collection_id") == collection_id]
                
            # Perform pagination in memory
            total = len(items)
            items = items[offset:offset + limit]
        else:
            total = result.count if result.count is not None else len(items)

        return {"items": items, "total": total}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[items] get_items error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/items/search/all — Full-text search
# ---------------------------------------------------------------------------

@router.get("/search/all")
async def search_items(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, le=50),
    user_id: str = Depends(get_user_id),
):
    try:
        select_cols = fallback_db.get_optimized_select_string()
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select(select_cols)
            .eq("user_id", user_id)
            .execute()
        )
        items = [item_to_response(r) for r in (result.data or [])]
        items = fallback_db.merge_items_metadata(user_id, items)
        
        # Rank items using vector semantic hybrid search
        ranked_items = perform_hybrid_search(user_id, q, items)
        
        # Return top 10 (or up to limit, capped at 10 to guarantee top 10 ranked results)
        target_limit = min(limit, 10) if limit > 10 else limit
        top_items = ranked_items[:target_limit]
        
        return {"items": top_items, "total": len(top_items)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"search_items error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/items/history/stats — Completed item stats
# ---------------------------------------------------------------------------

@router.get("/history/stats")
async def get_history_stats(user: dict = Depends(get_current_user)):
    user_id = user.get("id") or user.get("sub")
    try:
        select_cols = ["id", "status", "content_type", "completed_at", "estimated_read_time"]
        if fallback_db.has_estimated_time_minutes:
            select_cols.append("estimated_time_minutes")
        if fallback_db.has_actual_time_spent:
            select_cols.append("actual_time_spent")
            
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select(",".join(select_cols))
            .eq("user_id", user_id)
            .eq("status", "completed")
            .execute()
        )
        items = result.data or []
        items = fallback_db.merge_items_metadata(user_id, items)
        
        # Calculate items completed
        items_completed = len(items)
        
        # Calculate total time consumed
        total_time_consumed = 0.0
        for item in items:
            t = item.get("actual_time_spent")
            if t is not None:
                total_time_consumed += float(t)
            else:
                # Fallback to estimated reading time if actual_time_spent is None
                est = item.get("estimated_time_minutes") or item.get("estimated_read_time") or 5.0
                total_time_consumed += float(est)
                
        # Calculate top categories
        category_counts = {}
        for item in items:
            cat = item.get("content_type") or "article"
            category_counts[cat] = category_counts.get(cat, 0) + 1
        
        top_categories = sorted(
            [{"category": cat, "count": count} for cat, count in category_counts.items()],
            key=lambda x: x["count"],
            reverse=True
        )
        
        # Calculate completion streak
        # Let's extract completion dates
        completed_dates = set()
        for item in items:
            completed_at_str = item.get("completed_at")
            if completed_at_str:
                try:
                    # Parse completed_at ISO string
                    clean_comp = completed_at_str.replace("Z", "+00:00")
                    comp_date = datetime.fromisoformat(clean_comp).date()
                    completed_dates.add(comp_date)
                except Exception:
                    pass
                    
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        
        current_streak = 0
        if completed_dates:
            if today in completed_dates:
                current_streak = 1
                check_date = yesterday
                while check_date in completed_dates:
                    current_streak += 1
                    check_date -= timedelta(days=1)
            elif yesterday in completed_dates:
                current_streak = 1
                check_date = yesterday - timedelta(days=1)
                while check_date in completed_dates:
                    current_streak += 1
                    check_date -= timedelta(days=1)
                    
        return {
            "items_completed": items_completed,
            "total_time_consumed": total_time_consumed,
            "top_categories": top_categories[:3],
            "completion_streak": current_streak
        }
    except Exception as e:
        logger.error("Failed to compute history stats: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/items/{item_id} — Single item
# ---------------------------------------------------------------------------

@router.get("/{item_id}")
async def get_item(item_id: str, user_id: str = Depends(get_user_id)):
    try:
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select("*")
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Item not found")
        item = item_to_response(result.data[0])
        item = fallback_db.merge_single_item_metadata(user_id, item)
        fallback_db.record_item_open(user_id, item_id)

        return item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{item_id}/audio-summary")
async def generate_audio_summary(item_id: str, user_id: str = Depends(get_user_id)):
    """Generate (or retrieve) audio summary for an item.

    Returns the URL to the MP3 file served via the static audio mount.
    """
    # Fetch the item
    result = await asyncio.to_thread(
        lambda: supabase.table("items")
        .select("*")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")
    item = item_to_response(result.data[0])
    # Ensure AI summary exists
    if not item.get("ai_summary"):
        item = ensure_summary(item)
    summary = item.get("ai_summary")
    audio_url = AudioService.generate_summary_audio(item_id, summary)
    if audio_url:
        # Update DB with audio_url if not already stored
        try:
            await asyncio.to_thread(
                lambda: supabase.table("items").update({"audio_url": audio_url}).eq("id", item_id).execute()
            )
        except Exception as e:
            print(f"[items] Failed to store audio_url for {item_id}: {e}")
        return {"audio_url": audio_url}
    raise HTTPException(status_code=500, detail="Failed to generate audio summary")


@router.post("/{item_id}/retry")
async def retry_ai_generation(
    item_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_user_id)
):
    """Manually retry AI content extraction and enrichment for a failed or pending item."""
    # 1. Fetch item
    res = await asyncio.to_thread(
        lambda: supabase.table("items").select("*").eq("id", item_id).eq("user_id", user_id).execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Item not found")
    
    item = res.data[0]
    
    # 2. Update status to queued
    print(f"[PIPELINE LOG] [Retry] Enqueuing item {item_id} again.")
    await asyncio.to_thread(
        lambda: supabase.table("items").update({
            "processing_status": "queued",
            "ai_summary": "Queued for AI summary..."
        }).eq("id", item_id).execute()
    )
    update_ingestion_debug(item_id, "queued", "Item manually enqueued for retry.")
    
    # 3. Add to background tasks
    background_tasks.add_task(
        run_background_extraction_and_enrichment,
        item_id,
        item.get("url"),
        user_id,
        item.get("title")
    )
    
    # 4. Return updated item response
    updated_res = await asyncio.to_thread(
        lambda: supabase.table("items").select("*").eq("id", item_id).execute()
    )
    final_item = fallback_db.merge_single_item_metadata(user_id, updated_res.data[0])
    return item_to_response(final_item)


# ---------------------------------------------------------------------------
# PUT /api/items/{item_id} — Full edit (title, tags, summary, description)
# ---------------------------------------------------------------------------

@router.put("/{item_id}")
async def edit_item(item_id: str, req: ItemEdit, background_tasks: BackgroundTasks, user_id: str = Depends(get_user_id)):
    try:
        update_data = {}
        if req.title is not None:
            update_data["title"] = req.title
        if req.tags is not None:
            update_data["tags"] = [t.lower().strip() for t in req.tags if t.strip()]
        if req.ai_summary is not None:
            update_data["ai_summary"] = req.ai_summary
        if req.description is not None:
            update_data["description"] = req.description
        if req.collection_id is not None:
            update_data["collection_id"] = req.collection_id if req.collection_id else None
        if req.actual_time_spent is not None:
            update_data["actual_time_spent"] = req.actual_time_spent

        if req.read_progress is not None:
            progress = max(0, min(100, req.read_progress))
            update_data["read_progress"] = progress
            if progress == 100:
                update_data["status"] = "completed"
                update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
                if req.actual_time_spent is None:
                    try:
                        curr_item_res = await asyncio.to_thread(
                            lambda: supabase.table("items").select("actual_time_spent, estimated_time_minutes, estimated_read_time").eq("id", item_id).execute()
                        )
                        curr_item = curr_item_res.data[0] if curr_item_res.data else {}
                        curr_item = fallback_db.merge_single_item_metadata(user_id, curr_item)
                        curr_spent = curr_item.get("actual_time_spent")
                        if curr_spent is None or curr_spent == 0.0:
                            est_min = curr_item.get("estimated_time_minutes")
                            if est_min is None:
                                est_sec = curr_item.get("estimated_read_time") or 300
                                est_min = est_sec / 60.0
                            update_data["actual_time_spent"] = est_min
                    except Exception:
                        pass
            elif progress > 0:
                update_data["status"] = "reading"
                update_data["completed_at"] = None
            else:
                update_data["status"] = "unread"
                update_data["completed_at"] = None

        if not update_data:
            return await get_item(item_id, user_id)

        if req.full_summary is not None:
            update_data["full_summary"] = req.full_summary

        # Extract metadata updates
        metadata_fields = ["collection_id", "read_progress", "full_summary", "actual_time_spent"]
        local_updates = {}
        for field in metadata_fields:
            if field in update_data:
                local_updates[field] = update_data[field]
                # If column is missing on remote, delete it from update_data
                if (field == "collection_id" and not fallback_db.has_collection_id) or \
                   (field == "read_progress" and not fallback_db.has_read_progress) or \
                   (field == "full_summary" and not fallback_db.has_full_summary) or \
                   (field == "actual_time_spent" and not fallback_db.has_actual_time_spent):
                    del update_data[field]
                    
        # Apply local updates if any
        if local_updates:
            fallback_db.update_item_metadata(user_id, item_id, local_updates, supabase)

        # Apply remote updates if any
        if update_data:
            result = await asyncio.to_thread(
                lambda: supabase.table("items")
                .update(update_data)
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Item not found")
            item = item_to_response(result.data[0])
        else:
            # If no remote fields were updated, fetch current item to return
            result = await asyncio.to_thread(
                lambda: supabase.table("items")
                .select("*")
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Item not found")
            item = item_to_response(result.data[0])
            
        # Merge local metadata into response
        item = fallback_db.merge_single_item_metadata(user_id, item)
        fallback_db.record_item_open(user_id, item_id)
        background_tasks.add_task(index_item_by_id, item_id, user_id)
        background_tasks.add_task(run_recalculate_priorities, user_id)
        return item
    except HTTPException:
        raise
    except Exception as e:
        print(f"[items] edit_item error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# PATCH /api/items/{item_id} — Quick update (status, is_favorite, title, tags)
# ---------------------------------------------------------------------------

@router.patch("/{item_id}")
async def update_item(item_id: str, req: ItemUpdate, background_tasks: BackgroundTasks, user_id: str = Depends(get_user_id)):
    try:
        update_data: dict = {}

        if req.actual_time_spent is not None:
            update_data["actual_time_spent"] = req.actual_time_spent

        if req.status is not None:
            update_data["status"] = req.status
            if req.status == "completed":
                update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
                update_data["read_progress"] = 100
                if req.actual_time_spent is None:
                    try:
                        curr_item_res = await asyncio.to_thread(
                            lambda: supabase.table("items").select("actual_time_spent, estimated_time_minutes, estimated_read_time").eq("id", item_id).execute()
                        )
                        curr_item = curr_item_res.data[0] if curr_item_res.data else {}
                        curr_item = fallback_db.merge_single_item_metadata(user_id, curr_item)
                        curr_spent = curr_item.get("actual_time_spent")
                        if curr_spent is None or curr_spent == 0.0:
                            est_min = curr_item.get("estimated_time_minutes")
                            if est_min is None:
                                est_sec = curr_item.get("estimated_read_time") or 300
                                est_min = est_sec / 60.0
                            update_data["actual_time_spent"] = est_min
                    except Exception:
                        pass
            elif req.status == "unread":
                update_data["completed_at"] = None
                update_data["read_progress"] = 0
            else:
                update_data["completed_at"] = None
                # Reopening: if current database progress is 100 or None, reset progress to 0
                try:
                    curr_progress = None
                    if fallback_db.has_read_progress:
                        curr_item_res = await asyncio.to_thread(
                            lambda: supabase.table("items").select("read_progress").eq("id", item_id).execute()
                        )
                        curr_item = curr_item_res.data[0] if curr_item_res.data else {}
                        curr_progress = curr_item.get("read_progress")
                    else:
                        local_meta = fallback_db.merge_single_item_metadata(user_id, {"id": item_id})
                        curr_progress = local_meta.get("read_progress")
                    if curr_progress is None or curr_progress >= 100:
                        update_data["read_progress"] = 0
                except Exception:
                    pass

        if req.is_favorite is not None:
            update_data["is_favorite"] = req.is_favorite

        if req.read_progress is not None:
            progress = max(0, min(100, req.read_progress))
            update_data["read_progress"] = progress
            if progress == 100:
                update_data["status"] = "completed"
                update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
                if req.actual_time_spent is None:
                    try:
                        curr_item_res = await asyncio.to_thread(
                            lambda: supabase.table("items").select("actual_time_spent, estimated_time_minutes, estimated_read_time").eq("id", item_id).execute()
                        )
                        curr_item = curr_item_res.data[0] if curr_item_res.data else {}
                        curr_item = fallback_db.merge_single_item_metadata(user_id, curr_item)
                        curr_spent = curr_item.get("actual_time_spent")
                        if curr_spent is None or curr_spent == 0.0:
                            est_min = curr_item.get("estimated_time_minutes")
                            if est_min is None:
                                est_sec = curr_item.get("estimated_read_time") or 300
                                est_min = est_sec / 60.0
                            update_data["actual_time_spent"] = est_min
                    except Exception:
                        pass
            elif progress > 0:
                update_data["status"] = "reading"
                update_data["completed_at"] = None
            else:
                update_data["status"] = "unread"
                update_data["completed_at"] = None

        if req.collection_id is not None:
            update_data["collection_id"] = req.collection_id if req.collection_id else None

        if not update_data:
            return await get_item(item_id, user_id)

        # Extract metadata updates
        metadata_fields = ["collection_id", "read_progress", "actual_time_spent"]
        local_updates = {}
        for field in metadata_fields:
            if field in update_data:
                local_updates[field] = update_data[field]
                # If column is missing on remote, delete it from update_data
                if (field == "collection_id" and not fallback_db.has_collection_id) or \
                   (field == "read_progress" and not fallback_db.has_read_progress) or \
                   (field == "actual_time_spent" and not fallback_db.has_actual_time_spent):
                    del update_data[field]
                    
        # Apply local updates if any
        if local_updates:
            fallback_db.update_item_metadata(user_id, item_id, local_updates, supabase)

        # Apply remote updates if any
        if update_data:
            result = await asyncio.to_thread(
                lambda: supabase.table("items")
                .update(update_data)
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Item not found")
            item = item_to_response(result.data[0])
        else:
            # If no remote fields were updated, fetch current item to return
            result = await asyncio.to_thread(
                lambda: supabase.table("items")
                .select("*")
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Item not found")
            item = item_to_response(result.data[0])
            
        # Merge local metadata into response
        item = fallback_db.merge_single_item_metadata(user_id, item)
        fallback_db.record_item_open(user_id, item_id)
        background_tasks.add_task(run_recalculate_priorities, user_id)
        return item
    except HTTPException:
        raise
    except Exception as e:
        print(f"[items] update_item error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# DELETE /api/items/{item_id}
# ---------------------------------------------------------------------------

@router.delete("/{item_id}")
async def delete_item(item_id: str, user_id: str = Depends(get_user_id)):
    try:
        await asyncio.to_thread(
            lambda: supabase.table("items").delete().eq("id", item_id).eq("user_id", user_id).execute()
        )
        fallback_db.delete_item_metadata(item_id)
        delete_embedding(item_id)
        return {"message": "Item deleted"}
    except Exception as e:
        print(f"[items] delete_item error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# POST /api/items/recalculate-priorities
# ---------------------------------------------------------------------------

@router.post("/backfill-summaries")
async def backfill_summaries(user_id: str = Depends(get_user_id)):
    """Generate missing AI summaries for all items of the user."""
    # Fetch items with null or empty ai_summary
    result = (
        supabase.table("items")
        .select("id, title, description, extracted_text, ai_summary, content_type")
        .eq("user_id", user_id)
        .execute()
    )
    items = result.data or []
    updated = 0
    ai = get_ai_service()
    for row in items:
        ai_summary = row.get("ai_summary")
        if ai_summary and ai_summary not in ["Summary could not be generated.", "Content could not be extracted for summarization.", "Summary unavailable.", "Limited text available"]:
            continue
        
        item_id = row.get("id")
        try:
            print(f"[PIPELINE LOG] [backfill_summaries] Setting processing_status to 'processing' for item {item_id}")
            supabase.table("items").update({"processing_status": "processing"}).eq("id", item_id).execute()
        except Exception as p_err:
            logger.warning(f"Could not update processing_status to processing for item {item_id}: {p_err}")

        title = row.get("title") or ""
        content_type = row.get("content_type") or "generic"
        transcript_val = row.get("transcript") or ""
        extracted_text_val = row.get("extracted_text") or ""
        title_for_ai = "" if content_type == "youtube" else title

        resolved_content = get_usable_content({
            "transcript": transcript_val,
            "extracted_text": extracted_text_val,
            "title": title,
            "description": row.get("description"),
            "author": row.get("author"),
            "url": row.get("url")
        })

        summary = None
        db_updated = False
        
        print(f"[PIPELINE LOG] [backfill_summaries] Starting summary generation for item {item_id}...")
        try:
            if not resolved_content:
                summary = "Summary could not be generated."
                print(f"[PIPELINE LOG] [backfill_summaries] No valid content for summary.")
            else:
                # Attempt 1
                print(f"[PIPELINE LOG] [backfill_summaries] Attempt 1...")
                try:
                    summary = ai.generate_summary(title=title_for_ai, content=resolved_content, content_type=content_type)
                    print(f"[PIPELINE LOG] [backfill_summaries] Attempt 1 succeeded.")
                except Exception as e:
                    logger.warning(f"[backfill_summaries] attempt 1 failed: {e}")
                    print(f"[PIPELINE LOG] [backfill_summaries] Attempt 1 failed: {e}")
                
                # Check fallback/failure
                if not summary or summary in ["Content could not be extracted for summarization.", "Summary could not be generated.", "Summary unavailable."]:
                    # Retry once
                    print(f"[PIPELINE LOG] [backfill_summaries] Attempt 2 (Retry)...")
                    try:
                        summary = ai.generate_summary(title=title_for_ai, content=resolved_content, content_type=content_type)
                        print(f"[PIPELINE LOG] [backfill_summaries] Attempt 2 succeeded.")
                    except Exception as e:
                        logger.error(f"[backfill_summaries] retry failed: {e}")
                        print(f"[PIPELINE LOG] [backfill_summaries] Attempt 2 failed: {e}")
                        raise e # never swallow exceptions
                
                if not summary or summary in ["Content could not be extracted for summarization.", "Summary could not be generated.", "Summary unavailable."]:
                    raise ValueError(f"AI Analysis failed to generate a valid summary. Got: {summary}")

            transcript_len = len(transcript_val)
            extracted_text_len = len(extracted_text_val)
            summary_input_len = len(resolved_content)
            summary_output_len = len(summary) if summary else 0

            print(f"[PIPELINE LOG] backfill_summaries - transcript_length: {transcript_len}")
            print(f"[PIPELINE LOG] backfill_summaries - extracted_text_length: {extracted_text_len}")
            print(f"[PIPELINE LOG] backfill_summaries - summary_input_length: {summary_input_len}")
            print(f"[PIPELINE LOG] backfill_summaries - summary_output_length: {summary_output_len}")

            logger.info(f"transcript_length: {transcript_len}")
            logger.info(f"extracted_text_length: {extracted_text_len}")
            logger.info(f"summary_input_length: {summary_input_len}")
            logger.info(f"summary_output_length: {summary_output_len}")

            processing_status = "completed" if summary and summary != "Summary could not be generated." else "failed"
            print(f"[PIPELINE LOG] [Database] [backfill_summaries] Updating DB with status='{processing_status}' for item {item_id}...")
            update_data = {
                "ai_summary": summary,
                "processing_status": processing_status,
                "extracted_text": extracted_text_val or resolved_content
            }
            supabase.table("items").update(update_data).eq("id", item_id).execute()
            db_updated = True
            updated += 1
            print(f"[PIPELINE LOG] [Database] [backfill_summaries] Saved to DB. ai_summary length: {len(summary)}")
            # Trigger background vector indexing
            asyncio.create_task(asyncio.to_thread(index_item_by_id, item_id, user_id))
            
        except Exception as e:
            logger.error(f"Backfill failed for item {item_id}: {e}", exc_info=True)
            print(f"[PIPELINE LOG] [backfill_summaries] Failed: {e}")
            
            if not db_updated:
                try:
                    print(f"[PIPELINE LOG] [Database] [backfill_summaries] Updating DB with failed status...")
                    update_data = {
                        "ai_summary": "Summary could not be generated.",
                        "processing_status": "failed",
                        "extracted_text": extracted_text_val or resolved_content
                    }
                    supabase.table("items").update(update_data).eq("id", item_id).execute()
                    print(f"[PIPELINE LOG] [Database] [backfill_summaries] DB updated to 'failed' successfully.")
                except Exception as db_err:
                    logger.error(f"Failed to update item {item_id} on failure: {db_err}")
                    print(f"[PIPELINE LOG] [Database] [backfill_summaries] CRITICAL: Failed to update DB on failure: {db_err}")
            
            raise e
            
    return {"updated": updated}

@router.post("/recalculate-priorities")
async def recalculate_priorities(user_id: str = Depends(get_user_id)):
    try:
        updated = await run_recalculate_priorities(user_id)
        return {"updated": updated}
    except Exception as e:
        print(f"[items] recalculate_priorities error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

# ---------------------------------------------------------------------------
# GET /api/items/recommendations
# ---------------------------------------------------------------------------

@router.get("/recommendations/next")
async def get_recommendations(user_id: str = Depends(get_user_id)):
    try:
        # 1. Fetch candidates (status is 'unread' or 'reading')
        cand_res = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .in_("status", ["unread", "reading"])
            .execute()
        )
        candidates = cand_res.data or []
        candidates = fallback_db.merge_items_metadata(user_id, candidates)

        # 2. Fetch completed items for history
        comp_res = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .execute()
        )
        completed_items = comp_res.data or []
        completed_items = fallback_db.merge_items_metadata(user_id, completed_items)

        # 3. Fetch tracking info
        tracking_info = fallback_db.get_item_tracking(user_id)

        # 4. Generate suggestion
        ai = get_ai_service()
        suggestion = ai.suggest_next_items(
            unread_items=candidates,
            completed_items=completed_items,
            tracking_info=tracking_info
        )

        # 5. Record the recommendation event if an item is chosen
        if suggestion and suggestion.get("item_id"):
            fallback_db.record_item_recommendation(user_id, suggestion["item_id"])

        return {"suggestion": suggestion}
        
    except Exception as e:
        print(f"[items] get_recommendations error: {e}")
        return {
            "suggestion": {
                "item_id": None,
                "title": None,
                "reason": "Failed to compute recommendations."
            }
        }


# ---------------------------------------------------------------------------
# GET /api/items/user/streak
# ---------------------------------------------------------------------------

@router.get("/user/streak")
async def get_user_streak(user: dict = Depends(get_current_user)):
    user_id = user.get("id") or user.get("sub")
    try:
        select_cols = ["id", "added_at", "completed_at", "estimated_read_time", "duration_seconds", "content_type", "priority_score", "status"]
        if fallback_db.has_estimated_time_minutes:
            select_cols.append("estimated_time_minutes")
        if fallback_db.has_read_progress:
            select_cols.append("read_progress")

        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select(",".join(select_cols))
            .eq("user_id", user_id)
            .execute()
        )
        
        items = result.data or []
        items = fallback_db.merge_items_metadata(user_id, items)
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        
        daily_saves = 0
        daily_completions = 0
        daily_reading_time = 0
        total_estimated_time_minutes = 0.0
        
        completed_dates = set()
        total_completed = 0
        has_deep_read = False
        
        import math
        for item in items:
            added_at_str = item.get("added_at")
            completed_at_str = item.get("completed_at")
            read_time = item.get("estimated_read_time") or 0
            status = item.get("status")
            progress = item.get("read_progress") or 0
            
            # Fetch / compute estimated_time_minutes
            est_time = item.get("estimated_time_minutes")
            if est_time is None:
                source_type = item.get("source_type") or item.get("content_type") or "generic"
                dur = item.get("duration_seconds")
                words = item.get("word_count")
                text = item.get("extracted_text")
                if source_type in ("youtube", "video"):
                    est_time = float(dur) / 60.0 if dur and dur > 0 else 5.0
                elif source_type == "pdf":
                    if words and words > 0:
                        est_time = float(math.ceil(words / 180.0))
                    elif text:
                        w = len(text.split())
                        est_time = float(math.ceil(w / 180.0)) if w > 0 else 5.0
                    else:
                        est_time = 5.0
                else:
                    if words and words > 0:
                        est_time = float(math.ceil(words / 200.0))
                    elif text:
                        w = len(text.split())
                        est_time = float(math.ceil(w / 200.0)) if w > 0 else 5.0
                    else:
                        est_time = 5.0
            
            if status in ("unread", "reading") and progress < 100:
                remaining_time = est_time * (1.0 - (progress / 100.0))
                total_estimated_time_minutes += remaining_time
            
            if added_at_str:
                try:
                    clean_added = added_at_str.replace("Z", "+00:00")
                    added_date = datetime.fromisoformat(clean_added).date()
                    if added_date == today:
                        daily_saves += 1
                except Exception:
                    pass
            
            if status == "completed":
                total_completed += 1
                if read_time > 15:
                    has_deep_read = True
                    
            if completed_at_str and status == "completed":
                try:
                    clean_comp = completed_at_str.replace("Z", "+00:00")
                    comp_date = datetime.fromisoformat(clean_comp).date()
                    completed_dates.add(comp_date)
                    if comp_date == today:
                        daily_completions += 1
                        daily_reading_time += read_time
                except Exception:
                    pass
        
        sorted_dates = sorted(list(completed_dates))
        
        current_streak = 0
        longest_streak = 0
        
        if sorted_dates:
            temp_streak = 1
            longest_streak = 1
            for i in range(1, len(sorted_dates)):
                if (sorted_dates[i] - sorted_dates[i-1]).days == 1:
                    temp_streak += 1
                elif (sorted_dates[i] - sorted_dates[i-1]).days > 1:
                    temp_streak = 1
                longest_streak = max(longest_streak, temp_streak)
                
            if today in completed_dates:
                current_streak = 1
                check_date = yesterday
                while check_date in completed_dates:
                    current_streak += 1
                    check_date -= timedelta(days=1)
            elif yesterday in completed_dates:
                current_streak = 1
                check_date = yesterday - timedelta(days=1)
                while check_date in completed_dates:
                    current_streak += 1
                    check_date -= timedelta(days=1)
            else:
                current_streak = 0
        
        badges = []
        if len(items) > 0:
            badges.append({
                "id": "first_save",
                "title": "First Step",
                "description": "Saved your first item",
                "icon": "Inbox"
            })
        if has_deep_read:
            badges.append({
                "id": "deep_reader",
                "title": "Deep Reader",
                "description": "Completed a 15+ min article/video",
                "icon": "BookOpen"
            })
        if total_completed >= 5:
            badges.append({
                "id": "avid_learner",
                "title": "Avid Learner",
                "description": "Completed 5 items",
                "icon": "Award"
            })
        if longest_streak >= 3:
            badges.append({
                "id": "consistent",
                "title": "Consistent",
                "description": "Achieved a 3-day completion streak",
                "icon": "Zap"
            })
        if longest_streak >= 7:
            badges.append({
                "id": "unstoppable",
                "title": "Unstoppable",
                "description": "Achieved a 7-day completion streak",
                "icon": "Flame"
            })
            
        # Compute weekly analytics (last 7 days including today)
        last_7_days = [today - timedelta(days=i) for i in range(6, -1, -1)]
        saves_by_day = {d: 0 for d in last_7_days}
        completions_by_day = {d: 0 for d in last_7_days}
        
        for item in items:
            added_at_str = item.get("added_at")
            completed_at_str = item.get("completed_at")
            status = item.get("status")
            
            if added_at_str:
                try:
                    clean_added = added_at_str.replace("Z", "+00:00")
                    added_date = datetime.fromisoformat(clean_added).date()
                    if added_date in saves_by_day:
                        saves_by_day[added_date] += 1
                except Exception:
                    pass
            
            if completed_at_str and status == "completed":
                try:
                    clean_comp = completed_at_str.replace("Z", "+00:00")
                    comp_date = datetime.fromisoformat(clean_comp).date()
                    if comp_date in completions_by_day:
                        completions_by_day[comp_date] += 1
                except Exception:
                    pass

        weekly_saves = [saves_by_day[d] for d in last_7_days]
        weekly_completions = [completions_by_day[d] for d in last_7_days]
        weekly_labels = [d.strftime("%a") for d in last_7_days]

        user_metadata = user.get("user_metadata") or {}
        daily_goal = int(user_metadata.get("daily_reading_goal_minutes", 15))

        total_items = sum(1 for item in items if item.get("status") in ("unread", "reading", "completed"))
        completed_ratio_percent = round((total_completed / total_items) * 100) if total_items > 0 else 0

        unfinished_items = [item for item in items if item.get("status") in ("unread", "reading")]
        focus_score = round(sum(item.get("priority_score") or 50.0 for item in unfinished_items) / len(unfinished_items)) if unfinished_items else 0

        return {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "daily_saves": daily_saves,
            "daily_completions": daily_completions,
            "daily_reading_goal_minutes": daily_goal,
            "daily_reading_time_minutes": daily_reading_time,
            "total_estimated_time_minutes": total_estimated_time_minutes,
            "badges": badges,
            "total_completed": total_completed,
            "total_items": total_items,
            "completed_ratio_percent": completed_ratio_percent,
            "focus_score": focus_score,
            "weekly_saves": weekly_saves,
            "weekly_completions": weekly_completions,
            "weekly_labels": weekly_labels
        }
    except Exception as e:
        logger.error("Failed to compute streak: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# POST /api/items/bulk — Bulk actions (delete, move, status, favorite)
# ---------------------------------------------------------------------------

from pydantic import BaseModel

class BulkActionRequest(BaseModel):
    ids: List[str]
    action: str  # "delete", "move", "status", "favorite"
    status: Optional[str] = None
    collection_id: Optional[str] = None
    is_favorite: Optional[bool] = None

@router.post("/bulk")
async def bulk_action(req: BulkActionRequest, background_tasks: BackgroundTasks, user_id: str = Depends(get_user_id)):
    """Perform bulk operations on multiple queue items."""
    if not req.ids:
        return {"success": True, "message": "No items specified", "count": 0}

    try:
        if req.action == "delete":
            await asyncio.to_thread(
                lambda: supabase.table("items").delete().in_("id", req.ids).eq("user_id", user_id).execute()
            )
            for i_id in req.ids:
                fallback_db.delete_item_metadata(i_id)
                delete_embedding(i_id)
            background_tasks.add_task(run_recalculate_priorities, user_id)
            return {"success": True, "message": f"Deleted {len(req.ids)} items", "count": len(req.ids)}

        elif req.action == "move":
            col_id = req.collection_id if req.collection_id else None
            if fallback_db.has_collection_id:
                await asyncio.to_thread(
                    lambda: supabase.table("items").update({"collection_id": col_id}).in_("id", req.ids).eq("user_id", user_id).execute()
                )
            else:
                for i_id in req.ids:
                    fallback_db.update_item_metadata(user_id, i_id, {"collection_id": col_id}, supabase)
            background_tasks.add_task(run_recalculate_priorities, user_id)
            return {"success": True, "message": f"Moved {len(req.ids)} items to collection", "count": len(req.ids)}

        elif req.action == "status":
            if not req.status:
                raise HTTPException(status_code=400, detail="Status is required for status bulk update")
            updates = {"status": req.status}
            progress_val = None
            if req.status == "completed":
                updates["completed_at"] = datetime.now(timezone.utc).isoformat()
                progress_val = 100
                if fallback_db.has_read_progress:
                    updates["read_progress"] = 100
            elif req.status == "unread":
                updates["completed_at"] = None
                progress_val = 0
                if fallback_db.has_read_progress:
                    updates["read_progress"] = 0
            else:
                updates["completed_at"] = None
            await asyncio.to_thread(
                lambda: supabase.table("items").update(updates).in_("id", req.ids).eq("user_id", user_id).execute()
            )
            if progress_val is not None and not fallback_db.has_read_progress:
                for i_id in req.ids:
                    fallback_db.update_item_metadata(user_id, i_id, {"read_progress": progress_val}, supabase)
            background_tasks.add_task(run_recalculate_priorities, user_id)
            return {"success": True, "message": f"Updated status of {len(req.ids)} items to {req.status}", "count": len(req.ids)}

        elif req.action == "favorite":
            if req.is_favorite is None:
                raise HTTPException(status_code=400, detail="is_favorite is required for favorite bulk update")
            await asyncio.to_thread(
                lambda: supabase.table("items").update({"is_favorite": req.is_favorite}).in_("id", req.ids).eq("user_id", user_id).execute()
            )
            background_tasks.add_task(run_recalculate_priorities, user_id)
            return {"success": True, "message": f"Updated favorite state of {len(req.ids)} items", "count": len(req.ids)}

        else:
            raise HTTPException(status_code=400, detail=f"Invalid bulk action: {req.action}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Bulk action {req.action} failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/items/analytics/reading — Reading Analytics
# ---------------------------------------------------------------------------

@router.get("/analytics/reading")
async def get_reading_analytics(user: dict = Depends(get_current_user)):
    user_id = user.get("id") or user.get("sub")
    try:
        select_cols = ["id", "status", "content_type", "title", "url", "added_at", "completed_at", "estimated_read_time", "tags", "priority_score"]
        if fallback_db.has_estimated_time_minutes:
            select_cols.append("estimated_time_minutes")
        if fallback_db.has_actual_time_spent:
            select_cols.append("actual_time_spent")
        if fallback_db.has_source_type:
            select_cols.append("source_type")
            
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select(",".join(select_cols))
            .eq("user_id", user_id)
            .execute()
        )
        items = result.data or []
        items = fallback_db.merge_items_metadata(user_id, items)
        
        # Get tracking data
        tracking_info = await asyncio.to_thread(
            lambda: fallback_db.get_item_tracking(user_id)
        )
        
        # Time helpers
        today = datetime.now(timezone.utc).date()
        
        # 1. Reading Time calculations
        daily_reading_time = 0.0
        weekly_reading_time = 0.0
        monthly_reading_time = 0.0
        
        # We also want day-by-day reading time for the past 30 days
        last_30_days = [today - timedelta(days=i) for i in range(29, -1, -1)]
        time_by_day = {d: 0.0 for d in last_30_days}
        completions_by_day = {d: 0 for d in last_30_days}
        
        # Day-by-day for past 12 weeks
        # Start of current week (Monday)
        start_of_week = today - timedelta(days=today.weekday())
        last_12_weeks = [start_of_week - timedelta(weeks=i) for i in range(11, -1, -1)]
        time_by_week = {w: 0.0 for w in last_12_weeks}
        completions_by_week = {w: 0 for w in last_12_weeks}
        
        # Day-by-day for past 12 months
        last_12_months_dates = []
        curr_year = today.year
        curr_month = today.month
        for i in range(11, -1, -1):
            m = curr_month - i
            y = curr_year
            while m <= 0:
                m += 12
                y -= 1
            last_12_months_dates.append(f"{y:04d}-{m:02d}")
        
        time_by_month = {m: 0.0 for m in last_12_months_dates}
        completions_by_month = {m: 0 for m in last_12_months_dates}

        total_completed = 0
        total_time_spent = 0.0
        completed_items = []
        completed_dates = set()
        
        for item in items:
            status = item.get("status")
            completed_at_str = item.get("completed_at")
            
            # Determine time spent
            t = item.get("actual_time_spent")
            if t is not None:
                time_spent = float(t)
            else:
                time_spent = float(item.get("estimated_time_minutes") or (item.get("estimated_read_time") or 300) / 60.0)
            
            if status == "completed":
                total_completed += 1
                total_time_spent += time_spent
                completed_items.append(item)
                
                if completed_at_str:
                    try:
                        clean_comp = completed_at_str.replace("Z", "+00:00")
                        comp_date = datetime.fromisoformat(clean_comp).date()
                        completed_dates.add(comp_date)
                        
                        # Accumulate daily
                        if comp_date in time_by_day:
                            time_by_day[comp_date] += time_spent
                            completions_by_day[comp_date] += 1
                            
                        # Accumulate weekly
                        for w in last_12_weeks:
                            if w <= comp_date < w + timedelta(days=7):
                                time_by_week[w] += time_spent
                                completions_by_week[w] += 1
                                break
                                
                        # Accumulate monthly
                        month_str = f"{comp_date.year:04d}-{comp_date.month:02d}"
                        if month_str in time_by_month:
                            time_by_month[month_str] += time_spent
                            completions_by_month[month_str] += 1
                            
                        # Check if completed today, this week (past 7 days), or this month (past 30 days)
                        diff_days = (today - comp_date).days
                        if diff_days == 0:
                            daily_reading_time += time_spent
                        if 0 <= diff_days < 7:
                            weekly_reading_time += time_spent
                        if 0 <= diff_days < 30:
                            monthly_reading_time += time_spent
                    except Exception:
                        pass
        
        # 2. Daily reading goal
        user_metadata = user.get("user_metadata") or {}
        daily_goal = int(user_metadata.get("daily_reading_goal_minutes", 15))
        
        # 3. Reading Streak Calendar
        sorted_dates = sorted(list(completed_dates))
        current_streak = 0
        longest_streak = 0
        
        if sorted_dates:
            temp_streak = 1
            longest_streak = 1
            for i in range(1, len(sorted_dates)):
                if (sorted_dates[i] - sorted_dates[i-1]).days == 1:
                    temp_streak += 1
                elif (sorted_dates[i] - sorted_dates[i-1]).days > 1:
                    temp_streak = 1
                longest_streak = max(longest_streak, temp_streak)
                
            yesterday = today - timedelta(days=1)
            if today in completed_dates:
                current_streak = 1
                check_date = yesterday
                while check_date in completed_dates:
                    current_streak += 1
                    check_date -= timedelta(days=1)
            elif yesterday in completed_dates:
                current_streak = 1
                check_date = yesterday - timedelta(days=1)
                while check_date in completed_dates:
                    current_streak += 1
                    check_date -= timedelta(days=1)
            else:
                current_streak = 0
                
        # 4. Category distribution
        category_counts = {}
        category_time = {}
        for item in completed_items:
            cat = item.get("source_type") or item.get("content_type") or "article"
            cat = cat.lower()
            t = item.get("actual_time_spent")
            time_spent = float(t) if t is not None else float(item.get("estimated_time_minutes") or (item.get("estimated_read_time") or 300) / 60.0)
            
            category_counts[cat] = category_counts.get(cat, 0) + 1
            category_time[cat] = category_time.get(cat, 0.0) + time_spent
            
        category_distribution = []
        for cat in set(list(category_counts.keys()) + ["article", "youtube", "reddit", "twitter", "leetcode", "pdf"]):
            count = category_counts.get(cat, 0)
            time_spent = category_time.get(cat, 0.0)
            category_distribution.append({
                "category": cat.capitalize(),
                "count": count,
                "time_spent": round(time_spent, 1)
            })
            
        # 5. Average completion time
        avg_completion_time = round(total_time_spent / total_completed, 1) if total_completed > 0 else 0.0
        
        # 6. Most viewed categories
        category_views = {}
        for item_id, track in tracking_info.items():
            if track.get("last_opened_at"):
                matching_item = next((it for it in items if it.get("id") == item_id), None)
                if matching_item:
                    cat = matching_item.get("source_type") or matching_item.get("content_type") or "article"
                    cat = cat.lower().capitalize()
                    category_views[cat] = category_views.get(cat, 0) + 1
                    
        most_viewed_categories = sorted(
            [{"category": cat, "views": count} for cat, count in category_views.items()],
            key=lambda x: x["views"],
            reverse=True
        )
        
        if not most_viewed_categories:
            most_viewed_categories = [{"category": "Article", "views": 0}]

        # 7. Productivity Score
        total_items_count = len(items)
        completion_rate = (total_completed / total_items_count * 100) if total_items_count > 0 else 0.0
        
        goal_met_days = sum(1 for d in last_30_days[-7:] if time_by_day[d] >= daily_goal)
        goal_score = (goal_met_days / 7.0) * 100
        
        streak_score = min(100.0, (current_streak / 7.0) * 100.0)
        
        unique_cats = len([cat for cat, c in category_counts.items() if c > 0])
        diversity_score = min(100.0, (unique_cats / 3.0) * 100.0)
        
        productivity_score = round(
            (completion_rate * 0.35) + 
            (goal_score * 0.35) + 
            (streak_score * 0.15) + 
            (diversity_score * 0.15)
        )
        productivity_score = min(100, max(0, productivity_score))
        
        # 8. Top AI-recommended topics read
        ai_recommended_completed_tags = {}
        for item in completed_items:
            item_id = item.get("id")
            track = tracking_info.get(item_id)
            if track and (track.get("last_recommended_at") or (track.get("recommendation_count") or 0) > 0):
                tags = item.get("tags") or []
                for tag in tags:
                    if tag != "uncategorized":
                        ai_recommended_completed_tags[tag] = ai_recommended_completed_tags.get(tag, 0) + 1
                        
        top_ai_topics = sorted(
            [{"topic": tag, "count": count} for tag, count in ai_recommended_completed_tags.items()],
            key=lambda x: x["count"],
            reverse=True
        )[:10]
        
        daily_time_chart = [{"date": d.strftime("%Y-%m-%d"), "minutes": round(time_by_day[d], 1), "completions": completions_by_day[d]} for d in last_30_days]
        weekly_time_chart = [{"week_start": w.strftime("%Y-%m-%d"), "minutes": round(time_by_week[w], 1), "completions": completions_by_week[w]} for w in last_12_weeks]
        monthly_time_chart = [{"month": m, "minutes": round(time_by_month[m], 1), "completions": completions_by_month[m]} for m in last_12_months_dates]
        
        return {
            "reading_time": {
                "daily": round(daily_reading_time, 1),
                "weekly": round(weekly_reading_time, 1),
                "monthly": round(monthly_reading_time, 1),
                "daily_goal": daily_goal
            },
            "average_completion_time": avg_completion_time,
            "category_distribution": category_distribution,
            "most_viewed_categories": most_viewed_categories,
            "streak": {
                "current": current_streak,
                "longest": longest_streak,
                "completed_dates": [d.strftime("%Y-%m-%d") for d in completed_dates]
            },
            "productivity_score": productivity_score,
            "top_ai_topics": top_ai_topics,
            "charts": {
                "daily": daily_time_chart,
                "weekly": weekly_time_chart,
                "monthly": monthly_time_chart
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to compute reading analytics: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# GET /api/items/analytics/export — Export Reading Analytics to CSV
# ---------------------------------------------------------------------------

@router.get("/analytics/export")
async def export_reading_analytics(user: dict = Depends(get_current_user)):
    user_id = user.get("id") or user.get("sub")
    try:
        select_cols = ["id", "status", "content_type", "title", "url", "added_at", "completed_at", "estimated_read_time", "tags", "priority_score"]
        if fallback_db.has_estimated_time_minutes:
            select_cols.append("estimated_time_minutes")
        if fallback_db.has_actual_time_spent:
            select_cols.append("actual_time_spent")
        if fallback_db.has_source_type:
            select_cols.append("source_type")
            
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select(",".join(select_cols))
            .eq("user_id", user_id)
            .execute()
        )
        items = result.data or []
        items = fallback_db.merge_items_metadata(user_id, items)
        
        import csv
        import io
        from fastapi.responses import StreamingResponse
        
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write headers
        writer.writerow([
            "ID", "Title", "URL", "Category", "Status", "Tags",
            "Estimated Time (Minutes)", "Actual Time Spent (Minutes)", 
            "Added At", "Completed At", "Priority Score"
        ])
        
        for item in items:
            t = item.get("actual_time_spent")
            actual_time = float(t) if t is not None else 0.0
            
            est = item.get("estimated_time_minutes") or (item.get("estimated_read_time") or 300) / 60.0
            estimated_time = float(est)
            
            tags_str = ", ".join(item.get("tags") or [])
            cat = item.get("source_type") or item.get("content_type") or "article"
            
            writer.writerow([
                item.get("id"),
                item.get("title") or "Untitled",
                item.get("url"),
                cat.capitalize(),
                item.get("status"),
                tags_str,
                round(estimated_time, 2),
                round(actual_time, 2),
                item.get("added_at"),
                item.get("completed_at") or "",
                item.get("priority_score", 50)
            ])
            
        output.seek(0)
        
        response = StreamingResponse(
            io.StringIO(output.getvalue()),
            media_type="text/csv"
        )
        response.headers["Content-Disposition"] = "attachment; filename=queueit_reading_analytics.csv"
        return response
        
    except Exception as e:
        logger.error(f"Failed to export reading analytics: {e}")
        raise HTTPException(status_code=400, detail=str(e))
