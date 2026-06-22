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
import threading
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
        "created_at": item.get("created_at") or item.get("added_at"),
        "audio_url": item.get("audio_url"),
        "thumbnail_url": item.get("thumbnail_url"),
        "source_name": source_name,
        "source_type": source_type or item.get("content_type"),
        "source_domain": source_domain,
        "logo_url": logo_url,
        # ── Fields that were previously missing ──
        "ai_summary": item.get("ai_summary"),
        "tags": tags,
        "extracted_text": item.get("extracted_text"),
        "author": item.get("author"),
        "estimated_read_time": item.get("estimated_read_time"),
        "duration_seconds": item.get("duration_seconds"),
        "priority_score": item.get("priority_score", 50.0),
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


def get_usable_content(item_data: dict) -> Optional[str]:
    """
    Resolve any available content for summarization.
    Prioritizes transcript or extracted text.
    Falls back to caption, description, title, or author details.
    Returns None if absolutely no usable content exists.
    """
    transcript_val = item_data.get("transcript") or ""
    extracted_text_val = item_data.get("extracted_text") or item_data.get("full_text") or ""
    
    if is_valid_content_for_summary(transcript_val):
        return transcript_val.strip()
    if is_valid_content_for_summary(extracted_text_val):
        return extracted_text_val.strip()
        
    # If not strictly valid (e.g. under 30 chars), let's see if we have some non-placeholder text
    for txt in [transcript_val, extracted_text_val]:
        if txt:
            cleaned = txt.strip()
            if cleaned and not cleaned.startswith("http") and cleaned.lower() not in {
                "content could not be extracted for summarization.",
                "summary unavailable.",
                "ai summary could not be generated.",
                "generating ai summary...",
                "limited text available",
                "no metadata or transcript available for this video.",
                "summary could not be generated."
            }:
                return cleaned
                
    # Fallback to metadata / caption
    title = item_data.get("title") or ""
    desc = item_data.get("description") or ""
    author = item_data.get("author") or ""
    url = item_data.get("url") or ""
    
    parts = []
    if title and title != url:
        parts.append(f"Title: {title}")
    if author and author != "Unknown Author":
        parts.append(f"Author: {author}")
    if desc:
        cleaned_desc = desc.strip()
        # Ignore generic placeholder descriptions
        if cleaned_desc.lower() not in {
            "instagram post content", "instagram post", "threads post content", 
            "threads post", "limited text available"
        }:
            parts.append(f"Caption/Description: {cleaned_desc}")
            
    if parts:
        return "\n".join(parts)
        
    # Absolute fallback
    if title:
        return f"Link: {url}\nTitle: {title}"
        
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
    db_updated = False
    
    print(f"[PIPELINE LOG] [ensure_summary] Starting summary generation for item {item.get('id')}...")
    
    try:
        if not resolved_content:
            summary = "Summary could not be generated."
            print(f"[PIPELINE LOG] [ensure_summary] No valid content for summary.")
        else:
            ai = get_ai_service()
            # Attempt 1
            print(f"[PIPELINE LOG] [ensure_summary] Attempt 1...")
            try:
                summary = ai.generate_summary(title=title_for_ai, content=resolved_content, content_type=content_type)
                print(f"[PIPELINE LOG] [ensure_summary] Attempt 1 succeeded.")
            except Exception as e:
                logger.warning(f"[ensure_summary] attempt 1 failed: {e}")
                print(f"[PIPELINE LOG] [ensure_summary] Attempt 1 failed: {e}")
            
            # Check fallback/failure
            if not summary or summary in ["Content could not be extracted for summarization.", "Summary could not be generated.", "Summary unavailable."]:
                # Retry once
                print(f"[PIPELINE LOG] [ensure_summary] Attempt 2 (Retry)...")
                try:
                    summary = ai.generate_summary(title=title_for_ai, content=resolved_content, content_type=content_type)
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
        supabase.table("items").update(update_data).eq("id", item.get("id")).execute()
        db_updated = True
        item["ai_summary"] = summary
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


async def run_background_extraction_and_enrichment(
    item_id: str,
    clean_url: str,
    user_id: str,
    title_override: Optional[str] = None
) -> None:
    """Background task to extract content, fetch user interests, analyze with AI, compute priority/embeddings, and update DB."""
    import time
    import traceback
    
    print(f"[PIPELINE LOG] [Background] Starting extraction & enrichment for item {item_id}")
    logger.info(f"Background extraction & enrichment started for item {item_id}")
    start_time = time.time()
    
    db_updated = False
    
    try:
        # Run independent tasks: content extraction and user interests retrieval concurrently
        extracted_task = extract_content(clean_url)
        user_interests_task = asyncio.to_thread(_get_user_interests, user_id)
        
        extracted, user_interests = await asyncio.gather(extracted_task, user_interests_task)
        
        full_text_val = extracted.get("full_text") or ""
        description_val = extracted.get("description") or ""
        transcript_val = extracted.get("transcript") or ""
        title_val = title_override or extracted.get("title") or clean_url
        source_type = extracted.get("source_type", "generic")
        source_name = extracted.get("source_name")
        source_domain = extracted.get("source_domain")
        logo_url = extracted.get("logo_url")
        thumbnail_url = extracted.get("thumbnail_url")
        estimated_read_time = extracted.get("estimated_read_time")
        duration_seconds = extracted.get("duration_seconds")
        author = extracted.get("author")
        
        print(f"[PIPELINE LOG] [Background] Extracted content title={title_val!r} type={source_type}")
        
        # Resolve content using our new robust helper
        content_to_use = get_usable_content({
            "transcript": transcript_val,
            "extracted_text": full_text_val,
            "title": title_val,
            "description": description_val,
            "author": author,
            "url": clean_url
        })
        
        if content_to_use:
            ai = get_ai_service()
            title_for_ai = "" if source_type == "youtube" else title_val
            
            # Run AI analysis (summarization, tagging, priority) and embedding generation concurrently
            analysis_task = asyncio.to_thread(ai.analyze_content, title_for_ai, content_to_use, source_type)
            embedding_task = asyncio.to_thread(ai.generate_embedding, content_to_use)
            
            analysis, embedding = await asyncio.gather(analysis_task, embedding_task)
            
            summary = analysis.get("summary")
            
            # Check if summary is valid, if not retry once (only if content is not extremely short)
            if not summary or summary in ["Content could not be extracted for summarization.", "Summary could not be generated.", "Summary unavailable."]:
                if len(content_to_use) >= 300:
                    print(f"[PIPELINE LOG] [Background] AI analysis Attempt 1 returned invalid summary. Retrying...")
                    # Retry once
                    analysis = await asyncio.to_thread(ai.analyze_content, title_for_ai, content_to_use, source_type)
                    summary = analysis.get("summary")
                
            if not summary:
                summary = "Summary could not be generated."
                
            tags = analysis.get("tags") or ["uncategorized"]
            priority_score = analysis.get("priority", 50)
            
            word_count = len(content_to_use.split()) if content_to_use else 0
            est_read_time = max(1, round(word_count / 200)) if word_count else 1
            if estimated_read_time is None:
                estimated_read_time = est_read_time
                
            new_priority = ai.calculate_priority(
                title=title_val,
                summary=summary,
                tags=tags,
                source_type=source_type,
                estimated_time=estimated_read_time,
                days_since_added=0,
                user_interests=user_interests
            )
            
            processing_status = "completed"
        else:
            summary = "Summary could not be generated."
            tags = ["uncategorized"]
            new_priority = 30.0
            processing_status = "completed"
            
        print(f"[PIPELINE LOG] [Background] AI enrichment completed. Saving to DB...")
        
        # Save success to DB
        update_data = {
            "title": title_val,
            "description": description_val or None,
            "content_type": source_type,
            "source_name": source_name,
            "source_type": source_type,
            "source_domain": source_domain,
            "logo_url": logo_url,
            "thumbnail_url": thumbnail_url,
            "estimated_read_time": estimated_read_time,
            "duration_seconds": duration_seconds,
            "extracted_text": full_text_val or content_to_use or None,
            "author": author,
            "tags": tags,
            "ai_summary": summary,
            "priority_score": new_priority,
            "processing_status": processing_status
        }
        
        try:
            await asyncio.to_thread(
                lambda: supabase.table("items").update(update_data).eq("id", item_id).execute()
            )
        except Exception as e:
            if "column" in str(e).lower():
                logger.warning("Database update failed due to missing branding columns. Retrying without new columns.")
                fallback_update_data = {k: v for k, v in update_data.items() if k not in ["source_type", "source_domain", "logo_url"]}
                await asyncio.to_thread(
                    lambda: supabase.table("items").update(fallback_update_data).eq("id", item_id).execute()
                )
            else:
                raise e

        db_updated = True
        print(f"[PIPELINE LOG] [Background] DB updated successfully for item {item_id}")
        
        transcript_len = len(transcript_val)
        extracted_text_len = len(full_text_val)
        summary_input_len = len(content_to_use)
        summary_output_len = len(summary) if summary else 0

        print(f"[PIPELINE LOG] run_background_ai_enrichment - transcript_length: {transcript_len}")
        print(f"[PIPELINE LOG] run_background_ai_enrichment - extracted_text_length: {extracted_text_len}")
        print(f"[PIPELINE LOG] run_background_ai_enrichment - summary_input_length: {summary_input_len}")
        print(f"[PIPELINE LOG] run_background_ai_enrichment - summary_output_length: {summary_output_len}")
        
        # Schedule audio generation if summary is successful (run in background, do not await)
        if processing_status == "completed" and summary and summary != "Summary could not be generated.":
            asyncio.create_task(asyncio.to_thread(_generate_audio, item_id, summary))
            
    except Exception as e:
        logger.error(f"Background extraction/enrichment failed for item {item_id}: {e}", exc_info=True)
        print(f"[PIPELINE LOG] [Background] Failed for item {item_id}: {e}")
        traceback.print_exc()
        
        if not db_updated:
            try:
                update_data = {
                    "ai_summary": "Summary could not be generated.",
                    "processing_status": "failed",
                }
                await asyncio.to_thread(
                    lambda: supabase.table("items").update(update_data).eq("id", item_id).execute()
                )
                print(f"[PIPELINE LOG] [Background] DB updated to 'failed' for item {item_id}")
            except Exception as db_err:
                logger.error(f"Failed to update item {item_id} on failure: {db_err}")
                
        raise e


async def recover_processing_items():
    print("[RECOVERY] Starting processing items recovery worker...")
    try:
        res = supabase.table("items").select("*").eq("processing_status", "processing").execute()
        items = res.data or []
        print(f"[RECOVERY] Found {len(items)} items in 'processing' state.")
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
            "ai_summary": "Generating AI summary...",
            "priority_score": 50.0,
            "status": "unread",
            "processing_status": "processing",
            "is_favorite": False,
        }

        try:
            result = await asyncio.to_thread(
                lambda: supabase.table("items").insert(item_data).execute()
            )
        except Exception as e:
            if "column" in str(e).lower():
                logger.warning("Database insert failed due to missing branding columns. Retrying without new columns.")
                fallback_item_data = {k: v for k, v in item_data.items() if k not in ["source_type", "source_domain", "logo_url"]}
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
        
        # Schedule the slow extraction and enrichment process as a background task
        background_tasks.add_task(
            run_background_extraction_and_enrichment,
            item_id,
            clean_url,
            user_id,
            req.title
        )
            
        return {
            "success": True,
            "message": "Saved to Queue",
            "id": item_id,
            "title": title
        }

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
    search: Optional[str] = None,
    sort: Optional[str] = "newest",       # newest | priority | shortest | longest
    limit: int = Query(default=50, le=100),
    offset: int = 0,
    user_id: str = Depends(get_user_id),
):
    try:
        query = supabase.table("items").select("*", count="exact").eq("user_id", user_id)

        # Filters
        if status:
            query = query.eq("status", status)
        if type:
            query = query.eq("content_type", type)
        if tag:
            # Supabase array contains
            query = query.contains("tags", [tag])
        if search:
            # Text search on title + description (ilike)
            query = query.or_(
                f"title.ilike.%{search}%,description.ilike.%{search}%"
            )

        # Sort
        if sort == "priority":
            query = query.order("priority_score", desc=True)
        elif sort == "shortest":
            query = query.order("estimated_read_time", desc=False, nullsfirst=False)
        elif sort == "longest":
            query = query.order("estimated_read_time", desc=True, nullsfirst=False)
        else:  # newest (default)
            query = query.order("added_at", desc=True)

        # Pagination
        query = query.range(offset, offset + limit - 1)

        result = await asyncio.to_thread(query.execute)
        items = [item_to_response(r) for r in (result.data or [])]
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
    limit: int = Query(default=20, le=50),
    user_id: str = Depends(get_user_id),
):
    try:
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .or_(f"title.ilike.%{q}%,description.ilike.%{q}%")
            .order("added_at", desc=True)
            .limit(limit)
            .execute()
        )
        items = [item_to_response(r) for r in (result.data or [])]
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[items] search_items error: {e}")
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


# ---------------------------------------------------------------------------
# PUT /api/items/{item_id} — Full edit (title, tags, summary, description)
# ---------------------------------------------------------------------------

@router.put("/{item_id}")
async def edit_item(item_id: str, req: ItemEdit, user_id: str = Depends(get_user_id)):
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

        if not update_data:
            return await get_item(item_id, user_id)

        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .update(update_data)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Item not found")
        return item_to_response(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        print(f"[items] edit_item error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# PATCH /api/items/{item_id} — Quick update (status, is_favorite, title, tags)
# ---------------------------------------------------------------------------

@router.patch("/{item_id}")
async def update_item(item_id: str, req: ItemUpdate, user_id: str = Depends(get_user_id)):
    try:
        update_data: dict = {}

        if req.status is not None:
            update_data["status"] = req.status
            if req.status == "completed":
                update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
            else:
                update_data["completed_at"] = None

        if req.is_favorite is not None:
            update_data["is_favorite"] = req.is_favorite

        if not update_data:
            return await get_item(item_id, user_id)

        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .update(update_data)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Item not found")
        return item_to_response(result.data[0])
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
        # Fetch all non-completed items
        result = (
            supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .neq("status", "completed")
            .execute()
        )
        items = result.data or []
        if not items:
            return {"updated": 0}

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
                )
                supabase.table("items").update({"priority_score": new_score}).eq("id", item["id"]).execute()
                updated += 1
            except Exception as e:
                print(f"[items] Priority recalc failed for {item.get('id')}: {e}")

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
        # Get completed tags to infer interests
        completed_tags = _get_user_interests(user_id)
        
        # Get unread items
        result = (
            supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .eq("status", "unread")
            .order("priority_score", desc=True)
            .limit(20)
            .execute()
        )
        
        unread_items = result.data or []
        ai = get_ai_service()
        
        suggestion = ai.suggest_next_items(completed_tags, unread_items)
        return {"suggestion": suggestion}
        
    except Exception as e:
        print(f"[items] get_recommendations error: {e}")
        return {"suggestion": "Suggested next: (No items available)"}


# ---------------------------------------------------------------------------
# GET /api/items/user/streak
# ---------------------------------------------------------------------------

@router.get("/user/streak")
async def get_user_streak(user_id: str = Depends(get_user_id)):
    try:
        result = await asyncio.to_thread(
            lambda: supabase.table("items")
            .select("added_at, completed_at, estimated_read_time, status")
            .eq("user_id", user_id)
            .execute()
        )
        
        items = result.data or []
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        
        daily_saves = 0
        daily_completions = 0
        daily_reading_time = 0
        
        completed_dates = set()
        total_completed = 0
        has_deep_read = False
        
        for item in items:
            added_at_str = item.get("added_at")
            completed_at_str = item.get("completed_at")
            read_time = item.get("estimated_read_time") or 0
            status = item.get("status")
            
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
            
        return {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "daily_saves": daily_saves,
            "daily_completions": daily_completions,
            "daily_reading_goal_minutes": 15,
            "daily_reading_time_minutes": daily_reading_time,
            "badges": badges,
            "total_completed": total_completed
        }
    except Exception as e:
        logger.error("Failed to compute streak: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
