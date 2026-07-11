"use client";

import React, { useState, useCallback } from "react";
import { 
  Bell, 
  Clock, 
  Check, 
  Settings, 
  History, 
  CheckCircle2, 
  X, 
  ToggleLeft, 
  ToggleRight,
  Sparkles,
  Inbox,
  Loader2,
  Trophy,
  Flame,
  Zap,
  Award,
  Globe,
  Mail,
  Shield,
  XCircle
} from "lucide-react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useRemindersLogic } from "@/hooks/use-reminders-logic";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RemindersScheduler } from "./reminders-scheduler";

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Australia/Sydney"
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Memoized ReminderPanelContent to isolate state updates and prevent dashboard lag from triggering popover re-renders
interface ReminderPanelContentProps {
  activeTab: "reminders" | "history" | "gamification" | "settings";
  setActiveTab: (tab: "reminders" | "history" | "gamification" | "settings") => void;
  activeList: any[];
  historyList: any[];
  enabled: boolean;
  setEnabled: (val: boolean) => void;
  reminderTime: string;
  setReminderTime: (val: string) => void;
  frequency: "daily" | "weekdays" | "weekly" | "custom";
  setFrequency: (val: "daily" | "weekdays" | "weekly" | "custom") => void;
  customDays: string;
  handleToggleDay: (day: string) => void;
  timezone: string;
  setTimezone: (val: string) => void;
  browserNotificationsEnabled: boolean;
  setBrowserNotificationsEnabled: (val: boolean) => void;
  emailRemindersEnabled: boolean;
  setEmailRemindersEnabled: (val: boolean) => void;
  isSavingSettings: boolean;
  handleSnooze: (id: string, type: "1h" | "today" | "tomorrow") => Promise<void>;
  handleComplete: (id: string) => Promise<void>;
  handleDismiss: (id: string) => Promise<void>;
  handleSaveSettings: () => Promise<void>;
  handleUseFreeze: () => Promise<void>;
  gamification: any;
  xpPercent: number;
  last7Days: any[];
}

const ReminderPanelContent = React.memo(function ReminderPanelContent({
  activeTab,
  setActiveTab,
  activeList,
  historyList,
  enabled,
  setEnabled,
  reminderTime,
  setReminderTime,
  frequency,
  setFrequency,
  customDays,
  handleToggleDay,
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
  gamification,
  xpPercent,
  last7Days
}: ReminderPanelContentProps) {
  return (
    <div className="w-[340px] sm:w-[380px] max-w-[calc(100vw-24px)] max-h-[85vh] flex flex-col glass-strong border-border/25 shadow-2xl rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-3 duration-250 select-none">
      {/* Header */}
      <div className="p-4 border-b border-border/10 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary animate-pulse" />
            Smart Reminders
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Stay consistent with your queue</p>
        </div>
        <PopoverPrimitive.Close 
          className="p-1 rounded hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-colors cursor-pointer border-0 bg-transparent"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </PopoverPrimitive.Close>
      </div>

      {/* Navigation Tabs (4 Columns layout) */}
      <div className="flex border-b border-border/10 bg-secondary/20 p-1 gap-0.5">
        <button
          onClick={() => setActiveTab("reminders")}
          className={`flex-1 py-1.5 text-[9px] font-bold rounded-lg transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === "reminders" 
              ? "bg-background text-foreground shadow-sm" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bell className="h-3 w-3" />
          <span>Alerts</span>
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 py-1.5 text-[9px] font-bold rounded-lg transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === "history" 
              ? "bg-background text-foreground shadow-sm" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-3 w-3" />
          <span>History</span>
        </button>
        <button
          onClick={() => setActiveTab("gamification")}
          className={`flex-1 py-1.5 text-[9px] font-bold rounded-lg transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === "gamification" 
              ? "bg-background text-foreground shadow-sm" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Trophy className="h-3 w-3" />
          <span>Streaks</span>
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`flex-1 py-1.5 text-[9px] font-bold rounded-lg transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeTab === "settings" 
              ? "bg-background text-foreground shadow-sm" 
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Settings className="h-3 w-3" />
          <span>Settings</span>
        </button>
      </div>

      {/* Content with internal scrollbar constraints */}
      <div className="max-h-[min(420px,60vh)] overflow-y-auto p-3.5 scrollbar-none flex-1">
        
        {/* 1. Reminders Tab */}
        {activeTab === "reminders" && (
          <div className="space-y-3">
            {activeList.length > 0 ? (
              activeList.map((rem) => (
                <div 
                  key={rem.id} 
                  className="p-2.5 bg-secondary/35 rounded-xl border border-border/10 space-y-2 relative group"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="space-y-1 flex-1 min-w-0">
                      <p className="text-[11px] font-semibold leading-normal text-foreground break-words">
                        {rem.title}
                      </p>
                      <div className="flex items-center gap-1 text-[8px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5 shrink-0" />
                        <span>
                          Scheduled {frequency === "weekly" ? "weekly" : frequency === "weekdays" ? "on weekdays" : frequency === "custom" ? "custom weekdays" : "daily"} at {rem.scheduled_time}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDismiss(rem.id)}
                      className="text-[8px] text-muted-foreground hover:text-foreground shrink-0 border border-border/10 px-1.5 py-0.5 rounded bg-accent/20 cursor-pointer transition-colors"
                      title="Dismiss reminder"
                    >
                      Dismiss
                    </button>
                  </div>

                  {/* Complete & Snooze Actions - Equal-sized buttons */}
                  <div className="flex gap-2 pt-0.5 w-full">
                    <Button
                      onClick={() => handleComplete(rem.id)}
                      size="sm"
                      className="flex-1 text-[9px] h-6.5 bg-emerald-600 hover:bg-emerald-700 text-white border-0 cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Check className="h-3 w-3" />
                      Complete
                    </Button>

                    <div className="flex-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="w-full inline-flex items-center justify-center gap-1 rounded-md border border-border/20 bg-transparent text-[9px] font-medium h-6.5 hover:bg-accent/40 text-foreground cursor-pointer transition-colors focus:outline-none"
                        >
                          <Clock className="h-3 w-3" />
                          Snooze
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="glass border-border/30 w-32 z-50">
                          <DropdownMenuItem 
                            onClick={() => handleSnooze(rem.id, "1h")}
                            className="cursor-pointer text-[9px] py-1.5"
                          >
                            1 Hour
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleSnooze(rem.id, "today")}
                            className="cursor-pointer text-[9px] py-1.5"
                          >
                            Rest of Today
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleSnooze(rem.id, "tomorrow")}
                            className="cursor-pointer text-[9px] py-1.5"
                          >
                            Until Tomorrow
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center flex flex-col items-center justify-center space-y-3">
                <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                  <Inbox className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">All Caught Up!</p>
                  <p className="text-[10px] text-muted-foreground max-w-[220px]">
                    No active reading reminders. Complete items in your queue to trigger suggestions.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. History Tab */}
        {activeTab === "history" && (
          <div className="space-y-2.5">
            {historyList.length > 0 ? (
              historyList.map((rem) => {
                let statusLabel = rem.status.charAt(0).toUpperCase() + rem.status.slice(1);
                let badgeColor = "text-muted-foreground bg-accent/25 border-border/10";
                let Icon = Clock;

                if (rem.status === "completed") {
                  statusLabel = "Completed";
                  badgeColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                  Icon = CheckCircle2;
                } else if (rem.status === "snoozed") {
                  statusLabel = "Snoozed";
                  badgeColor = "text-orange-400 bg-orange-500/10 border-orange-500/20";
                  Icon = Clock;
                } else if (rem.status === "read") {
                  statusLabel = "Dismissed";
                  badgeColor = "text-rose-400 bg-rose-500/10 border-rose-500/20";
                  Icon = X;
                } else if (rem.status === "sent") {
                  statusLabel = "Sent";
                  badgeColor = "text-blue-400 bg-blue-500/10 border-blue-500/20";
                  Icon = Bell;
                } else if (rem.status === "delivered") {
                  statusLabel = "Delivered";
                  badgeColor = "text-indigo-400 bg-indigo-500/10 border-indigo-500/20";
                  Icon = Check;
                } else if (rem.status === "opened") {
                  statusLabel = "Opened";
                  badgeColor = "text-violet-400 bg-violet-500/10 border-violet-500/20";
                  Icon = Globe;
                } else if (rem.status === "failed") {
                  statusLabel = "Failed";
                  badgeColor = "text-red-400 bg-red-500/10 border-red-500/20";
                  Icon = XCircle;
                }

                const sentDateStr = new Date(rem.sent_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                });
                
                const completedDateStr = rem.completed_at ? new Date(rem.completed_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                }) : null;

                return (
                  <div key={rem.id} className="p-2.5 rounded-xl border border-border/10 bg-secondary/15 flex items-start gap-3 hover:bg-secondary/25 transition-colors">
                    <div className="mt-0.5 shrink-0">
                      <Icon className={`h-3.5 w-3.5 ${
                        rem.status === "completed" ? "text-emerald-500" : 
                        rem.status === "snoozed" ? "text-orange-400" : 
                        rem.status === "read" ? "text-rose-400" : 
                        rem.status === "delivered" ? "text-indigo-400" :
                        rem.status === "opened" ? "text-violet-400" :
                        rem.status === "failed" ? "text-red-500" :
                        "text-blue-400"
                      }`} />
                    </div>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <p className="text-[11px] leading-normal font-medium text-foreground break-words">
                        {rem.title}
                      </p>
                      <div className="flex justify-between items-center text-[8px] text-muted-foreground gap-2">
                        <span>
                          {rem.status === "completed" && completedDateStr 
                            ? `Completed: ${completedDateStr}` 
                            : rem.status === "snoozed"
                            ? `Snoozed: ${sentDateStr}`
                            : rem.status === "read"
                            ? `Dismissed: ${sentDateStr}`
                            : `Sent: ${sentDateStr}`}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded-full border ${badgeColor} font-semibold shrink-0`}>
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-center py-6 text-[10px] text-muted-foreground">No reminder history logged yet.</p>
            )}
          </div>
        )}

        {/* 3. Gamification Tab */}
        {activeTab === "gamification" && (
          <div className="space-y-4 pt-1">
            {/* Streaks Header */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500 animate-bounce" />
                <div>
                  <p className="text-[10px] font-bold text-foreground">Current Streak</p>
                  <p className="text-xs font-black text-orange-400">{gamification.current_streak} days</p>
                </div>
              </div>
              <div className="text-right border-l border-border/10 pl-3">
                <p className="text-[8px] text-muted-foreground font-semibold">Longest Streak</p>
                <p className="text-[10px] font-bold text-foreground">{gamification.longest_streak} days</p>
              </div>
            </div>

            {/* Level & XP bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px]">
                <span className="font-bold text-foreground">Level {gamification.level}</span>
                <span className="text-muted-foreground font-semibold">{gamification.xp} / {gamification.xp_needed} XP</span>
              </div>
              <div className="w-full bg-secondary/40 rounded-full h-2 overflow-hidden border border-border/10">
                <div 
                  className="bg-primary h-full rounded-full transition-all duration-500" 
                  style={{ width: `${xpPercent}%` }}
                />
              </div>
            </div>

            {/* Streak calendar representing last 7 days */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-foreground">Activity Calendar (7 Days)</p>
              <div className="flex justify-between gap-1 p-2 bg-secondary/15 rounded-xl border border-border/10">
                {last7Days.map((day) => (
                  <div key={day.dateStr} className="flex flex-col items-center flex-1">
                    <span className="text-[7px] text-muted-foreground font-semibold mb-1">{day.label}</span>
                    <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[9px] ${
                      day.isCompleted 
                        ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30" 
                        : "bg-secondary/30 text-muted-foreground border border-border/10"
                    }`}>
                      {day.isCompleted ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <span className="text-[7px] opacity-40">●</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Streak Freeze panel */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-orange-500/5 border border-orange-500/15">
              <div className="space-y-0.5">
                <p className="text-[10px] font-bold text-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3 text-orange-500 shrink-0" />
                  Streak Freeze
                </p>
                <p className="text-[8px] text-muted-foreground leading-normal">
                  {gamification.streak_freezes_available > 0 
                    ? `${gamification.streak_freezes_available} freeze(s) available` 
                    : "0 freezes (1 automatically granted/week)"}
                </p>
              </div>
              <Button
                onClick={handleUseFreeze}
                disabled={gamification.streak_freezes_available <= 0}
                size="sm"
                className="text-[9px] h-6.5 bg-orange-600 hover:bg-orange-700 text-white border-0 cursor-pointer disabled:opacity-50"
              >
                Use Freeze
              </Button>
            </div>

            {/* Unlocked Badges */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-foreground">Unlocked Achievements</p>
              {gamification.badges.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {gamification.badges.map((badge: any) => (
                    <div 
                      key={badge.id} 
                      className="p-1.5 rounded-xl bg-primary/5 border border-primary/10 flex flex-col items-center text-center space-y-1"
                      title={badge.description}
                    >
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        {badge.id === "consistent" ? <Zap className="h-3.5 w-3.5" /> :
                         badge.id === "unstoppable" ? <Flame className="h-3.5 w-3.5" /> :
                         <Award className="h-3.5 w-3.5" />}
                      </div>
                      <span className="text-[8px] font-bold text-foreground truncate w-full">{badge.title}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[8px] text-muted-foreground text-center py-2 bg-secondary/10 rounded-xl border border-dashed border-border/10">
                  No achievements unlocked yet. Read daily to earn badges!
                </p>
              )}
            </div>
          </div>
        )}

        {/* 4. Settings Tab */}
        {activeTab === "settings" && (
          <div className="space-y-4 pt-1">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between border-b border-border/5 pb-3">
              <div className="space-y-0.5">
                <label className="text-[11px] font-bold text-foreground">Enable Reminders</label>
                <p className="text-[9px] text-muted-foreground">Notification of high priority backlog</p>
              </div>
              <button
                onClick={() => setEnabled(!enabled)}
                className="p-1 text-primary focus:outline-none cursor-pointer border-0 bg-transparent"
              >
                {enabled ? (
                  <ToggleRight className="h-7 w-7" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-muted-foreground" />
                )}
              </button>
            </div>

            {/* Browser Alerts Toggle */}
            <div className="flex items-center justify-between border-b border-border/5 pb-3">
              <div className="space-y-0.5">
                <label className="text-[11px] font-bold text-foreground flex items-center gap-1">
                  <Bell className="h-3.5 w-3.5 text-primary shrink-0" />
                  Desktop Alerts
                </label>
                <p className="text-[9px] text-muted-foreground">Trigger browser notifications locally</p>
              </div>
              <button
                onClick={() => setBrowserNotificationsEnabled(!browserNotificationsEnabled)}
                disabled={!enabled}
                className="p-1 text-primary focus:outline-none cursor-pointer border-0 bg-transparent disabled:opacity-50"
              >
                {browserNotificationsEnabled && enabled ? (
                  <ToggleRight className="h-7 w-7" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-muted-foreground" />
                )}
              </button>
            </div>

            {/* Email Reminders Toggle */}
            <div className="flex items-center justify-between border-b border-border/5 pb-3">
              <div className="space-y-0.5">
                <label className="text-[11px] font-bold text-foreground flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                  Email Reminders
                </label>
                <p className="text-[9px] text-muted-foreground">Receive daily digests in your inbox</p>
              </div>
              <button
                onClick={() => setEmailRemindersEnabled(!emailRemindersEnabled)}
                disabled={!enabled}
                className="p-1 text-primary focus:outline-none cursor-pointer border-0 bg-transparent disabled:opacity-50"
              >
                {emailRemindersEnabled && enabled ? (
                  <ToggleRight className="h-7 w-7" />
                ) : (
                  <ToggleLeft className="h-7 w-7 text-muted-foreground" />
                )}
              </button>
            </div>

            {/* Time Picker */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-foreground">Preferred Reminder Time</label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                disabled={!enabled}
                className="w-full bg-secondary/30 border border-border/15 p-2 rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
              />
            </div>

            {/* Timezone Selection */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-foreground flex items-center gap-1">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={!enabled}
                className="w-full bg-secondary/30 border border-border/15 p-2 rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} className="bg-popover text-foreground">{tz}</option>
                ))}
              </select>
            </div>

            {/* Reminder Frequency dropdown */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-foreground">Reminder Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as any)}
                disabled={!enabled}
                className="w-full bg-secondary/30 border border-border/15 p-2 rounded-xl text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <option value="daily" className="bg-popover text-foreground">Daily</option>
                <option value="weekdays" className="bg-popover text-foreground">Weekdays (Mon-Fri)</option>
                <option value="weekly" className="bg-popover text-foreground">Weekly (Sundays)</option>
                <option value="custom" className="bg-popover text-foreground">Custom Weekdays</option>
              </select>
            </div>

            {/* Custom Weekdays checklist grid */}
            {frequency === "custom" && (
              <div className="space-y-1.5 p-2.5 rounded-xl bg-secondary/20 border border-border/10">
                <label className="text-[10px] font-bold text-foreground">Select Weekdays</label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((day) => {
                    const isSelected = customDays.split(",").includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => handleToggleDay(day)}
                        disabled={!enabled}
                        className={`px-2 py-1 text-[9px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isSelected 
                            ? "bg-primary text-white border-primary" 
                            : "bg-secondary/40 border-border/10 text-muted-foreground hover:text-foreground"
                        } disabled:opacity-50`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Button
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              className="w-full text-[11px] h-8 bg-primary hover:opacity-90 text-white border-0 mt-2 cursor-pointer"
            >
              {isSavingSettings ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Save Preferences"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});

export function RemindersPopover() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"reminders" | "history" | "gamification" | "settings">("reminders");

  const {
    unreadCount,
    activeList,
    historyList,
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
    gamification
  } = useRemindersLogic(isOpen, activeTab);

  const handleToggleDay = React.useCallback((day: string) => {
    let days = customDays ? customDays.split(",") : [];
    if (days.includes(day)) {
      days = days.filter(d => d !== day);
    } else {
      days.push(day);
    }
    setCustomDays(days.join(","));
  }, [customDays, setCustomDays]);

  const xpPercent = Math.min(100, Math.round(((gamification.xp || 0) / (gamification.xp_needed || 200)) * 100));

  // Generate streak calendar representing the last 7 days
  const last7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString(undefined, { weekday: "short" });
    const isCompleted = gamification.calendar?.includes(dateStr);
    return { dateStr, label, isCompleted };
  });

  return (
    <>
      <PopoverPrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
        {/* Bell Trigger Button */}
        <PopoverPrimitive.Trigger 
          className="relative p-2 rounded-xl border border-border/15 hover:bg-accent/40 glass transition-all cursor-pointer flex items-center justify-center focus:outline-none"
          id="reminders-bell-btn"
          aria-label="View reminders"
        >
          <Bell className="h-4.5 w-4.5 text-muted-foreground hover:text-foreground transition-colors" />
          
          {/* Animated Badge Counter */}
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-orange-500 text-[9px] font-black text-white border-2 border-background animate-pulse animate-bounce">
              {unreadCount}
            </span>
          )}
        </PopoverPrimitive.Trigger>

        {/* Popover Portal outside main DOM */}
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner 
            side="bottom" 
            align="end" 
            sideOffset={8}
            collisionPadding={12}
            className="z-[99999] isolate outline-none"
          >
            <PopoverPrimitive.Popup className="outline-none">
              {/* Only render panel contents when open to avoid DOM sizing and layout overhead when popover is closed */}
              {isOpen && (
                <ReminderPanelContent
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  activeList={activeList}
                  historyList={historyList}
                  enabled={enabled}
                  setEnabled={setEnabled}
                  reminderTime={reminderTime}
                  setReminderTime={setReminderTime}
                  frequency={frequency}
                  setFrequency={setFrequency}
                  customDays={customDays}
                  handleToggleDay={handleToggleDay}
                  timezone={timezone}
                  setTimezone={setTimezone}
                  browserNotificationsEnabled={browserNotificationsEnabled}
                  setBrowserNotificationsEnabled={setBrowserNotificationsEnabled}
                  emailRemindersEnabled={emailRemindersEnabled}
                  setEmailRemindersEnabled={setEmailRemindersEnabled}
                  isSavingSettings={isSavingSettings}
                  handleSnooze={handleSnooze}
                  handleComplete={handleComplete}
                  handleDismiss={handleDismiss}
                  handleSaveSettings={handleSaveSettings}
                  handleUseFreeze={handleUseFreeze}
                  gamification={gamification}
                  xpPercent={xpPercent}
                  last7Days={last7Days}
                />
              )}
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <RemindersScheduler 
        browserNotificationsEnabled={browserNotificationsEnabled}
        frequency={frequency}
      />
    </>
  );
}
