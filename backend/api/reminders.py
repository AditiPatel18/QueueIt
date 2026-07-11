"""
Reminders API router.
Manages smart reading reminders settings, trigger checks, snoozes, completions, and read states.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Optional, List
from pydantic import BaseModel
from middleware.auth import get_current_user
from services.reminder_service import ReminderService
from utils.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reminders", tags=["reminders"])


class SettingsUpdate(BaseModel):
    enabled: bool
    reminder_time: str
    frequency: Optional[str] = "daily"
    custom_days: Optional[str] = ""
    timezone: Optional[str] = "UTC"
    browser_notifications: Optional[bool] = True
    email_reminders: Optional[bool] = True
    sms_reminders: Optional[bool] = False
    phone_number: Optional[str] = ""
    email_address: Optional[str] = ""


class SnoozeRequest(BaseModel):
    type: str  # "1h" | "today" | "tomorrow"


@router.get("")
async def get_reminders(
    include_history: bool = True,
    include_settings: bool = True,
    include_gamification: bool = True,
    user: dict = Depends(get_current_user)
):
    """Retrieve active reminders, history, unread badge count, user settings, and gamification state."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        # 1. Trigger due reminder check dynamically (lazy evaluation).
        # check_and_generate_reminder is synchronous (SQLite + Supabase I/O).
        # Use asyncio.to_thread so it never blocks the FastAPI event loop —
        # otherwise every 10-second frontend poll starves the Queue/Dashboard APIs.
        if include_settings:
            import asyncio
            try:
                await asyncio.to_thread(
                    ReminderService.check_and_generate_reminder, user_id, supabase
                )
            except Exception as _chk_err:
                # Never let reminder check failure prevent the page from loading
                logger.warning(f"[Reminders] check_and_generate_reminder skipped: {_chk_err}")

        
        # 2. Fetch parameters
        settings = ReminderService.get_settings(user_id) if include_settings else {
            "enabled": True,
            "reminder_time": "09:00",
            "snoozed_until": None,
            "last_reminded_at": None,
            "frequency": "daily",
            "custom_days": "",
            "timezone": "UTC",
            "browser_notifications": True,
            "email_reminders": True,
            "sms_reminders": False,
            "phone_number": "",
            "email_address": ""
        }
        active_reminders = ReminderService.get_active_reminders(user_id)
        unread_count = ReminderService.get_unread_count(user_id)
        history = ReminderService.get_history(user_id) if include_history else []

        # 3. Gamification stats
        gamification_payload = {
            "xp": 0,
            "level": 1,
            "xp_needed": 200,
            "streak_freezes_available": 0,
            "last_freeze_used_at": None,
            "daily_goal": 15,
            "current_streak": 0,
            "longest_streak": 0,
            "calendar": [],
            "badges": []
        }
        
        if include_gamification:
            from services.gamification_service import GamificationService
            # Sync first to ensure single source of truth
            GamificationService.sync_streak_data(user_id, supabase)
            gamification = GamificationService.get_or_init(user_id)
            calendar = GamificationService.get_calendar(user_id)
            
            current_lvl = gamification.get("level") or 1
            xp_needed = current_lvl * 200

            # Construct badges
            badges = []
            longest_streak = gamification.get("longest_streak") or 0
            if longest_streak >= 3:
                badges.append({
                    "id": "consistent",
                    "title": "Consistent",
                    "description": "Achieved a 3-day completion streak",
                    "icon": "Zap"
                })
            if longest_streak >= 7:
                badges.append({
                    "id": "unstoppable",
                    "title": "Unstoppable",
                    "description": "Achieved a 7-day completion streak",
                    "icon": "Flame"
                })
            if (gamification.get("xp") or 0) >= 100:
                badges.append({
                    "id": "avid_learner",
                    "title": "Avid Learner",
                    "description": "Earned over 100 total XP",
                    "icon": "Award"
                })
                
            gamification_payload = {
                "xp": gamification.get("xp") or 0,
                "level": current_lvl,
                "xp_needed": xp_needed,
                "streak_freezes_available": gamification.get("streak_freezes_available") or 0,
                "last_freeze_used_at": gamification.get("last_freeze_used_at"),
                "daily_goal": gamification.get("daily_goal") or 15,
                "current_streak": gamification.get("current_streak") or 0,
                "longest_streak": longest_streak,
                "calendar": calendar,
                "badges": badges
            }

        return {
            "settings": settings,
            "active_reminders": active_reminders,
            "unread_count": unread_count,
            "history": history,
            "gamification": gamification_payload
        }
    except Exception as e:
        logger.error(f"[Reminders API] Failed to fetch reminders: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/settings")
async def update_settings(update: SettingsUpdate, user: dict = Depends(get_current_user)):
    """Update user's reminder preferences."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        updated = ReminderService.update_settings(
            user_id=user_id,
            enabled=update.enabled,
            reminder_time=update.reminder_time,
            frequency=update.frequency or 'daily',
            custom_days=update.custom_days or '',
            timezone=update.timezone or 'UTC',
            browser_notifications=update.browser_notifications if update.browser_notifications is not None else True,
            email_reminders=update.email_reminders if update.email_reminders is not None else True,
            sms_reminders=update.sms_reminders if update.sms_reminders is not None else False,
            phone_number=update.phone_number or '',
            email_address=update.email_address or ''
        )
        return updated
    except Exception as e:
        logger.error(f"[Reminders API] Failed to update settings: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{reminder_id}/snooze")
async def snooze_reminder(reminder_id: str, req: SnoozeRequest, user: dict = Depends(get_current_user)):
    """Snooze the active reading reminder."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        res = ReminderService.snooze_reminder(user_id, reminder_id, req.type)
        return res
    except Exception as e:
        logger.error(f"[Reminders API] Failed to snooze: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{reminder_id}/complete")
async def complete_reminder(reminder_id: str, user: dict = Depends(get_current_user)):
    """Mark the reminded queue item as completed."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        res = ReminderService.complete_reminder(user_id, reminder_id, supabase)
        return res
    except Exception as e:
        logger.error(f"[Reminders API] Failed to complete reminder: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{reminder_id}/read")
async def read_reminder(reminder_id: str, user: dict = Depends(get_current_user)):
    """Mark a reminder as read (clears badge count)."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        success = ReminderService.read_reminder(user_id, reminder_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"[Reminders API] Failed to mark read: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{reminder_id}/deliver")
async def deliver_reminder(reminder_id: str, user: dict = Depends(get_current_user)):
    """Track reminder delivery confirmation from device."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        success = ReminderService.deliver_reminder(user_id, reminder_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"[Reminders API] Failed to confirm delivery: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{reminder_id}/open")
async def open_reminder(reminder_id: str, user: dict = Depends(get_current_user)):
    """Track reminder clicked/opened state by user."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        success = ReminderService.open_reminder(user_id, reminder_id)
        return {"success": success}
    except Exception as e:
        logger.error(f"[Reminders API] Failed to confirm open state: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/gamification/freeze")
async def use_streak_freeze(user: dict = Depends(get_current_user)):

    """Consume an available streak freeze protect users from streak break."""
    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        from services.gamification_service import GamificationService
        res = GamificationService.use_freeze(user_id)
        return res
    except Exception as e:
        logger.error(f"[Reminders API] Failed to consume freeze: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# DEV ONLY — force-trigger a reminder right now (bypasses time gate)
# Uses the exact same code path as the background scheduler:
#   check_and_generate_reminder(force_time_check=True)
#   → pending record created → dispatch_and_update fires immediately
# This endpoint is auth-protected and never modifies any other module.
# ---------------------------------------------------------------------------

@router.post("/dev/trigger-now")
async def dev_trigger_reminder_now(user: dict = Depends(get_current_user)):
    """
    DEV ONLY: Force-run the reminder scheduler for the authenticated user right now.
    Bypasses the HH:MM time gate (force_time_check=True) and immediately dispatches
    any pending reminder through email + browser notification channels.
    Returns the generated reminder record (or a reason if skipped).
    """
    import asyncio
    import json
    import sqlite3
    from utils.schema_fallback import DB_PATH
    from services.notification_service import NotificationService

    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    logger.info(f"[DevTrigger] Forcing reminder check for user {user_id}")

    try:
        # Step 1 — Run check_and_generate_reminder with force_time_check=True.
        # This creates a 'pending' record in local_reminder_history if due.
        reminder = await asyncio.to_thread(
            ReminderService.check_and_generate_reminder,
            user_id,
            supabase,
            True,  # force_time_check — bypass HH:MM gate for dev testing
        )

        if not reminder:
            # Still return active reminders so the caller can see current state
            active = ReminderService.get_active_reminders(user_id)
            unread = ReminderService.get_unread_count(user_id)
            logger.info(
                f"[DevTrigger] No new reminder generated for user {user_id}. "
                f"Active reminders: {len(active)}"
            )
            return {
                "triggered": False,
                "reason": (
                    "No new reminder generated — user may be snoozed, "
                    "already reminded today, no unread items, or reminders disabled."
                ),
                "active_reminders": active,
                "unread_count": unread,
            }

        logger.info(
            f"[DevTrigger] Reminder {reminder['id']} created for user {user_id}. "
            f"Dispatching immediately via notification channels."
        )

        # Step 2 — Immediately dispatch (don't wait for the 60s worker tick).
        # This sends the email + browser notification right now.
        try:
            svc = NotificationService()
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, user_id, title, retry_count, delivery_logs, status "
                "FROM local_reminder_history WHERE id = ?",
                (reminder["id"],)
            )
            row = cursor.fetchone()
            conn.close()

            if row and row["status"] == "pending":
                # Mark processing so the background worker won't double-dispatch
                conn2 = sqlite3.connect(DB_PATH)
                conn2.execute(
                    "UPDATE local_reminder_history SET status = 'processing' WHERE id = ?",
                    (reminder["id"],)
                )
                conn2.commit()
                conn2.close()

                # Fire-and-forget — don't await here so the HTTP response returns instantly
                from services.scheduler_service import dispatch_and_update
                asyncio.create_task(
                    dispatch_and_update(
                        svc,
                        row["id"],
                        row["user_id"],
                        row["title"],
                        row["retry_count"] or 0,
                        row["delivery_logs"] or "",
                    )
                )
                logger.info(
                    f"[DevTrigger] Dispatch task spawned for reminder {reminder['id']}"
                )
        except Exception as dispatch_err:
            # Dispatch failure must never block the response
            logger.error(f"[DevTrigger] Dispatch error (non-fatal): {dispatch_err}")

        return {
            "triggered": True,
            "reminder": reminder,
            "message": (
                "Reminder generated and dispatch task started. "
                "Email and browser notification will arrive within ~5 seconds."
            ),
        }

    except Exception as e:
        logger.error(f"[DevTrigger] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dev/scheduler-status")
async def dev_scheduler_status(user: dict = Depends(get_current_user)):
    """
    DEV ONLY: Returns scheduler health, pending reminder queue depth,
    and the last 5 reminder history records for the authenticated user.
    """
    import sqlite3
    from utils.schema_fallback import DB_PATH
    from services.scheduler_service import SCHEDULER_HEALTH

    user_id = user.get("id") or user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Queue depth
        cursor.execute(
            "SELECT COUNT(1) FROM local_reminder_history "
            "WHERE status IN ('pending', 'processing')"
        )
        queue_depth = cursor.fetchone()[0]

        # Settings for this user
        cursor.execute(
            "SELECT enabled, reminder_time, timezone, frequency, last_reminded_at, "
            "snoozed_until, email_reminders, email_address, browser_notifications "
            "FROM local_reminder_settings WHERE user_id = ?",
            (user_id,)
        )
        settings_row = cursor.fetchone()
        settings = dict(settings_row) if settings_row else {}

        # Last 5 reminder records for this user
        cursor.execute(
            "SELECT id, item_id, title, status, sent_at, retry_count, error_message, delivery_logs "
            "FROM local_reminder_history WHERE user_id = ? "
            "ORDER BY sent_at DESC LIMIT 5",
            (user_id,)
        )
        recent = [dict(r) for r in cursor.fetchall()]
        conn.close()

        return {
            "scheduler_health": SCHEDULER_HEALTH,
            "queue_depth_pending_processing": queue_depth,
            "user_settings": settings,
            "recent_reminders": recent,
        }
    except Exception as e:
        logger.error(f"[DevStatus] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
