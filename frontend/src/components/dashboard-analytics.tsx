"use client";

import { useAnalytics } from "@/hooks/use-swr-queries";
import { Flame, Zap, Award, BookOpen, Inbox, Calendar, CheckCircle2 } from "lucide-react";
import { Loader2 } from "lucide-react";

const ICON_MAP = {
  Inbox: Inbox,
  BookOpen: BookOpen,
  Award: Award,
  Zap: Zap,
  Flame: Flame,
};

export function DashboardAnalytics() {
  const { analytics, isLoading, error } = useAnalytics();

  if (isLoading) {
    return (
      <div className="glass p-6 rounded-2xl border border-border/15 flex items-center justify-center min-h-[220px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="glass p-6 rounded-2xl border border-border/15 flex items-center justify-center min-h-[220px] text-xs text-muted-foreground">
        Failed to load analytics
      </div>
    );
  }

  const {
    current_streak = 0,
    longest_streak = 0,
    daily_saves = 0,
    daily_completions = 0,
    daily_reading_time_minutes = 0,
    daily_reading_goal_minutes = 15,
    badges = [],
    total_completed = 0,
    weekly_saves = [0, 0, 0, 0, 0, 0, 0],
    weekly_completions = [0, 0, 0, 0, 0, 0, 0],
    weekly_labels = ["", "", "", "", "", "", ""],
  } = analytics;

  // Calculate max val for chart scaling
  const maxSaves = Math.max(...weekly_saves, 0);
  const maxCompletions = Math.max(...weekly_completions, 0);
  const chartMax = Math.max(maxSaves, maxCompletions, 3); // minimum scale is 3

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* 1. Streak & Streak goal Card */}
      <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-orange-500/10 rounded-full blur-xl pointer-events-none" />

        <div className="flex justify-between items-start">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">
              Consistency
            </span>
            <h3 className="text-xl font-bold">Activity Streak</h3>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-550/15 border border-orange-500/20">
            <Flame className="h-5 w-5 text-orange-500 animate-pulse" />
          </div>
        </div>

        <div className="my-5 flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tracking-tight text-orange-400">
            {current_streak}
          </span>
          <span className="text-xs text-muted-foreground font-semibold">
            {current_streak === 1 ? "day streak" : "days streak"}
          </span>
        </div>

        <div className="space-y-2 border-t border-border/10 pt-4 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Longest Streak</span>
            <span className="font-bold text-foreground">{longest_streak} days</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Today's saves</span>
            <span className="font-bold text-foreground">{daily_saves} items</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Today's completions</span>
            <span className="font-bold text-foreground">{daily_completions} items</span>
          </div>
        </div>
      </div>

      {/* 2. Custom CSS Bar Chart for Weekly Activity */}
      <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col relative overflow-hidden md:col-span-2">
        <div className="flex justify-between items-center mb-5">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">
              Activity
            </span>
            <h3 className="text-lg font-bold">Weekly Saves & Completions</h3>
          </div>
          <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-primary" />
              <span className="text-muted-foreground">Saves</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-emerald-500" />
              <span className="text-muted-foreground">Completions</span>
            </div>
          </div>
        </div>

        {/* CSS Chart rendering */}
        <div className="flex-1 flex items-end justify-between h-36 pt-4 px-2">
          {weekly_labels.map((label: string, index: number) => {
            const savesVal = weekly_saves[index] || 0;
            const completionsVal = weekly_completions[index] || 0;

            const savesPercent = (savesVal / chartMax) * 100;
            const completionsPercent = (completionsVal / chartMax) * 100;

            return (
              <div key={index} className="flex flex-col items-center flex-1 group/bar">
                {/* Visual Bars Container */}
                <div className="relative w-12 flex justify-center gap-1.5 h-28 items-end">
                  {/* Saves Bar */}
                  <div
                    style={{ height: `${Math.max(savesPercent, 3)}%` }}
                    className={`w-3.5 rounded-t-sm transition-all duration-500 bg-primary/75 hover:bg-primary shadow-sm relative ${
                      savesVal > 0 ? "opacity-100" : "opacity-20"
                    }`}
                  >
                    {/* Tooltip on hover */}
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 scale-0 group-hover/bar:scale-100 bg-secondary-foreground text-background text-[9px] px-1.5 py-0.5 rounded shadow-lg pointer-events-none transition-all font-bold z-10">
                      +{savesVal}
                    </span>
                  </div>

                  {/* Completions Bar */}
                  <div
                    style={{ height: `${Math.max(completionsPercent, 3)}%` }}
                    className={`w-3.5 rounded-t-sm transition-all duration-500 bg-emerald-500/75 hover:bg-emerald-500 shadow-sm relative ${
                      completionsVal > 0 ? "opacity-100" : "opacity-20"
                    }`}
                  >
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 scale-0 group-hover/bar:scale-100 bg-secondary-foreground text-background text-[9px] px-1.5 py-0.5 rounded shadow-lg pointer-events-none transition-all font-bold z-10">
                      ✓{completionsVal}
                    </span>
                  </div>
                </div>

                {/* Day label */}
                <span className="text-[10px] text-muted-foreground mt-2 font-semibold group-hover/bar:text-foreground transition-colors">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Badges & Rewards */}
      {badges.length > 0 && (
        <div className="glass p-6 rounded-2xl border border-border/15 md:col-span-3">
          <div className="flex items-center gap-2 mb-4 border-b border-border/10 pb-2">
            <Award className="h-4.5 w-4.5 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Earned Badges
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
            {badges.map((badge: any) => {
              const BadgeIcon = ICON_MAP[badge.icon as keyof typeof ICON_MAP] || Award;
              return (
                <div
                  key={badge.id}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-border/10 hover:border-primary/15 transition-all bg-secondary/10"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-primary text-white shadow-sm">
                    <BadgeIcon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold truncate">{badge.title}</h4>
                    <p className="text-[10px] text-muted-foreground truncate leading-relaxed">
                      {badge.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
