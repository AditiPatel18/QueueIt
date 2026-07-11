import asyncio
import sqlite3
import logging
import json
import re
from datetime import datetime, timezone, timedelta
from services.reminder_service import ReminderService
from services.notification_service import NotificationService
from utils.schema_fallback import DB_PATH
from utils.supabase_client import supabase

logger = logging.getLogger(__name__)

SCHEDULER_HEALTH = {
    "scheduler_last_run": None,
    "worker_last_run": None,
}

# Pre-compiled UUID pattern — non-UUID user_ids (e.g. emails from test runs) are
# silently skipped; they would cause PostgreSQL "invalid input syntax for type uuid"
# errors on every scheduler tick and pollute logs.
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# Maximum number of email delivery attempts before permanently marking as failed
MAX_RETRY_COUNT = 3


def _recover_stuck_processing_records():
    """Reset any records stuck in 'processing' status back to 'pending'.
    
    This handles two scenarios:
    1. Startup recovery: app restarted while a dispatch was in progress.
    2. Periodic recovery: dispatch task crashed/timed out (records older than 5 min).
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Recover records stuck in 'processing' for more than 5 minutes
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        cursor.execute(
            """UPDATE local_reminder_history 
               SET status = 'pending' 
               WHERE status = 'processing' AND (sent_at < ? OR sent_at IS NULL)""",
            (cutoff,)
        )
        recovered = cursor.rowcount
        conn.commit()
        conn.close()
        
        if recovered > 0:
            logger.info(
                f"[Worker] 🔧 Recovered {recovered} stuck 'processing' record(s) → 'pending'"
            )
    except Exception as e:
        logger.error(f"[Worker] Error recovering stuck processing records: {e}")


async def start_notification_queue_worker():
    """Background worker that polls pending notifications from local_reminder_history and dispatches them with retries."""
    logger.info("[Worker] 🚀 Notification queue worker started")
    dispatch_service = NotificationService()
    
    # Startup recovery: reset any records stuck in 'processing' from a previous run
    _recover_stuck_processing_records()
    
    while True:
        try:
            SCHEDULER_HEALTH["worker_last_run"] = datetime.now(timezone.utc).isoformat()
            logger.info("[Worker] 🔔 Worker tick — checking for pending/failed reminders...")
            
            # Periodic recovery for stuck processing records
            _recover_stuck_processing_records()
            
            # Connect and get all pending or failed notifications eligible for retry
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, user_id, title, retry_count, delivery_logs, status FROM local_reminder_history WHERE status = 'pending' OR (status = 'failed' AND retry_count < ?) LIMIT 10",
                (MAX_RETRY_COUNT,)
            )
            rows = cursor.fetchall()
            conn.close()
            
            if rows:
                logger.info(f"[Worker] 📋 Found {len(rows)} reminder(s) to process")
            else:
                logger.debug("[Worker] No pending reminders to process")
            
            now = datetime.now(timezone.utc)
            for row in rows:
                rem_id = row["id"]
                user_id = row["user_id"]
                title = row["title"]
                retry_count = row["retry_count"] or 0
                delivery_logs_str = row["delivery_logs"] or ""
                status = row["status"]

                # Skip non-UUID user_ids — these are leftover from test runs and
                # would cause Supabase "invalid input syntax for type uuid" errors.
                if not _UUID_RE.match(user_id or ""):
                    logger.warning(
                        f"[Worker] Skipping reminder {rem_id}: "
                        f"user_id '{user_id}' is not a valid UUID — cleaning up."
                    )
                    _conn = sqlite3.connect(DB_PATH)
                    _conn.execute(
                        "DELETE FROM local_reminder_history WHERE id = ?", (rem_id,)
                    )
                    _conn.commit()
                    _conn.close()
                    continue
                
                # Check 1-minute backoff if the status is failed
                if status == "failed" and delivery_logs_str:
                    try:
                        logs = json.loads(delivery_logs_str)
                    except Exception:
                        logs = [delivery_logs_str]
                    if logs:
                        try:
                            # Parse last attempt log line (usually starts with ISO string)
                            last_log = logs[-1]
                            ts_str = last_log.split(": ")[0]
                            last_attempt = datetime.fromisoformat(ts_str)
                            if last_attempt.tzinfo is None:
                                last_attempt = last_attempt.replace(tzinfo=timezone.utc)
                            if (now - last_attempt).total_seconds() < 60:
                                # Too soon to retry, skip this item for this polling run
                                logger.debug(
                                    f"[Worker] Reminder {rem_id} — backoff period active, skipping"
                                )
                                continue
                        except Exception:
                            pass
                
                logger.info(
                    f"[Worker] 📧 Processing reminder {rem_id} for user {user_id} "
                    f"(attempt {retry_count + 1}/{MAX_RETRY_COUNT}, status={status})"
                )
                
                # Mark as processing to prevent other runs picking it up
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("UPDATE local_reminder_history SET status = 'processing' WHERE id = ?", (rem_id,))
                conn.commit()
                conn.close()
                
                # Spawn async task to dispatch — fully fire-and-forget, isolated from Queue/API
                asyncio.create_task(
                    dispatch_and_update(dispatch_service, rem_id, user_id, title, retry_count, delivery_logs_str)
                )
                
        except Exception as e:
            logger.error(f"[Worker] Error in worker loop: {e}")
            
        # Poll every 60 seconds
        await asyncio.sleep(60)
 
async def dispatch_and_update(dispatch_service, rem_id, user_id, title, retry_count, delivery_logs_str):
    subject = "QueueIt Reading Reminder"
    content = title
    
    try:
        logs = json.loads(delivery_logs_str) if delivery_logs_str else []
    except Exception:
        logs = [delivery_logs_str] if delivery_logs_str else []
        
    now_str = datetime.now(timezone.utc).isoformat()
    success = False
    error_msg = ""
    
    logger.info(f"[Worker] 🔄 Dispatching reminder {rem_id} to user {user_id}...")
    
    try:
        res = await dispatch_service.dispatch_async(rem_id, user_id, subject, content)
        if isinstance(res, tuple):
            success, error_msg = res
        else:
            success = bool(res)
            if not success:
                error_msg = "Dispatch returned False (no details provided)"
    except Exception as ex:
        error_msg = str(ex)
        logger.error(f"[Worker] ❌ Dispatch exception for reminder {rem_id}: {ex}")
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Treat "[Email Sent]" sentinel as success marker — strip it from public error_msg
    display_msg = error_msg.replace("[Email Sent]", "").strip(" |")
    
    if success:
        # Preserve [Email Sent] sentinel in delivery_logs for the idempotency guard
        log_entry = f"{now_str}: Sent successfully."
        if "[Email Sent]" in (error_msg or ""):
            log_entry = f"{now_str}: [Email Sent] Sent successfully."
        logs.append(log_entry)
        cursor.execute(
            "UPDATE local_reminder_history SET status = 'sent', delivery_logs = ?, error_message = '' WHERE id = ?",
            (json.dumps(logs), rem_id)
        )
        logger.info(
            f"[Worker] ✅ Reminder {rem_id} successfully sent to user {user_id}"
        )
    else:
        new_retry = retry_count + 1
        sentinel = "[Email Sent] " if "[Email Sent]" in (error_msg or "") else ""
        log_entry = f"{now_str}: {sentinel}Attempt {new_retry} failed: {display_msg or error_msg}"
        logs.append(log_entry)
        
        if new_retry < MAX_RETRY_COUNT:
            # Go back to 'pending' for immediate retry on next worker tick (with backoff)
            cursor.execute(
                "UPDATE local_reminder_history SET status = 'failed', retry_count = ?, error_message = ?, delivery_logs = ? WHERE id = ?",
                (new_retry, display_msg or error_msg, json.dumps(logs), rem_id)
            )
            logger.warning(
                f"[Worker] ⚠️ Reminder {rem_id} failed attempt {new_retry}/{MAX_RETRY_COUNT}. "
                f"Will retry after backoff. Error: {display_msg or error_msg}"
            )
        else:
            # Max retries exhausted — permanently failed
            cursor.execute(
                "UPDATE local_reminder_history SET status = 'failed', retry_count = ?, error_message = ?, delivery_logs = ? WHERE id = ?",
                (new_retry, display_msg or error_msg, json.dumps(logs), rem_id)
            )
            logger.error(
                f"[Worker] ❌ Reminder {rem_id} permanently failed after {new_retry}/{MAX_RETRY_COUNT} attempts. "
                f"Error: {display_msg or error_msg}"
            )
            
    conn.commit()
    conn.close()

async def start_reminder_scheduler():
    """Background loop that checks reminder times against user settings and schedules notifications."""
    logger.info("[Scheduler] 🚀 Reminder scheduler started")
    # Start the notification queue worker in parallel
    asyncio.create_task(start_notification_queue_worker())
    
    # Give the app a few seconds to warm up
    await asyncio.sleep(5)
    while True:
        try:
            SCHEDULER_HEALTH["scheduler_last_run"] = datetime.now(timezone.utc).isoformat()
            logger.info("[Scheduler] ⏰ Scheduler tick — checking all users for due reminders...")
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT user_id FROM local_reminder_settings WHERE enabled = 1")
            users = cursor.fetchall()
            conn.close()
            
            logger.info(f"[Scheduler] 👥 Found {len(users)} user(s) with reminders enabled")
            
            for user in users:
                user_id = user[0]

                # Guard: skip non-UUID user_ids left over from test runs
                if not _UUID_RE.match(user_id or ""):
                    logger.warning(
                        f"[Scheduler] Skipping non-UUID user_id '{user_id}' — "
                        "removing from reminder_settings."
                    )
                    _conn = sqlite3.connect(DB_PATH)
                    _conn.execute(
                        "DELETE FROM local_reminder_settings WHERE user_id = ?",
                        (user_id,),
                    )
                    _conn.commit()
                    _conn.close()
                    continue

                try:
                    # check_and_generate_reminder is synchronous (SQLite + Supabase I/O).
                    # Run in a thread so it never blocks the asyncio event loop.
                    result = await asyncio.to_thread(
                        ReminderService.check_and_generate_reminder,
                        user_id,
                        supabase,
                        False,  # force_time_check
                    )
                    if result:
                        logger.info(
                            f"[Scheduler] 📝 Reminder GENERATED for user {user_id}: "
                            f"id={result.get('id')}, item={result.get('item_id')}"
                        )
                    else:
                        logger.debug(
                            f"[Scheduler] User {user_id} — not due or already reminded today"
                        )
                except Exception as ex:
                    logger.error(f"[Scheduler] Error checking reminder for user {user_id}: {ex}")
                    
        except Exception as e:
            logger.error(f"[Scheduler] Error in reminder scheduler loop: {e}")
            
        # Run check every 60 seconds to capture exact minutes
        await asyncio.sleep(60)
