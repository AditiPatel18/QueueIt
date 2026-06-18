from fastapi import APIRouter, Depends
from middleware.auth import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """
    Returns the current authenticated user's profile.
    """
    return {"user": current_user}