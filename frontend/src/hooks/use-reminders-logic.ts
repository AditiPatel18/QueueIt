"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR, { mutate } from "swr";
import { 
  getReminders,
  updateReminderSettings, 
  snoozeReminder, 
  completeReminder, 
  readReminder,
  useStreakFreeze
} from "@/lib/api";
import { toast } from "sonner";

export function useRemindersLogic(isOpen: boolean = false, activeTab: string = "reminders") {
  // Fetch alerts & settings only when popover is open (lazy-loaded on bell click)
  const shouldFetchAlerts = true;

  // 1. Fetch alerts & settings (include_history=false, include_settings=true, include_gamification=false)
  const { data: alertsData, mutate: mutateAlerts } = useSWR(
    ["api/reminders", false, true, false],
    () => getReminders(false, true, false),
    {
      revalidateOnFocus: true,
      refreshInterval: 10000,
      dedupingInterval: 5000,
    }
  );

  // 2. Fetch history (include_history=true, include_settings=false, include_gamification=false)
  const shouldFetchHistory = isOpen && activeTab === "history";
  const { data: historyData, mutate: mutateHistory } = useSWR(
    shouldFetchHistory ? ["api/reminders", true, false, false] : null,
    () => getReminders(true, false, false),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  // 3. Fetch gamification (include_history=false, include_settings=false, include_gamification=true)
  const shouldFetchGamification = isOpen && activeTab === "gamification";
  const { data: gamificationData, mutate: mutateGamification } = useSWR(
    shouldFetchGamification ? ["api/reminders", false, false, true] : null,
    () => getReminders(false, false, true),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  // Combine split SWR cache parts into a single reminders structure
  const reminders = {
    settings: alertsData?.settings || historyData?.settings || gamificationData?.settings || { 
      enabled: true, 
      reminder_time: "09:00", 
      snoozed_until: null, 
      last_reminded_at: null,
      frequency: "daily" as const,
      custom_days: "",
      timezone: "UTC",
      browser_notifications: true,
      email_reminders: true
    },
    active_reminders: alertsData?.active_reminders || [],
    unread_count: alertsData?.unread_count ?? 0,
    history: historyData?.history || [],
    gamification: gamificationData?.gamification || {
      xp: 0,
      level: 1,
      xp_needed: 200,
      streak_freezes_available: 0,
      last_freeze_used_at: null,
      daily_goal: 15,
      current_streak: 0,
      longest_streak: 0,
      calendar: [],
      badges: []
    }
  };

  const mutateReminders = useCallback(() => {
    mutateAlerts();
    if (shouldFetchHistory) mutateHistory();
    if (shouldFetchGamification) mutateGamification();
  }, [mutateAlerts, mutateHistory, mutateGamification, shouldFetchHistory, shouldFetchGamification]);

  // Local states for settings form
  const [enabled, setEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [frequency, setFrequency] = useState<"daily" | "weekdays" | "weekly" | "custom">("daily");
  const [customDays, setCustomDays] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(true);
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Sync settings local states when SWR cache updates
  useEffect(() => {
    if (reminders.settings) {
      setEnabled(reminders.settings.enabled);
      setReminderTime(reminders.settings.reminder_time);
      setFrequency(reminders.settings.frequency || "daily");
      setCustomDays(reminders.settings.custom_days || "");
      setTimezone(reminders.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      setBrowserNotificationsEnabled(reminders.settings.browser_notifications !== false);
      setEmailRemindersEnabled(reminders.settings.email_reminders !== false);
    }
  }, [alertsData?.settings, historyData?.settings, gamificationData?.settings]);

  const handleSnooze = useCallback(async (reminderId: string, snoozeType: "1h" | "today" | "tomorrow") => {
    try {
      await snoozeReminder(reminderId, snoozeType);
      toast.success(`Reminder snoozed (${snoozeType})`);
      mutateReminders();
    } catch (err) {
      toast.error("Failed to snooze reminder");
    }
  }, [mutateReminders]);

  const handleComplete = useCallback(async (reminderId: string) => {
    try {
      await completeReminder(reminderId);
      toast.success("Item marked completed!");
      mutateReminders();
      mutate("api/items/user/streak");
      mutate("api/items/user/streak-heatmap");
      mutate("api/items/analytics/reading");
    } catch (err) {
      toast.error("Failed to mark completed");
    }
  }, [mutateReminders]);

  const handleDismiss = useCallback(async (reminderId: string) => {
    try {
      await readReminder(reminderId);
      mutateReminders();
    } catch (err) {
      console.error(err);
    }
  }, [mutateReminders]);

  const handleSaveSettings = useCallback(async () => {
    try {
      setIsSavingSettings(true);
      await updateReminderSettings(
        enabled, 
        reminderTime, 
        frequency, 
        customDays, 
        timezone, 
        browserNotificationsEnabled, 
        emailRemindersEnabled
      );

      toast.success("Reminder settings updated");
      mutateReminders();
    } catch (err) {
      toast.error("Failed to save settings");
      throw err;
    } finally {
      setIsSavingSettings(false);
    }
  }, [enabled, reminderTime, frequency, customDays, timezone, browserNotificationsEnabled, emailRemindersEnabled, mutateReminders]);

  const handleUseFreeze = useCallback(async () => {
    try {
      await useStreakFreeze();
      toast.success("Streak freeze activated!");
      mutateReminders();
      mutate("api/items/user/streak-heatmap");
    } catch (err) {
      toast.error("Failed to activate streak freeze");
    }
  }, [mutateReminders]);

  const rawActiveList = reminders.active_reminders || [];
  const activeList = rawActiveList.filter((rem, index, self) =>
    self.findIndex(r => (r.item_id && r.item_id === rem.item_id) || r.title === rem.title) === index
  );

  const rawHistoryList = reminders.history || [];
  const historyList = rawHistoryList.filter((rem, index, self) =>
    self.findIndex(r => (r.item_id && r.item_id === rem.item_id) || r.title === rem.title) === index
  );

  const unreadCount = activeList.length;
  const settings = reminders.settings;
  const gamification = reminders.gamification;

  return {
    reminders,
    unreadCount,
    activeList,
    historyList,
    settings,
    enabled,
    setEnabled,
    reminderTime,
    setReminderTime,
    frequency,
    setFrequency,
    customDays,
    setCustomDays,
    timezone,
    setTimezone,
    browserNotificationsEnabled,
    setBrowserNotificationsEnabled,
    emailRemindersEnabled,
    setEmailRemindersEnabled,
    isSavingSettings,
    handleSnooze,
    handleComplete,
    handleDismiss,
    handleSaveSettings,
    handleUseFreeze,
    mutateReminders,
    gamification
  };
}
