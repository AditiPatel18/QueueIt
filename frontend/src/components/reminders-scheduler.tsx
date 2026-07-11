"use client";

import { useEffect } from "react";
import { useReminders } from "@/hooks/use-swr-queries";
import { deliverReminder, openReminder } from "@/lib/api";

interface RemindersSchedulerProps {
  browserNotificationsEnabled: boolean;
  frequency: "daily" | "weekdays" | "weekly" | "custom";
}

export function RemindersScheduler({ browserNotificationsEnabled, frequency }: RemindersSchedulerProps) {
  const { reminders } = useReminders();

  // Request browser notification permission if reminders are enabled and browser notifications are toggled on
  useEffect(() => {
    if (reminders?.settings?.enabled && browserNotificationsEnabled && typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, [reminders?.settings?.enabled, browserNotificationsEnabled]);

  // Check saved reminder time and trigger browser notifications
  useEffect(() => {
    if (!reminders?.settings?.enabled || !browserNotificationsEnabled) return;

    let lastNotifiedDateStr = "";

    const interval = setInterval(() => {
      const now = new Date();

      // Check frequency constraints
      const dayOfWeek = now.getDay(); // 0 is Sunday, 6 is Saturday
      
      if (frequency === "weekdays" && (dayOfWeek === 0 || dayOfWeek === 6)) {
        return; // Skip weekends
      }
      if (frequency === "weekly" && dayOfWeek !== 0) {
        return; // Skip non-Sundays (Weekly triggers on Sunday)
      }
      if (frequency === "custom" && reminders?.settings?.custom_days) {
        const daysMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const weekdayStr = daysMap[dayOfWeek];
        const customDays = reminders.settings.custom_days;
        if (!customDays.includes(weekdayStr)) {
          return; // Skip if today is not in custom days selection
        }
      }

      const timeStr = reminders.settings.reminder_time;
      if (!timeStr) return;

      const [hour, minute] = timeStr.split(":").map(Number);
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      if (currentHour === hour && currentMinute === minute) {
        const currentDateStr = now.toDateString();
        if (lastNotifiedDateStr === currentDateStr) return;

        // Check if reminders are currently snoozed
        if (reminders.settings.snoozed_until) {
          const snoozed = new Date(reminders.settings.snoozed_until);
          if (now < snoozed) return;
        }

        lastNotifiedDateStr = currentDateStr;

        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          // Deduplicate active list in scheduler as well to fetch clean titles
          const activeListRaw = reminders.active_reminders || [];
          const uniqueActive = activeListRaw.filter((rem, index, self) =>
            self.findIndex(r => (r.item_id && r.item_id === rem.item_id) || r.title === rem.title) === index
          );

          const reminderRecord = uniqueActive[0];
          const activeTitle = reminderRecord?.title || "Time to read your high priority unread items!";
          
          // Log delivered state to backend if reminder exists
          if (reminderRecord) {
            deliverReminder(reminderRecord.id).catch(console.error);
          }

          const notification = new Notification("QueueIt Reading Reminder", {
            body: activeTitle.replace("Time to read: ", ""),
            icon: "/favicon.ico"
          });

          notification.onclick = () => {
            // Log opened state to backend if reminder exists
            if (reminderRecord) {
              openReminder(reminderRecord.id).catch(console.error);
            }
            window.focus();
            window.location.href = "/dashboard";
          };
        }
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [reminders, browserNotificationsEnabled, frequency]);

  return null;
}
