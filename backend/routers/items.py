"""
Queue items router — CRUD endpoints for the content queue.
All endpoints require an authenticated user (JWT in Authorization header).
"""

from fastapi import APIRouter, HTTPException, Depends, status, Query, Response, BackgroundTasks
from supabase import create_client, Client
from config import get_settings
from middleware.auth import get_current_user
from models.items import (
    AddItemRequest,
    UpdateItemRequest,
    QueueItemResponse,
    QueueListResponse,
    APIResponse
)
from services.extractor import extract_content
from services.ai_service import get_ai_service
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/items", tags=["items"])


def get_supabase_admin() -> Client:
    """
    Return a Supabase client using the service-role key.
    This bypasses RLS — auth is handled by our JWT middleware instead.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


# ---------- POST /api/items ----------
@router.post("", response_model=APIResponse[QueueItemResponse], status_code=status.HTTP_201_CREATED)
async def add_item(
    request: AddItemRequest,
    response: Response,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Submit a URL → extract content → store in the database.
    Returns the newly created queue item.
    If extraction fails, the URL is still saved as a generic bookmark.
    """
    user_id = current_user.get("sub")
    if not user_id:
        response.status_code = 401
        return APIResponse(success=False, error="Invalid user token")

    url_str = str(request.url)
    logger.info("[ADD_ITEM] user_id=%s url=%s", user_id, url_str)

    # 1. Extract content from the URL (never raises — has internal fallback)
    try:
        content = await extract_content(url_str)
        logger.info(
            "[ADD_ITEM] Extraction result: title=%s, source_type=%s",
            content.get("title", "?")[:80],
            content.get("source_type", "?"),
        )
    except Exception as e:
        logger.error("[ADD_ITEM] Extraction unexpectedly raised for %s: %s", url_str, e)
        from urllib.parse import urlparse
        domain = urlparse(url_str).hostname or "unknown"
        content = {
            "source_type": "generic",
            "title": url_str,
            "description": None,
            "author": None,
            "thumbnail_url": None,
            "source_name": domain.removeprefix("www."),
            "estimated_read_time": None,
            "duration_seconds": None,
            "full_text": None,
        }

    # 2. Add AI Enhancements synchronously
    try:
        ai_service = get_ai_service()
        source_type = content.get("source_type", "article")
        
        if source_type == "youtube":
            content_text = content.get("transcript") or content.get("full_text") or content.get("description") or ""
            title_for_ai = ""
        else:
            content_text = content.get("full_text") or ""
            title_for_ai = content.get("title") or url_str

        ai_tags = ai_service.generate_tags(
            title=title_for_ai,
            content=content_text,
            source_type=source_type
        )
        # Generate AI summary only if we have substantive content (content_text)
        ai_summary = None
        if content_text:
            ai_summary = ai_service.generate_summary(
                title=title_for_ai,
                content=content_text,
                description=content.get("description") or ""
            )
        
        time_seconds = content.get("estimated_read_time") and content.get("estimated_read_time", 0) * 60
        if not time_seconds:
            time_seconds = content.get("duration_seconds", 0)
            
        priority_score = ai_service.calculate_priority(
            title=title_for_ai,
            summary=ai_summary or "",
            tags=ai_tags,
            source_type=source_type,
            estimated_time=time_seconds,
            days_since_added=0
        )
    except Exception as e:
        logger.error("[ADD_ITEM] AI enhancement failed: %s", e)
        ai_tags = ["uncategorized"]
        ai_summary = None
        priority_score = 50.0

    # 3. Insert into Supabase
    try:
        supabase = get_supabase_admin()
        row = {
            "user_id": user_id,
            "url": url_str,
            "content_type": content.get("source_type", "article"),
            "title": content.get("title") or url_str,
            "description": content.get("description"),
            "author": content.get("author"),
            "thumbnail_url": content.get("thumbnail_url"),
            "source_name": content.get("source_name"),
            "estimated_read_time": content.get("estimated_read_time"),
            "duration_seconds": content.get("duration_seconds"),
            "extracted_text": content.get("full_text"),
            "status": "unread",
            "processing_status": "completed",
            "tags": ai_tags,
            "ai_summary": ai_summary,
            "priority_score": priority_score,
        }

        result = supabase.table("items").insert(row).execute()
        if not result.data:
            response.status_code = 500
            return APIResponse(success=False, error="Failed to save item to database")

        item = result.data[0]
        # Schedule async audio generation if AI summary exists
        if ai_summary:
            background_tasks.add_task(_generate_audio_and_update, item.get("id"), ai_summary)

        return APIResponse(success=True, data=QueueItemResponse(**item))
    except Exception as e:
        logger.error("[ADD_ITEM] Database error: %s", str(e))
        response.status_code = 500
        return APIResponse(success=False, error=f"Database error: {str(e)}")


# ---------- GET /api/items ----------
@router.get("", response_model=APIResponse[QueueListResponse])
async def list_items(
    response: Response,
    current_user: dict = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    tags: str | None = Query(default=None),
):
    """
    Return the current user's queue items, newest first.
    Supports pagination, status filtering, search (by title/summary), and tags.
    """
    user_id = current_user.get("sub")
    if not user_id:
        response.status_code = 401
        return APIResponse(success=False, error="Invalid user token")

    try:
        supabase = get_supabase_admin()
        query = (
            supabase.table("items")
            .select("*", count="exact")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
        )

        if status_filter:
            query = query.eq("status", status_filter)
        
        if search:
            # Simple text search on title
            query = query.ilike("title", f"%{search}%")
            
        if tags:
            # Parse comma-separated tags and use contains on the array
            tag_list = [t.strip() for t in tags.split(",") if t.strip()]
            if tag_list:
                query = query.contains("tags", tag_list)

        result = query.execute()

        items = [QueueItemResponse(**item) for item in (result.data or [])]
        total = result.count if result.count is not None else len(items)

        return APIResponse(success=True, data=QueueListResponse(items=items, total=total))
    except Exception as e:
        logger.error("Failed to fetch items: %s", str(e))
        response.status_code = 500
        return APIResponse(success=False, error=f"Failed to fetch items: {str(e)}")


# ---------- PATCH /api/items/{item_id} ----------
@router.patch("/{item_id}", response_model=APIResponse[QueueItemResponse])
async def update_item(
    item_id: str,
    request: UpdateItemRequest,
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    """Update a queue item's status, title, or tags."""
    user_id = current_user.get("sub")
    if not user_id:
        response.status_code = 401
        return APIResponse(success=False, error="Invalid user token")

    updates = {}
    if request.status is not None:
        updates["status"] = request.status
    if request.title is not None:
        updates["title"] = request.title
    if request.tags is not None:
        updates["tags"] = request.tags

    if not updates:
        response.status_code = 400
        return APIResponse(success=False, error="No fields to update")

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("items")
            .update(updates)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )

        if not result.data:
            response.status_code = 404
            return APIResponse(success=False, error="Item not found or permission denied")

        return APIResponse(success=True, data=QueueItemResponse(**result.data[0]))
    except Exception as e:
        logger.error("Failed to update item: %s", str(e))
        response.status_code = 500
        return APIResponse(success=False, error=f"Failed to update item: {str(e)}")


# ---------- DELETE /api/items/{item_id} ----------
@router.delete("/{item_id}", response_model=APIResponse[None])
async def delete_item(
    item_id: str,
    response: Response,
    current_user: dict = Depends(get_current_user),
):
    """Delete a queue item. Only the item owner can delete."""
    user_id = current_user.get("sub")
    if not user_id:
        response.status_code = 401
        return APIResponse(success=False, error="Invalid user token")

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("items")
            .delete()
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )

        if not result.data:
            response.status_code = 404
            return APIResponse(success=False, error="Item not found or permission denied")
            
        return APIResponse(success=True, data=None)
    except Exception as e:
        response.status_code = 500
        return APIResponse(success=False, error=f"Failed to delete item: {str(e)}")
