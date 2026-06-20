"""
Items API router — complete implementation with AI integration.
All endpoints, full filtering, sorting, search, and priority recalculation.
"""

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Any, Optional, List
from datetime import datetime, timezone, timedelta

from schemas.item import ItemCreate, ItemUpdate, ItemEdit
from services.extractor import extract_content
from services.ai_service import get_ai_service
from services.audio_service import AudioService
from utils.supabase_client import supabase
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

    return {
        "id": item.get("id"),
        "user_id": item.get("user_id"),
        "url": item.get("url", ""),
        "title": item.get("title"),
        "description": item.get("description"),
        "content_type": item.get("content_type", "generic"),
        "logo_url": item.get("logo_url"),
        "status": item.get("status", "unread"),
        "is_favorite": item.get("is_favorite", False),
        "added_at": item.get("added_at"),
        "created_at": item.get("created_at") or item.get("added_at"),
        "audio_url": item.get("audio_url"),
        "source_name": item.get("source_name"),
        "thumbnail_url": item.get("thumbnail_url"),
        # ── Fields that were previously missing ──
        "ai_summary": item.get("ai_summary"),
        "tags": tags,
        "extracted_text": item.get("extracted_text"),
        "author": item.get("author"),
        "estimated_read_time": item.get("estimated_read_time"),
        "duration_seconds": item.get("duration_seconds"),
        "priority_score": item.get("priority_score", 50.0),
    }


def ensure_summary(item: dict) -> dict:
    """Ensure the item has a non-empty ai_summary. If missing, generate one and update DB.
    Returns the possibly updated item dict.
    """
    if item.get("ai_summary"):
        return item

    title = item.get("title") or ""
    description = item.get("description") or ""
    content_type = item.get("content_type") or "generic"
    
    # Priority: full_text (or transcript) -> extracted_text -> description -> title
    resolved_content = ""
    used_source = ""
    
    if content_type == "youtube":
        resolved_content = item.get("transcript") or item.get("extracted_text") or ""
        used_source = "transcript" if item.get("transcript") else "extracted_text"
        if not resolved_content:
            resolved_content = description
            used_source = "description"
        if not resolved_content:
            resolved_content = title
            used_source = "title"
    else:
        if item.get("extracted_text"):
            resolved_content = item.get("extracted_text")
            used_source = "extracted_text"
        elif description:
            resolved_content = description
            used_source = "description"
        else:
            resolved_content = title
            used_source = "title"

    print(f"[PIPELINE LOG] [API] [ensure_summary] resolved content source: {used_source}, length: {len(resolved_content)}")
    print(f"[PIPELINE LOG] [API] [ensure_summary] extracted_text length: {len(item.get('extracted_text') or '')}")

    if len(resolved_content.strip()) < 300:
        summary = "Limited text available"
    else:
        title_for_ai = "" if content_type == "youtube" else title
        ai = get_ai_service()
        summary = ai.generate_summary(title=title_for_ai, content=resolved_content, description=description, content_type=content_type)
        if not summary:
            summary = "AI summary could not be generated."

    # Update DB
    try:
        supabase.table("items").update({"ai_summary": summary}).eq("id", item.get("id")).execute()
        item["ai_summary"] = summary
        print(f"[PIPELINE LOG] [Database] [ensure_summary] Saved to DB. ai_summary length: {len(summary)}")
    except Exception as e:
        logger.error(f"Failed to backfill ai_summary for item {item.get('id')}: {e}")
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


# ---------------------------------------------------------------------------
# POST /api/items — Create
# ---------------------------------------------------------------------------

@router.post("")
async def create_item(req: ItemCreate, background_tasks: BackgroundTasks, user_id: str = Depends(get_user_id)):
    try:
        clean_url = req.url.strip()

        # Duplicate check
        existing = (
            supabase.table("items")
            .select("*")
            .eq("user_id", user_id)
            .eq("url", clean_url)
            .execute()
        )
        if existing.data:
            print(f"[items] Duplicate URL for user {user_id}, returning existing item")
            return item_to_response(existing.data[0])

        # Extract content
        print(f"[items] Extracting content: {clean_url}")
        extracted = await extract_content(clean_url)
        print(f"[items] Extracted content title={extracted.get('title', '?')!r} type={extracted.get('source_type', '?')}")
        # 1. Extractor Stage Logs
        full_text_val = extracted.get("full_text") or ""
        description_val = extracted.get("description") or ""
        transcript_val = extracted.get("transcript") or ""
        title_val = req.title or extracted.get("title") or clean_url
        title = title_val
        source_type = extracted.get("source_type", "generic")

        print(f"[PIPELINE LOG] [Extractor] URL: {clean_url}")
        print(f"[PIPELINE LOG] [Extractor] extracted_text length: {len(full_text_val)}")
        print(f"[PIPELINE LOG] [Extractor] full_text length: {len(full_text_val)}")
        print(f"[PIPELINE LOG] [Extractor] description length: {len(description_val)}")
        print(f"[PIPELINE LOG] [Extractor] transcript length: {len(transcript_val)}")

        # Resolve content using priority: full_text (or transcript) -> extracted_text -> description -> title
        content_to_use = ""
        used_source = ""

        if source_type == "youtube":
            content_to_use = transcript_val or full_text_val
            used_source = "transcript" if transcript_val else "full_text"
            if not content_to_use:
                content_to_use = description_val
                used_source = "description"
            if not content_to_use:
                content_to_use = title_val
                used_source = "title"
            title_for_ai = ""
        else:
            if full_text_val:
                content_to_use = full_text_val
                used_source = "full_text"
            elif extracted.get("extracted_text"):
                content_to_use = extracted.get("extracted_text")
                used_source = "extracted_text"
            elif description_val:
                content_to_use = description_val
                used_source = "description"
            else:
                content_to_use = title_val
                used_source = "title"
            title_for_ai = title_val

        print(f"[PIPELINE LOG] [API] Resolved content source: {used_source}, content length: {len(content_to_use)}")

        # AI enrichment with error handling
        ai = get_ai_service()
        
        # Check text length for "Limited text available" rule
        if len(content_to_use.strip()) < 300:
            print(f"[PIPELINE LOG] [API] Content length genuinely less than 300. Bypassing AI.")
            tags = ["uncategorized"]
            summary = "Limited text available"
            priority_score = 30
        else:
            try:
                analysis = ai.analyze_content(title_for_ai, content_to_use, source_type)
            except Exception as e:
                logger.error(f"AI analysis failed for item {clean_url}: {e}")
                analysis = {"tags": ["uncategorized"], "summary": "AI summary could not be generated.", "priority": 50}
            tags = analysis["tags"]
            summary = analysis.get("summary") or "AI summary could not be generated."
            priority_score = analysis["priority"]

        print(f"[items] Tags: {tags}, Priority: {priority_score}, Summary length: {len(summary)}")

        # Build DB row
        item_data = {
            "user_id": user_id,
            "url": clean_url,
            "title": title,
            "description": extracted.get("description"),
            "content_type": source_type,
            "source_name": extracted.get("source_name"),
            "thumbnail_url": extracted.get("thumbnail_url"),
            "estimated_read_time": extracted.get("estimated_read_time"),
            "duration_seconds": extracted.get("duration_seconds"),
            "extracted_text": extracted.get("full_text"),
            "author": extracted.get("author"),
            "tags": tags,
            "ai_summary": summary,
            "priority_score": priority_score,
            "status": "unread",
            "is_favorite": False,
        }

        result = supabase.table("items").insert(item_data).execute()
        if not result.data:
            raise Exception("Failed to insert item into database")

        item_id = result.data[0].get('id')
        db_summary = result.data[0].get('ai_summary') or ""
        print(f"[items] Saved item id={item_id}")
        print(f"[PIPELINE LOG] [Database] Saved item ID: {item_id}, database ai_summary length: {len(db_summary)}")
        # Schedule async audio generation if summary available
        if summary:
            background_tasks.add_task(_generate_audio, item_id, summary)
        return item_to_response(result.data[0])

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

        result = query.execute()
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
        result = (
            supabase.table("items")
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
        result = (
            supabase.table("items")
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
    result = (
        supabase.table("items")
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
            supabase.table("items").update({"audio_url": audio_url}).eq("id", item_id).execute()
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

        result = (
            supabase.table("items")
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

        result = (
            supabase.table("items")
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
        supabase.table("items").delete().eq("id", item_id).eq("user_id", user_id).execute()
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
        .select("id, title, description, extracted_text, ai_summary, content_type, transcript")
        .eq("user_id", user_id)
        .execute()
    )
    items = result.data or []
    updated = 0
    ai = get_ai_service()
    for row in items:
        if row.get("ai_summary"):
            continue
        title = row.get("title") or ""
        description = row.get("description") or ""
        content_type = row.get("content_type") or "generic"
        
        # Priority: full_text (or transcript) -> extracted_text -> description -> title
        resolved_content = ""
        used_source = ""
        
        if content_type == "youtube":
            resolved_content = row.get("transcript") or row.get("extracted_text") or ""
            used_source = "transcript" if row.get("transcript") else "extracted_text"
            if not resolved_content:
                resolved_content = description
                used_source = "description"
            if not resolved_content:
                resolved_content = title
                used_source = "title"
            title_for_ai = ""
        else:
            if row.get("extracted_text"):
                resolved_content = row.get("extracted_text")
                used_source = "extracted_text"
            elif description:
                resolved_content = description
                used_source = "description"
            else:
                resolved_content = title
                used_source = "title"
            title_for_ai = title

        print(f"[PIPELINE LOG] [API] [backfill_summaries] resolved content source: {used_source}, length: {len(resolved_content)}")
        print(f"[PIPELINE LOG] [API] [backfill_summaries] extracted_text length: {len(row.get('extracted_text') or '')}")

        if len(resolved_content.strip()) < 300:
            summary = "Limited text available"
        else:
            summary = ai.generate_summary(title=title_for_ai, content=resolved_content, description=description, content_type=content_type)
            if not summary:
                summary = "AI summary could not be generated."

        try:
            supabase.table("items").update({"ai_summary": summary}).eq("id", row.get("id")).execute()
            updated += 1
            print(f"[PIPELINE LOG] [Database] [backfill_summaries] Saved to DB. ai_summary length: {len(summary)}")
        except Exception as e:
            logger.error(f"Backfill failed for item {row.get('id')}: {e}")
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
        result = (
            supabase.table("items")
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
