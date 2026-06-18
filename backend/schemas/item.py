"""Pydantic models for the items API — canonical schema matching Supabase exactly."""

from pydantic import BaseModel
from typing import Optional, List


class ItemCreate(BaseModel):
    """Request body for creating a queue item."""
    url: str
    title: Optional[str] = None  # Optional user-supplied title override


class ItemUpdate(BaseModel):
    """Quick update: status toggle, favorite toggle."""
    status: Optional[str] = None       # unread | reading | completed | archived
    is_favorite: Optional[bool] = None


class ItemEdit(BaseModel):
    """Full edit: title, tags, ai_summary, description."""
    title: Optional[str] = None
    tags: Optional[List[str]] = None
    ai_summary: Optional[str] = None
    description: Optional[str] = None


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
    thumbnail_url: Optional[str] = None
    estimated_read_time: Optional[int] = None
    duration_seconds: Optional[int] = None
    extracted_text: Optional[str] = None
    author: Optional[str] = None
    tags: List[str] = []
    ai_summary: Optional[str] = None
    priority_score: float = 50.0
    status: str = "unread"
    is_favorite: bool = False
    added_at: Optional[str] = None
