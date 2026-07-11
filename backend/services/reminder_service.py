"""
ReminderService to handle Smart Reading Reminders logic.
Coordinates database actions on local fallback SQLite and encapsulates reminder business logic.
"""

import os
import uuid
import sqlite3
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from utils.schema_fallback import DB_PATH, fallback_db
from services.notification_service import NotificationService

logger = logging.getLogger(__name__)


class ReminderService:
    """Service to manage smart reading reminders, preferences, and snoozes."""

    @classmethod
    def get_settings(cls, user_id: str) -> Dict[str, Any]:
        """Fetch or initialize local reminder settings for a user."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT * FROM local_reminder_settings WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            if row:
                data = dict(row)
                # Ensure values map to boolean clean types
                return {
                    "user_id": data.get("user_id"),
                    "enabled": data.get("enabled") == 1,
                    "reminder_time": data.get("reminder_time") or "09:00",
                    "snoozed_until": data.get("snoozed_until"),
                    "last_reminded_at": data.get("last_reminded_at"),
                    "frequency": data.get("frequency") or "daily",
                    "custom_days": data.get("custom_days") or "",
                    "timezone": data.get("timezone") or "UTC",
                    "browser_notifications": data.get("browser_notifications") == 1,
                    "email_reminders": data.get("email_reminders") == 1,
                    "sms_reminders": data.get("sms_reminders") == 1,
                    "phone_number": data.get("phone_number") or "",
                    "email_address": data.get("email_address") or "",
                    "last_sent_date": data.get("last_sent_date")
                }
            
            # Initialize with default settings
            default_settings = {
                "user_id": user_id,
                "enabled": 1,
                "reminder_time": "09:00",
                "snoozed_until": None,
                "last_reminded_at": None,
                "frequency": "daily",
                "custom_days": "",
                "timezone": "UTC",
                "browser_notifications": 1,
                "email_reminders": 1,
                "sms_reminders": 0,
                "phone_number": "",
                "email_address": "",
                "last_sent_date": None
            }
            cursor.execute("""
                INSERT INTO local_reminder_settings 
                (user_id, enabled, reminder_time, snoozed_until, last_reminded_at, frequency, custom_days, timezone, browser_notifications, email_reminders, sms_reminders, phone_number, email_address, last_sent_date) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                user_id, default_settings["enabled"], default_settings["reminder_time"], 
                default_settings["snoozed_until"], default_settings["last_reminded_at"],
                default_settings["frequency"], default_settings["custom_days"],
                default_settings["timezone"], default_settings["browser_notifications"],
                default_settings["email_reminders"], default_settings["sms_reminders"],
                default_settings["phone_number"], default_settings["email_address"],
                default_settings["last_sent_date"]
            ))
            conn.commit()
            return {
                "user_id": user_id,
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
                "email_address": "",
                "last_sent_date": None
            }
        except Exception as e:
            logger.error(f"[ReminderService] Error fetching settings: {e}")
            return {
                "user_id": user_id, "enabled": True, "reminder_time": "09:00", 
                "snoozed_until": None, "last_reminded_at": None, "frequency": "daily",
                "custom_days": "", "timezone": "UTC", "browser_notifications": True, "email_reminders": True,
                "sms_reminders": False, "phone_number": "", "email_address": "", "last_sent_date": None
            }
        finally:
            conn.close()

    @classmethod
    def update_settings(cls, user_id: str, enabled: bool, reminder_time: str, frequency: str = 'daily', custom_days: str = '', timezone: str = 'UTC', browser_notifications: bool = True, email_reminders: bool = True, sms_reminders: bool = False, phone_number: str = '', email_address: str = '') -> Dict[str, Any]:
        """Update enabling state, timezone, frequency and custom configuration for reminders."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            if not reminder_time or ":" not in reminder_time:
                reminder_time = "09:00"
            
            enabled_val = 1 if enabled else 0
            browser_val = 1 if browser_notifications else 0
            email_val = 1 if email_reminders else 0
            sms_val = 1 if sms_reminders else 0
            
            cursor.execute("SELECT 1 FROM local_reminder_settings WHERE user_id = ?", (user_id,))
            if cursor.fetchone():
                cursor.execute("""
                    UPDATE local_reminder_settings 
                    SET enabled = ?, reminder_time = ?, frequency = ?, custom_days = ?, timezone = ?, browser_notifications = ?, email_reminders = ?, sms_reminders = ?, phone_number = ?, email_address = ? 
                    WHERE user_id = ?
                """, (enabled_val, reminder_time, frequency, custom_days, timezone, browser_val, email_val, sms_val, phone_number, email_address, user_id))
            else:
                cursor.execute("""
                    INSERT INTO local_reminder_settings 
                    (user_id, enabled, reminder_time, frequency, custom_days, timezone, browser_notifications, email_reminders, sms_reminders, phone_number, email_address) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (user_id, enabled_val, reminder_time, frequency, custom_days, timezone, browser_val, email_val, sms_val, phone_number, email_address))
            
            conn.commit()
            return {
                "user_id": user_id, 
                "enabled": enabled, 
                "reminder_time": reminder_time,
                "frequency": frequency,
                "custom_days": custom_days,
                "timezone": timezone,
                "browser_notifications": browser_notifications,
                "email_reminders": email_reminders,
                "sms_reminders": sms_reminders,
                "phone_number": phone_number,
                "email_address": email_address
            }
        except Exception as e:
            logger.error(f"[ReminderService] Error updating settings: {e}")
            raise e
        finally:
            conn.close()

    @classmethod
    def get_active_reminders(cls, user_id: str) -> List[Dict[str, Any]]:
        """Fetch all reminders with active status (unresolved reminders)."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT * FROM local_reminder_history WHERE user_id = ? AND status IN ('pending', 'failed', 'sent', 'delivered', 'opened', 'processing') ORDER BY sent_at DESC",
                (user_id,)
            )
            rows = cursor.fetchall()
            res = []
            for row in rows:
                r = dict(row)
                if r.get("status") == "failed" and r.get("error_message"):
                    r["title"] = f"{r['title']} (Failed: {r['error_message']})"
                r["reminder_item_id"] = r.get("item_id")
                res.append(r)
            return res
        except Exception as e:
            logger.error(f"[ReminderService] Error fetching active reminders: {e}")
            return []
        finally:
            conn.close()

    @classmethod
    def get_unread_count(cls, user_id: str) -> int:
        """Get badge count of unresolved reminders."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT COUNT(1) FROM local_reminder_history WHERE user_id = ? AND status IN ('pending', 'failed', 'sent', 'delivered', 'opened', 'processing')",
                (user_id,)
            )
            val = cursor.fetchone()
            return val[0] if val else 0
        except Exception as e:
            logger.error(f"[ReminderService] Error fetching unread count: {e}")
            return 0
        finally:
            conn.close()

    @classmethod
    def get_history(cls, user_id: str, limit: int = 30) -> List[Dict[str, Any]]:
        """Retrieve recent reminder logs history."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT * FROM local_reminder_history WHERE user_id = ? AND status IN ('completed', 'snoozed', 'read', 'dismissed') ORDER BY sent_at DESC LIMIT ?",
                (user_id, limit)
            )
            rows = cursor.fetchall()
            res = []
            for row in rows:
                r = dict(row)
                if r.get("status") == "failed" and r.get("error_message"):
                    r["title"] = f"{r['title']} (Failed: {r['error_message']})"
                r["reminder_item_id"] = r.get("item_id")
                res.append(r)
            return res
        except Exception as e:
            logger.error(f"[ReminderService] Error fetching reminder history: {e}")
            return []
        finally:
            conn.close()

    @classmethod
    def read_reminder(cls, user_id: str, reminder_id: str) -> bool:
        """Mark a sent reminder as read/dismissed (clears badge count)."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE local_reminder_history SET status = 'read' WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed', 'sent', 'delivered', 'opened')",
                (reminder_id, user_id)
            )
            conn.commit()
            
            # Award small XP reward for interaction
            try:
                from services.gamification_service import GamificationService
                GamificationService.record_activity(user_id, minutes_read=2, item_completed=False)
            except Exception as ex:
                logger.error(f"[ReminderService] Gamification credit error: {ex}")
                
            return True
        except Exception as e:
            logger.error(f"[ReminderService] Error reading reminder: {e}")
            return False
        finally:
            conn.close()

    @classmethod
    def deliver_reminder(cls, user_id: str, reminder_id: str) -> bool:
        """Log/mark reminder delivered when received by device."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE local_reminder_history SET status = 'delivered' WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed', 'sent')",
                (reminder_id, user_id)
            )
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"[ReminderService] Error delivering reminder: {e}")
            return False
        finally:
            conn.close()

    @classmethod
    def open_reminder(cls, user_id: str, reminder_id: str) -> bool:
        """Log/mark reminder opened when clicked by user."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE local_reminder_history SET status = 'opened' WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed', 'sent', 'delivered')",
                (reminder_id, user_id)
            )
            conn.commit()
            
            # Award small XP reward for opening reminder alert
            try:
                from services.gamification_service import GamificationService
                GamificationService.record_activity(user_id, minutes_read=5, item_completed=False)
            except Exception as ex:
                logger.error(f"[ReminderService] Gamification credit error: {ex}")
                
            return True
        except Exception as e:
            logger.error(f"[ReminderService] Error opening reminder: {e}")
            return False
        finally:
            conn.close()

    @classmethod
    def snooze_reminder(cls, user_id: str, reminder_id: str, snooze_type: str) -> Dict[str, Any]:
        """Snooze the active reminder and pause reminder settings until calculated date."""
        now = datetime.now(timezone.utc)
        
        if snooze_type == "1h":
            snoozed_until = now + timedelta(hours=1)
        elif snooze_type == "today":
            snoozed_until = now + timedelta(hours=8)
        elif snooze_type == "tomorrow":
            snoozed_until = now + timedelta(days=1)
        else:
            snoozed_until = now + timedelta(hours=2)

        snoozed_until_str = snoozed_until.isoformat()

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE local_reminder_settings SET snoozed_until = ? WHERE user_id = ?",
                (snoozed_until_str, user_id)
            )
            cursor.execute(
                "UPDATE local_reminder_history SET status = 'snoozed' WHERE id = ? AND user_id = ?",
                (reminder_id, user_id)
            )
            conn.commit()
            return {"snoozed_until": snoozed_until_str, "reminder_id": reminder_id, "status": "snoozed"}
        except Exception as e:
            logger.error(f"[ReminderService] Error snoozing reminder: {e}")
            raise e
        finally:
            conn.close()

    @classmethod
    def complete_reminder(cls, user_id: str, reminder_id: str, supabase_client) -> Dict[str, Any]:
        """Mark the associated queue item as complete directly from the reminder."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT * FROM local_reminder_history WHERE id = ? AND user_id = ?",
                (reminder_id, user_id)
            )
            reminder = cursor.fetchone()
            if not reminder:
                raise ValueError("Reminder not found")

            reminder_dict = dict(reminder)
            item_id = reminder_dict.get("item_id")
            
            minutes_spent = 15.0
            if item_id:
                now_iso = datetime.now(timezone.utc).isoformat()
                update_data = {
                    "status": "completed",
                    "completed_at": now_iso,
                    "read_progress": 100
                }

                try:
                    item_res = supabase_client.table("items").select("id, actual_time_spent, estimated_time_minutes, estimated_read_time").eq("id", item_id).execute()
                    if item_res.data:
                        item_data = item_res.data[0]
                        item_data = fallback_db.merge_single_item_metadata(user_id, item_data)
                        curr_spent = item_data.get("actual_time_spent")
                        
                        if curr_spent is None or curr_spent == 0.0:
                            est_min = item_data.get("estimated_time_minutes")
                            if est_min is None:
                                est_sec = item_data.get("estimated_read_time") or 300
                                est_min = float(est_sec) / 60.0
                            update_data["actual_time_spent"] = est_min
                            minutes_spent = est_min
                        else:
                            minutes_spent = curr_spent
                except Exception as ex:
                    logger.error(f"[ReminderService] Failed to calculate complete spent: {ex}")

                local_meta_updates = {}
                for field in ["read_progress", "completed_at", "actual_time_spent"]:
                    if field in update_data:
                        local_meta_updates[field] = update_data[field]
                
                fallback_db.update_item_metadata(user_id, item_id, local_meta_updates, supabase_client)
                
                supabase_client.table("items").update({
                    "status": "completed",
                    "completed_at": now_iso
                }).eq("id", item_id).eq("user_id", user_id).execute()

            completed_time = datetime.now(timezone.utc).isoformat()
            cursor.execute(
                "UPDATE local_reminder_history SET status = 'completed', completed_at = ? WHERE id = ? AND user_id = ?",
                (completed_time, reminder_id, user_id)
            )
            conn.commit()

            # Award XP, updates streak, registers activity calendar
            try:
                from services.gamification_service import GamificationService
                GamificationService.record_activity(user_id, minutes_read=minutes_spent, item_completed=True)
            except Exception as ex:
                logger.error(f"[ReminderService] Gamification credit error: {ex}")

            return {"status": "completed", "reminder_id": reminder_id, "completed_at": completed_time}
        except Exception as e:
            logger.error(f"[ReminderService] Error completing reminder: {e}")
            raise e
        finally:
            conn.close()

    @classmethod
    def check_and_generate_reminder(cls, user_id: str, supabase_client, force_time_check: bool = False) -> Optional[Dict[str, Any]]:
        """
        Runs check: is user due for reminder? If enabled, frequency matches, timezone matches,
        last reminded is not today, and not snoozed: generate smart reminder from high priority unread.
        Always fetches fresh settings from DB — no caching.
        """
        # Always read fresh from DB on every scheduler tick (no caching)
        settings = cls.get_settings(user_id)

        # Timezone support
        import zoneinfo
        tz_name = settings.get("timezone") or "UTC"
        try:
            tz = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            tz = zoneinfo.ZoneInfo("UTC")

        now_local = datetime.now(tz)
        today_date = now_local.date()

        # Fetch key fields from fresh DB settings
        time_str = settings.get("reminder_time") or "09:00"
        email_enabled = bool(settings.get("email_reminders"))
        last_sent_date = settings.get("last_sent_date")
        reminder_enabled = bool(settings.get("enabled"))

        # Parse scheduled hour/minute
        try:
            hour, minute = map(int, time_str.split(":"))
        except ValueError:
            hour, minute = 9, 0

        # Construct scheduled datetime for today in user's timezone
        scheduled_today = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)

        # Determine if reminder is due (current >= scheduled AND not already sent today)
        already_sent_today = (last_sent_date == str(today_date))
        time_due = force_time_check or (now_local >= scheduled_today)
        reminder_due = reminder_enabled and email_enabled and time_due and not already_sent_today

        # ── Detailed diagnostic log on EVERY scheduler tick ──────────────────
        logger.info(
            f"[Scheduler] Reminder check — "
            f"user_id={user_id} | "
            f"timezone={tz_name} | "
            f"current_time={now_local.strftime('%H:%M:%S')} | "
            f"reminder_time={time_str} | "
            f"email_enabled={email_enabled} | "
            f"reminder_enabled={reminder_enabled} | "
            f"last_sent_date={last_sent_date} | "
            f"today={today_date} | "
            f"already_sent_today={already_sent_today} | "
            f"time_due={time_due} | "
            f"reminder_due={reminder_due}"
        )

        if not reminder_enabled:
            logger.info(f"[Scheduler] User {user_id}: reminders disabled — skipping")
            return None

        # 1. Check snooze state
        if settings["snoozed_until"]:
            try:
                snoozed = datetime.fromisoformat(settings["snoozed_until"])
                if snoozed.tzinfo is None:
                    snoozed = snoozed.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) < snoozed:
                    logger.info(f"[Scheduler] User {user_id}: snoozed until {snoozed} — skipping")
                    return None
            except Exception:
                pass

        # 2. Check scheduled time and frequency constraints
        frequency = settings.get("frequency") or "daily"
        weekday = now_local.weekday()  # 0=Monday ... 6=Sunday

        if frequency == "weekdays" and weekday >= 5:
            logger.info(f"[Scheduler] User {user_id}: frequency=weekdays but today is weekend — skipping")
            return None
        elif frequency == "weekly" and weekday != 6:
            logger.info(f"[Scheduler] User {user_id}: frequency=weekly but today is not Sunday — skipping")
            return None
        elif frequency == "custom":
            days_map = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
            weekday_str = days_map.get(weekday, "")
            custom_days = settings.get("custom_days") or ""
            if weekday_str not in custom_days:
                logger.info(f"[Scheduler] User {user_id}: custom day {weekday_str} not in {custom_days} — skipping")
                return None

        # 3. Time gate: current_time >= reminder_time?
        if not time_due:
            logger.info(
                f"[Scheduler] User {user_id}: current_time {now_local.strftime('%H:%M')} "
                f"< reminder_time {time_str} — not yet due"
            )
            return None

        # 4. Check if user already got a reminder today using last_sent_date (primary guard)
        if already_sent_today:
            logger.info(f"[Scheduler] User {user_id}: already sent reminder today ({today_date}) — skipping")
            return None

        # Double check local database history to prevent duplicate reminders for the same day
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT sent_at FROM local_reminder_history WHERE user_id = ?", (user_id,))
            history_rows = cursor.fetchall()
            for row in history_rows:
                h_sent_at = row[0]
                if h_sent_at:
                    try:
                        h_dt = datetime.fromisoformat(h_sent_at)
                        h_dt_local = h_dt.astimezone(tz)
                        if h_dt_local.date() == today_date:
                            logger.info(f"[Scheduler] User {user_id} already has a reminder in history today ({today_date})")
                            return None
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"Error checking duplicate reminder date: {e}")
        finally:
            conn.close()

        # 4. Find highest priority unread/reading item to suggest
        try:
            select_cols = ["id", "title", "url", "status", "priority_score"]
            res = supabase_client.table("items").select(",".join(select_cols)).eq("user_id", user_id).in_("status", ["unread", "reading"]).execute()
            items = res.data or []
            items = fallback_db.merge_items_metadata(user_id, items)
            active_items = [i for i in items if i.get("status") in ("unread", "reading")]
            
            if not active_items:
                logger.info(f"No unread/reading items found for user {user_id}. Skipping reminder generation.")
                return None
            
            active_items.sort(key=lambda x: x.get("priority_score", 50.0), reverse=True)
            top_item = active_items[0]
        except Exception as e:
            logger.error(f"[ReminderService] Error fetching unread items for reminders: {e}")
            return None

        # 5. Generate and record reminder
        reminder_id = str(uuid.uuid4())
        sent_time = datetime.now(timezone.utc).isoformat()
        item_title = top_item.get("title") or "an item from your queue"
        
        # Deduplicate active reminder list from showing multiple duplicate cards of this same item
        # If there is already an active (sent/delivered/opened) reminder for this item_id, we prevent inserting a duplicate
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            if top_item.get("id"):
                # Duplicate guard: only block if an ACTIVE reminder for this item already
                # exists TODAY. Previously this had no status filter and no date filter,
                # which permanently blocked any item from generating a second reminder ever.
                cursor.execute(
                    """
                    SELECT 1 FROM local_reminder_history
                    WHERE user_id = ? AND item_id = ?
                      AND status IN ('pending', 'processing', 'sent', 'delivered', 'opened')
                      AND date(sent_at) = date('now')
                    """,
                    (user_id, top_item.get("id"))
                )
                if cursor.fetchone():
                    logger.info(
                        f"[Scheduler] Duplicate active reminder exists for item "
                        f"{top_item.get('id')} today — skipping."
                    )
                    return None

            reminder_status = "pending"

            cursor.execute("""
                INSERT INTO local_reminder_history 
                (id, user_id, item_id, title, scheduled_time, sent_at, status, channel) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                reminder_id, user_id, top_item.get("id"), 
                f"Time to read: '{item_title}' (High priority)", 
                time_str, sent_time, reminder_status, "in_app"
            ))
            
            cursor.execute(
                "UPDATE local_reminder_settings SET last_reminded_at = ?, last_sent_date = ? WHERE user_id = ?",
                (sent_time, str(today_date), user_id)
            )
            conn.commit()
            
            return {
                "id": reminder_id,
                "user_id": user_id,
                "item_id": top_item.get("id"),
                "reminder_item_id": top_item.get("id"),
                "title": f"Time to read: '{item_title}' (High priority)",
                "sent_at": sent_time,
                "status": reminder_status
            }
        except Exception as e:
            logger.error(f"[ReminderService] Error generating reminder: {e}")
            return None
        finally:
            conn.close()
