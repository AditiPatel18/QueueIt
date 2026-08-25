import sqlite3 from 'sqlite3';
import { openDb, dbRun, dbGet, dbAll, fallbackDb } from '../utils/schemaFallback';
import { supabase } from '../config/supabase';
import { ReminderService } from './reminderService';
import { NotificationService } from './notificationService';

export const SCHEDULER_HEALTH = {
  scheduler_last_run: null as string | null,
  worker_last_run: null as string | null,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RETRY_COUNT = 3;

/**
 * Reset any records stuck in 'processing' status back to 'pending'.
 */
async function recoverStuckProcessingRecords(): Promise<void> {
  const db = openDb();
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await dbRun(
      db,
      `UPDATE local_reminder_history 
       SET status = 'pending' 
       WHERE status = 'processing' AND (sent_at < ? OR sent_at IS NULL)`,
      [cutoff]
    );
  } catch (err) {
    console.error('[Worker] Error recovering stuck processing records:', err);
  } finally {
    db.close();
  }
}

/**
 * Dispatches a reminder and updates database states based on success or failure.
 */
export async function dispatchAndUpdate(
  dispatchService: NotificationService,
  remId: string,
  userId: string,
  title: string,
  retryCount: number,
  deliveryLogsStr: string
): Promise<boolean> {
  const subject = 'QueueIt Reading Reminder';
  const content = title;

  let logs: string[] = [];
  if (deliveryLogsStr) {
    try {
      logs = JSON.parse(deliveryLogsStr);
      if (!Array.isArray(logs)) {
        logs = [deliveryLogsStr];
      }
    } catch {
      logs = [deliveryLogsStr];
    }
  }

  const nowStr = new Date().toISOString();
  let success = false;
  let errorMsg = '';

  console.log(`[Worker] 🔄 Dispatching reminder ${remId} to user ${userId}...`);

  try {
    const res = await dispatchService.dispatchAsync(remId, userId, subject, content);
    if (Array.isArray(res)) {
      success = res[0];
      errorMsg = res[1] || '';
    } else {
      success = !!res;
      if (!success) {
        errorMsg = 'Dispatch returned False (no details provided)';
      }
    }
  } catch (err: any) {
    errorMsg = err.message || String(err);
    console.error(`[Worker] ❌ Dispatch exception for reminder ${remId}:`, err);
  }

  const db = openDb();
  try {
    const displayMsg = errorMsg.replace('[Email Sent]', '').trim();

    if (success) {
      let logEntry = `${nowStr}: Sent successfully.`;
      if (errorMsg.includes('[Email Sent]')) {
        logEntry = `${nowStr}: [Email Sent] Sent successfully.`;
      }
      logs.push(logEntry);
      await dbRun(
        db,
        "UPDATE local_reminder_history SET status = 'sent', delivery_logs = ?, error_message = '' WHERE id = ?",
        [JSON.stringify(logs), remId]
      );
      console.log(`[Worker] ✅ Reminder ${remId} successfully sent to user ${userId}`);
      return true;
    } else {
      const newRetry = retryCount + 1;
      const sentinel = errorMsg.includes('[Email Sent]') ? '[Email Sent] ' : '';
      const logEntry = `${nowStr}: ${sentinel}Attempt ${newRetry} failed: ${displayMsg || errorMsg}`;
      logs.push(logEntry);

      const cleanError = 'Unable to send email reminder.';
      await dbRun(
        db,
        "UPDATE local_reminder_history SET status = 'failed', retry_count = ?, error_message = ?, delivery_logs = ? WHERE id = ?",
        [newRetry, cleanError, JSON.stringify(logs), remId]
      );
      console.warn(`[Worker] ⚠️ Reminder ${remId} attempt ${newRetry}/${MAX_RETRY_COUNT} failed. Error: ${displayMsg || errorMsg}`);
      return false;
    }
  } catch (err) {
    console.error(`[Worker] Error updating database for reminder ${remId}:`, err);
    return false;
  } finally {
    db.close();
  }
}

/**
 * Background worker that polls pending notifications and dispatches them with retries.
 */
export async function processPendingNotificationQueue(): Promise<void> {
  const dispatchService = new NotificationService();
  SCHEDULER_HEALTH.worker_last_run = new Date().toISOString();

  await recoverStuckProcessingRecords();

  const db = openDb();
  let rows: any[] = [];
  try {
    rows = await dbAll<any>(
      db,
      `SELECT id, user_id, title, retry_count, delivery_logs, status 
       FROM local_reminder_history 
       WHERE status = 'pending' OR (status = 'failed' AND retry_count < ?) 
       LIMIT 10`,
      [MAX_RETRY_COUNT]
    );
  } finally {
    db.close();
  }

  if (rows.length > 0) {
    console.log(`[Worker] 📋 Found ${rows.length} reminder(s) to process`);
  }

  const now = new Date();
  for (const row of rows) {
    const remId = row.id;
    const userId = row.user_id;
    const title = row.title;
    const retryCount = row.retry_count || 0;
    const deliveryLogsStr = row.delivery_logs || '';
    const status = row.status;

    if (!userId || !UUID_RE.test(userId)) {
      console.warn(`[Worker] Skipping reminder ${remId}: user_id '${userId}' is not a valid UUID — cleaning up.`);
      const dbDel = openDb();
      try {
        await dbRun(dbDel, 'DELETE FROM local_reminder_history WHERE id = ?', [remId]);
      } finally {
        dbDel.close();
      }
      continue;
    }

    if (status === 'failed' && deliveryLogsStr) {
      let logs: string[] = [];
      try {
        logs = JSON.parse(deliveryLogsStr);
        if (!Array.isArray(logs)) logs = [deliveryLogsStr];
      } catch {
        logs = [deliveryLogsStr];
      }

      if (logs.length > 0) {
        try {
          const lastLog = logs[logs.length - 1];
          const tsStr = lastLog.split(': ')[0];
          const lastAttempt = new Date(tsStr);
          const diffSec = (now.getTime() - lastAttempt.getTime()) / 1000;
          if (diffSec < 45) {
            continue;
          }
        } catch { /* ignore */ }
      }
    }

    console.log(`[Worker] 📧 Processing reminder ${remId} for user ${userId} (attempt ${retryCount + 1}/${MAX_RETRY_COUNT}, status=${status})`);

    const dbMark = openDb();
    try {
      await dbRun(dbMark, "UPDATE local_reminder_history SET status = 'processing' WHERE id = ?", [remId]);
    } finally {
      dbMark.close();
    }

    await dispatchAndUpdate(dispatchService, remId, userId, title, retryCount, deliveryLogsStr);
  }
}

async function startNotificationQueueWorker(): Promise<void> {
  if (!fallbackDb.initialized) {
    try {
      await fallbackDb.ready;
    } catch (err) {
      console.error('[Worker] Cannot start worker: SQLite schema initialization failed.', err);
      return;
    }
  }

  const ok = await fallbackDb.verifySchemaTables();
  if (!ok || !fallbackDb.initialized) {
    console.error('[Worker] Cannot start worker: fallbackDb table verification failed.');
    return;
  }

  console.log('[Worker] 🚀 Notification queue worker started');
  await recoverStuckProcessingRecords();

  setInterval(async () => {
    try {
      await processPendingNotificationQueue();
    } catch (err) {
      console.error('[Worker] Error in worker loop:', err);
    }
  }, 30000);
}

/**
 * Background loop that checks reminder times against user settings and schedules notifications.
 */
export async function startReminderScheduler(): Promise<void> {
  if (!fallbackDb.initialized) {
    try {
      await fallbackDb.ready;
    } catch (err) {
      console.error('[Scheduler] Cannot start reminder scheduler: SQLite schema initialization failed.', err);
      return;
    }
  }

  const ok = await fallbackDb.verifySchemaTables();
  if (!ok || !fallbackDb.initialized) {
    console.error('[Scheduler] Cannot start reminder scheduler: fallbackDb table verification failed.');
    return;
  }

  console.log('[Scheduler] 🚀 Reminder scheduler started');
  
  // Start the notification queue worker in parallel after schema initialization is confirmed
  startNotificationQueueWorker().catch(err => {
    console.error('[Scheduler] Notification worker start failed:', err);
  });

  // Give the app 3 seconds to warm up
  await new Promise(resolve => setTimeout(resolve, 3000));

  setInterval(async () => {
    try {
      SCHEDULER_HEALTH.scheduler_last_run = new Date().toISOString();
      console.log('[Scheduler] ⏰ Scheduler tick — checking all users for due reminders...');

      const userSet = new Set<string>();

      const db = openDb();
      try {
        const settingsUsers = await dbAll<{ user_id: string }>(db, 'SELECT user_id FROM local_reminder_settings WHERE enabled = 1');
        for (const u of settingsUsers) {
          if (u.user_id && UUID_RE.test(u.user_id)) {
            userSet.add(u.user_id);
          }
        }
      } finally {
        db.close();
      }

      try {
        const { data: itemRows } = await supabase.from('items').select('user_id');
        if (itemRows) {
          for (const r of itemRows) {
            if (r.user_id && UUID_RE.test(r.user_id)) {
              userSet.add(r.user_id);
            }
          }
        }
      } catch { /* non-fatal */ }

      const userList = Array.from(userSet);
      console.log(`[Scheduler] 👥 Found ${userList.length} user(s) to check for due reminders`);

      for (const userId of userList) {
        try {
          const result = await ReminderService.checkAndGenerateReminder(userId, supabase, false);
          if (result) {
            console.log(`[Scheduler] 📝 Reminder GENERATED for user ${userId}: id=${result.id}, item=${result.item_id}`);
            // Instantly process queue for immediate delivery
            await processPendingNotificationQueue();
          }
        } catch (ex) {
          console.error(`[Scheduler] Error checking reminder for user ${userId}:`, ex);
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error in reminder scheduler loop:', err);
    }
  }, 60000);
}
