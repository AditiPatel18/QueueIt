"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayersIcon,
  LogOutIcon,
  Loader2,
  User,
  ChevronDownIcon,
  ArrowLeft,
  Calendar,
  Clock,
  Sparkles,
  Download,
  Flame,
  PieChart,
  Eye,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { useReadingAnalytics, useStreakHeatmap } from "@/hooks/use-swr-queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a YYYY-MM-DD string as a locale date string */
function fmtDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** YYYY-MM-DD of today in local time */
function todayLocal(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Heatmap cell color by intensity bucket (0-4)
// ---------------------------------------------------------------------------
function heatColor(count: number): string {
  if (count === 0) return "bg-[oklch(0.3_0_0)] border-[oklch(0.35_0_0)]"; // empty
  if (count === 1) return "bg-[oklch(0.45_0.18_270)] border-[oklch(0.5_0.18_270)]";
  if (count === 2) return "bg-[oklch(0.55_0.22_270)] border-[oklch(0.6_0.22_270)]";
  if (count === 3) return "bg-[oklch(0.65_0.25_270)] border-[oklch(0.7_0.25_270)]";
  return "bg-[oklch(0.75_0.28_270)] border-[oklch(0.78_0.28_270)]"; // 4+
}

// ---------------------------------------------------------------------------
// Build 53-week heatmap grid (GitHub style)
// Returns: columns array where each column = 1 week (Sun–Sat)
// ---------------------------------------------------------------------------
function buildHeatmapGrid(dailyCounts: Record<string, number>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Start from the Sunday of the week that was 52 weeks ago
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 52 * 7);
  // Rewind to the Sunday of that week
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const todayStr = todayLocal();

  const columns: {
    weekIndex: number;
    monthLabel: string | null; // only set on first week of a month
    days: {
      dateStr: string;
      count: number;
      label: string;
      isToday: boolean;
      isFuture: boolean;
    }[];
  }[] = [];

  let prevMonth = -1;
  const cur = new Date(startDate);

  for (let w = 0; w < 53; w++) {
    const days = [];
    let monthLabel: string | null = null;

    for (let d = 0; d < 7; d++) {
      const y = cur.getFullYear();
      const mo = cur.getMonth();
      const day = cur.getDate();
      const dateStr = `${y}-${String(mo + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      // First day of a new month → emit month label on this column
      if (day === 1 || (w === 0 && d === 0)) {
        const m = cur.getMonth();
        if (m !== prevMonth) {
          monthLabel = cur.toLocaleDateString(undefined, { month: "short" });
          prevMonth = m;
        }
      }

      const isFuture = cur > today;
      const count = isFuture ? 0 : (dailyCounts[dateStr] ?? 0);

      days.push({
        dateStr,
        count,
        label: fmtDate(dateStr),
        isToday: dateStr === todayStr,
        isFuture,
      });

      cur.setDate(cur.getDate() + 1);
    }

    columns.push({ weekIndex: w, monthLabel, days });
  }

  return columns;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Tooltip state for heatmap
  const [tooltip, setTooltip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  // Chart controls
  const [intervalType, setIntervalType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [metricType, setMetricType] = useState<"time" | "completions">("completions");

  const { analytics, isLoading: analyticsLoading, error: analyticsError } = useReadingAnalytics();
  const { streakData } = useStreakHeatmap();

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const handleExportCSV = async () => {
    try {
      setExporting(true);
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        alert("Unauthorized — no session");
        return;
      }

      const API_BASE = `${(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "")}/api`;
      const response = await fetch(`${API_BASE}/items/analytics/export`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) throw new Error("CSV Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "queueit_reading_analytics.csv";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Export error", err);
      alert("Failed to export CSV: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  const getInitials = (user: SupabaseUser) => {
    const name = user.user_metadata?.full_name || user.email || "U";
    return name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getDisplayName = (user: SupabaseUser) => {
    return user.user_metadata?.full_name || user.email?.split("@")[0] || "User";
  };

  // ---- Heatmap ----
  const dailyCompletionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (streakData?.daily_activity) {
      streakData.daily_activity.forEach((item: { date: string; count: number }) => {
        counts[item.date] = item.count;
      });
    }
    return counts;
  }, [streakData]);

  const heatmapColumns = useMemo(
    () => buildHeatmapGrid(dailyCompletionCounts),
    [dailyCompletionCounts]
  );

  const currentStreak = streakData?.current_streak ?? 0;
  const longestStreak = streakData?.longest_streak ?? 0;

  // ---- Chart data (original mapping — matches backend chart shapes exactly) ----
  const activeChartData = useMemo(() => {
    if (!analytics?.charts) return [];

    if (intervalType === "daily") {
      return (analytics.charts.daily || []).map((d: any) => ({
        label: new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: metricType === "time" ? d.minutes : d.completions,
        rawDate: d.date,
      }));
    }

    if (intervalType === "weekly") {
      return (analytics.charts.weekly || []).map((d: any) => ({
        label: `Wk ${new Date(d.week_start).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}`,
        value: metricType === "time" ? d.minutes : d.completions,
        rawDate: d.week_start,
      }));
    }

    // monthly
    return (analytics.charts.monthly || []).map((d: any) => {
      const [y, m] = d.month.split("-");
      const date = new Date(parseInt(y), parseInt(m) - 1, 1);
      return {
        label: date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        value: metricType === "time" ? d.minutes : d.completions,
        rawDate: d.month,
      };
    });
  }, [analytics, intervalType, metricType]);

  const maxChartValue = useMemo(() => {
    const vals = activeChartData.map((d) => d.value);
    return Math.max(...vals, 1);
  }, [activeChartData]);

  // ---- Productivity ring ----
  const scoreRingOffset = useMemo(() => {
    const score = analytics?.productivity_score || 0;
    const r = 40;
    const circ = 2 * Math.PI * r;
    return circ - (score / 100) * circ;
  }, [analytics]);

  if (loading || analyticsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (analyticsError || !analytics) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
        <p className="text-muted-foreground text-sm mb-4">Failed to load reading analytics data.</p>
        <Link href="/dashboard">
          <Button variant="outline">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const {
    reading_time = { daily: 0, weekly: 0, monthly: 0, daily_goal: 15 },
    average_completion_time = 0,
    category_distribution = [],
    most_viewed_categories = [],
    streak = { current: 0, longest: 0, completed_dates: [] },
    productivity_score = 0,
    top_ai_topics = [],
  } = analytics;

  const getProductivityFeedback = (score: number) => {
    if (score >= 85) return { label: "Master Reader", desc: "Superb daily focus! You maintain perfect consistency.", color: "text-emerald-400" };
    if (score >= 70) return { label: "Focused Scholar", desc: "Solid progress. Keep meeting your daily targets!", color: "text-primary" };
    if (score >= 50) return { label: "Casual Reader", desc: "Try categorizing and completing a bit more every day.", color: "text-amber-400" };
    return { label: "Queue Explorer", desc: "Start strong by finishing items in your backlog.", color: "text-rose-400" };
  };

  const feedback = getProductivityFeedback(productivity_score);

  // Day-of-week labels (only Sun/Mon/Wed/Fri to save space like GitHub)
  const DOW_LABELS = ["Sun", "", "Mon", "", "Wed", "", "Fri", ""];

  return (
    <div className="relative min-h-screen bg-background">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 -left-40 h-[400px] w-[400px] rounded-full bg-[oklch(0.5_0.2_270_/_8%)] blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[400px] w-[400px] rounded-full bg-[oklch(0.45_0.18_300_/_6%)] blur-[120px]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 border-b border-border/30 glass">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <LayersIcon className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">QueueIt</span>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                className="glass-strong border-border/30 hover:bg-accent/40 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Dashboard
              </Button>
            </Link>

            <Link href="/analytics">
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground hover:text-foreground bg-accent/30 font-semibold cursor-pointer"
              >
                Analytics
              </Button>
            </Link>

            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                  id="user-menu-btn"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage
                      src={user.user_metadata?.avatar_url}
                      alt={getDisplayName(user)}
                    />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                      {getInitials(user)}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 glass-strong border-border/30">
                  <div className="px-3 py-2">
                    <p className="text-sm font-medium">{getDisplayName(user)}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator className="bg-border/30" />
                  <Link href="/profile">
                    <DropdownMenuItem className="cursor-pointer">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </DropdownMenuItem>
                  </Link>
                  <DropdownMenuSeparator className="bg-border/30" />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    onClick={handleLogout}
                    disabled={loggingOut}
                  >
                    {loggingOut ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogOutIcon className="mr-2 h-4 w-4" />
                    )}
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12 space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
              Reading <span className="gradient-text">Analytics</span>
            </h1>
            <p className="mt-2 text-muted-foreground text-sm">
              Deep insights into your completion habits, reading categories, and topics.
            </p>
          </div>
          <div>
            <Button
              onClick={handleExportCSV}
              disabled={exporting}
              size="sm"
              className="gradient-primary text-white border-0 hover:opacity-90 transition-opacity cursor-pointer glow-primary flex items-center gap-1.5"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export Analytics (CSV)
            </Button>
          </div>
        </div>

        {/* 1. Quick Stats */}
        <div className="grid gap-6 md:grid-cols-4">

          {/* Daily */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-primary/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">Today</span>
                <h3 className="text-base font-bold text-foreground">Reading Time</h3>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                <Clock className="h-4 w-4 text-primary" />
              </div>
            </div>
            <div className="my-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-primary">{reading_time.daily}</span>
              <span className="text-xs text-muted-foreground font-semibold">min</span>
            </div>
            <div className="border-t border-border/10 pt-3 text-xs text-muted-foreground flex justify-between items-center">
              <span>Daily Goal: {reading_time.daily_goal} min</span>
              <span className="font-bold text-foreground">
                {Math.min(100, Math.round((reading_time.daily / reading_time.daily_goal) * 100))}%
              </span>
            </div>
            <div className="mt-2 w-full h-1 bg-border/20 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.min(100, (reading_time.daily / reading_time.daily_goal) * 100)}%` }}
                className="h-full bg-primary rounded-full transition-all duration-500"
              />
            </div>
          </div>

          {/* Weekly */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">Weekly</span>
                <h3 className="text-base font-bold text-foreground">Reading Time</h3>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
            <div className="my-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-emerald-400">{reading_time.weekly}</span>
              <span className="text-xs text-muted-foreground font-semibold">min</span>
            </div>
            <div className="border-t border-border/10 pt-3 text-xs text-muted-foreground">
              Avg. <span className="font-bold text-foreground">{Math.round(reading_time.weekly / 7)} min</span> / day
            </div>
          </div>

          {/* Monthly */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-violet-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">Monthly</span>
                <h3 className="text-base font-bold text-foreground">Reading Time</h3>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20">
                <Calendar className="h-4 w-4 text-violet-400" />
              </div>
            </div>
            <div className="my-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-violet-400">{reading_time.monthly}</span>
              <span className="text-xs text-muted-foreground font-semibold">min</span>
            </div>
            <div className="border-t border-border/10 pt-3 text-xs text-muted-foreground">
              Est. <span className="font-bold text-foreground">{Math.round(reading_time.monthly / Math.max(1, average_completion_time))} items</span> completed
            </div>
          </div>

          {/* Productivity Score */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex items-center gap-4 relative overflow-hidden">
            <div className="relative flex-shrink-0 flex items-center justify-center h-24 w-24">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="48" cy="48" r="40" className="stroke-border/25" strokeWidth="8" fill="transparent" />
                <circle
                  cx="48" cy="48" r="40"
                  className="stroke-primary"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray={`${2 * Math.PI * 40}`}
                  strokeDashoffset={scoreRingOffset}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-xl font-black text-foreground">{productivity_score}%</span>
                <span className="text-[8px] text-muted-foreground font-bold tracking-wider uppercase">Score</span>
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block">Focus level</span>
              <h3 className={`text-sm font-bold ${feedback.color}`}>{feedback.label}</h3>
              <p className="text-[10px] leading-snug text-muted-foreground">{feedback.desc}</p>
            </div>
          </div>

        </div>

        {/* 2. Reading Streak Heatmap — GitHub / LeetCode style */}
        <div className="glass p-6 rounded-2xl border border-border/15 relative overflow-hidden">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500 shrink-0" />
              <div>
                <h3 className="text-base font-bold text-foreground">Reading Streak Calendar</h3>
                <p className="text-[10px] text-muted-foreground leading-normal">
                  Daily completed content over the past year — built from{" "}
                  <span className="font-semibold">completed_at</span> timestamps.
                </p>
              </div>
            </div>
            <div className="flex gap-5 text-xs font-semibold text-muted-foreground shrink-0">
              <div>
                Current:{" "}
                <span className="font-bold text-orange-400">{currentStreak} day{currentStreak !== 1 ? "s" : ""}</span>
              </div>
              <div>
                Longest:{" "}
                <span className="font-bold text-foreground">{longestStreak} day{longestStreak !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className="w-full overflow-x-auto pb-2 scrollbar-none select-none">
            <div className="inline-flex gap-0 min-w-max">
              {/* Day-of-week labels column */}
              <div className="flex flex-col mr-1.5 mt-6">
                {["S", "", "M", "", "W", "", "F", ""].slice(0, 7).map((lbl, i) => (
                  <div
                    key={i}
                    className="h-[13px] flex items-center text-[8px] text-muted-foreground font-medium w-4 mb-[2px]"
                  >
                    {lbl}
                  </div>
                ))}
              </div>

              {/* Week columns */}
              <div className="flex flex-col">
                {/* Month labels row */}
                <div className="flex mb-1 h-5">
                  {heatmapColumns.map((col) => (
                    <div key={col.weekIndex} className="w-[13px] mr-[2px] text-[8px] text-muted-foreground font-medium truncate">
                      {col.monthLabel ?? ""}
                    </div>
                  ))}
                </div>

                {/* Day cells */}
                <div className="flex gap-[2px]">
                  {heatmapColumns.map((col) => (
                    <div key={col.weekIndex} className="flex flex-col gap-[2px]">
                      {col.days.map((day) => {
                        const colorCls = day.isFuture
                          ? "bg-border/10 border-border/10 opacity-30"
                          : heatColor(day.count);
                        const todayCls = day.isToday
                          ? "ring-1 ring-orange-400 ring-offset-[1px] ring-offset-background z-10"
                          : "";
                        return (
                          <div
                            key={day.dateStr}
                            className={`w-[13px] h-[13px] rounded-[2px] border transition-transform duration-150 hover:scale-125 cursor-default ${colorCls} ${todayCls}`}
                            onMouseEnter={(e) => {
                              if (day.isFuture) return;
                              const rect = (e.target as HTMLElement).getBoundingClientRect();
                              setTooltip({
                                text: day.count === 0
                                  ? `${day.label} — no completions`
                                  : `${day.label} — ${day.count} item${day.count !== 1 ? "s" : ""} completed`,
                                x: rect.left + rect.width / 2,
                                y: rect.top,
                              });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-1.5 mt-4 text-[9px] text-muted-foreground justify-end pr-1">
              <span>Less</span>
              <div className="w-[11px] h-[11px] rounded-[2px] bg-[oklch(0.3_0_0)] border border-[oklch(0.35_0_0)]" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-[oklch(0.45_0.18_270)] border border-[oklch(0.5_0.18_270)]" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-[oklch(0.55_0.22_270)] border border-[oklch(0.6_0.22_270)]" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-[oklch(0.65_0.25_270)] border border-[oklch(0.7_0.25_270)]" />
              <div className="w-[11px] h-[11px] rounded-[2px] bg-[oklch(0.75_0.28_270)] border border-[oklch(0.78_0.28_270)]" />
              <span>More</span>
            </div>
          </div>

          {/* Total count summary */}
          {streakData?.daily_activity && (
            <p className="text-[10px] text-muted-foreground mt-2 leading-normal">
              <span className="font-bold text-foreground">
                {streakData.daily_activity.reduce((sum: number, d: any) => sum + d.count, 0)}
              </span>{" "}
              items completed across{" "}
              <span className="font-bold text-foreground">
                {streakData.daily_activity.length}
              </span>{" "}
              active days in the past year.
            </p>
          )}
        </div>

        {/* 3. Chart + Category Distribution */}
        <div className="grid gap-6 md:grid-cols-3">

          {/* Main Chart */}
          <div className="glass p-6 rounded-2xl border border-border/15 md:col-span-2 flex flex-col min-h-[360px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">History</span>
                <h3 className="text-base font-bold text-foreground">Completions &amp; Time Chart</h3>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Metric toggle */}
                <div className="inline-flex rounded-lg bg-secondary/30 p-1 border border-border/10">
                  <button
                    onClick={() => setMetricType("completions")}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                      metricType === "completions" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Completions
                  </button>
                  <button
                    onClick={() => setMetricType("time")}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                      metricType === "time" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Time (min)
                  </button>
                </div>

                {/* Interval toggle */}
                <div className="inline-flex rounded-lg bg-secondary/30 p-1 border border-border/10">
                  {(["daily", "weekly", "monthly"] as const).map((t, i) => (
                    <button
                      key={t}
                      onClick={() => setIntervalType(t)}
                      className={`rounded-md px-2.5 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                        intervalType === t ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {["30D", "12W", "12M"][i]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Chart area — original stable implementation */}
            <div className="flex-1 flex items-end justify-between h-48 pt-6 border-b border-border/10 px-2 select-none relative">

              {/* Empty state */}
              {activeChartData.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                  No activity tracked for this interval.
                </div>
              )}

              {activeChartData.map((d: any, idx: number) => {
                const heightPercent = maxChartValue > 0 ? (d.value / maxChartValue) * 100 : 0;

                // Only show every 5th label for dense daily view
                const shouldShowLabel =
                  intervalType !== "daily" ||
                  idx % 5 === 0 ||
                  idx === activeChartData.length - 1;

                return (
                  <div key={idx} className="flex flex-col items-center flex-1 group/item">
                    {/* Visual Column Bar */}
                    <div className="relative w-full flex justify-center h-44 items-end px-0.5">
                      <div
                        style={{ height: `${Math.max(heightPercent, 2)}%` }}
                        className={`w-full rounded-t-[2px] transition-all duration-500 bg-primary/70 hover:bg-primary shadow-sm relative ${
                          d.value > 0 ? "opacity-100" : "opacity-15"
                        }`}
                      >
                        {/* Tooltip on hover */}
                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 scale-0 group-hover/item:scale-100 bg-secondary-foreground text-background text-[9px] px-2 py-0.5 rounded shadow-lg pointer-events-none transition-all font-bold z-10 whitespace-nowrap">
                          {d.value} {metricType === "time" ? "min" : "done"}
                        </div>
                      </div>
                    </div>

                    {/* X-Axis Labels */}
                    <span className={`text-[8px] text-muted-foreground mt-2 select-none group-hover/item:text-foreground transition-colors ${
                      shouldShowLabel ? "opacity-100" : "opacity-0 group-hover/item:opacity-100"
                    }`}>
                      {d.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 text-[10px] text-muted-foreground leading-relaxed flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
              <span>
                Average completion duration:{" "}
                <span className="font-bold text-foreground">{average_completion_time} minutes</span> per queue item.
              </span>
            </div>
          </div>

          {/* Category distribution */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">Category</span>
              <h3 className="text-base font-bold text-foreground mb-5">Reading Distribution</h3>

              <div className="space-y-4">
                {category_distribution
                  .filter((cat: any) => cat.count > 0)
                  .sort((a: any, b: any) => b.count - a.count)
                  .map((cat: any, idx: number) => {
                    const maxCount = Math.max(
                      ...category_distribution.filter((c: any) => c.count > 0).map((c: any) => c.count),
                      1
                    );
                    const percent = (cat.count / maxCount) * 100;

                    let colorClass = "bg-primary";
                    if (cat.category.toLowerCase() === "youtube") colorClass = "bg-rose-500";
                    if (cat.category.toLowerCase() === "reddit") colorClass = "bg-orange-500";
                    if (cat.category.toLowerCase() === "leetcode") colorClass = "bg-amber-400";
                    if (cat.category.toLowerCase() === "pdf") colorClass = "bg-emerald-500";
                    if (cat.category.toLowerCase() === "twitter") colorClass = "bg-sky-400";

                    return (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-foreground">{cat.category}</span>
                          <span className="text-muted-foreground text-[10px]">
                            {cat.count} item{cat.count !== 1 ? "s" : ""} ({cat.time_spent}m)
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-border/25 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${percent}%` }}
                            className={`h-full ${colorClass} rounded-full transition-all duration-500`}
                          />
                        </div>
                      </div>
                    );
                  })}

                {category_distribution.filter((cat: any) => cat.count > 0).length === 0 && (
                  <p className="text-xs text-muted-foreground">No completed items in categories yet.</p>
                )}
              </div>
            </div>

            <div className="border-t border-border/10 pt-4 mt-6 text-[10px] text-muted-foreground flex items-center gap-1.5">
              <PieChart className="h-3 w-3 text-primary shrink-0" />
              <span>Categorized items optimize AI re-prioritizations.</span>
            </div>
          </div>
        </div>

        {/* 4. Bottom: Most Viewed + AI Topics */}
        <div className="grid gap-6 md:grid-cols-2">

          {/* Most Viewed Categories */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Eye className="h-4 w-4 text-primary" />
                <h3 className="text-base font-bold text-foreground">Most Viewed Categories</h3>
              </div>

              <div className="divide-y divide-border/10">
                {most_viewed_categories.map((cat: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary text-[10px] font-bold">
                        {idx + 1}
                      </div>
                      <span className="text-xs font-semibold text-foreground">{cat.category}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-bold">{cat.views} opens</span>
                  </div>
                ))}

                {most_viewed_categories.length === 0 && (
                  <div className="py-4 text-xs text-muted-foreground">No open events recorded.</div>
                )}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground mt-4 leading-normal">
              Determined by items that you opened and reviewed in reader view or external links.
            </p>
          </div>

          {/* Top AI Topics */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                <h3 className="text-base font-bold text-foreground">Top AI-Recommended Topics Read</h3>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-2">
                {top_ai_topics.map((t: any, idx: number) => (
                  <div
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-primary/20 bg-primary/10 text-[10px] font-bold text-primary hover:border-primary/45 transition-colors cursor-default"
                  >
                    <span>#{t.topic}</span>
                    <span className="h-4 px-1 rounded-full bg-primary/20 flex items-center justify-center text-[8px] text-primary">
                      {t.count}
                    </span>
                  </div>
                ))}

                {top_ai_topics.length === 0 && (
                  <div className="py-4 text-xs text-muted-foreground w-full">
                    No completed items matching recent AI recommendations. Continue read actions on recommendation list.
                  </div>
                )}
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground mt-4 leading-normal">
              Most common tags extracted from completed items that were recommended to you by AI suggestions.
            </p>
          </div>

        </div>

      </main>

      {/* Global floating tooltip for heatmap cells */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-popover text-popover-foreground text-[10px] font-semibold px-2.5 py-1.5 rounded-lg shadow-xl border border-border/30 -translate-x-1/2 -translate-y-full -mt-2 whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
