import { describe, it, expect } from '@jest/globals';
import { fallbackDb, openDb, dbAll, DB_PATH } from '../../src/utils/schemaFallback';

describe('SQLite Deterministic Initialization Tests', () => {
  it('should initialize fallbackDb and set initialized to true', async () => {
    await fallbackDb.ready;
    expect(fallbackDb.initialized).toBe(true);
    expect(DB_PATH).toBeTruthy();
  });

  it('should verify all 7 required tables exist in SQLite master', async () => {
    await fallbackDb.ready;
    const ok = await fallbackDb.verifyRequiredTables();
    expect(ok).toBe(true);

    const requiredTables = [
      'local_reminder_settings',
      'local_reminder_history',
      'local_user_gamification',
      'local_streak_calendar',
      'local_item_meta',
      'local_item_tracking',
      'local_item_embeddings',
    ];

    const db = openDb();
    try {
      const placeholders = requiredTables.map(() => '?').join(',');
      const rows = await dbAll<{ name: string }>(
        db,
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`,
        requiredTables
      );

      const foundTables = rows.map((r) => r.name);
      for (const table of requiredTables) {
        expect(foundTables).toContain(table);
      }
    } finally {
      db.close();
    }
  });
});
