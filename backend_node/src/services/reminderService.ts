import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { openDb, dbRun, dbGet, dbAll, fallbackDb } from '../utils/schemaFallback';
import { getLocalDateStr, GamificationService } from './gamificationService';
import { supabase } from '../config/supabase';

export interface ReminderSettings {
  user_id: string;
  enabled: boolean;
  reminder_time: string;
  snoozed_until: string | null;
  last_reminded_at: string | null;
  frequency: string;
  custom_days: string;
  timezone: string;
  browser_notifications: boolean;
  email_reminders: boolean;
  sms_reminders: boolean;
  phone_number: string;
  email_address: string;
  last_sent_date: string | null;
}

export class ReminderService {
  /**
   * Resolve user's registered email address via Supabase Auth Admin API if missing locally.
   */
  static async resolveUserEmail(userId: string, defaultEmail?: string): Promise<string> {
    if (defaultEmail && defaultEmail.includes('@')) {
      return defaultEmail.trim();
    }
    if (userId && userId.includes('@')) {
      return userId.trim();
    }
    try {
      const { data } = await supabase.auth.admin.getUserById(userId);
      if (data?.user?.email) {
        return data.user.email.trim();
      }
    } catch (err) {
      console.warn(`[ReminderService] Could not resolve email via Supabase Auth for user ${userId}:`, err);
    }
    return '';
  }

  /**
   * Fetch or initialize local reminder settings for a user.
   */
  static async getSettings(userId: string, defaultEmail?: string): Promise<ReminderSettings> {
    const db = openDb();
    try {
      let resolvedEmail = defaultEmail || '';
      const row = await dbGet<any>(db, 'SELECT * FROM local_reminder_settings WHERE user_id = ?', [userId]);

      if (row) {
        let currentEmail = row.email_address || '';
        if (!currentEmail || !currentEmail.includes('@')) {
          currentEmail = await this.resolveUserEmail(userId, defaultEmail);
          if (currentEmail) {
            await dbRun(db, 'UPDATE local_reminder_settings SET email_address = ? WHERE user_id = ?', [currentEmail, userId]);
          }
        }

        return {
          user_id: row.user_id,
          enabled: row.enabled === 1,
          reminder_time: row.reminder_time || '09:00',
          snoozed_until: row.snoozed_until || null,
          last_reminded_at: row.last_reminded_at || null,
          frequency: row.frequency || 'daily',
          custom_days: row.custom_days || '',
          timezone: row.timezone || 'UTC',
          browser_notifications: row.browser_notifications === 1,
          email_reminders: row.email_reminders === 1,
          sms_reminders: row.sms_reminders === 1,
          phone_number: row.phone_number || '',
          email_address: currentEmail,
          last_sent_date: row.last_sent_date || null,
        };
      }

      // Default settings
      resolvedEmail = await this.resolveUserEmail(userId, defaultEmail);
      const defaultSettings: ReminderSettings = {
        user_id: userId,
        enabled: true,
        reminder_time: '09:00',
        snoozed_until: null,
        last_reminded_at: null,
        frequency: 'daily',
        custom_days: '',
        timezone: 'UTC',
        browser_notifications: true,
        email_reminders: true,
        sms_reminders: false,
        phone_number: '',
        email_address: resolvedEmail,
        last_sent_date: null,
      };

      await dbRun(
        db,
        `INSERT INTO local_reminder_settings 
         (user_id, enabled, reminder_time, snoozed_until, last_reminded_at, frequency, custom_days, timezone, browser_notifications, email_reminders, sms_reminders, phone_number, email_address, last_sent_date) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          defaultSettings.enabled ? 1 : 0,
          defaultSettings.reminder_time,
          defaultSettings.snoozed_until,
          defaultSettings.last_reminded_at,
          defaultSettings.frequency,
          defaultSettings.custom_days,
          defaultSettings.timezone,
          defaultSettings.browser_notifications ? 1 : 0,
          defaultSettings.email_reminders ? 1 : 0,
          defaultSettings.sms_reminders ? 1 : 0,
          defaultSettings.phone_number,
          defaultSettings.email_address,
          defaultSettings.last_sent_date,
        ]
      );
      return defaultSettings;
    } catch (err) {
      console.error('[ReminderService] Error fetching settings:', err);
      return {
        user_id: userId,
        enabled: true,
        reminder_time: '09:00',
        snoozed_until: null,
        last_reminded_at: null,
        frequency: 'daily',
        custom_days: '',
        timezone: 'UTC',
        browser_notifications: true,
        email_reminders: true,
        sms_reminders: false,
        phone_number: '',
        email_address: defaultEmail || '',
        last_sent_date: null,
      };
    } finally {
      db.close();
    }
  }

  /**
   * Update enabling state, timezone, frequency and custom configuration for reminders.
   */
  static async updateSettings(
    userId: string,
    enabled: boolean,
    reminderTime: string,
    frequency: string = 'daily',
    customDays: string = '',
    timezone: string = 'UTC',
    browserNotifications: boolean = true,
    emailReminders: boolean = true,
    smsReminders: boolean = false,
    phoneNumber: string = '',
    emailAddress: string = ''
  ): Promise<Partial<ReminderSettings>> {
    const db = openDb();
    try {
      let rTime = reminderTime;
      if (!rTime || !rTime.includes(':')) {
        rTime = '09:00';
      }

      let finalEmail = emailAddress;
      if (!finalEmail || !finalEmail.includes('@')) {
        finalEmail = await this.resolveUserEmail(userId);
      }

      const enabledVal = enabled ? 1 : 0;
      const browserVal = browserNotifications ? 1 : 0;
      const emailVal = emailReminders ? 1 : 0;
      const smsVal = smsReminders ? 1 : 0;

      const existing = await dbGet<any>(db, 'SELECT 1 FROM local_reminder_settings WHERE user_id = ?', [userId]);
      if (existing) {
        await dbRun(
          db,
          `UPDATE local_reminder_settings 
           SET enabled = ?, reminder_time = ?, frequency = ?, custom_days = ?, timezone = ?, browser_notifications = ?, email_reminders = ?, sms_reminders = ?, phone_number = ?, email_address = ? 
           WHERE user_id = ?`,
          [enabledVal, rTime, frequency, customDays, timezone, browserVal, emailVal, smsVal, phoneNumber, finalEmail, userId]
        );
      } else {
        await dbRun(
          db,
          `INSERT INTO local_reminder_settings 
           (user_id, enabled, reminder_time, frequency, custom_days, timezone, browser_notifications, email_reminders, sms_reminders, phone_number, email_address) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, enabledVal, rTime, frequency, customDays, timezone, browserVal, emailVal, smsVal, phoneNumber, finalEmail]
        );
      }

      return {
        user_id: userId,
        enabled,
        reminder_time: rTime,
        frequency,
        custom_days: customDays,
        timezone,
        browser_notifications: browserNotifications,
        email_reminders: emailReminders,
        sms_reminders: smsReminders,
        phone_number: phoneNumber,
        email_address: finalEmail,
      };
    } catch (err) {
      console.error('[ReminderService] Error updating settings:', err);
      throw err;
    } finally {
      db.close();
    }
  }

  /**
   * Fetch all reminders with active status (unresolved reminders).
   */
  static async getActiveReminders(userId: string): Promise<any[]> {
    const db = openDb();
    try {
      const rows = await dbAll<any>(
        db,
        `SELECT * FROM local_reminder_history 
         WHERE user_id = ? 
           AND status IN ('pending', 'failed', 'sent', 'delivered', 'opened', 'processing') 
         ORDER BY sent_at DESC`,
        [userId]
      );

      const itemIds = rows.map(r => r.item_id).filter(Boolean);
      const itemsById: Record<string, any> = {};
      if (itemIds.length > 0) {
        try {
          const selCols = ['id', 'title', 'priority_score', 'estimated_read_time'];
          if (fallbackDb.has_estimated_time_minutes) {
            selCols.push('estimated_time_minutes');
          }
          const itemRes = await supabase.from('items').select(selCols.join(',')).in('id', itemIds);
          if (itemRes.data) {
            const merged = await fallbackDb.mergeItemsMetadata(userId, itemRes.data);
            for (const it of merged) {
              itemsById[it.id] = it;
            }
          }
        } catch (ex) {
          console.error('[ReminderService] Error batch fetching items in active reminders:', ex);
        }
      }

      const res = [];
      for (const row of rows) {
        const r = { ...row };
        const item = itemsById[r.item_id];
        if (item) {
          r.title = item.title || r.title;
          const pScore = item.priority_score || 50.0;
          if (pScore >= 75) {
            r.priority = 'High';
          } else if (pScore >= 40) {
            r.priority = 'Medium';
          } else {
            r.priority = 'Normal';
          }

          let estMin = item.estimated_time_minutes;
          if (estMin === undefined || estMin === null) {
            const estSec = item.estimated_read_time || 300;
            estMin = parseFloat(estSec) / 60.0;
          }
          r.estimated_read_time = `${parseFloat(estMin).toFixed(1)} min`;
        } else {
          let titleClean = r.title;
          if (titleClean.startsWith("Time to read: '") && titleClean.endsWith("' (High priority)")) {
            titleClean = titleClean.substring("Time to read: '".length, titleClean.length - "' (High priority)".length);
          } else if (titleClean.startsWith("Time to read: '") && titleClean.endsWith("'")) {
            titleClean = titleClean.substring("Time to read: '".length, titleClean.length - 1);
          }
          r.title = titleClean;
          r.priority = 'Normal';
          r.estimated_read_time = '5.0 min';
        }

        if (r.status === 'failed') {
          r.error_message = 'Unable to send email reminder.';
        }

        r.reminder_item_id = r.item_id;
        res.push(r);
      }

      return res;
    } catch (err) {
      console.error('[ReminderService] Error fetching active reminders:', err);
      return [];
    } finally {
      db.close();
    }
  }

  /**
   * Get badge count of unresolved reminders.
   */
  static async getUnreadCount(userId: string): Promise<number> {
    const db = openDb();
    try {
      const val = await dbGet<{ count: number }>(
        db,
        `SELECT COUNT(1) as count FROM local_reminder_history 
         WHERE user_id = ? 
           AND status IN ('pending', 'failed', 'sent', 'delivered', 'opened', 'processing')`,
        [userId]
      );
      return val?.count || 0;
    } catch (err) {
      console.error('[ReminderService] Error fetching unread count:', err);
      return 0;
    } finally {
      db.close();
    }
  }

  /**
   * Retrieve recent reminder logs history.
   */
  static async getHistory(userId: string, limit: number = 30): Promise<any[]> {
    const db = openDb();
    try {
      const rows = await dbAll<any>(
        db,
        `SELECT * FROM local_reminder_history 
         WHERE user_id = ? 
           AND status IN ('completed', 'snoozed', 'read', 'dismissed', 'failed') 
         ORDER BY sent_at DESC 
         LIMIT ?`,
        [userId, limit]
      );

      const itemIds = rows.map(r => r.item_id).filter(Boolean);
      const itemsById: Record<string, any> = {};
      if (itemIds.length > 0) {
        try {
          const itemRes = await supabase.from('items').select('id, title').in('id', itemIds);
          if (itemRes.data) {
            for (const it of itemRes.data) {
              itemsById[it.id] = it;
            }
          }
        } catch { /* ignore */ }
      }

      const res = [];
      for (const row of rows) {
        const r = { ...row };
        const item = itemsById[r.item_id];
        if (item && item.title) {
          r.title = item.title;
        } else {
          let titleClean = r.title;
          if (titleClean.startsWith("Time to read: '") && titleClean.endsWith("' (High priority)")) {
            titleClean = titleClean.substring("Time to read: '".length, titleClean.length - "' (High priority)".length);
          } else if (titleClean.startsWith("Time to read: '") && titleClean.endsWith("'")) {
            titleClean = titleClean.substring("Time to read: '".length, titleClean.length - 1);
          }
          r.title = titleClean;
        }
        r.reminder_item_id = r.item_id;
        res.push(r);
      }

      return res;
    } catch (err) {
      console.error('[ReminderService] Error fetching reminder history:', err);
      return [];
    } finally {
      db.close();
    }
  }

  /**
   * Snooze a reminder.
   */
  static async snoozeReminder(userId: string, reminderId: string, snoozeType: string = '1h'): Promise<any> {
    const db = openDb();
    try {
      const now = new Date();
      let snoozedUntil = new Date();

      if (snoozeType === '1h') {
        snoozedUntil = new Date(now.getTime() + 60 * 60 * 1000);
      } else if (snoozeType === 'today') {
        snoozedUntil = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      } else if (snoozeType === 'tomorrow') {
        snoozedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      } else {
        snoozedUntil = new Date(now.getTime() + 60 * 60 * 1000);
      }

      const snoozedIso = snoozedUntil.toISOString();

      await dbRun(
        db,
        'UPDATE local_reminder_settings SET snoozed_until = ? WHERE user_id = ?',
        [snoozedIso, userId]
      );

      await dbRun(
        db,
        "UPDATE local_reminder_history SET status = 'snoozed' WHERE id = ? AND user_id = ?",
        [reminderId, userId]
      );

      return {
        status: 'snoozed',
        reminder_id: reminderId,
        snooze_type: snoozeType,
        snoozed_until: snoozedIso,
      };
    } catch (err) {
      console.error('[ReminderService] Error snoozing reminder:', err);
      throw err;
    } finally {
      db.close();
    }
  }

  /**
   * Mark reminder as read / dismissed.
   */
  static async readReminder(userId: string, reminderId: string): Promise<boolean> {
    const db = openDb();
    try {
      await dbRun(
        db,
        "UPDATE local_reminder_history SET status = 'read' WHERE id = ? AND user_id = ?",
        [reminderId, userId]
      );
      return true;
    } catch (err) {
      console.error('[ReminderService] Error marking reminder read:', err);
      return false;
    } finally {
      db.close();
    }
  }

  /**
   * Mark reminder as delivered.
   */
  static async deliverReminder(userId: string, reminderId: string): Promise<boolean> {
    const db = openDb();
    try {
      await dbRun(
        db,
        "UPDATE local_reminder_history SET status = 'delivered' WHERE id = ? AND user_id = ?",
        [reminderId, userId]
      );
      return true;
    } catch (err) {
      console.error('[ReminderService] Error marking reminder delivered:', err);
      return false;
    } finally {
      db.close();
    }
  }

  /**
   * Mark reminder as opened / clicked.
   */
  static async openReminder(userId: string, reminderId: string): Promise<boolean> {
    const db = openDb();
    try {
      await dbRun(
        db,
        "UPDATE local_reminder_history SET status = 'opened' WHERE id = ? AND user_id = ?",
        [reminderId, userId]
      );
      return true;
    } catch (err) {
      console.error('[ReminderService] Error marking reminder opened:', err);
      return false;
    } finally {
      db.close();
    }
  }

  /**
   * Mark reminder as completed & complete item, updating streak.
   */
  static async completeReminder(userId: string, reminderId: string, supabaseClient: any): Promise<any> {
    const db = openDb();
    try {
      const remRow = await dbGet<any>(
        db,
        'SELECT * FROM local_reminder_history WHERE id = ? AND user_id = ?',
        [reminderId, userId]
      );

      if (!remRow) {
        throw new Error('Reminder not found');
      }

      const itemId = remRow.item_id;
      let minutesSpent = 5.0;

      if (itemId) {
        try {
          const itemRes = await supabaseClient.from('items').select('estimated_read_time').eq('id', itemId).maybeSingle();
          if (itemRes.data && itemRes.data.estimated_read_time) {
            minutesSpent = parseFloat(itemRes.data.estimated_read_time) / 60.0;
          }
        } catch { /* ignore */ }

        const nowIso = new Date().toISOString();
        await supabaseClient
          .from('items')
          .update({
            status: 'completed',
            completed_at: nowIso,
          })
          .eq('id', itemId)
          .eq('user_id', userId);
      }

      const completedTime = new Date().toISOString();
      await dbRun(
        db,
        "UPDATE local_reminder_history SET status = 'completed', completed_at = ? WHERE id = ? AND user_id = ?",
        [completedTime, reminderId, userId]
      );

      // Award XP, updates streak, registers activity calendar
      try {
        await GamificationService.recordActivity(userId, minutesSpent, true);
      } catch (ex) {
        console.error('[ReminderService] Gamification credit error:', ex);
      }

      return { status: 'completed', reminder_id: reminderId, completed_at: completedTime };
    } catch (err) {
      console.error('[ReminderService] Error completing reminder:', err);
      throw err;
    } finally {
      db.close();
    }
  }

  /**
   * Checks if user is due for reminder and generates reminder.
   */
  static async checkAndGenerateReminder(userId: string, supabaseClient: any, forceTimeCheck: boolean = false): Promise<any> {
    const settings = await this.getSettings(userId);

    const tzName = settings.timezone || 'UTC';
    const now = new Date();

    const localTimeStr = now.toLocaleTimeString('en-US', { timeZone: tzName, hour12: false });
    const [localHour, localMin] = localTimeStr.split(':').map(Number);

    const todayDateStr = getLocalDateStr(tzName, now);

    const timeStr = settings.reminder_time || '09:00';
    const emailEnabled = !!settings.email_reminders;
    const lastSentDate = settings.last_sent_date;
    const reminderEnabled = !!settings.enabled;

    let hour = 9;
    let minute = 0;
    try {
      const parts = timeStr.split(':').map(Number);
      if (parts.length === 2) {
        hour = parts[0];
        minute = parts[1];
      }
    } catch {
      // ignore
    }

    const localDateTimeValue = localHour * 60 + localMin;
    const scheduledDateTimeValue = hour * 60 + minute;

    const alreadySentToday = (lastSentDate === todayDateStr);
    const timeDue = forceTimeCheck || (localDateTimeValue >= scheduledDateTimeValue);
    const reminderDue = reminderEnabled && emailEnabled && timeDue && !alreadySentToday;

    console.log(
      `[Scheduler] Reminder check — user_id=${userId} | timezone=${tzName} | current_time=${localHour}:${localMin} | reminder_time=${timeStr} | email_enabled=${emailEnabled} | reminder_enabled=${reminderEnabled} | last_sent_date=${lastSentDate} | today=${todayDateStr} | already_sent_today=${alreadySentToday} | time_due=${timeDue} | reminder_due=${reminderDue}`
    );

    if (!reminderEnabled) {
      console.log(`[Scheduler] User ${userId}: reminders disabled — skipping`);
      return null;
    }

    if (settings.snoozed_until) {
      try {
        const snoozed = new Date(settings.snoozed_until);
        if (now < snoozed) {
          console.log(`[Scheduler] User ${userId}: snoozed until ${snoozed.toISOString()} — skipping`);
          return null;
        }
      } catch {
        // ignore
      }
    }

    const frequency = settings.frequency || 'daily';
    const dayName = now.toLocaleDateString('en-US', { timeZone: tzName, weekday: 'short' });
    const weekdayMap: Record<string, number> = { 'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6 };
    const weekday = weekdayMap[dayName] !== undefined ? weekdayMap[dayName] : 0;

    if (frequency === 'weekdays' && weekday >= 5) {
      console.log(`[Scheduler] User ${userId}: frequency=weekdays but today is weekend — skipping`);
      return null;
    } else if (frequency === 'weekly' && weekday !== 6) {
      console.log(`[Scheduler] User ${userId}: frequency=weekly but today is not Sunday — skipping`);
      return null;
    } else if (frequency === 'custom') {
      const customDays = settings.custom_days || '';
      if (!customDays.includes(dayName)) {
        console.log(`[Scheduler] User ${userId}: custom day ${dayName} not in ${customDays} — skipping`);
        return null;
      }
    }

    if (!timeDue) {
      console.log(`[Scheduler] User ${userId}: not yet due`);
      return null;
    }

    if (alreadySentToday && !forceTimeCheck) {
      console.log(`[Scheduler] User ${userId}: already sent reminder today (${todayDateStr}) — skipping`);
      return null;
    }

    // Find highest priority unread/reading item to suggest
    let topItem: any = null;
    try {
      const selectCols = ['id', 'title', 'url', 'status', 'priority_score'];
      const res = await supabaseClient.from('items').select(selectCols.join(',')).eq('user_id', userId).in('status', ['unread', 'reading']);
      let items = res.data || [];
      items = await fallbackDb.mergeItemsMetadata(userId, items);
      const activeItems = items.filter((i: any) => i.status === 'unread' || i.status === 'reading');

      if (activeItems.length === 0) {
        console.log(`No unread/reading items found for user ${userId}. Skipping reminder generation.`);
        return null;
      }

      activeItems.sort((a: any, b: any) => (b.priority_score || 50.0) - (a.priority_score || 50.0));
      topItem = activeItems[0];
    } catch (err) {
      console.error('[ReminderService] Error fetching unread items for reminders:', err);
      return null;
    }

    // Generate reminder
    const reminderId = uuidv4();
    const sentTime = new Date().toISOString();
    const itemTitle = topItem.title || 'an item from your queue';

    const dbSave = openDb();
    try {
      if (topItem.id && !forceTimeCheck) {
        // Duplicate guard: only block if an active/sent reminder for this item already exists TODAY
        const duplicate = await dbGet<any>(
          dbSave,
          `SELECT 1 FROM local_reminder_history 
           WHERE user_id = ? AND item_id = ? 
             AND status IN ('pending', 'processing', 'sent', 'delivered', 'opened') 
             AND date(sent_at) = date('now')`,
          [userId, topItem.id]
        );
        if (duplicate) {
          console.log(`[Scheduler] Duplicate active reminder exists for item ${topItem.id} today — skipping.`);
          return null;
        }
      }

      const reminderStatus = 'pending';

      await dbRun(
        dbSave,
        `INSERT INTO local_reminder_history 
         (id, user_id, item_id, title, scheduled_time, sent_at, status, channel) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reminderId,
          userId,
          topItem.id,
          `Time to read: '${itemTitle}' (High priority)`,
          timeStr,
          sentTime,
          reminderStatus,
          'in_app',
        ]
      );

      await dbRun(
        dbSave,
        'UPDATE local_reminder_settings SET last_reminded_at = ?, last_sent_date = ? WHERE user_id = ?',
        [sentTime, todayDateStr, userId]
      );

      return {
        id: reminderId,
        user_id: userId,
        item_id: topItem.id,
        reminder_item_id: topItem.id,
        title: `Time to read: '${itemTitle}' (High priority)`,
        sent_at: sentTime,
        status: reminderStatus,
      };
    } catch (err) {
      console.error('[ReminderService] Error generating reminder:', err);
      return null;
    } finally {
      dbSave.close();
    }
  }
}
