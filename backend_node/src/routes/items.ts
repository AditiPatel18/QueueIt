/**
 * Items API router – Node.js/TypeScript port of backend/api/items.py
 * Preserves exact QueueIt behaviour: filtering, sorting, pagination, duplicate
 * detection, mock background enrichment pipeline, streak/analytics calculation.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { fallbackDb } from '../utils/schemaFallback';
import { normalizeUrl, resolvePlatformInfo, isSafeUrl } from '../utils/urlHelper';
import { StreakService } from '../services/gamificationService';
import { AIService, determineFolderForItem } from '../services/aiService';

const router = Router();

// In-memory ingestion debug log
const ingestionDebugInfo: Record<string, { pipeline_stage: string; logs: string[]; error: string | null }> = {};

// Deduplication lock set (prevents duplicate concurrent insertions)
const processingLocks = new Set<string>();

function updateIngestionDebug(itemId: string, stage: string, message: string, error?: string | null) {
  if (!ingestionDebugInfo[itemId]) {
    ingestionDebugInfo[itemId] = { pipeline_stage: stage, logs: [], error: null };
  }
  ingestionDebugInfo[itemId].pipeline_stage = stage;
  const ts = new Date().toISOString();
  ingestionDebugInfo[itemId].logs.push(`[${ts}] [${stage}] ${message}`);
  if (error != null) ingestionDebugInfo[itemId].error = error;
}
// ---------------------------------------------------------------------------
// GET /api/items/debug-ingestion/:id — Debug session logs
// ---------------------------------------------------------------------------

router.get('/debug-ingestion/:id', async (req: Request, res: Response) => {
  const itemId = req.params.id;
  if (ingestionDebugInfo[itemId]) {
    return res.json(ingestionDebugInfo[itemId]);
  }
  try {
    const { data } = await supabase.from('items').select('id, processing_status, ai_summary').eq('id', itemId).maybeSingle();
    if (data) {
      return res.json({
        pipeline_stage: data.processing_status || 'completed',
        logs: [`Item exists in database. Current status: ${data.processing_status}`],
        error: data.processing_status === 'completed' ? null : 'Processing pending',
      });
    }
  } catch { /* non-fatal */ }
  return res.status(404).json({ detail: `No ingestion debug session found for ID ${itemId}` });
});

router.get('/test-yt-direct', async (req: Request, res: Response) => {
  const url = (req.query.url as string) || 'https://www.youtube.com/watch?v=SqcY0GlETPk';
  try {
    const extracted = await AIService.extractYouTubeContent(url);
    return res.json({ url, extracted });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get('/debug-yt', async (req: Request, res: Response) => {
  const videoId = (req.query.v as string) || 'aircAruvnKk';
  const logs: string[] = [];

  const publicKeys = [
    'AIzaSyAO_FJ2SlqU8Q4STEihQIxomIq_S9waxqY',
    'AIzaSyC1xlsmZOMtvD_3epXvIqf4gE3b-t9R_2E',
    'AIzaSyBflxtu4so615_dC_YyH9Z2zL6q9vU2-gA',
  ];

  const clientConfigs = [
    { name: 'ANDROID', clientName: 'ANDROID', clientVersion: '20.10.38', ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11; en_US; Pixel 5 Build/RD1A.201105.003.C1)' },
    { name: 'IOS', clientName: 'IOS', clientVersion: '19.45.4', ua: 'com.google.ios.youtube/19.45.4 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X; en_US)' },
    { name: 'WEB', clientName: 'WEB', clientVersion: '2.20240308.00.00', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36' },
  ];

  const results: any = {};

  for (const clientCfg of clientConfigs) {
    for (const key of publicKeys) {
      try {
        const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': clientCfg.ua,
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': clientCfg.clientVersion,
          },
          body: JSON.stringify({
            context: { client: { clientName: clientCfg.clientName, clientVersion: clientCfg.clientVersion, hl: 'en', gl: 'US' } },
            videoId: videoId,
          }),
        });

        const status = playerRes.status;
        if (!playerRes.ok) {
          results[`${clientCfg.name}_${key.substring(0, 6)}`] = { httpStatus: status };
          continue;
        }

        const data: any = await playerRes.json();
        const playability = data?.playabilityStatus?.status;
        const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

        let sampleCaptionHttp = null;
        let sampleCaptionLen = 0;
        if (tracks.length > 0 && tracks[0].baseUrl) {
          const capRes = await fetch(tracks[0].baseUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
              'Referer': 'https://www.youtube.com/',
              'Origin': 'https://www.youtube.com',
            },
          });
          sampleCaptionHttp = capRes.status;
          if (capRes.ok) {
            const txt = await capRes.text();
            sampleCaptionLen = txt.length;
          }
        }

        results[`${clientCfg.name}_${key.substring(0, 6)}`] = {
          httpStatus: status,
          playability,
          captionTracksCount: tracks.length,
          firstTrackLang: tracks[0]?.languageCode,
          sampleCaptionHttp,
          sampleCaptionLen,
        };

        if (sampleCaptionLen > 50) break;
      } catch (e: any) {
        results[`${clientCfg.name}_${key.substring(0, 6)}`] = { error: e?.message };
      }
    }
  }

  // Also test Nocookie embed fallback
  try {
    const embedRes = await fetch(`https://www.youtube-nocookie.com/embed/${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36' },
    });
    const html = await embedRes.text();
    const idx = html.indexOf('"captionTracks":');
    results['NocookieEmbed'] = {
      httpStatus: embedRes.status,
      hasCaptionTracks: idx !== -1,
    };
  } catch (e: any) {
    results['NocookieEmbed'] = { error: e?.message };
  }

  return res.json({ videoId, results });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(req: AuthenticatedRequest): string {
  return (req.user?.id || req.user?.sub || '') as string;
}

function normalizeTags(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function itemToResponse(item: Record<string, any>): Record<string, any> {
  const tags = normalizeTags(item.tags);
  const url = item.url || '';
  let source_name = item.source_name;
  let source_type = item.source_type;
  let source_domain = item.source_domain;
  let logo_url = item.logo_url;
  if (url && (!source_name || !source_type || !source_domain || !logo_url)) {
    try {
      const info = resolvePlatformInfo(url);
      if (!source_name) source_name = info.source_name;
      if (!source_type) source_type = info.source_type;
      if (!source_domain) source_domain = info.source_domain;
      if (!logo_url) logo_url = info.logo_url;
    } catch { /* non-fatal */ }
  }
  const isCompleted = item.status === 'completed';
  return {
    id: item.id,
    user_id: item.user_id,
    url,
    title: item.title,
    description: item.description,
    content_type: item.content_type || 'generic',
    status: item.status || 'unread',
    processing_status: item.processing_status || 'completed',
    is_favorite: item.is_favorite || false,
    added_at: item.added_at,
    completed_at: item.completed_at,
    created_at: item.created_at || item.added_at,
    audio_url: item.audio_url,
    thumbnail_url: item.thumbnail_url,
    source_name,
    source_type: source_type || item.content_type,
    source_domain,
    logo_url,
    ai_summary: item.ai_summary,
    full_summary: item.full_summary,
    tags,
    extracted_text: item.extracted_text,
    author: item.author,
    estimated_read_time: isCompleted ? 0 : item.estimated_read_time,
    estimated_time_minutes: isCompleted ? 0.0 : item.estimated_time_minutes,
    actual_time_spent: item.actual_time_spent ?? 0.0,
    duration_seconds: isCompleted ? 0 : item.duration_seconds,
    priority_score: item.priority_score ?? 50.0,
    collection_id: item.collection_id,
    read_progress: item.read_progress ?? 0,
    notes: item.notes,
  };
}

/** Lightweight in-memory hybrid search – ranks items matching the query */
function performHybridSearch(userId: string, q: string, items: Record<string, any>[]): Record<string, any>[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items;

  const scored = items.map(item => {
    let score = 0;
    const haystack = [
      item.title, item.description, item.ai_summary, item.url,
      item.source_name, item.source_domain, item.collection_name,
      ...(normalizeTags(item.tags)),
    ].filter(Boolean).join(' ').toLowerCase();

    for (const term of terms) {
      if (haystack.includes(term)) score += 2;
      // Bonus for title match
      if ((item.title || '').toLowerCase().includes(term)) score += 3;
    }
    return { item, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.item);
}

/** Background enrichment pipeline using Gemini AIService */
async function runMockEnrichmentPipeline(itemId: string, url: string, userId: string, titleOverride?: string | null) {
  if (processingLocks.has(itemId)) return;
  processingLocks.add(itemId);

  try {
    updateIngestionDebug(itemId, 'processing', 'AI enrichment pipeline started.');
    await AIService.processItemEnrichment(itemId, url, userId, titleOverride);
    updateIngestionDebug(itemId, 'completed', 'AI enrichment pipeline completed successfully.');
  } catch (err: any) {
    updateIngestionDebug(itemId, 'failed', `Pipeline error: ${err?.message}`, String(err));
  } finally {
    processingLocks.delete(itemId);
  }
}

// ---------------------------------------------------------------------------
// POST /api/items — Create
// ---------------------------------------------------------------------------

router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { url, title, collection_id, suggested_collection_name, suggested_collection_color } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ detail: 'URL is required' });
    }
    const cleanUrl = url.trim();
    if (!isSafeUrl(cleanUrl)) {
      return res.status(400).json({ detail: 'Invalid or restricted URL target' });
    }
    const normalized = normalizeUrl(cleanUrl);

    // Duplicate check using existing url column and application-level normalization
    let existingItem: any = null;
    try {
      const { data } = await supabase.from('items').select('*').eq('user_id', userId).eq('url', cleanUrl).maybeSingle();
      if (data) existingItem = data;
    } catch {
      /* non-fatal */
    }

    if (!existingItem) {
      try {
        const { data: allItems } = await supabase.from('items').select('*').eq('user_id', userId);
        const all = allItems || [];
        existingItem = all.find((i: any) => normalizeUrl(i.url || '') === normalized) || null;
      } catch { /* non-fatal */ }
    }

    if (existingItem) {
      const merged = await fallbackDb.mergeSingleItemMetadata(userId, existingItem);
      const resp = itemToResponse(merged);
      return res.status(200).set('X-QueueIt-Duplicate', 'true').json({ ...resp, is_duplicate: true });
    }

    const platformInfo = resolvePlatformInfo(cleanUrl);

    // Resolve collection_id
    let resolvedCollectionId = collection_id || null;
    if (!resolvedCollectionId && suggested_collection_name) {
      try {
        const cols = await fallbackDb.listCollections(userId, supabase);
        const found = cols.find((c: any) => c.name.toLowerCase().trim() === suggested_collection_name.toLowerCase().trim());
        if (found) {
          resolvedCollectionId = found.id;
        } else {
          const nc = await fallbackDb.createCollection(userId, suggested_collection_name.trim(), suggested_collection_color || 'blue', supabase);
          resolvedCollectionId = nc.id;
        }
      } catch { /* non-fatal */ }
    }

    const itemData: Record<string, any> = {
      user_id: userId,
      url: cleanUrl,
      title: title || cleanUrl,
      content_type: platformInfo.source_type,
      source_name: platformInfo.source_name,
      source_type: platformInfo.source_type,
      source_domain: platformInfo.source_domain,
      logo_url: platformInfo.logo_url,
      tags: ['uncategorized'],
      ai_summary: null,
      priority_score: 50.0,
      status: 'unread',
      processing_status: 'queued',
      is_favorite: false,
    };
    if (resolvedCollectionId) itemData.collection_id = resolvedCollectionId;

    let insertResult: any;
    try {
      const { data, error } = await supabase.from('items').insert(itemData).select().single();
      if (error) throw error;
      insertResult = data;
    } catch (insertErr: any) {
      // Retry without optional columns
      const safeData: Record<string, any> = {
        user_id: userId, url: cleanUrl, title: itemData.title,
        content_type: platformInfo.source_type, tags: ['uncategorized'],
        ai_summary: null, priority_score: 50.0, status: 'unread',
        processing_status: 'queued', is_favorite: false,
      };
      if (resolvedCollectionId) safeData.collection_id = resolvedCollectionId;
      const { data, error: e2 } = await supabase.from('items').insert(safeData).select().single();
      if (e2) throw e2;
      insertResult = data;
    }

    if (!insertResult) throw new Error('Failed to insert item into database');

    const itemId = insertResult.id;
    updateIngestionDebug(itemId, 'validation', `Initial insert completed. URL: '${cleanUrl}'`);

    // Save local metadata
    const metaUpdates: Record<string, any> = { estimated_time_minutes: 5.0 };
    if (resolvedCollectionId) metaUpdates.collection_id = resolvedCollectionId;
    try { await fallbackDb.updateItemMetadata(userId, itemId, metaUpdates, supabase); } catch { /* non-fatal */ }

    // Run enrichment pipeline in background (no await)
    runMockEnrichmentPipeline(itemId, cleanUrl, userId, title || null).catch(() => {});

    const merged = await fallbackDb.mergeSingleItemMetadata(userId, insertResult);
    return res.status(201).json(itemToResponse(merged));
  } catch (err: any) {
    console.error('[items] create_item error:', err);
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/search/all — Full-text search
// ---------------------------------------------------------------------------

router.get('/search/all', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const q = String(req.query.q || '').trim();
  const limit = Math.min(parseInt(String(req.query.limit || '10'), 10) || 10, 50);
  if (!q) return res.status(400).json({ detail: 'Query param q is required' });

  try {
    const { data } = await supabase.from('items').select('*').eq('user_id', userId);
    let items = (data || []).map(itemToResponse);
    items = await fallbackDb.mergeItemsMetadata(userId, items);

    const ranked = performHybridSearch(userId, q, items);
    const top = ranked.slice(0, limit);
    return res.json({ items: top, total: top.length });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/history/stats — Completed item stats
// ---------------------------------------------------------------------------

router.get('/history/stats', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const selectCols = fallbackDb.getOptimizedSelectString();
    const { data } = await supabase
      .from('items')
      .select(selectCols)
      .eq('user_id', userId)
      .eq('status', 'completed');

    let items = await fallbackDb.mergeItemsMetadata(userId, data || []);
    const itemsCompleted = items.length;

    let totalTimeConsumed = 0.0;
    const catCounts: Record<string, number> = {};

    const completedDates = new Set<string>();
    const todayDate = new Date();
    todayDate.setUTCHours(0, 0, 0, 0);
    const yesterdayDate = new Date(todayDate.getTime() - 86400000);

    for (const item of items) {
      const t = item.actual_time_spent;
      if (t != null) {
        totalTimeConsumed += parseFloat(t);
      } else {
        const est = item.estimated_time_minutes || item.estimated_read_time || 5.0;
        totalTimeConsumed += parseFloat(est);
      }
      const cat = item.content_type || 'article';
      catCounts[cat] = (catCounts[cat] || 0) + 1;

      if (item.completed_at) {
        try {
          const d = new Date(item.completed_at);
          d.setUTCHours(0, 0, 0, 0);
          completedDates.add(d.toISOString());
        } catch { /* skip */ }
      }
    }

    const topCategories = Object.entries(catCounts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    let currentStreak = 0;
    const todayStr = todayDate.toISOString();
    const yesterdayStr = yesterdayDate.toISOString();
    if (completedDates.has(todayStr)) {
      currentStreak = 1;
      let check = new Date(yesterdayDate);
      while (completedDates.has(check.toISOString())) {
        currentStreak++;
        check = new Date(check.getTime() - 86400000);
      }
    } else if (completedDates.has(yesterdayStr)) {
      currentStreak = 1;
      let check = new Date(yesterdayDate.getTime() - 86400000);
      while (completedDates.has(check.toISOString())) {
        currentStreak++;
        check = new Date(check.getTime() - 86400000);
      }
    }

    return res.json({
      items_completed: itemsCompleted,
      total_time_consumed: totalTimeConsumed,
      top_categories: topCategories,
      completion_streak: currentStreak,
    });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/recommendations/next — Next item suggestion
// ---------------------------------------------------------------------------

router.get('/recommendations/next', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { data: candidateData } = await supabase.from('items').select('*').eq('user_id', userId).in('status', ['unread', 'reading']);
    const { data: completedData } = await supabase.from('items').select('*').eq('user_id', userId).eq('status', 'completed');
    const { data: allData } = await supabase.from('items').select('*').eq('user_id', userId);

    let candidates = await fallbackDb.mergeItemsMetadata(userId, candidateData || []);
    const completedItems = await fallbackDb.mergeItemsMetadata(userId, completedData || []);
    const trackingInfo = await fallbackDb.getItemTracking(userId);

    // If no unread/reading candidates exist, check if all items are completed or queue is empty
    if (!candidates.length) {
      const allItems = await fallbackDb.mergeItemsMetadata(userId, allData || []);
      if (!allItems.length) {
        return res.json({ suggestion: null, reason: 'No items in your queue yet. Add an item to get AI recommendations!' });
      }
      // If all items are completed, pick from allItems as fallback
      candidates = allItems;
    }

    // Build interest tags from completed items
    const interestTagCounts: Record<string, number> = {};
    for (const ci of completedItems) {
      for (const tag of normalizeTags(ci.tags)) {
        if (tag !== 'uncategorized') interestTagCounts[tag] = (interestTagCounts[tag] || 0) + 1;
      }
    }
    const interestTags = Object.entries(interestTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

    // Score candidates deterministically
    const now = Date.now();
    const scored = candidates.map(item => {
      let score = parseFloat(item.priority_score) || 50.0;
      const tags = normalizeTags(item.tags);
      for (const tag of tags) {
        if (interestTags.includes(tag)) score += 15;
      }
      if (item.status === 'reading') score += 20;
      if (item.status === 'unread') score += 10;
      const track = trackingInfo[item.id];
      if (track?.last_recommended_at) {
        const lastRec = new Date(track.last_recommended_at).getTime();
        const hoursSince = (now - lastRec) / 3600000;
        if (hoursSince < 24) score -= 25;
      }
      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0]?.item;

    if (!top || !top.id) {
      return res.json({ suggestion: null, reason: 'No recommendation available.' });
    }

    fallbackDb.recordItemRecommendation(userId, top.id).catch(() => {});

    const itemResp = itemToResponse(top);
    const title = itemResp.title || top.title || 'Untitled Item';
    const topTags = normalizeTags(top.tags);

    let reason = `Based on your ${top.status === 'reading' ? 'in-progress reading and ' : ''}priority score of ${Math.round(top.priority_score || 50)}, this is your top recommended content.`;
    const matchTag = topTags.find(t => interestTags.includes(t));
    if (matchTag) {
      reason = `Matches your frequent interest in #${matchTag}. High priority content to consume next.`;
    }

    return res.json({
      suggestion: {
        item_id: top.id,
        title,
        item: itemResp,
        reason,
        priority_score: top.priority_score || 50,
      }
    });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/user/streak — Reading streak + weekly analytics
// ---------------------------------------------------------------------------

router.get('/user/streak', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const selectCols = fallbackDb.getOptimizedSelectString();
    const { data } = await supabase.from('items').select(selectCols).eq('user_id', userId);
    let items = await fallbackDb.mergeItemsMetadata(userId, data || []);

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 86400000);

    let dailySaves = 0, dailyCompletions = 0, dailyReadingTime = 0;
    let totalEstimatedTimeMinutes = 0.0;
    const completedDates = new Set<number>();
    let totalCompleted = 0, hasDeepRead = false;

    for (const item of items) {
      const status = item.status;
      const progress = item.read_progress ?? 0;
      const readTime = parseFloat(item.estimated_read_time) || 0;
      const sourceType = (item.source_type || item.content_type || 'generic').toLowerCase();
      const dur = parseFloat(item.duration_seconds) || 0;
      let estTime = item.estimated_time_minutes != null ? parseFloat(item.estimated_time_minutes) : null;

      if (estTime == null) {
        if (['youtube', 'video'].includes(sourceType)) {
          estTime = dur > 0 ? dur / 60.0 : 5.0;
        } else {
          const wordCount = (item.extracted_text || '').split(/\s+/).filter(Boolean).length;
          estTime = wordCount > 0 ? Math.ceil(wordCount / 200.0) : 5.0;
        }
      }

      if (['unread', 'reading'].includes(status) && progress < 100) {
        totalEstimatedTimeMinutes += estTime * (1 - progress / 100.0);
      }

      if (item.added_at) {
        try {
          const addedDate = new Date(item.added_at); addedDate.setUTCHours(0, 0, 0, 0);
          if (addedDate.getTime() === today.getTime()) dailySaves++;
        } catch { /* skip */ }
      }

      if (status === 'completed') {
        totalCompleted++;
        if (readTime > 15) hasDeepRead = true;
        if (item.completed_at) {
          try {
            const compDate = new Date(item.completed_at); compDate.setUTCHours(0, 0, 0, 0);
            completedDates.add(compDate.getTime());
            if (compDate.getTime() === today.getTime()) {
              dailyCompletions++;
              dailyReadingTime += readTime;
            }
          } catch { /* skip */ }
        }
      }
    }

    // Streak calculation
    const sortedDates = Array.from(completedDates).sort((a, b) => a - b);
    let currentStreak = 0, longestStreak = 0;
    if (sortedDates.length) {
      let tempStreak = 1; longestStreak = 1;
      for (let i = 1; i < sortedDates.length; i++) {
        const diff = (sortedDates[i] - sortedDates[i - 1]) / 86400000;
        if (diff === 1) { tempStreak++; }
        else if (diff > 1) { tempStreak = 1; }
        longestStreak = Math.max(longestStreak, tempStreak);
      }
      if (completedDates.has(today.getTime())) {
        currentStreak = 1;
        let check = yesterday.getTime();
        while (completedDates.has(check)) { currentStreak++; check -= 86400000; }
      } else if (completedDates.has(yesterday.getTime())) {
        currentStreak = 1;
        let check = yesterday.getTime() - 86400000;
        while (completedDates.has(check)) { currentStreak++; check -= 86400000; }
      }
    }

    // Badges
    const badges = [];
    if (items.length > 0) badges.push({ id: 'first_save', title: 'First Step', description: 'Saved your first item', icon: 'Inbox' });
    if (hasDeepRead) badges.push({ id: 'deep_reader', title: 'Deep Reader', description: 'Completed a 15+ min article/video', icon: 'BookOpen' });
    if (totalCompleted >= 5) badges.push({ id: 'avid_learner', title: 'Avid Learner', description: 'Completed 5 items', icon: 'Award' });
    if (longestStreak >= 3) badges.push({ id: 'consistent', title: 'Consistent', description: 'Achieved a 3-day completion streak', icon: 'Zap' });
    if (longestStreak >= 7) badges.push({ id: 'unstoppable', title: 'Unstoppable', description: 'Achieved a 7-day completion streak', icon: 'Flame' });

    // Weekly analytics (last 7 days)
    const last7Days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() - (6 - i) * 86400000));
    const savesByDay: Record<number, number> = {};
    const completionsByDay: Record<number, number> = {};
    last7Days.forEach(d => { savesByDay[d.getTime()] = 0; completionsByDay[d.getTime()] = 0; });

    for (const item of items) {
      if (item.added_at) {
        try {
          const d = new Date(item.added_at); d.setUTCHours(0, 0, 0, 0);
          if (d.getTime() in savesByDay) savesByDay[d.getTime()]++;
        } catch { /* skip */ }
      }
      if (item.completed_at && item.status === 'completed') {
        try {
          const d = new Date(item.completed_at); d.setUTCHours(0, 0, 0, 0);
          if (d.getTime() in completionsByDay) completionsByDay[d.getTime()]++;
        } catch { /* skip */ }
      }
    }

    const weeklyLabels = last7Days.map(d => d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }));
    const weeklySaves = last7Days.map(d => savesByDay[d.getTime()] || 0);
    const weeklyCompletions = last7Days.map(d => completionsByDay[d.getTime()] || 0);

    const user = req.user || {};
    const userMeta = (user as any).user_metadata || {};
    const dailyGoal = parseInt(userMeta.daily_reading_goal_minutes || '15', 10);

    const totalItems = items.filter(i => ['unread', 'reading', 'completed'].includes(i.status)).length;
    const completedRatioPercent = totalItems > 0 ? Math.round((totalCompleted / totalItems) * 100) : 0;
    const unfinishedItems = items.filter(i => ['unread', 'reading'].includes(i.status));
    const focusScore = unfinishedItems.length > 0
      ? Math.round(unfinishedItems.reduce((s, i) => s + (parseFloat(i.priority_score) || 50.0), 0) / unfinishedItems.length)
      : 0;

    return res.json({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      daily_saves: dailySaves,
      daily_completions: dailyCompletions,
      daily_reading_goal_minutes: dailyGoal,
      daily_reading_time_minutes: dailyReadingTime,
      total_estimated_time_minutes: totalEstimatedTimeMinutes,
      badges,
      total_completed: totalCompleted,
      total_items: totalItems,
      completed_ratio_percent: completedRatioPercent,
      focus_score: focusScore,
      weekly_saves: weeklySaves,
      weekly_completions: weeklyCompletions,
      weekly_labels: weeklyLabels,
    });
  } catch (err: any) {
    console.error('[items] user/streak error:', err);
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/user/streak-heatmap — Streak heatmap (via StreakService)
// ---------------------------------------------------------------------------

router.get('/user/streak-heatmap', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const heatmap = await StreakService.getStreakHeatmap(userId);
    return res.json(heatmap);
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/analytics/export — Export Reading Analytics to CSV
// ---------------------------------------------------------------------------

function escapeCSVCell(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

router.get('/analytics/export', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const selectCols = fallbackDb.getOptimizedSelectString();
    const { data, error } = await supabase.from('items').select(selectCols).eq('user_id', userId);
    if (error) {
      console.error('[items] export error fetching items:', error);
    }
    let items = await fallbackDb.mergeItemsMetadata(userId, data || []);

    const headers = [
      "ID",
      "Title",
      "URL",
      "Category",
      "Status",
      "Tags",
      "Estimated Time (Minutes)",
      "Actual Time Spent (Minutes)",
      "Added At",
      "Completed At",
      "Priority Score"
    ];

    const rows: string[] = [];
    rows.push(headers.map(escapeCSVCell).join(','));

    for (const item of items) {
      const estMin = item.estimated_time_minutes || ((item.estimated_read_time || 300) / 60);
      const actMin = item.actual_time_spent ?? 0;
      const tagsStr = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
      const cat = item.source_type || item.content_type || 'article';

      const row = [
        item.id,
        item.title || 'Untitled',
        item.url || '',
        cat,
        item.status || 'unread',
        tagsStr,
        Number(estMin).toFixed(2),
        Number(actMin).toFixed(2),
        item.added_at || '',
        item.completed_at || '',
        item.priority_score ?? 50
      ];

      rows.push(row.map(escapeCSVCell).join(','));
    }

    const csvContent = rows.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="queueit_reading_analytics.csv"');
    return res.status(200).send(csvContent);
  } catch (err: any) {
    console.error('[items] analytics/export error:', err);
    return res.status(500).json({ detail: err.message || 'Failed to export CSV' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/analytics/reading — Reading analytics
// ---------------------------------------------------------------------------

router.get('/analytics/reading', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const selectCols = fallbackDb.getOptimizedSelectString();
    const { data } = await supabase.from('items').select(selectCols).eq('user_id', userId);
    let items = await fallbackDb.mergeItemsMetadata(userId, data || []);
    const trackingInfo = await fallbackDb.getItemTracking(userId);

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const todayTime = today.getTime();

    let dailyReadingTime = 0.0, weeklyReadingTime = 0.0, monthlyReadingTime = 0.0;
    const last30DaysList = Array.from({ length: 30 }, (_, i) => new Date(todayTime - (29 - i) * 86400000));
    const timeByDay: Record<number, number> = {};
    const completionsByDay: Record<number, number> = {};
    last30DaysList.forEach(d => { timeByDay[d.getTime()] = 0; completionsByDay[d.getTime()] = 0; });

    const startOfWeekDate = new Date(todayTime - today.getUTCDay() * 86400000 + 86400000); // Monday
    const last12Weeks = Array.from({ length: 12 }, (_, i) => new Date(startOfWeekDate.getTime() - (11 - i) * 7 * 86400000));
    const timeByWeek: Record<number, number> = {};
    const completionsByWeek: Record<number, number> = {};
    last12Weeks.forEach(w => { timeByWeek[w.getTime()] = 0; completionsByWeek[w.getTime()] = 0; });

    const last12MonthsKeys: string[] = [];
    const currDate = new Date(today);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(currDate.getFullYear(), currDate.getMonth() - i, 1);
      const key = `${m.getFullYear().toString().padStart(4, '0')}-${(m.getMonth() + 1).toString().padStart(2, '0')}`;
      last12MonthsKeys.push(key);
    }
    const timeByMonth: Record<string, number> = {};
    const completionsByMonth: Record<string, number> = {};
    last12MonthsKeys.forEach(k => { timeByMonth[k] = 0; completionsByMonth[k] = 0; });

    let totalCompleted = 0, totalTimeSpent = 0.0;
    const completedItems: any[] = [];
    const completedDatesSet = new Set<number>();

    for (const item of items) {
      if (item.status !== 'completed') continue;
      const t = item.actual_time_spent;
      const timeSpent = t != null ? parseFloat(t) : parseFloat(item.estimated_time_minutes || ((item.estimated_read_time || 300) / 60.0));

      totalCompleted++;
      totalTimeSpent += timeSpent;
      completedItems.push(item);

      if (item.completed_at) {
        try {
          const compDate = new Date(item.completed_at); compDate.setUTCHours(0, 0, 0, 0);
          const compTime = compDate.getTime();
          completedDatesSet.add(compTime);

          if (timeByDay[compTime] !== undefined) {
            timeByDay[compTime] += timeSpent;
            completionsByDay[compTime]++;
          }

          for (const w of last12Weeks) {
            if (compTime >= w.getTime() && compTime < w.getTime() + 7 * 86400000) {
              timeByWeek[w.getTime()] += timeSpent;
              completionsByWeek[w.getTime()]++;
              break;
            }
          }

          const mKey = `${compDate.getUTCFullYear().toString().padStart(4, '0')}-${(compDate.getUTCMonth() + 1).toString().padStart(2, '0')}`;
          if (timeByMonth[mKey] !== undefined) {
            timeByMonth[mKey] += timeSpent;
            completionsByMonth[mKey]++;
          }

          const diffDays = (todayTime - compTime) / 86400000;
          if (diffDays === 0) dailyReadingTime += timeSpent;
          if (diffDays < 7) weeklyReadingTime += timeSpent;
          if (diffDays < 30) monthlyReadingTime += timeSpent;
        } catch { /* skip */ }
      }
    }

    // Streak
    const sortedDates = Array.from(completedDatesSet).sort((a, b) => a - b);
    let currentStreak = 0, longestStreak = 0;
    if (sortedDates.length) {
      let temp = 1; longestStreak = 1;
      for (let i = 1; i < sortedDates.length; i++) {
        const diff = (sortedDates[i] - sortedDates[i - 1]) / 86400000;
        if (diff === 1) { temp++; } else if (diff > 1) { temp = 1; }
        longestStreak = Math.max(longestStreak, temp);
      }
      const yesterday = todayTime - 86400000;
      if (completedDatesSet.has(todayTime)) {
        currentStreak = 1;
        let check = yesterday;
        while (completedDatesSet.has(check)) { currentStreak++; check -= 86400000; }
      } else if (completedDatesSet.has(yesterday)) {
        currentStreak = 1;
        let check = yesterday - 86400000;
        while (completedDatesSet.has(check)) { currentStreak++; check -= 86400000; }
      }
    }

    // Category distribution
    const catCounts: Record<string, number> = {};
    const catTime: Record<string, number> = {};
    for (const item of completedItems) {
      const cat = ((item.source_type || item.content_type || 'article') as string).toLowerCase();
      const t = item.actual_time_spent;
      const ts = t != null ? parseFloat(t) : parseFloat(item.estimated_time_minutes || ((item.estimated_read_time || 300) / 60.0));
      catCounts[cat] = (catCounts[cat] || 0) + 1;
      catTime[cat] = (catTime[cat] || 0) + ts;
    }
    const defaultCats = ['article', 'youtube', 'reddit', 'twitter', 'leetcode', 'pdf'];
    const allCats = new Set([...Object.keys(catCounts), ...defaultCats]);
    const categoryDistribution = Array.from(allCats).map(cat => ({
      category: cat.charAt(0).toUpperCase() + cat.slice(1),
      count: catCounts[cat] || 0,
      time_spent: Math.round((catTime[cat] || 0) * 10) / 10,
    }));

    // Most viewed categories
    const catViews: Record<string, number> = {};
    for (const [itemId, track] of Object.entries(trackingInfo)) {
      if ((track as any).last_opened_at) {
        const matchItem = items.find(i => i.id === itemId);
        if (matchItem) {
          const cat = ((matchItem.source_type || matchItem.content_type || 'article') as string).toLowerCase();
          const catCapitalized = cat.charAt(0).toUpperCase() + cat.slice(1);
          catViews[catCapitalized] = (catViews[catCapitalized] || 0) + 1;
        }
      }
    }
    let mostViewedCategories = Object.entries(catViews)
      .map(([category, views]) => ({ category, views }))
      .sort((a, b) => b.views - a.views);
    if (!mostViewedCategories.length) mostViewedCategories = [{ category: 'Article', views: 0 }];

    // Productivity score
    const totalItemsCount = items.length;
    const completionRate = totalItemsCount > 0 ? (totalCompleted / totalItemsCount) * 100 : 0.0;
    const user = req.user || {};
    const userMeta = (user as any).user_metadata || {};
    const dailyGoal = parseInt(userMeta.daily_reading_goal_minutes || '15', 10);
    const goalMetDays = last30DaysList.slice(-7).filter(d => (timeByDay[d.getTime()] || 0) >= dailyGoal).length;
    const goalScore = (goalMetDays / 7.0) * 100;
    const streakScore = Math.min(100.0, (currentStreak / 7.0) * 100.0);
    const uniqueCats = Object.values(catCounts).filter(c => c > 0).length;
    const diversityScore = Math.min(100.0, (uniqueCats / 3.0) * 100.0);
    const productivityScore = Math.min(100, Math.max(0, Math.round(
      (completionRate * 0.35) + (goalScore * 0.35) + (streakScore * 0.15) + (diversityScore * 0.15)
    )));

    // Top AI-recommended topics
    const aiTagCounts: Record<string, number> = {};
    for (const item of completedItems) {
      const track = trackingInfo[item.id] as any;
      if (track?.last_recommended_at || (track?.recommendation_count || 0) > 0) {
        for (const tag of normalizeTags(item.tags)) {
          if (tag !== 'uncategorized') aiTagCounts[tag] = (aiTagCounts[tag] || 0) + 1;
        }
      }
    }
    const topAiTopics = Object.entries(aiTagCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const dailyTimeChart = last30DaysList.map(d => ({
      date: d.toISOString().split('T')[0],
      minutes: Math.round((timeByDay[d.getTime()] || 0) * 10) / 10,
      completions: completionsByDay[d.getTime()] || 0,
    }));
    const weeklyTimeChart = last12Weeks.map(w => ({
      week_start: w.toISOString().split('T')[0],
      minutes: Math.round((timeByWeek[w.getTime()] || 0) * 10) / 10,
      completions: completionsByWeek[w.getTime()] || 0,
    }));
    const monthlyTimeChart = last12MonthsKeys.map(m => ({
      month: m,
      minutes: Math.round((timeByMonth[m] || 0) * 10) / 10,
      completions: completionsByMonth[m] || 0,
    }));

    return res.json({
      reading_time: {
        daily: Math.round(dailyReadingTime * 10) / 10,
        weekly: Math.round(weeklyReadingTime * 10) / 10,
        monthly: Math.round(monthlyReadingTime * 10) / 10,
        daily_goal: dailyGoal,
      },
      average_completion_time: totalCompleted > 0 ? Math.round((totalTimeSpent / totalCompleted) * 10) / 10 : 0.0,
      category_distribution: categoryDistribution,
      most_viewed_categories: mostViewedCategories,
      streak: {
        current: currentStreak,
        longest: longestStreak,
        completed_dates: Array.from(completedDatesSet).map(t => new Date(t).toISOString().split('T')[0]),
      },
      productivity_score: productivityScore,
      top_ai_topics: topAiTopics,
      charts: {
        daily: dailyTimeChart,
        weekly: weeklyTimeChart,
        monthly: monthlyTimeChart,
      },
    });
  } catch (err: any) {
    console.error('[items] analytics/reading error:', err);
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/items/bulk — Bulk actions
// ---------------------------------------------------------------------------

router.post('/bulk', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const { ids, action, status, collection_id, is_favorite } = req.body;
  if (!Array.isArray(ids) || !action) {
    return res.status(400).json({ detail: 'ids (array) and action are required' });
  }
  try {
    let updated = 0;
    const targetColId = collection_id || null;

    if (action === 'move' && collection_id !== undefined) {
      if (targetColId) {
        const { data: col } = await supabase.from('collections').select('id').eq('id', targetColId).eq('user_id', userId).maybeSingle();
        if (!col) {
          return res.status(400).json({ detail: 'Invalid or unauthorized collection_id' });
        }
      }
    }

    for (const id of ids) {
      try {
        if (action === 'delete') {
          await supabase.from('items').delete().eq('id', id).eq('user_id', userId);
          await fallbackDb.deleteItemMetadata(id);
        } else if (action === 'status' && status) {
          const patch: Record<string, any> = { status };
          if (status === 'completed') {
            patch.completed_at = new Date().toISOString();
            patch.read_progress = 100;
          } else if (status === 'unread') {
            patch.completed_at = null;
            patch.read_progress = 0;
          }
          await supabase.from('items').update(patch).eq('id', id).eq('user_id', userId);
        } else if (action === 'move' && collection_id !== undefined) {
          await supabase.from('items').update({ collection_id: targetColId }).eq('id', id).eq('user_id', userId);
          await fallbackDb.updateItemMetadata(userId, id, { collection_id: targetColId }, supabase);
        } else if (action === 'favorite' && is_favorite !== undefined) {
          await supabase.from('items').update({ is_favorite }).eq('id', id).eq('user_id', userId);
        }
        updated++;
      } catch { /* skip individual failures */ }
    }
    return res.json({ updated });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/items/reclassify — Perform AI folder reclassification
// ---------------------------------------------------------------------------

router.post('/reclassify', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { item_ids } = req.body || {};

    // Fetch target items for this user
    let query = supabase.from('items').select('*').eq('user_id', userId);
    if (Array.isArray(item_ids) && item_ids.length > 0) {
      query = query.in('id', item_ids);
    }
    const { data: items, error: itemsErr } = await query;
    if (itemsErr || !items || items.length === 0) {
      return res.json({
        reclassified_count: 0,
        message: 'No items available to reclassify.',
        updated_items: [],
      });
    }

    let reclassifiedCount = 0;
    const reclassifiedItems: any[] = [];

    for (const item of items) {
      const bestMatchId = await determineFolderForItem(userId, {
        id: item.id,
        title: item.title,
        tags: item.tags,
        source_type: item.source_type,
        url: item.url,
        ai_summary: item.ai_summary,
        description: item.description,
      }, supabase);

      if (bestMatchId && bestMatchId !== item.collection_id) {
        await supabase.from('items').update({ collection_id: bestMatchId }).eq('id', item.id).eq('user_id', userId);
        await fallbackDb.updateItemMetadata(userId, item.id, { collection_id: bestMatchId }, supabase);
        reclassifiedCount++;
        reclassifiedItems.push({ id: item.id, collection_id: bestMatchId });
      }
    }

    return res.json({
      message: `AI reclassified ${reclassifiedCount} items successfully`,
      reclassified_count: reclassifiedCount,
      updated_items: reclassifiedItems,
    });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/items/backfill-summaries — Backfill stub
// ---------------------------------------------------------------------------

router.post('/backfill-summaries', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { data: items } = await supabase.from('items').select('*').eq('user_id', userId);
    const pending = (items || []).filter((i: any) =>
      i.processing_status === 'queued' ||
      i.processing_status === 'pending' ||
      !i.ai_summary ||
      i.ai_summary.includes('Queued for AI summary')
    );

    let updated = 0;
    for (const item of pending) {
      AIService.processItemEnrichment(item.id, item.url, userId, item.title).catch(() => {});
      updated++;
    }

    return res.json({ updated, message: `Triggered AI summary generation for ${updated} items` });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/items/recalculate-priorities — Priority recalculation stub
// ---------------------------------------------------------------------------

router.post('/recalculate-priorities', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  return res.json({ updated: 0, message: 'Priority recalculation is handled by the Python backend' });
});

// ---------------------------------------------------------------------------
// POST /api/items/suggest-collection — AI Collection suggestion handler
// ---------------------------------------------------------------------------

router.post('/suggest-collection', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { title = '', url = '', tags = [] } = req.body || {};
    let { data: collections } = await supabase.from('collections').select('*').eq('user_id', userId);
    if (!collections || collections.length === 0) {
      collections = await fallbackDb.listCollections(userId, supabase);
    }

    const textToMatch = `${title} ${url} ${(tags || []).join(' ')}`.toLowerCase();

    if (collections && collections.length > 0) {
      for (const col of collections) {
        const colNameLower = col.name.toLowerCase().trim();
        if (textToMatch.includes(colNameLower)) {
          return res.json({
            suggested_collection_id: col.id,
            name: col.name,
            color: col.color || 'blue',
            is_new: false,
          });
        }
      }
    }

    return res.json({
      suggested_collection_id: null,
      name: 'Reading List',
      color: 'blue',
      is_new: true,
    });
  } catch (err: any) {
    return res.json({ suggested_collection_id: null, name: 'Reading List', color: 'blue', is_new: true });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items — List with filtering, sorting, pagination
// IMPORTANT: This must come AFTER all specific routes to not shadow them!
// ---------------------------------------------------------------------------

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  try {
    const { status, type, tag, collection_id, search, sort = 'newest' } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 100);
    const offset = parseInt(String(req.query.offset || '0'), 10) || 0;

    // Build Supabase query
    let query = supabase.from('items').select('*', { count: 'exact' }).eq('user_id', userId);

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('content_type', type);
    if (tag) query = (query as any).contains('tags', [tag]);

    let applyCollectionFilterInMemory = false;
    if (collection_id) {
      // Try remote filter; fall back to in-memory if column not available
      try {
        if (collection_id === 'none' || collection_id === 'null') {
          query = (query as any).is('collection_id', null);
        } else {
          query = query.eq('collection_id', collection_id);
        }
      } catch {
        applyCollectionFilterInMemory = true;
      }
    }

    if (search && search.trim()) {
      // Fetch all candidates matching non-search filters, then perform hybrid search
      const { data } = await query;
      let items = (data || []).map(itemToResponse);
      items = await fallbackDb.mergeItemsMetadata(userId, items);

      if (applyCollectionFilterInMemory) {
        if (collection_id === 'none' || collection_id === 'null') {
          items = items.filter(i => !i.collection_id);
        } else {
          items = items.filter(i => i.collection_id === collection_id);
        }
      }

      // Map collection names
      try {
        const cols = await fallbackDb.listCollections(userId, supabase);
        const colMap: Record<string, string> = {};
        (cols as any[]).forEach((c: any) => { colMap[c.id] = c.name; });
        items.forEach(i => { i.collection_name = colMap[i.collection_id] || ''; });
      } catch { /* non-fatal */ }

      let ranked = performHybridSearch(userId, search.trim(), items);

      if (sort === 'priority') ranked.sort((a, b) => (parseFloat(b.priority_score) || 50) - (parseFloat(a.priority_score) || 50));
      else if (sort === 'shortest') ranked.sort((a, b) => (a.estimated_read_time ?? 999) - (b.estimated_read_time ?? 999));
      else if (sort === 'longest') ranked.sort((a, b) => (b.estimated_read_time ?? 0) - (a.estimated_read_time ?? 0));

      const total = ranked.length;
      const page = ranked.slice(offset, offset + limit);
      return res.json({ items: page, total });
    }

    // No search: push sorting and pagination to DB level
    if (sort === 'priority') query = (query as any).order('priority_score', { ascending: false });
    else if (sort === 'shortest') query = (query as any).order('estimated_read_time', { ascending: true, nullsFirst: false });
    else if (sort === 'longest') query = (query as any).order('estimated_read_time', { ascending: false, nullsFirst: false });
    else query = (query as any).order('added_at', { ascending: false });

    if (!applyCollectionFilterInMemory) {
      query = (query as any).range(offset, offset + limit - 1);
    }

    const { data, count, error: qErr } = await query;
    console.log(`[items] GET / userId=${userId} count=${count} rows=${data?.length} error=${qErr?.message}`);
    let items = (data || []).map(itemToResponse);
    items = await fallbackDb.mergeItemsMetadata(userId, items);

    if (applyCollectionFilterInMemory) {
      if (collection_id === 'none' || collection_id === 'null') {
        items = items.filter(i => !i.collection_id);
      } else {
        items = items.filter(i => i.collection_id === collection_id);
      }
      const total = items.length;
      items = items.slice(offset, offset + limit);
      return res.json({ items, total });
    }

    return res.json({ items, total: count ?? items.length });
  } catch (err: any) {
    console.error('[items] get_items error:', err);
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/:id — Single item
// MUST remain LAST among GET routes
// ---------------------------------------------------------------------------

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const itemId = req.params.id;
  try {
    const { data, error } = await supabase.from('items').select('*').eq('id', itemId).eq('user_id', userId).maybeSingle();
    if (error || !data) return res.status(404).json({ detail: 'Item not found' });
    const merged = await fallbackDb.mergeSingleItemMetadata(userId, data);
    fallbackDb.recordItemOpen(userId, itemId).catch(() => {});
    return res.json(itemToResponse(merged));
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/items/:id — Full edit
// ---------------------------------------------------------------------------

router.put('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const itemId = req.params.id;
  try {
    const { title, tags, ai_summary, description, collection_id, actual_time_spent, read_progress, full_summary } = req.body;
    const updateData: Record<string, any> = {};
    const localUpdates: Record<string, any> = {};

    if (title != null) updateData.title = title;
    if (tags != null) updateData.tags = (tags as string[]).map(t => t.toLowerCase().trim()).filter(Boolean);
    if (ai_summary != null) updateData.ai_summary = ai_summary;
    if (description != null) updateData.description = description;
    if (actual_time_spent != null) updateData.actual_time_spent = actual_time_spent;
    if (full_summary != null) localUpdates.full_summary = full_summary;

    if (collection_id !== undefined) {
      const colVal = collection_id || null;
      if (colVal) {
        const { data: col } = await supabase.from('collections').select('id').eq('id', colVal).eq('user_id', userId).maybeSingle();
        if (!col) {
          return res.status(400).json({ detail: 'Invalid or unauthorized collection_id' });
        }
      }
      updateData.collection_id = colVal;
      localUpdates.collection_id = colVal;
    }

    if (read_progress != null) {
      const progress = Math.max(0, Math.min(100, parseInt(read_progress, 10)));
      updateData.read_progress = progress;
      localUpdates.read_progress = progress;
      if (progress === 100) {
        updateData.status = 'completed';
        updateData.completed_at = new Date().toISOString();
      } else if (progress > 0) {
        updateData.status = 'reading';
        updateData.completed_at = null;
      } else {
        updateData.status = 'unread';
        updateData.completed_at = null;
      }
    }

    // Metadata field routing — preserve collection_id for Supabase items column
    const metaOnly = ['read_progress', 'full_summary', 'actual_time_spent'];
    const remoteData: Record<string, any> = { ...updateData };
    metaOnly.forEach(f => { if (f in localUpdates) delete remoteData[f]; });

    if (Object.keys(localUpdates).length) {
      await fallbackDb.updateItemMetadata(userId, itemId, localUpdates, supabase);
    }

    let itemRow: any;
    if (Object.keys(remoteData).length) {
      const { data, error } = await supabase.from('items').update(remoteData).eq('id', itemId).eq('user_id', userId).select().maybeSingle();
      if (error || !data) return res.status(404).json({ detail: 'Item not found' });
      itemRow = data;
    } else {
      const { data } = await supabase.from('items').select('*').eq('id', itemId).eq('user_id', userId).maybeSingle();
      if (!data) return res.status(404).json({ detail: 'Item not found' });
      itemRow = data;
    }

    const merged = await fallbackDb.mergeSingleItemMetadata(userId, itemRow);
    fallbackDb.recordItemOpen(userId, itemId).catch(() => {});
    return res.json(itemToResponse(merged));
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/items/:id — Quick update
// ---------------------------------------------------------------------------

router.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const itemId = req.params.id;
  try {
    const { status, is_favorite, read_progress, collection_id, actual_time_spent } = req.body;
    const updateData: Record<string, any> = {};
    const localUpdates: Record<string, any> = {};

    if (actual_time_spent != null) {
      localUpdates.actual_time_spent = actual_time_spent;
    }

    if (status != null) {
      updateData.status = status;
      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
        localUpdates.read_progress = 100;
      } else if (status === 'unread') {
        updateData.completed_at = null;
        localUpdates.read_progress = 0;
      } else {
        updateData.completed_at = null;
      }
    }

    if (is_favorite != null) updateData.is_favorite = is_favorite;

    if (read_progress != null) {
      const progress = Math.max(0, Math.min(100, parseInt(read_progress, 10)));
      localUpdates.read_progress = progress;
      if (progress === 100) {
        updateData.status = 'completed';
        updateData.completed_at = new Date().toISOString();
      } else if (progress > 0) {
        updateData.status = 'reading';
        updateData.completed_at = null;
      } else {
        updateData.status = 'unread';
        updateData.completed_at = null;
      }
    }

    if (collection_id !== undefined) {
      const colVal = collection_id || null;
      if (colVal) {
        const { data: col } = await supabase.from('collections').select('id').eq('id', colVal).eq('user_id', userId).maybeSingle();
        if (!col) {
          return res.status(400).json({ detail: 'Invalid or unauthorized collection_id' });
        }
      }
      updateData.collection_id = colVal;
      localUpdates.collection_id = colVal;
    }

    // Route metadata fields — strip unmapped columns ONLY if missing in schema
    ['read_progress', 'actual_time_spent'].forEach(f => {
      if (!(fallbackDb as any)[`has_${f}`]) {
        delete updateData[f];
      }
    });

    if (Object.keys(localUpdates).length) {
      await fallbackDb.updateItemMetadata(userId, itemId, localUpdates, supabase);
    }

    let itemRow: any;
    if (Object.keys(updateData).length) {
      const { data, error } = await supabase.from('items').update(updateData).eq('id', itemId).eq('user_id', userId).select().maybeSingle();
      if (error || !data) return res.status(404).json({ detail: 'Item not found' });
      itemRow = data;
    } else {
      const { data } = await supabase.from('items').select('*').eq('id', itemId).eq('user_id', userId).maybeSingle();
      if (!data) return res.status(404).json({ detail: 'Item not found' });
      itemRow = data;
    }

    const merged = await fallbackDb.mergeSingleItemMetadata(userId, itemRow);
    fallbackDb.recordItemOpen(userId, itemId).catch(() => {});
    return res.json(itemToResponse(merged));
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/items/:id
// ---------------------------------------------------------------------------

router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const itemId = req.params.id;
  try {
    await supabase.from('items').delete().eq('id', itemId).eq('user_id', userId);
    await fallbackDb.deleteItemMetadata(itemId);
    return res.json({ message: 'Item deleted' });
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/items/:id/retry — Retry AI generation
// ---------------------------------------------------------------------------

router.post('/:id/retry', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  const itemId = req.params.id;
  try {
    const { data, error } = await supabase.from('items').select('*').eq('id', itemId).eq('user_id', userId).maybeSingle();
    if (error || !data) return res.status(404).json({ detail: 'Item not found' });

    // Reset to queued
    await supabase.from('items').update({ processing_status: 'queued', ai_summary: 'Queued for AI summary...' }).eq('id', itemId);
    updateIngestionDebug(itemId, 'queued', 'Item manually enqueued for retry.');

    // Kick off mock pipeline
    runMockEnrichmentPipeline(itemId, data.url, userId, data.title).catch(() => {});

    const { data: refreshed } = await supabase.from('items').select('*').eq('id', itemId).maybeSingle();
    const merged = await fallbackDb.mergeSingleItemMetadata(userId, refreshed || data);
    return res.json(itemToResponse(merged));
  } catch (err: any) {
    return res.status(400).json({ detail: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/items/:id/ingestion-debug — Ingestion debug info
// ---------------------------------------------------------------------------

router.get('/:id/ingestion-debug', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const itemId = req.params.id;
  const info = ingestionDebugInfo[itemId];
  if (!info) return res.json({ pipeline_stage: 'unknown', logs: [], error: null });
  return res.json(info);
});

export default router;
