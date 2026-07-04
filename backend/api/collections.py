"""
Collections API router — CRUD endpoints for organizing queue items.
All endpoints require an authenticated user.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from typing import List
from schemas.collection import CollectionCreate, CollectionUpdate, CollectionResponse
from utils.supabase_client import supabase
from utils.schema_fallback import fallback_db
from middleware.auth import get_current_user

router = APIRouter(prefix="/collections", tags=["collections"])

def get_user_id(user: dict = Depends(get_current_user)) -> str:
    return user.get("id") or user.get("sub")

# ---------- GET /api/collections ----------
@router.get("", response_model=List[CollectionResponse])
async def list_collections(user_id: str = Depends(get_user_id)):
    """List all collections belonging to the current user."""
    try:
        collections = fallback_db.list_collections(user_id, supabase)
        try:
            stats = fallback_db.get_collection_stats(user_id, supabase)
            for col in collections:
                col_id = col.get("id")
                col_stats = stats.get(col_id, {"item_count": 0, "read_time_minutes": 0})
                col["item_count"] = col_stats["item_count"]
                col["read_time_minutes"] = col_stats["read_time_minutes"]
        except Exception as stats_err:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Failed to calculate stats for collections: {stats_err}")
            for col in collections:
                col["item_count"] = 0
                col["read_time_minutes"] = 0
        return collections
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch collections: {str(e)}"
        )

# ---------- POST /api/collections ----------
@router.post("", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
async def create_collection(
    req: CollectionCreate,
    user_id: str = Depends(get_user_id)
):
    """Create a new collection for the user."""
    try:
        return fallback_db.create_collection(user_id, req.name.strip(), req.color.strip() if req.color else "blue", supabase)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create collection: {str(e)}"
        )

# ---------- PUT /api/collections/{collection_id} ----------
@router.put("/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    collection_id: str,
    req: CollectionUpdate,
    user_id: str = Depends(get_user_id)
):
    """Update a collection name or color."""
    try:
        return fallback_db.update_collection(user_id, collection_id, req.name, req.color, supabase)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(ve)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to update collection: {str(e)}"
        )

# ---------- DELETE /api/collections/{collection_id} ----------
@router.delete("/{collection_id}")
async def delete_collection(
    collection_id: str,
    user_id: str = Depends(get_user_id)
):
    """Delete a collection. Items inside will have collection_id set to NULL."""
    try:
        success = fallback_db.delete_collection(user_id, collection_id, supabase)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Collection not found or permission denied"
            )
        return {"success": True, "message": "Collection deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to delete collection: {str(e)}"
        )
