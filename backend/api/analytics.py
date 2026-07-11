"""
Analytics API router.
Provides endpoint for reading analytics metrics.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import get_current_user
from services.analytics_service import AnalyticsService
from utils.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("")
async def get_analytics(user: dict = Depends(get_current_user)):
    """Fetch reading analytics metrics for the authenticated user."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        metrics = AnalyticsService.calculate_dashboard_metrics(user_id, supabase)
        return metrics
    except Exception as e:
        logger.error("Failed to compute reading analytics dashboard: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compute reading analytics dashboard: {str(e)}")
