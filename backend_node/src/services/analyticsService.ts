import { openDb, dbGet, fallbackDb } from '../utils/schemaFallback';
import { supabase } from '../config/supabase';
import { GamificationService, getLocalDateStr } from './gamificationService';

export class AnalyticsService {
  /**
   * Helper to calculate estimated reading time of an item in minutes.
   */
  static getItemReadingTime(item: any): number {
    const estMin = item.estimated_time_minutes;
    if (estMin !== undefined && estMin !== null) {
      const parsed = parseFloat(estMin);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    const estSec = item.estimated_read_time || item.duration_seconds;
    if (estSec !== undefined && estSec !== null) {
      const parsed = parseFloat(estSec);
      if (!isNaN(parsed)) {
        return parsed / 60.0;
      }
    }

    const text = item.extracted_text;
    if (text) {
      const words = text.trim().split(/\s+/).length;
      if (words > 0) {
        const sourceType = item.source_type || item.content_type || 'generic';
        const wpm = sourceType === 'pdf' ? 180.0 : 200.0;
        return Math.ceil(words / wpm);
      }
    }

    return 5.0; // Default to 5 minutes
  }

  /**
   * Fetch queue items for the user, merge local metadata, and calculate metrics.
   */
  static async calculateDashboardMetrics(userId: string, supabaseClient: any): Promise<Record<string, any>> {
    // 1. Fetch user items
    const selectCols = ['id', 'status', 'added_at', 'completed_at', 'estimated_read_time', 'duration_seconds', 'content_type'];
    if (fallbackDb.has_estimated_time_minutes) {
      selectCols.push('estimated_time_minutes');
    }
    if (fallbackDb.has_actual_time_spent) {
      selectCols.push('actual_time_spent');
    }
    if (fallbackDb.has_source_type) {
      selectCols.push('source_type');
    }

    const res = await supabaseClient.from('items').select(selectCols.join(',')).eq('user_id', userId);
    let items = res.data || [];
    items = await fallbackDb.mergeItemsMetadata(userId, items);

    // Get user's timezone from settings
    let tzName = 'UTC';
    const db = openDb();
    try {
      const settRow = await dbGet<{ timezone?: string }>(db, 'SELECT timezone FROM local_reminder_settings WHERE user_id = ?', [userId]);
      if (settRow && settRow.timezone) {
        tzName = settRow.timezone;
      }
    } catch {
      // ignore
    }

    const todayStr = getLocalDateStr(tzName);
    const today = new Date(todayStr);

    let dailyGoal = 15; // default daily reading goal (minutes)
    try {
      const goalRow = await dbGet<{ daily_goal?: number }>(db, 'SELECT daily_goal FROM local_user_gamification WHERE user_id = ?', [userId]);
      if (goalRow && goalRow.daily_goal) {
        dailyGoal = goalRow.daily_goal;
      }
    } catch {
      // ignore
    }
    db.close();

    // 2. Metric Accumulation
    let totalItems = 0;
    let completedItems = 0;
    let totalReadingTime = 0.0;
    let timeCompleted = 0.0;
    let remainingTime = 0.0;
    const completedDates = new Set<string>();

    // Day-by-day charts maps
    const last7DaysDates: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      last7DaysDates.push(getLocalDateStr(tzName, d));
    }

    const last30DaysDates: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      last30DaysDates.push(getLocalDateStr(tzName, d));
    }

    const timeByDay7: Record<string, number> = {};
    const completionsByDay7: Record<string, number> = {};
    last7DaysDates.forEach(d => {
      timeByDay7[d] = 0.0;
      completionsByDay7[d] = 0;
    });

    const timeByDay30: Record<string, number> = {};
    const completionsByDay30: Record<string, number> = {};
    last30DaysDates.forEach(d => {
      timeByDay30[d] = 0.0;
      completionsByDay30[d] = 0;
    });

    const dailyCompletionCounts: Record<string, number> = {};

    for (const item of items) {
      const status = item.status;
      if (status !== 'unread' && status !== 'reading' && status !== 'completed') {
        continue;
      }

      totalItems += 1;
      const estMinutes = this.getItemReadingTime(item);
      totalReadingTime += estMinutes;

      if (status === 'completed') {
        completedItems += 1;
        const spent = item.actual_time_spent;
        const actualSpent = (spent !== undefined && spent !== null && parseFloat(spent) > 0.0) ? parseFloat(spent) : estMinutes;
        timeCompleted += actualSpent;

        const completedAtStr = item.completed_at;
        if (completedAtStr) {
          try {
            const compDateStr = getLocalDateStr(tzName, new Date(completedAtStr));
            completedDates.add(compDateStr);

            dailyCompletionCounts[compDateStr] = (dailyCompletionCounts[compDateStr] || 0) + 1;

            if (timeByDay7[compDateStr] !== undefined) {
              timeByDay7[compDateStr] += actualSpent;
              completionsByDay7[compDateStr] += 1;
            }

            if (timeByDay30[compDateStr] !== undefined) {
              timeByDay30[compDateStr] += actualSpent;
              completionsByDay30[compDateStr] += 1;
            }
          } catch {
            // ignore
          }
        }
      } else if (status === 'unread' || status === 'reading') {
        const progress = item.read_progress || 0;
        const itemRemaining = estMinutes * (1.0 - (progress / 100.0));
        remainingTime += itemRemaining;
      }
    }

    // 3. Synchronize and fetch streaks from GamificationService to ensure perfect sync
    await GamificationService.syncStreakData(userId, supabaseClient);
    const gamification = await GamificationService.getOrInit(userId);
    const currentReadingStreak = gamification.current_streak || 0;
    const longestStreak = gamification.longest_streak || 0;

    // Load all dates from the calendar database to build completion footprint chart
    const calendarDates = await GamificationService.getCalendar(userId);
    for (const dStr of calendarDates) {
      try {
        completedDates.add(dStr);
        if (!dailyCompletionCounts[dStr]) {
          dailyCompletionCounts[dStr] = 0;
        }
      } catch {
        // ignore
      }
    }

    const completionPercentage = totalItems > 0 ? (completedItems / totalItems) * 100 : 0.0;
    const averageReadingTimeItem = totalItems > 0 ? totalReadingTime / totalItems : 0.0;

    // 4. Productivity Score (0-100)
    let goalMetDays = 0;
    last7DaysDates.forEach(d => {
      if (timeByDay7[d] >= dailyGoal) {
        goalMetDays++;
      }
    });

    const goalScore = (goalMetDays / 7.0) * 100;
    const streakScore = Math.min(100.0, (currentReadingStreak / 7.0) * 100.0);

    let productivityScore = Math.round(
      (completionPercentage * 0.40) +
      (goalScore * 0.40) +
      (streakScore * 0.20)
    );
    productivityScore = Math.min(100, Math.max(0, productivityScore));

    // 5. Format Breakdown Lists
    const last7DaysList = last7DaysDates.map(d => ({
      date: d,
      completed_count: completionsByDay7[d],
      reading_minutes: parseFloat(timeByDay7[d].toFixed(1)),
    }));

    const last30DaysList = last30DaysDates.map(d => ({
      date: d,
      completed_count: completionsByDay30[d],
      reading_minutes: parseFloat(timeByDay30[d].toFixed(1)),
    }));

    const weeklyReadingMinutes = parseFloat(
      Object.values(timeByDay7).reduce((a, b) => a + b, 0).toFixed(1)
    );
    const monthlyReadingMinutes = parseFloat(
      Object.values(timeByDay30).reduce((a, b) => a + b, 0).toFixed(1)
    );

    const dailyActivity = Object.keys(dailyCompletionCounts)
      .sort()
      .map(k => ({
        date: k,
        count: dailyCompletionCounts[k],
      }));

    return {
      total_items: totalItems,
      completed_items: completedItems,
      completion_percentage: parseFloat(completionPercentage.toFixed(1)),
      total_reading_time: parseFloat(totalReadingTime.toFixed(1)),
      time_completed: parseFloat(timeCompleted.toFixed(1)),
      remaining_time: parseFloat(remainingTime.toFixed(1)),
      average_reading_time_item: parseFloat(averageReadingTimeItem.toFixed(1)),
      current_reading_streak: currentReadingStreak,
      longest_streak: longestStreak,
      productivity_score: productivityScore,
      last_7_days: last7DaysList,
      last_30_days: last30DaysList,
      weekly_reading_minutes: weeklyReadingMinutes,
      monthly_reading_minutes: monthlyReadingMinutes,
      daily_completion_counts: dailyCompletionCounts,
      daily_activity: dailyActivity,
    };
  }
}
