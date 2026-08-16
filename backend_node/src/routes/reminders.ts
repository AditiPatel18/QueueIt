/**
 * Reminders API router – Node.js/TypeScript port of backend/api/reminders.py
 * Preserves exact QueueIt behaviour: settings, snooze, complete, deliver, open,
 * gamification freeze, and dev endpoints.
 */

import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { ReminderService } from '../services/reminderService';
import { GamificationService } from '../services/gamificationService';
import { SCHEDULER_HEALTH, processPendingNotificationQueue } from '../services/schedulerService';

const router = Router();

function getUserId(req: AuthenticatedRequest): string {
  return (req.user?.id || req.user?.sub || '') as string;
}

function getUserEmail(req: AuthenticatedRequest): string {
  return (req.user?.email || '') as string;
}

// ---------------------------------------------------------------------------
// GET /api/reminders — Fetch settings, active reminders, history, gamification
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const userEmail = getUserEmail(req);
  try {
    const [settings, activeReminders, reminderHistory, gamification] = await Promise.all([
      ReminderService.getSettings(userId, userEmail).catch(() => null),
      ReminderService.getActiveReminders(userId).catch(() => []),
      ReminderService.getHistory(userId, 30).catch(() => []),
      GamificationService.getOrInit(userId).catch(() => null),
    ]);

    const unreadCount = await ReminderService.getUnreadCount(userId).catch(() => 0);

    return res.json({
      settings,
      reminders: activeReminders,
      history: reminderHistory,
      unread_count: unreadCount,
      gamification,
    });
  } catch (err: any) {
    console.error('[reminders] GET / error:', err);
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/settings — Update reminder settings
// ---------------------------------------------------------------------------

router.post('/settings', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const userEmail = getUserEmail(req);
  try {
    const {
      enabled = true,
      reminder_time = '09:00',
      frequency = 'daily',
      custom_days = '',
      timezone = 'UTC',
      browser_notifications = true,
      email_reminders = true,
      sms_reminders = false,
      phone_number = '',
      email_address = '',
    } = req.body;

    const targetEmail = email_address && email_address.includes('@') ? email_address : userEmail;

    const updated = await ReminderService.updateSettings(
      userId,
      !!enabled,
      String(reminder_time),
      String(frequency),
      String(custom_days),
      String(timezone),
      !!browser_notifications,
      !!email_reminders,
      !!sms_reminders,
      String(phone_number),
      String(targetEmail)
    );

    return res.json({ success: true, settings: updated });
  } catch (err: any) {
    console.error('[reminders] POST /settings error:', err);
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/:id/snooze — Snooze a reminder
// ---------------------------------------------------------------------------

router.post('/:id/snooze', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const reminderId = req.params.id;
  try {
    const { snooze_type = '1h' } = req.body;
    const result = await ReminderService.snoozeReminder(userId, reminderId, String(snooze_type));
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/:id/complete — Mark reminder/item as complete
// ---------------------------------------------------------------------------

router.post('/:id/complete', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const reminderId = req.params.id;
  try {
    const result = await ReminderService.completeReminder(userId, reminderId, supabase);
    return res.json(result);
  } catch (err: any) {
    if (err.message === 'Reminder not found') {
      return res.status(404).json({ detail: 'Reminder not found' });
    }
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/:id/read — Mark reminder as read/dismissed
// ---------------------------------------------------------------------------

router.post('/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const reminderId = req.params.id;
  try {
    const success = await ReminderService.readReminder(userId, reminderId);
    return res.json({ success, reminder_id: reminderId, status: 'read' });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/:id/deliver — Mark reminder as delivered
// ---------------------------------------------------------------------------

router.post('/:id/deliver', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const reminderId = req.params.id;
  try {
    const success = await ReminderService.deliverReminder(userId, reminderId);
    return res.json({ success, reminder_id: reminderId, status: 'delivered' });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/:id/open — Mark reminder as opened (clicked)
// ---------------------------------------------------------------------------

router.post('/:id/open', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const reminderId = req.params.id;
  try {
    const success = await ReminderService.openReminder(userId, reminderId);
    return res.json({ success, reminder_id: reminderId, status: 'opened' });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/gamification/freeze — Use a streak freeze
// ---------------------------------------------------------------------------

router.post('/gamification/freeze', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const result = await GamificationService.useFreeze(userId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reminders/dev/trigger-now — Dev: force-trigger a reminder now
// ---------------------------------------------------------------------------

router.post('/dev/trigger-now', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const userEmail = getUserEmail(req);
  try {
    // Ensure settings email_address is populated
    await ReminderService.getSettings(userId, userEmail);

    const reminder = await ReminderService.checkAndGenerateReminder(userId, supabase, true);
    if (!reminder) {
      return res.json({ message: 'No reminder was generated (no unread items or already sent today)', triggered: false });
    }

    // Process worker queue immediately so email is sent right away
    await processPendingNotificationQueue().catch(err => {
      console.error('[reminders] Error processing pending queue after trigger-now:', err);
    });

    const activeList = await ReminderService.getActiveReminders(userId);
    const updatedReminder = activeList.find(r => r.id === reminder.id) || reminder;

    return res.json({ message: 'Reminder triggered and email dispatched successfully', reminder: updatedReminder, triggered: true });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reminders/dev/scheduler-status — Dev: scheduler health
// ---------------------------------------------------------------------------

router.get('/dev/scheduler-status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    scheduler_last_run: SCHEDULER_HEALTH.scheduler_last_run,
    worker_last_run: SCHEDULER_HEALTH.worker_last_run,
    status: 'running',
  });
});

export default router;
