"""Pydantic models for the AI Chat API."""

from pydantic import BaseModel
from typing import List, Optional
from schemas.item import ItemResponse


class ChatMessage(BaseModel):
    """A single message in the chat history."""
    role: str  # 'user' or 'assistant'
    content: str


class ChatRequest(BaseModel):
    """Request body for submitting a message to the AI queue chat."""
    message: str
    history: List[ChatMessage] = []


class ChatResponse(BaseModel):
    """Response structure containing assistant reply and matching queue item sources."""
    response: str
    sources: List[ItemResponse] = []
