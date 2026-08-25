import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { NotificationService } from '../services/notificationService';

const router = Router();

function getUserId(req: AuthenticatedRequest): string {
  return (req.user?.id || req.user?.sub || '') as string;
}

// ---------------------------------------------------------------------------
// GET /api/notifications/preferences
// ---------------------------------------------------------------------------
router.get('/preferences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { data, error } = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) {
      return res.status(404).json({ detail: 'Preferences not found' });
    }
    return res.json(data);
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/preferences
// ---------------------------------------------------------------------------
router.post('/preferences', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const prefs = req.body || {};
  try {
    const updateData: Record<string, any> = { user_id: userId };
    Object.keys(prefs).forEach((k) => {
      if (prefs[k] !== undefined && k !== 'user_id') {
        updateData[k] = prefs[k];
      }
    });

    const { data, error } = await supabase.from('notification_preferences').upsert(updateData, { onConflict: 'user_id' }).select();
    if (error) {
      return res.status(400).json({ detail: error.message });
    }
    return res.json(data?.[0] || updateData);
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/subscribe
// ---------------------------------------------------------------------------
router.post('/subscribe', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const { subscription } = req.body || {};
  try {
    const { error } = await supabase.from('push_subscriptions').upsert({ user_id: userId, subscription }, { onConflict: 'user_id' });
    if (error) {
      return res.status(400).json({ detail: error.message });
    }
    return res.status(201).json({ result: 'subscribed' });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/unsubscribe
// ---------------------------------------------------------------------------
router.post('/unsubscribe', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    if (error) {
      return res.status(400).json({ detail: error.message });
    }
    return res.json({ result: 'unsubscribed' });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/send-test
// ---------------------------------------------------------------------------
router.post('/send-test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { data: pref } = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle();
    if (pref && pref.email_enabled === false) {
      return res.status(400).json({ detail: 'Email not enabled for user' });
    }
    const service = new NotificationService();
    const userEmail = req.user?.email || userId;
    await service.sendEmailAsync(userEmail, 'QueueIt Test Notification', '<p>This is a test notification from QueueIt.</p>');
    return res.json({ result: 'test email sent' });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

export default router;
