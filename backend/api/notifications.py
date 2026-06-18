from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from utils.supabase_client import supabase
from services.notification_service import NotificationService

router = APIRouter()

class PreferenceUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    push_enabled: Optional[bool] = None
    whatsapp_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    quiet_start: Optional[str] = None  # HH:MM format
    quiet_end: Optional[str] = None
    preferred_days: Optional[List[int]] = None
    preferred_time: Optional[str] = None
    max_items_per_notification: Optional[int] = None
    snoozed_until: Optional[str] = None

@router.get("/notifications/preferences", response_model=dict)
async def get_preferences(user_id: str):
    resp = supabase.table("notification_preferences").select("*").eq("user_id", user_id).single().execute()
    if resp.error:
        raise HTTPException(status_code=404, detail="Preferences not found")
    return resp.data

@router.post("/notifications/preferences", response_model=dict)
async def set_preferences(user_id: str, prefs: PreferenceUpdate):
    # Upsert preference record
    data = {k: v for k, v in prefs.dict().items() if v is not None}
    data["user_id"] = user_id
    resp = supabase.table("notification_preferences").upsert(data, on_conflict=["user_id"]).execute()
    if resp.error:
        raise HTTPException(status_code=400, detail=resp.error.message)
    return resp.data[0] if isinstance(resp.data, list) else resp.data

@router.post("/notifications/subscribe", status_code=status.HTTP_201_CREATED)
async def subscribe_push(user_id: str, subscription: dict):
    # Store VAPID subscription JSON
    resp = supabase.table("push_subscriptions").upsert({"user_id": user_id, "subscription": subscription}, on_conflict=["user_id"]).execute()
    if resp.error:
        raise HTTPException(status_code=400, detail=resp.error.message)
    return {"result": "subscribed"}

@router.post("/notifications/unsubscribe", status_code=status.HTTP_200_OK)
async def unsubscribe_push(user_id: str):
    resp = supabase.table("push_subscriptions").delete().eq("user_id", user_id).execute()
    if resp.error:
        raise HTTPException(status_code=400, detail=resp.error.message)
    return {"result": "unsubscribed"}

@router.post("/notifications/send-test", status_code=status.HTTP_200_OK)
async def send_test(user_id: str):
    service = NotificationService()
    pref = service.get_user_preferences(user_id)
    if not pref.email_enabled:
        raise HTTPException(status_code=400, detail="Email not enabled for user")
    service.send_email(to_email=user_id, subject="QueueIt Test Notification", html_content="<p>This is a test notification from QueueIt.</p>")
    return {"result": "test email sent"}
