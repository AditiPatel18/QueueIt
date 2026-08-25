/**
 * TypeScript port of backend/utils/schema_fallback.py
 * Manages local SQLite DB for schema fallback and metadata storage.
 */
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

// DB path mirrors Python: one level up from backend_node/src -> project root
const projectRoot = path.resolve(__dirname, '../../../');
export const DB_PATH = path.join(projectRoot, 'local_fallback.db');

// ── Promisified SQLite wrappers ─────────────────────────────────────────────

export function openDb(): sqlite3.Database {
  return new sqlite3.Database(DB_PATH);
}

export function dbRun(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

export function dbGet<T = Record<string, unknown>>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T)));
  });
}

export function dbAll<T = Record<string, unknown>>(db: sqlite3.Database, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
  });
}

// ── Schema detection ────────────────────────────────────────────────────────

export class SchemaFallbackManager {
  has_collections_table = false;
  has_collection_id = false;
  has_read_progress = false;
  has_notes = false;
  has_source_type = false;
  has_source_domain = false;
  has_logo_url = false;
  has_audio_url = false;
  has_is_favorite = false;
  has_full_summary = false;
  has_estimated_time_minutes = false;
  has_actual_time_spent = false;
  has_normalized_url = false;
  initialized = false;
  private _ready: Promise<void>;

  constructor() {
    this._ready = this._init();
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  private async _init(): Promise<void> {
    await this.initSqlite();
    this.detectSchema().catch(() => {});
  }

  private async detectSchema(): Promise<void> {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    return new Promise((resolve) => {
      const url = `${supabaseUrl}/rest/v1/?apikey=${supabaseKey}`;
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { headers: { apikey: supabaseKey } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const schema = JSON.parse(data);
            const defs = schema?.definitions || {};
            this.has_collections_table = 'collections' in defs;
            const itemsDef = defs?.items || {};
            const props = itemsDef?.properties || {};
            this.has_collection_id = 'collection_id' in props;
            this.has_read_progress = 'read_progress' in props;
            this.has_notes = 'notes' in props;
            this.has_source_type = 'source_type' in props;
            this.has_source_domain = 'source_domain' in props;
            this.has_logo_url = 'logo_url' in props;
            this.has_audio_url = 'audio_url' in props;
            this.has_is_favorite = 'is_favorite' in props;
            this.has_full_summary = 'full_summary' in props;
            this.has_estimated_time_minutes = 'estimated_time_minutes' in props;
            this.has_actual_time_spent = 'actual_time_spent' in props;
            this.has_normalized_url = 'normalized_url' in props;
          } catch { /* ignore parse errors */ }
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.setTimeout(5000, () => { req.destroy(); resolve(); });
    });
  }

  private async initSqlite(): Promise<void> {
    const db = openDb();
    try {

      
      // local_collections
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_collections (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
        color TEXT NOT NULL, created_at TEXT NOT NULL)`);

      // local_item_meta
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_item_meta (
        item_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, collection_id TEXT,
        read_progress INTEGER DEFAULT 0, notes TEXT, full_summary TEXT)`);
      for (const col of [
        'full_summary TEXT', 'estimated_time_minutes REAL',
        'actual_time_spent REAL DEFAULT 0.0', 'normalized_url TEXT',
      ]) {
        try { await dbRun(db, `ALTER TABLE local_item_meta ADD COLUMN ${col}`); } catch { /* exists */ }
      }

      // local_item_tracking
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_item_tracking (
        item_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, last_opened_at TEXT,
        last_recommended_at TEXT, recommendation_count INTEGER DEFAULT 0)`);

      // local_item_embeddings
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_item_embeddings (
        item_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, embedding TEXT NOT NULL,
        text_hash TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_embeddings_user_id ON local_item_embeddings(user_id)`);

      // local_reminder_settings
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_reminder_settings (
        user_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1,
        reminder_time TEXT DEFAULT '09:00', snoozed_until TEXT, last_reminded_at TEXT)`);
      for (const col of [
        "frequency TEXT DEFAULT 'daily'", "custom_days TEXT DEFAULT ''",
        "timezone TEXT DEFAULT 'UTC'", 'browser_notifications INTEGER DEFAULT 1',
        'email_reminders INTEGER DEFAULT 1', 'sms_reminders INTEGER DEFAULT 0',
        "phone_number TEXT DEFAULT ''", "email_address TEXT DEFAULT ''", 'last_sent_date TEXT',
      ]) {
        try { await dbRun(db, `ALTER TABLE local_reminder_settings ADD COLUMN ${col}`); } catch { /* exists */ }
      }

      // local_user_gamification
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_user_gamification (
        user_id TEXT PRIMARY KEY, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1,
        streak_freezes_available INTEGER DEFAULT 1, last_freeze_used_at TEXT,
        last_freeze_granted_at TEXT, daily_goal INTEGER DEFAULT 15,
        current_streak INTEGER DEFAULT 0, longest_streak INTEGER DEFAULT 0,
        last_activity_date TEXT)`);
      try { await dbRun(db, `ALTER TABLE local_user_gamification ADD COLUMN last_freeze_granted_at TEXT`); } catch { /* exists */ }

      // local_streak_calendar
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_streak_calendar (
        user_id TEXT, activity_date TEXT, xp_earned INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, activity_date))`);

      // local_reminder_history
      await dbRun(db, `CREATE TABLE IF NOT EXISTS local_reminder_history (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT, title TEXT,
        scheduled_time TEXT, sent_at TEXT, status TEXT, channel TEXT, completed_at TEXT)`);
      for (const col of [
        'retry_count INTEGER DEFAULT 0', "error_message TEXT DEFAULT ''", "delivery_logs TEXT DEFAULT ''",
      ]) {
        try { await dbRun(db, `ALTER TABLE local_reminder_history ADD COLUMN ${col}`); } catch { /* exists */ }
      }

      // Indexes
      await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_reminder_history_user_status ON local_reminder_history(user_id, status, sent_at)`);
      await dbRun(db, `CREATE INDEX IF NOT EXISTS idx_streak_calendar_user ON local_streak_calendar(user_id)`);

      this.initialized = true;
      if (process.env.NODE_ENV !== 'test') {
        console.log('[SQLite] Schema initialization completed successfully');
      }
    } finally {
      db.close();
    }
  }

  // ── Select string ──────────────────────────────────────────────────────────

  getOptimizedSelectString(): string {
    const cols = [
      'id', 'user_id', 'url', 'content_type', 'title', 'description', 'author',
      'thumbnail_url', 'source_name', 'estimated_read_time', 'duration_seconds',
      'status', 'processing_status', 'tags', 'ai_summary', 'priority_score',
      'created_at', 'updated_at', 'added_at', 'completed_at',
    ];
    if (this.has_source_type) cols.push('source_type');
    if (this.has_source_domain) cols.push('source_domain');
    if (this.has_logo_url) cols.push('logo_url');
    if (this.has_audio_url) cols.push('audio_url');
    if (this.has_is_favorite) cols.push('is_favorite');
    if (this.has_collection_id) cols.push('collection_id');
    if (this.has_read_progress) cols.push('read_progress');
    if (this.has_notes) cols.push('notes');
    if (this.has_full_summary) cols.push('full_summary');
    if (this.has_estimated_time_minutes) cols.push('estimated_time_minutes');
    if (this.has_actual_time_spent) cols.push('actual_time_spent');
    if (this.has_normalized_url) cols.push('normalized_url');
    return cols.join(',');
  }

  // ── Collections ────────────────────────────────────────────────────────────

  async listCollections(userId: string, supabaseClient: any): Promise<any[]> {
    try {
      const res = await supabaseClient.from('collections').select('*').eq('user_id', userId).order('created_at');
      if (!res.error && Array.isArray(res.data)) {
        return res.data;
      }
    } catch { /* fallback to local sqlite */ }

    const db = openDb();
    try {
      return await dbAll(db, 'SELECT * FROM local_collections WHERE user_id = ? ORDER BY created_at ASC', [userId]);
    } catch {
      return [];
    } finally { db.close(); }
  }

  async createCollection(userId: string, name: string, color: string, supabaseClient: any): Promise<any> {
    const colId = uuidv4();
    const createdAt = new Date().toISOString();
    if (this.has_collections_table) {
      try {
        const res = await supabaseClient.from('collections').insert({ name, color, user_id: userId }).select();
        if (!res.error && res.data?.length) return res.data[0];
      } catch { /* fallback */ }
    }
    const db = openDb();
    try {
      await dbRun(db, 'INSERT INTO local_collections (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)',
        [colId, userId, name, color, createdAt]);
      return { id: colId, user_id: userId, name, color, created_at: createdAt };
    } finally { db.close(); }
  }

  async updateCollection(userId: string, colId: string, name: string | null, color: string | null, supabaseClient: any): Promise<any> {
    if (this.has_collections_table) {
      try {
        const updates: Record<string, string> = {};
        if (name !== null) updates.name = name;
        if (color !== null) updates.color = color;
        const res = await supabaseClient.from('collections').update(updates).eq('id', colId).eq('user_id', userId).select();
        if (!res.error && res.data?.length) return res.data[0];
      } catch { /* fallback */ }
    }
    const db = openDb();
    try {
      const existing = await dbGet<any>(db, 'SELECT * FROM local_collections WHERE id = ? AND user_id = ?', [colId, userId]);
      if (!existing) throw new Error('Collection not found');
      const newName = name ?? existing.name;
      const newColor = color ?? existing.color;
      await dbRun(db, 'UPDATE local_collections SET name = ?, color = ? WHERE id = ? AND user_id = ?', [newName, newColor, colId, userId]);
      return { ...existing, name: newName, color: newColor };
    } finally { db.close(); }
  }

  async deleteCollection(userId: string, colId: string, supabaseClient: any): Promise<boolean> {
    if (this.has_collections_table) {
      try {
        const res = await supabaseClient.from('collections').delete().eq('id', colId).eq('user_id', userId).select();
        if (!res.error) return true;
      } catch { /* fallback */ }
    }
    const db = openDb();
    try {
      await dbRun(db, 'DELETE FROM local_collections WHERE id = ? AND user_id = ?', [colId, userId]);
      await dbRun(db, 'UPDATE local_item_meta SET collection_id = NULL WHERE collection_id = ?', [colId]);
      return true;
    } catch { return false; } finally { db.close(); }
  }

  async getCollectionStats(userId: string, supabaseClient: any): Promise<Record<string, { item_count: number; read_time_minutes: number }>> {
    const selectCols = this.has_collection_id ? 'id,collection_id,estimated_read_time,status' : 'id,estimated_read_time,status';
    try {
      const res = await supabaseClient.from('items').select(selectCols).eq('user_id', userId);
      let items: any[] = res.data || [];
      if (!this.has_collection_id) items = await this.mergeItemsMetadata(userId, items);
      const statsMap: Record<string, { item_count: number; read_time_minutes: number }> = {};
      for (const item of items) {
        const colId = item.collection_id;
        if (!colId || item.status === 'completed') continue;
        if (!statsMap[colId]) statsMap[colId] = { item_count: 0, read_time_minutes: 0 };
        statsMap[colId].item_count++;
        statsMap[colId].read_time_minutes += parseInt(item.estimated_read_time || '0') || 0;
      }
      return statsMap;
    } catch { return {}; }
  }

  // ── Item metadata merge ────────────────────────────────────────────────────

  async mergeItemsMetadata(userId: string, items: any[]): Promise<any[]> {
    if (!items.length) return items;
    const needsCol = !this.has_collection_id;
    const needsProg = !this.has_read_progress;
    const needsNotes = !this.has_notes;
    const needsFS = !this.has_full_summary;
    const needsEst = !this.has_estimated_time_minutes;
    const needsSpent = !this.has_actual_time_spent;

    if (!needsCol && !needsProg && !needsNotes && !needsFS && !needsEst && !needsSpent) return items;

    const itemIds = items.map((i) => i.id).filter(Boolean);
    if (!itemIds.length) return items;

    const db = openDb();
    try {
      const placeholders = itemIds.map(() => '?').join(',');
      const rows = await dbAll<any>(db, `SELECT * FROM local_item_meta WHERE item_id IN (${placeholders})`, itemIds);
      const metaMap: Record<string, any> = {};
      rows.forEach((r) => { metaMap[r.item_id] = r; });

      for (const item of items) {
        const local = metaMap[item.id] || {};
        if (needsCol) item.collection_id = local.collection_id ?? null;
        if (needsProg) item.read_progress = local.read_progress ?? 0;
        if (needsNotes) item.notes = local.notes ?? null;
        if (needsFS) item.full_summary = local.full_summary ?? null;
        if (needsEst) {
          item.estimated_time_minutes = local.estimated_time_minutes ??
            (item.estimated_read_time ? parseFloat(item.estimated_read_time) : 5.0);
        }
        if (needsSpent) item.actual_time_spent = local.actual_time_spent ?? 0.0;
      }
    } finally { db.close(); }
    return items;
  }

  async mergeSingleItemMetadata(userId: string, item: any): Promise<any> {
    const merged = await this.mergeItemsMetadata(userId, [item]);
    return merged[0] ?? item;
  }

  async updateItemMetadata(userId: string, itemId: string, updates: Record<string, unknown>, supabaseClient: any): Promise<void> {
    const remoteFields: Record<string, unknown> = {};
    const localFields: Record<string, unknown> = {};

    for (const [field, val] of Object.entries(updates)) {
      const isRemote =
        (field === 'collection_id' && this.has_collection_id) ||
        (field === 'read_progress' && this.has_read_progress) ||
        (field === 'notes' && this.has_notes) ||
        (field === 'full_summary' && this.has_full_summary) ||
        (field === 'estimated_time_minutes' && this.has_estimated_time_minutes) ||
        (field === 'actual_time_spent' && this.has_actual_time_spent);
      if (isRemote) remoteFields[field] = val;
      else localFields[field] = val;
    }

    if (Object.keys(remoteFields).length) {
      try { await supabaseClient.from('items').update(remoteFields).eq('id', itemId); } catch { /* non-fatal */ }
    }

    if (Object.keys(localFields).length) {
      const db = openDb();
      try {
        const existing = await dbGet<any>(db, 'SELECT * FROM local_item_meta WHERE item_id = ?', [itemId]);
        if (existing) {
          const nc = localFields.collection_id ?? existing.collection_id;
          const np = localFields.read_progress ?? existing.read_progress;
          const nn = localFields.notes ?? existing.notes;
          const nf = localFields.full_summary ?? existing.full_summary;
          const ne = localFields.estimated_time_minutes ?? existing.estimated_time_minutes;
          const ns = localFields.actual_time_spent ?? existing.actual_time_spent;
          await dbRun(db, 
            'UPDATE local_item_meta SET collection_id=?, read_progress=?, notes=?, full_summary=?, estimated_time_minutes=?, actual_time_spent=? WHERE item_id=?',
            [nc, np, nn, nf, ne, ns, itemId]);
        } else {
          await dbRun(db,
            'INSERT INTO local_item_meta (item_id, user_id, collection_id, read_progress, notes, full_summary, estimated_time_minutes, actual_time_spent) VALUES (?,?,?,?,?,?,?,?)',
            [itemId, userId, localFields.collection_id ?? null, localFields.read_progress ?? 0,
             localFields.notes ?? null, localFields.full_summary ?? null,
             localFields.estimated_time_minutes ?? 5.0, localFields.actual_time_spent ?? 0.0]);
        }
      } finally { db.close(); }
    }
  }

  async deleteItemMetadata(itemId: string): Promise<void> {
    const db = openDb();
    try {
      await dbRun(db, 'DELETE FROM local_item_meta WHERE item_id = ?', [itemId]);
      await dbRun(db, 'DELETE FROM local_item_tracking WHERE item_id = ?', [itemId]);
    } finally { db.close(); }
  }

  async recordItemOpen(userId: string, itemId: string): Promise<void> {
    const db = openDb();
    const now = new Date().toISOString();
    try {
      await dbRun(db,
        `INSERT INTO local_item_tracking (item_id, user_id, last_opened_at) VALUES (?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET last_opened_at = excluded.last_opened_at`,
        [itemId, userId, now]);
    } catch { /* non-fatal */ } finally { db.close(); }
  }

  async recordItemRecommendation(userId: string, itemId: string): Promise<void> {
    const db = openDb();
    const now = new Date().toISOString();
    try {
      await dbRun(db,
        `INSERT INTO local_item_tracking (item_id, user_id, last_recommended_at, recommendation_count) VALUES (?, ?, ?, 1)
         ON CONFLICT(item_id) DO UPDATE SET last_recommended_at = excluded.last_recommended_at, recommendation_count = recommendation_count + 1`,
        [itemId, userId, now]);
    } catch { /* non-fatal */ } finally { db.close(); }
  }

  async getItemTracking(userId: string): Promise<Record<string, any>> {
    const db = openDb();
    try {
      const rows = await dbAll<any>(db, 'SELECT * FROM local_item_tracking WHERE user_id = ?', [userId]);
      const res: Record<string, any> = {};
      rows.forEach(row => {
        res[row.item_id] = { ...row };
      });
      return res;
    } catch {
      return {};
    } finally {
      db.close();
    }
  }
}

export const fallbackDb = new SchemaFallbackManager();
