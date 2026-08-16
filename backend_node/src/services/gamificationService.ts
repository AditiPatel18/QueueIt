import { openDb, dbRun, dbGet, dbAll } from '../utils/schemaFallback';
import { supabase } from '../config/supabase';

// Helper to get local date string YYYY-MM-DD
export function getLocalDateStr(tzName: string = 'UTC', date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzName || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

export interface UserGamification {
  user_id: string;
  xp: number;
  level: number;
  streak_freezes_available: number;
  last_freeze_used_at: string | null;
  last_freeze_granted_at: string | null;
  daily_goal: number;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string | null;
}

export class GamificationService {
  /**
   * Fetch or initialize local gamification status for a user.
   */
  static async getOrInit(userId: string): Promise<UserGamification> {
    const db = openDb();
    try {
      // Get user's timezone from reminder settings
      let tzName = 'UTC';
      try {
        const settRow = await dbGet<{ timezone?: string }>(db, 'SELECT timezone FROM local_reminder_settings WHERE user_id = ?', [userId]);
        if (settRow && settRow.timezone) {
          tzName = settRow.timezone;
        }
      } catch (err) {
        console.warn('Error reading timezone for gamification init:', err);
      }

      const todayStr = getLocalDateStr(tzName);

      const row = await dbGet<UserGamification>(db, 'SELECT * FROM local_user_gamification WHERE user_id = ?', [userId]);
      if (!row) {
        // Initialize defaults
        const defaultData: UserGamification = {
          user_id: userId,
          xp: 0,
          level: 1,
          streak_freezes_available: 1,
          last_freeze_used_at: null,
          last_freeze_granted_at: todayStr,
          daily_goal: 15,
          current_streak: 0,
          longest_streak: 0,
          last_activity_date: null,
        };

        await dbRun(
          db,
          `INSERT INTO local_user_gamification 
           (user_id, xp, level, streak_freezes_available, last_freeze_used_at, last_freeze_granted_at, daily_goal, current_streak, longest_streak, last_activity_date) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            defaultData.xp,
            defaultData.level,
            defaultData.streak_freezes_available,
            defaultData.last_freeze_used_at,
            defaultData.last_freeze_granted_at,
            defaultData.daily_goal,
            defaultData.current_streak,
            defaultData.longest_streak,
            defaultData.last_activity_date,
          ]
        );
        return defaultData;
      }

      const data = { ...row };

      // Check if due for weekly freeze grant (1 freeze/week)
      const lastGrant = data.last_freeze_granted_at;
      let granted = false;
      if (lastGrant) {
        try {
          const lastGrantDate = new Date(lastGrant);
          const todayDate = new Date(todayStr);
          const daysDiff = Math.floor((todayDate.getTime() - lastGrantDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff >= 7) {
            // Grant 1 freeze (cap at maximum of 3 freezes)
            const newFreezes = Math.min(3, (data.streak_freezes_available || 0) + 1);
            await dbRun(
              db,
              'UPDATE local_user_gamification SET streak_freezes_available = ?, last_freeze_granted_at = ? WHERE user_id = ?',
              [newFreezes, todayStr, userId]
            );
            data.streak_freezes_available = newFreezes;
            data.last_freeze_granted_at = todayStr;
            granted = true;
          }
        } catch (ex) {
          console.warn('Error calculating freeze grant:', ex);
        }
      } else {
        await dbRun(db, 'UPDATE local_user_gamification SET last_freeze_granted_at = ? WHERE user_id = ?', [todayStr, userId]);
        data.last_freeze_granted_at = todayStr;
        granted = true;
      }

      // Process streak logic (did they miss days?)
      const lastActivity = data.last_activity_date;
      let currentStreak = data.current_streak || 0;

      if (lastActivity && currentStreak > 0) {
        try {
          const lastActDate = new Date(lastActivity);
          const todayDate = new Date(todayStr);
          const daysDiff = Math.floor((todayDate.getTime() - lastActDate.getTime()) / (1000 * 60 * 60 * 24));

          if (daysDiff > 1) {
            const freezes = data.streak_freezes_available || 0;
            // Apply freeze if missed exactly yesterday (daysDiff == 2) and freeze is available
            if (daysDiff === 2 && freezes > 0) {
              const yesterday = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);
              const yesterdayStr = getLocalDateStr(tzName, yesterday);
              await dbRun(
                db,
                'UPDATE local_user_gamification SET streak_freezes_available = ?, last_freeze_used_at = ?, last_activity_date = ? WHERE user_id = ?',
                [freezes - 1, yesterdayStr, yesterdayStr, userId]
              );
              data.streak_freezes_available = freezes - 1;
              data.last_freeze_used_at = yesterdayStr;
              data.last_activity_date = yesterdayStr;
              console.log(`[Gamification] Used streak freeze for user ${userId} on ${yesterdayStr}`);
            } else {
              // Streak breaks!
              await dbRun(db, 'UPDATE local_user_gamification SET current_streak = 0 WHERE user_id = ?', [userId]);
              data.current_streak = 0;
              console.log(`[Gamification] Streak broken for user ${userId}. Resetting to 0.`);
            }
          }
        } catch (ex) {
          console.warn('Error checking streak freeze fallback:', ex);
        }
      }

      return data;
    } catch (err) {
      console.error('[GamificationService] Error getting user gamification:', err);
      return {
        user_id: userId,
        xp: 0,
        level: 1,
        streak_freezes_available: 0,
        last_freeze_used_at: null,
        last_freeze_granted_at: null,
        daily_goal: 15,
        current_streak: 0,
        longest_streak: 0,
        last_activity_date: null,
      };
    } finally {
      db.close();
    }
  }

  /**
   * Record activity, award XP, update streak calendar, check level-up.
   */
  static async recordActivity(
    userId: string,
    minutesRead: number = 0,
    itemCompleted: boolean = false
  ): Promise<{ xp: number; level: number; current_streak: number; longest_streak: number; xp_added: number } | Record<string, never>> {
    const db = openDb();
    try {
      // Get user's timezone from reminder settings
      let tzName = 'UTC';
      try {
        const settRow = await dbGet<{ timezone?: string }>(db, 'SELECT timezone FROM local_reminder_settings WHERE user_id = ?', [userId]);
        if (settRow && settRow.timezone) {
          tzName = settRow.timezone;
        }
      } catch (err) {
        console.warn('Error reading timezone for record activity:', err);
      }

      const todayStr = getLocalDateStr(tzName);
      const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = getLocalDateStr(tzName, yesterday);

      // 1. Fetch current status (closes inside db transaction)
      const status = await this.getOrInit(userId);

      // 2. Award XP
      let xpToAdd = 0;
      if (itemCompleted) {
        xpToAdd += 50;
      }
      if (minutesRead > 0) {
        // 2 XP per minute read
        xpToAdd += Math.floor(minutesRead * 2);
      }

      // 3. Add date to calendar
      await dbRun(
        db,
        `INSERT INTO local_streak_calendar (user_id, activity_date, xp_earned) 
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, activity_date) DO UPDATE SET xp_earned = xp_earned + ?`,
        [userId, todayStr, xpToAdd, xpToAdd]
      );

      // 4. Update streaks
      let currentStreak = status.current_streak || 0;
      let longestStreak = status.longest_streak || 0;
      const lastActivity = status.last_activity_date;

      if (lastActivity !== todayStr) {
        if (lastActivity === yesterdayStr) {
          currentStreak += 1;
        } else if (lastActivity === null || currentStreak === 0) {
          currentStreak = 1;
        } else {
          // Gaps occurred but not frozen
          currentStreak = 1;
        }
        longestStreak = Math.max(longestStreak, currentStreak);
      }

      // 5. Apply Level-up logic
      let currentXp = (status.xp || 0) + xpToAdd;
      let currentLevel = status.level || 1;

      // Simple level-up threshold: level * 200 XP
      let xpNeeded = currentLevel * 200;
      while (currentXp >= xpNeeded) {
        currentXp -= xpNeeded;
        currentLevel += 1;
        xpNeeded = currentLevel * 200;
        console.log(`[Gamification] User ${userId} leveled up to ${currentLevel}!`);
      }

      // 6. Save to DB
      await dbRun(
        db,
        `UPDATE local_user_gamification 
         SET xp = ?, level = ?, current_streak = ?, longest_streak = ?, last_activity_date = ? 
         WHERE user_id = ?`,
        [currentXp, currentLevel, currentStreak, longestStreak, todayStr, userId]
      );

      return {
        xp: currentXp,
        level: currentLevel,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        xp_added: xpToAdd,
      };
    } catch (err) {
      console.error('[GamificationService] Error recording activity:', err);
      return {};
    } finally {
      db.close();
    }
  }

  /**
   * Fetch all dates user completed activity (for calendar render).
   */
  static async getCalendar(userId: string): Promise<string[]> {
    const db = openDb();
    try {
      const rows = await dbAll<{ activity_date: string }>(
        db,
        'SELECT activity_date FROM local_streak_calendar WHERE user_id = ? ORDER BY activity_date ASC',
        [userId]
      );
      return rows.map(r => r.activity_date);
    } catch (err) {
      console.error('[GamificationService] Error fetching calendar:', err);
      return [];
    } finally {
      db.close();
    }
  }

  /**
   * Manually trigger/use a streak freeze (if user wants to protect today).
   */
  static async useFreeze(userId: string): Promise<{ success: boolean; streak_freezes_available: number; last_freeze_used_at: string }> {
    const db = openDb();
    try {
      let tzName = 'UTC';
      try {
        const settRow = await dbGet<{ timezone?: string }>(db, 'SELECT timezone FROM local_reminder_settings WHERE user_id = ?', [userId]);
        if (settRow && settRow.timezone) {
          tzName = settRow.timezone;
        }
      } catch (err) {
        console.warn('Error reading timezone for use freeze:', err);
      }

      const todayStr = getLocalDateStr(tzName);
      const status = await this.getOrInit(userId);
      const freezes = status.streak_freezes_available || 0;

      if (freezes <= 0) {
        throw new Error('No streak freezes available');
      }

      // Consume freeze, mock today as active
      await dbRun(
        db,
        'UPDATE local_user_gamification SET streak_freezes_available = ?, last_freeze_used_at = ?, last_activity_date = ? WHERE user_id = ?',
        [freezes - 1, todayStr, todayStr, userId]
      );

      await dbRun(
        db,
        'INSERT OR IGNORE INTO local_streak_calendar (user_id, activity_date, xp_earned) VALUES (?, ?, 0)',
        [userId, todayStr]
      );

      return {
        success: true,
        streak_freezes_available: freezes - 1,
        last_freeze_used_at: todayStr,
      };
    } catch (err) {
      console.error('[GamificationService] Error using freeze:', err);
      throw err;
    } finally {
      db.close();
    }
  }

  /**
   * Recalculates user streaks and calendar cells directly from Supabase items 'completed_at' timestamps.
   */
  static async syncStreakData(userId: string, supabaseClient: any): Promise<{ current_streak: number; longest_streak: number; calendar: string[] } | Record<string, never>> {
    const db = openDb();
    try {
      let tzName = 'UTC';
      try {
        const settRow = await dbGet<{ timezone?: string }>(db, 'SELECT timezone FROM local_reminder_settings WHERE user_id = ?', [userId]);
        if (settRow && settRow.timezone) {
          tzName = settRow.timezone;
        }
      } catch (err) {
        console.warn('Error reading timezone for sync streaks:', err);
      }

      const todayStr = getLocalDateStr(tzName);
      const todayDate = new Date(todayStr);
      const yesterdayStr = getLocalDateStr(tzName, new Date(todayDate.getTime() - 24 * 60 * 60 * 1000));
      const yesterdayDate = new Date(yesterdayStr);

      // Fetch completed items from Supabase
      let items: any[] = [];
      try {
        const res = await supabaseClient.from('items').select('completed_at').eq('user_id', userId).eq('status', 'completed');
        if (!res.error) {
          items = res.data || [];
        }
      } catch (err) {
        console.warn('[GamificationService] Supabase offline/error during sync:', err);
      }

      const completedDates = new Set<string>();

      // Parse completion dates to local dates
      for (const item of items) {
        const completedAtStr = item.completed_at;
        if (completedAtStr) {
          try {
            const dateObj = new Date(completedAtStr);
            const localDateStr = getLocalDateStr(tzName, dateObj);
            completedDates.add(localDateStr);
          } catch {
            // ignore
          }
        }
      }

      // Fetch streak freeze dates used from local database
      const freezeRows = await dbAll<{ activity_date: string }>(
        db,
        'SELECT activity_date FROM local_streak_calendar WHERE user_id = ? AND xp_earned = 0',
        [userId]
      );
      for (const row of freezeRows) {
        if (row.activity_date) {
          completedDates.add(row.activity_date);
        }
      }

      // Also fetch last_freeze_used_at from local_user_gamification
      const userRow = await dbGet<{ last_freeze_used_at?: string | null }>(
        db,
        'SELECT last_freeze_used_at FROM local_user_gamification WHERE user_id = ?',
        [userId]
      );
      if (userRow && userRow.last_freeze_used_at) {
        completedDates.add(userRow.last_freeze_used_at);
      }

      const sortedDatesStr = Array.from(completedDates).sort();
      let currentStreak = 0;
      let longestStreak = 0;

      if (sortedDatesStr.length > 0) {
        let tempStreak = 1;
        longestStreak = 1;
        for (let i = 1; i < sortedDatesStr.length; i++) {
          const d1 = new Date(sortedDatesStr[i - 1]);
          const d2 = new Date(sortedDatesStr[i]);
          const diffDays = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) {
            tempStreak += 1;
          } else if (diffDays > 1) {
            tempStreak = 1;
          }
          longestStreak = Math.max(longestStreak, tempStreak);
        }

        if (completedDates.has(todayStr)) {
          currentStreak = 1;
          let checkDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);
          while (completedDates.has(getLocalDateStr(tzName, checkDate))) {
            currentStreak += 1;
            checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
          }
        } else if (completedDates.has(yesterdayStr)) {
          currentStreak = 1;
          let checkDate = new Date(yesterdayDate.getTime() - 24 * 60 * 60 * 1000);
          while (completedDates.has(getLocalDateStr(tzName, checkDate))) {
            currentStreak += 1;
            checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
          }
        } else {
          currentStreak = 0;
        }
      }

      // Update local_user_gamification streaks
      const statusRow = await dbGet<{ xp?: number; level?: number }>(
        db,
        'SELECT xp, level FROM local_user_gamification WHERE user_id = ?',
        [userId]
      );
      const currentXp = statusRow?.xp || 0;
      const currentLevel = statusRow?.level || 1;

      const hasActivityToday = completedDates.has(todayStr);

      await dbRun(
        db,
        `INSERT INTO local_user_gamification 
         (user_id, xp, level, streak_freezes_available, current_streak, longest_streak, last_activity_date)
         VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET 
             current_streak = ?, 
             longest_streak = ?, 
             last_activity_date = ?`,
        [
          userId,
          currentXp,
          currentLevel,
          currentStreak,
          longestStreak,
          hasActivityToday ? todayStr : null,
          currentStreak,
          longestStreak,
          hasActivityToday ? todayStr : null,
        ]
      );

      // Rebuild local_streak_calendar for this user
      for (const dStr of completedDates) {
        await dbRun(
          db,
          'INSERT OR IGNORE INTO local_streak_calendar (user_id, activity_date, xp_earned) VALUES (?, ?, 50)',
          [userId, dStr]
        );
      }

      return {
        current_streak: currentStreak,
        longest_streak: longestStreak,
        calendar: Array.from(completedDates),
      };
    } catch (err) {
      console.error('[GamificationService] Error syncing streaks:', err);
      return {};
    } finally {
      db.close();
    }
  }
}

export class StreakService {
  static async getStreakHeatmap(userId: string): Promise<{ current_streak: number; longest_streak: number; daily_activity: { date: string; count: number }[] }> {
    const db = openDb();
    try {
      // 1. Fetch only completed_at column from completed items
      let items: any[] = [];
      try {
        const res = await supabase.from('items').select('completed_at').eq('user_id', userId).eq('status', 'completed');
        if (!res.error) {
          items = res.data || [];
        }
      } catch (err) {
        console.error('[StreakService] Error getting completed items from Supabase:', err);
      }

      // 2. Get user timezone from local reminder settings
      let tzName = 'UTC';
      try {
        const settRow = await dbGet<{ timezone?: string }>(db, 'SELECT timezone FROM local_reminder_settings WHERE user_id = ?', [userId]);
        if (settRow && settRow.timezone) {
          tzName = settRow.timezone;
        }
      } catch {
        // ignore
      }

      const todayStr = getLocalDateStr(tzName);
      const todayDate = new Date(todayStr);
      const yesterdayStr = getLocalDateStr(tzName, new Date(todayDate.getTime() - 24 * 60 * 60 * 1000));
      const yesterdayDate = new Date(yesterdayStr);

      const completedDates = new Set<string>();
      const dailyActivityCounts: Record<string, number> = {};

      // 3. Process completed_at timestamps
      for (const item of items) {
        const completedAtStr = item.completed_at;
        if (completedAtStr) {
          try {
            const dateObj = new Date(completedAtStr);
            const compDateStr = getLocalDateStr(tzName, dateObj);
            completedDates.add(compDateStr);
            dailyActivityCounts[compDateStr] = (dailyActivityCounts[compDateStr] || 0) + 1;
          } catch {
            // ignore
          }
        }
      }

      // 4. Integrate streak freezes from calendar
      try {
        const calendarRows = await dbAll<{ activity_date: string }>(
          db,
          'SELECT activity_date FROM local_streak_calendar WHERE user_id = ?',
          [userId]
        );
        for (const row of calendarRows) {
          if (row.activity_date) {
            completedDates.add(row.activity_date);
            if (!dailyActivityCounts[row.activity_date]) {
              dailyActivityCounts[row.activity_date] = 1; // count streak freeze day as active
            }
          }
        }
      } catch {
        // ignore
      }

      // 5. Compute current and longest streaks
      const sortedDatesStr = Array.from(completedDates).sort();
      let currentStreak = 0;
      let longestStreak = 0;

      if (sortedDatesStr.length > 0) {
        let tempStreak = 1;
        longestStreak = 1;
        for (let i = 1; i < sortedDatesStr.length; i++) {
          const d1 = new Date(sortedDatesStr[i - 1]);
          const d2 = new Date(sortedDatesStr[i]);
          const diffDays = Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) {
            tempStreak += 1;
          } else if (diffDays > 1) {
            tempStreak = 1;
          }
          longestStreak = Math.max(longestStreak, tempStreak);
        }

        if (completedDates.has(todayStr)) {
          currentStreak = 1;
          let checkDate = new Date(todayDate.getTime() - 24 * 60 * 60 * 1000);
          while (completedDates.has(getLocalDateStr(tzName, checkDate))) {
            currentStreak += 1;
            checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
          }
        } else if (completedDates.has(yesterdayStr)) {
          currentStreak = 1;
          let checkDate = new Date(yesterdayDate.getTime() - 24 * 60 * 60 * 1000);
          while (completedDates.has(getLocalDateStr(tzName, checkDate))) {
            currentStreak += 1;
            checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
          }
        } else {
          currentStreak = 0;
        }
      }

      const dailyActivity = Object.keys(dailyActivityCounts)
        .sort()
        .map(date => ({
          date,
          count: dailyActivityCounts[date],
        }));

      return {
        current_streak: currentStreak,
        longest_streak: longestStreak,
        daily_activity: dailyActivity,
      };
    } catch (err) {
      console.error('Error in StreakService:', err);
      return {
        current_streak: 0,
        longest_streak: 0,
        daily_activity: [],
      };
    } finally {
      db.close();
    }
  }
}
