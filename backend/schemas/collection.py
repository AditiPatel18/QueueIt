"""Pydantic models for the collections API."""

from pydantic import BaseModel
from typing import Optional

class CollectionCreate(BaseModel):
    """Request schema to create a collection."""
    name: str
    color: Optional[str] = "blue"

class CollectionUpdate(BaseModel):
    """Request schema to update a collection."""
    name: Optional[str] = None
    color: Optional[str] = None

class CollectionResponse(BaseModel):
    """Response schema for a collection."""
    id: str
    user_id: str
    name: str
    color: str
    created_at: str
    item_count: Optional[int] = 0
    read_time_minutes: Optional[int] = 0
