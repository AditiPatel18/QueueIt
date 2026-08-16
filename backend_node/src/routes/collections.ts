/**
 * Collections API router – Node.js/TypeScript port of backend/api/collections.py
 * Preserves exact QueueIt behaviour: CRUD with Supabase/SQLite fallback via fallbackDb.
 */

import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { fallbackDb } from '../utils/schemaFallback';

const router = Router();

function getUserId(req: AuthenticatedRequest): string {
  return (req.user?.id || req.user?.sub || '') as string;
}

// ---------------------------------------------------------------------------
// GET /api/collections — List all collections
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const collections = await fallbackDb.listCollections(userId, supabase);

    // Enrich with stats (item_count, read_time_minutes)
    let stats: Record<string, { item_count: number; read_time_minutes: number }> = {};
    try {
      stats = await fallbackDb.getCollectionStats(userId, supabase);
    } catch (statsErr) {
      console.error('[collections] Failed to calculate stats:', statsErr);
    }

    const enriched = (collections as any[]).map((col: any) => {
      const colStats = stats[col.id] || { item_count: 0, read_time_minutes: 0 };
      return {
        ...col,
        item_count: colStats.item_count,
        read_time_minutes: colStats.read_time_minutes,
      };
    });

    return res.json(enriched);
  } catch (err: any) {
    return res.status(500).json({ detail: `Failed to fetch collections: ${err.message || err}` });
  }
});

// ---------------------------------------------------------------------------
// POST /api/collections — Create collection
// ---------------------------------------------------------------------------

router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ detail: 'Collection name is required' });
  }
  try {
    const col = await fallbackDb.createCollection(userId, name.trim(), (color || 'blue').trim(), supabase);
    return res.status(201).json(col);
  } catch (err: any) {
    return res.status(400).json({ detail: `Failed to create collection: ${err.message || err}` });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/collections/:collection_id — Update collection
// ---------------------------------------------------------------------------

router.put('/:collection_id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const collectionId = req.params.collection_id;
  const { name, color } = req.body;
  try {
    const col = await fallbackDb.updateCollection(userId, collectionId, name ?? null, color ?? null, supabase);
    return res.json(col);
  } catch (err: any) {
    if (err.message === 'Collection not found') {
      return res.status(404).json({ detail: 'Collection not found' });
    }
    return res.status(400).json({ detail: `Failed to update collection: ${err.message || err}` });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/collections/:collection_id — Delete collection
// ---------------------------------------------------------------------------

router.delete('/:collection_id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const collectionId = req.params.collection_id;
  try {
    const success = await fallbackDb.deleteCollection(userId, collectionId, supabase);
    if (!success) {
      return res.status(404).json({ detail: 'Collection not found or permission denied' });
    }
    return res.json({ success: true, message: 'Collection deleted' });
  } catch (err: any) {
    return res.status(400).json({ detail: `Failed to delete collection: ${err.message || err}` });
  }
});

export default router;
