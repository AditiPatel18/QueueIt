import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { AnalyticsService } from '../services/analyticsService';
import { supabase } from '../config/supabase';

const router = Router();

function getUserId(req: AuthenticatedRequest): string {
  return (req.user?.id || req.user?.sub || '') as string;
}

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const metrics = await AnalyticsService.calculateDashboardMetrics(userId, supabase);
    return res.json(metrics);
  } catch (err: any) {
    console.error('[analytics] GET / error:', err);
    return res.status(500).json({ detail: err.message || String(err) });
  }
});

export default router;
