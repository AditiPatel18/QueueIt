"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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
import { useReadingAnalytics } from "@/hooks/use-swr-queries";

export default function AnalyticsPage() {
  const router = useRouter();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Chart view states
  const [intervalType, setIntervalType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [metricType, setMetricType] = useState<"time" | "completions">("time");

  const { analytics, isLoading: analyticsLoading, error: analyticsError } = useReadingAnalytics();

  useEffect(() => {
    const getUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };
    getUser();
  }, []);

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

  // 1. Process grid coordinates for reading streak calendar (past 26 weeks / 182 days)
  const streakCalendarGrid = useMemo(() => {
    if (!analytics?.streak?.completed_dates) return [];
    
    const completedSet = new Set(analytics.streak.completed_dates);
    
    // Map dates to daily completion count
    const dailyCompletionsMap: Record<string, number> = {};
    if (analytics.charts?.daily) {
      analytics.charts.daily.forEach((day) => {
        dailyCompletionsMap[day.date] = day.completions || 0;
      });
    }

    const today = new Date();
    // Align grid to start from Sunday 26 weeks ago
    const startDate = new Date();
    startDate.setDate(today.getDate() - 180);
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek); // Go back to Sunday

    const grid = [];
    const tempDate = new Date(startDate);

    // Render 26 columns of 7 rows (weeks * days)
    for (let i = 0; i < 182; i++) {
      const year = tempDate.getFullYear();
      const month = String(tempDate.getMonth() + 1).padStart(2, "0");
      const dateVal = String(tempDate.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${dateVal}`;

      const completed = completedSet.has(dateStr);
      const count = dailyCompletionsMap[dateStr] || (completed ? 1 : 0);

      grid.push({
        dateStr,
        completed,
        count,
        label: tempDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });

      tempDate.setDate(tempDate.getDate() + 1);
    }
    return grid;
  }, [analytics]);

  // 2. Fetch current chart metrics
  const activeChartData = useMemo(() => {
    if (!analytics?.charts) return [];
    
    const rawData = analytics.charts[intervalType] || [];
    
    if (intervalType === "daily") {
      return rawData.map((d: any) => ({
        label: new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: metricType === "time" ? d.minutes : d.completions,
        rawDate: d.date,
      }));
    } else if (intervalType === "weekly") {
      return rawData.map((d: any) => ({
        label: `Wk ${new Date(d.week_start).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}`,
        value: metricType === "time" ? d.minutes : d.completions,
        rawDate: d.week_start,
      }));
    } else {
      return rawData.map((d: any) => {
        const [y, m] = d.month.split("-");
        const date = new Date(parseInt(y), parseInt(m) - 1, 1);
        return {
          label: date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
          value: metricType === "time" ? d.minutes : d.completions,
          rawDate: d.month,
        };
      });
    }
  }, [analytics, intervalType, metricType]);

  const maxChartValue = useMemo(() => {
    const vals = activeChartData.map((d) => d.value);
    return Math.max(...vals, 1);
  }, [activeChartData]);

  // 3. Circular dashboard stroke computation
  const scoreRingOffset = useMemo(() => {
    const score = analytics?.productivity_score || 0;
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    return circumference - (score / 100) * circumference;
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

  // Custom feedback text based on score
  const getProductivityFeedback = (score: number) => {
    if (score >= 85) return { label: "Master Reader", desc: "Superb daily focus! You maintain perfect consistency.", color: "text-emerald-400" };
    if (score >= 70) return { label: "Focused Scholar", desc: "Solid progress. Keep meeting your daily targets!", color: "text-primary" };
    if (score >= 50) return { label: "Casual Reader", desc: "Try categorizing and completing a bit more every day.", color: "text-amber-400" };
    return { label: "Queue Explorer", desc: "Start strong by finishing items in your backlog.", color: "text-rose-400" };
  };

  const feedback = getProductivityFeedback(productivity_score);

  return (
    <div className="relative min-h-screen bg-background">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 -left-40 h-[400px] w-[400px] rounded-full bg-[oklch(0.5_0.2_270_/_8%)] blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[400px] w-[400px] rounded-full bg-[oklch(0.45_0.18_300_/_6%)] blur-[120px]" />
      </div>

      {/* Navigation */}
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

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12 space-y-8">
        
        {/* Header section */}
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

        {/* 1. Quick Stats & Productivity Circle */}
        <div className="grid gap-6 md:grid-cols-4">
          
          {/* Card: Daily reading time */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-primary/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">
                  Today
                </span>
                <h3 className="text-base font-bold text-foreground">Reading Time</h3>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                <Clock className="h-4 w-4 text-primary" />
              </div>
            </div>
            <div className="my-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-primary">
                {reading_time.daily}
              </span>
              <span className="text-xs text-muted-foreground font-semibold">min</span>
            </div>
            <div className="border-t border-border/10 pt-3 text-xs text-muted-foreground flex justify-between items-center">
              <span>Daily Goal: {reading_time.daily_goal} min</span>
              <span className="font-bold text-foreground">
                {Math.min(100, Math.round((reading_time.daily / reading_time.daily_goal) * 100))}%
              </span>
            </div>
            {/* Linear Progress bar */}
            <div className="mt-2 w-full h-1 bg-border/20 rounded-full overflow-hidden">
              <div
                style={{ width: `${Math.min(100, (reading_time.daily / reading_time.daily_goal) * 100)}%` }}
                className="h-full bg-primary rounded-full transition-all duration-500"
              />
            </div>
          </div>

          {/* Card: Weekly reading time */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-emerald-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">
                  Weekly
                </span>
                <h3 className="text-base font-bold text-foreground">Reading Time</h3>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
            <div className="my-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-emerald-400">
                {reading_time.weekly}
              </span>
              <span className="text-xs text-muted-foreground font-semibold">min</span>
            </div>
            <div className="border-t border-border/10 pt-3 text-xs text-muted-foreground">
              Avg. <span className="font-bold text-foreground">{Math.round(reading_time.weekly / 7)} min</span> / day
            </div>
          </div>

          {/* Card: Monthly reading time */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-violet-500/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">
                  Monthly
                </span>
                <h3 className="text-base font-bold text-foreground">Reading Time</h3>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20">
                <Calendar className="h-4 w-4 text-violet-400" />
              </div>
            </div>
            <div className="my-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-violet-400">
                {reading_time.monthly}
              </span>
              <span className="text-xs text-muted-foreground font-semibold">min</span>
            </div>
            <div className="border-t border-border/10 pt-3 text-xs text-muted-foreground">
              Estimated completions: <span className="font-bold text-foreground">{Math.round(reading_time.monthly / Math.max(1, average_completion_time))} items</span>
            </div>
          </div>

          {/* Card: Productivity score */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex items-center gap-4 relative overflow-hidden">
            {/* Radial progress score */}
            <div className="relative flex-shrink-0 flex items-center justify-center h-24 w-24">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  className="stroke-border/25"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  className="stroke-primary shadow-sm"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray={`${2 * Math.PI * 40}`}
                  strokeDashoffset={`${2 * Math.PI * 40 - (productivity_score / 100) * (2 * Math.PI * 40)}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-xl font-black text-foreground">{productivity_score}%</span>
                <span className="text-[8px] text-muted-foreground font-bold tracking-wider uppercase">Score</span>
              </div>
            </div>

            <div className="flex-1 space-y-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block">
                Focus level
              </span>
              <h3 className={`text-sm font-bold ${feedback.color}`}>{feedback.label}</h3>
              <p className="text-[10px] leading-snug text-muted-foreground">{feedback.desc}</p>
            </div>
          </div>

        </div>

        {/* 2. Reading Streak Calendar */}
        <div className="glass p-6 rounded-2xl border border-border/15">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <div>
                <h3 className="text-base font-bold text-foreground">Reading Streak Calendar</h3>
                <p className="text-[10px] text-muted-foreground leading-normal">
                  Your daily completed content footprint over the past 6 months (180 days).
                </p>
              </div>
            </div>
            <div className="flex gap-4 text-xs font-semibold text-muted-foreground">
              <div>
                Current Streak: <span className="font-bold text-orange-400">{streak.current} days</span>
              </div>
              <div>
                Longest Streak: <span className="font-bold text-foreground">{streak.longest} days</span>
              </div>
            </div>
          </div>

          {/* GitHub-like contribution grid */}
          <div className="w-full overflow-x-auto pb-2 scrollbar-none">
            <div className="flex gap-1.5 w-max">
              {/* Day names list */}
              <div className="flex flex-col justify-between text-[8px] text-muted-foreground py-1 select-none pr-1">
                <span>Sun</span>
                <span>Tue</span>
                <span>Thu</span>
                <span>Sat</span>
              </div>

              {/* Grid block container */}
              <div className="grid grid-flow-col grid-rows-7 gap-1">
                {streakCalendarGrid.map((day, idx) => {
                  // Color scale depending on count
                  let colorClass = "bg-border/20 hover:scale-125 hover:border-foreground/30 border border-transparent";
                  if (day.count === 1) colorClass = "bg-primary/35 hover:scale-125 hover:border-primary/60 border border-transparent cursor-help";
                  if (day.count === 2) colorClass = "bg-primary/70 hover:scale-125 hover:border-primary border border-transparent cursor-help";
                  if (day.count >= 3) colorClass = "bg-primary hover:scale-125 hover:border-primary border border-transparent cursor-help";

                  return (
                    <div
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-[2px] transition-all duration-300 ${colorClass}`}
                      title={`${day.label}: ${day.count} ${day.count === 1 ? 'item' : 'items'} completed`}
                    />
                  );
                })}
              </div>
            </div>
            
            {/* Grid Legend */}
            <div className="flex items-center gap-1.5 mt-4 text-[9px] text-muted-foreground justify-end pr-2">
              <span>Less</span>
              <div className="w-2.5 h-2.5 rounded-[1px] bg-border/20" />
              <div className="w-2.5 h-2.5 rounded-[1px] bg-primary/35" />
              <div className="w-2.5 h-2.5 rounded-[1px] bg-primary/70" />
              <div className="w-2.5 h-2.5 rounded-[1px] bg-primary" />
              <span>More</span>
            </div>
          </div>
        </div>

        {/* 3. Interactive Chart & General Info Grid */}
        <div className="grid gap-6 md:grid-cols-3">
          
          {/* Main Chart Card */}
          <div className="glass p-6 rounded-2xl border border-border/15 md:col-span-2 flex flex-col justify-between min-h-[350px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">
                  History
                </span>
                <h3 className="text-base font-bold text-foreground">Completions & Time Chart</h3>
              </div>
              
              {/* Toggles */}
              <div className="flex flex-wrap gap-2">
                {/* Metric Type */}
                <div className="inline-flex rounded-lg bg-secondary/30 p-1 border border-border/10">
                  <button
                    onClick={() => setMetricType("time")}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                      metricType === "time" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Time (min)
                  </button>
                  <button
                    onClick={() => setMetricType("completions")}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                      metricType === "completions" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Completions
                  </button>
                </div>

                {/* Interval Type */}
                <div className="inline-flex rounded-lg bg-secondary/30 p-1 border border-border/10">
                  <button
                    onClick={() => setIntervalType("daily")}
                    className={`rounded-md px-2.5 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                      intervalType === "daily" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    30D
                  </button>
                  <button
                    onClick={() => setIntervalType("weekly")}
                    className={`rounded-md px-2.5 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                      intervalType === "weekly" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    12W
                  </button>
                  <button
                    onClick={() => setIntervalType("monthly")}
                    className={`rounded-md px-2.5 py-0.5 text-[10px] font-bold transition-all cursor-pointer ${
                      intervalType === "monthly" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    12M
                  </button>
                </div>
              </div>
            </div>

            {/* Render CSS Columns Chart */}
            <div className="flex-1 flex items-end justify-between h-48 pt-6 border-b border-border/10 px-2 select-none relative">
              
              {/* If no data */}
              {activeChartData.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                  No activity tracked for this interval.
                </div>
              )}

              {activeChartData.map((d: any, idx: number) => {
                const heightPercent = maxChartValue > 0 ? (d.value / maxChartValue) * 100 : 0;
                
                // Limit rendering dense labels for daily view
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
                Average completion duration: <span className="font-bold text-foreground">{average_completion_time} minutes</span> per queue item.
              </span>
            </div>
          </div>

          {/* Insights Panel: Category distribution */}
          <div className="glass p-6 rounded-2xl border border-border/15 flex flex-col justify-between">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-1">
                Category
              </span>
              <h3 className="text-base font-bold text-foreground mb-5">Reading Distribution</h3>
              
              <div className="space-y-4">
                {category_distribution.map((cat: any, idx: number) => {
                  const maxCount = Math.max(...category_distribution.map((c: any) => c.count), 1);
                  const percent = (cat.count / maxCount) * 100;
                  
                  // Simple color mappings
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
                          {cat.count} items ({cat.time_spent}m)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-border/25 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${percent}%` }}
                          className={`h-full ${colorClass} rounded-full`}
                        />
                      </div>
                    </div>
                  );
                })}

                {category_distribution.length === 0 && (
                  <p className="text-xs text-muted-foreground">No completed items in categories.</p>
                )}
              </div>
            </div>

            <div className="border-t border-border/10 pt-4 mt-6 text-[10px] text-muted-foreground flex items-center gap-1.5">
              <PieChart className="h-3 w-3 text-primary shrink-0" />
              <span>Categorized items optimize AI re-prioritizations.</span>
            </div>
          </div>

        </div>

        {/* 4. Bottom Grid: Most Viewed Categories, Top AI Recommended Topics, & Streak */}
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
                    <span className="text-xs text-muted-foreground font-bold">
                      {cat.views} opens
                    </span>
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

          {/* Top AI Recommended Topics Read */}
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
    </div>
  );
}
