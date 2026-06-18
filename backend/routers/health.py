from fastapi import APIRouter
from datetime import datetime, timezone

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health_check():
    """Health check endpoint — returns service status and timestamp."""
    return {
        "status": "ok",
        "service": "queueit-api",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "0.1.0",
    }
