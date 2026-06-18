from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class SignUpRequest(BaseModel):
    """Request body for user registration."""
    email: EmailStr
    password: str = Field(..., min_length=6, description="Minimum 6 characters")
    full_name: Optional[str] = None


class LoginRequest(BaseModel):
    """Request body for user login."""
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    """Public user profile data."""
    id: str
    email: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: Optional[str] = None


class AuthResponse(BaseModel):
    """Response returned after successful authentication."""
    user: UserResponse
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: Optional[int] = None


class MessageResponse(BaseModel):
    """Generic message response."""
    message: str
    success: bool = True
