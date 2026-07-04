"""Pydantic models for the queue items API."""

from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List

class AddItemRequest(BaseModel):
    """Request body: the user submits a URL to be extracted and saved."""
    url: HttpUrl
    title: Optional[str] = None


class ItemEdit(BaseModel):
    """Request body: full edit of user-editable fields."""
    title: Optional[str] = None
    tags: Optional[List[str]] = None
    ai_summary: Optional[str] = None
    description: Optional[str] = None
    full_summary: Optional[str] = None


class ItemUpdate(BaseModel):
    """Request body: quick updates (status, favorite)."""
    status: Optional[str] = Field(
        None,
        pattern="^(unread|reading|completed|archived)$",
        description="One of: unread, reading, completed, archived",
    )
    is_favorite: Optional[bool] = None


class QueueItemResponse(BaseModel):
    """A single queue item returned to the frontend."""
    id: str
    user_id: str
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    content_type: str = "generic"
    source_name: Optional[str] = None
    source_type: Optional[str] = None
    source_domain: Optional[str] = None
    logo_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    estimated_read_time: Optional[int] = None
    estimated_time_minutes: Optional[float] = None
    actual_time_spent: Optional[float] = None
    duration_seconds: Optional[int] = None
    extracted_text: Optional[str] = None
    author: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    ai_summary: Optional[str] = None
    full_summary: Optional[str] = None
    priority_score: float = 50.0
    audio_url: Optional[str] = None
    status: str = "unread"
    processing_status: str = "completed"
    is_favorite: bool = False
    added_at: Optional[str] = None
    completed_at: Optional[str] = None


class QueueListResponse(BaseModel):
    """Response containing a list of queue items."""
    items: List[QueueItemResponse]
    total: int
