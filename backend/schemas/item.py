"""Pydantic models for the items API — canonical schema matching Supabase exactly."""

from pydantic import BaseModel
from typing import Optional, List


class ItemCreate(BaseModel):
    """Request body for creating a queue item."""
    url: str
    title: Optional[str] = None  # Optional user-supplied title override
    collection_id: Optional[str] = None
    suggested_collection_name: Optional[str] = None
    suggested_collection_color: Optional[str] = None


class ItemUpdate(BaseModel):
    """Quick update: status toggle, favorite toggle, progress, collection, notes, time spent."""
    status: Optional[str] = None       # unread | reading | completed | archived
    is_favorite: Optional[bool] = None
    read_progress: Optional[int] = None
    collection_id: Optional[str] = None
    actual_time_spent: Optional[float] = None


class ItemEdit(BaseModel):
    """Full edit: title, tags, ai_summary, description, notes, collection_id, read_progress, time spent."""
    title: Optional[str] = None
    tags: Optional[List[str]] = None
    ai_summary: Optional[str] = None
    description: Optional[str] = None
    collection_id: Optional[str] = None
    read_progress: Optional[int] = None
    full_summary: Optional[str] = None
    actual_time_spent: Optional[float] = None


class ItemResponse(BaseModel):
    # Updated to include logo_url for source branding
    audio_url: Optional[str] = None
    logo_url: Optional[str] = None
    """Single item — all canonical fields, now includes optional audio_url."""
    id: str
    user_id: str
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    content_type: str = "generic"
    source_name: Optional[str] = None
    source_type: Optional[str] = None
    source_domain: Optional[str] = None
    thumbnail_url: Optional[str] = None
    estimated_read_time: Optional[int] = None
    estimated_time_minutes: Optional[float] = None
    actual_time_spent: Optional[float] = None
    duration_seconds: Optional[int] = None
    extracted_text: Optional[str] = None
    author: Optional[str] = None
    tags: List[str] = []
    ai_summary: Optional[str] = None
    full_summary: Optional[str] = None
    priority_score: float = 50.0
    status: str = "unread"
    processing_status: str = "completed"
    is_favorite: bool = False
    added_at: Optional[str] = None
    completed_at: Optional[str] = None
    collection_id: Optional[str] = None
    read_progress: int = 0
