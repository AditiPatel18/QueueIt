"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  LayersIcon,
  Loader2,
  Flame,
  Zap,
  Award,
  BookOpen,
  Inbox,
  ArrowLeft,
  Settings,
  User,
  Mail,
  Calendar,
  LogOutIcon,
  Activity,
  UserCheck,
  CheckCircle2,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import { useAnalytics, ANALYTICS_CACHE_KEY } from "@/hooks/use-swr-queries";
import { mutate } from "swr";
import type { User as SupabaseUser } from "@supabase/supabase-js";

const ICON_MAP = {
  Inbox: Inbox,
  BookOpen: BookOpen,
  Award: Award,
  Zap: Zap,
  Flame: Flame,
};

type ActiveSection = "account" | "activity" | "settings" | "logout";

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [updatingGoal, setUpdatingGoal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Profile Active Section State
  const [activeSection, setActiveSection] = useState<ActiveSection>("account");

  // Profile Form States
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [readingGoal, setReadingGoal] = useState("15");

  const { analytics, isLoading: analyticsLoading, error: analyticsError } = useAnalytics();

  useEffect(() => {
    const getUser = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setDisplayName(user.user_metadata?.full_name || "");
        setAvatarUrl(user.user_metadata?.avatar_url || "");
        setReadingGoal(String(user.user_metadata?.daily_reading_goal_minutes || "15"));
      }
      setUserLoading(false);
    };
    getUser();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setUpdatingProfile(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.updateUser({
        data: {
          full_name: displayName.trim(),
          avatar_url: avatarUrl.trim(),
        },
      });

      if (error) throw error;

      if (data.user) {
        setUser(data.user);
      }

      toast.success("Profile updated successfully!");
    } catch (err: any) {
      toast.error("Failed to update profile", { description: err.message });
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleUpdateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setUpdatingGoal(true);

    try {
      const supabase = createClient();
      const goalNum = parseInt(readingGoal, 10) || 15;

      const { data, error } = await supabase.auth.updateUser({
        data: {
          daily_reading_goal_minutes: goalNum,
        },
      });

      if (error) throw error;

      if (data.user) {
        setUser(data.user);
      }

      toast.success("Daily reading goal updated successfully!");
      // Mutate analytics SWR cache so the goal updates immediately in consistency section
      mutate(ANALYTICS_CACHE_KEY);
    } catch (err: any) {
      toast.error("Failed to update daily goal", { description: err.message });
    } finally {
      setUpdatingGoal(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const getInitials = (supabaseUser: SupabaseUser) => {
    const name = displayName || supabaseUser.user_metadata?.full_name || supabaseUser.email || "U";
    return name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getDisplayName = (supabaseUser: SupabaseUser) => {
    return displayName || supabaseUser.user_metadata?.full_name || supabaseUser.email?.split("@")[0] || "User";
  };

  const getJoinedDate = (supabaseUser: SupabaseUser) => {
    if (!supabaseUser.created_at) return "Unknown";
    return new Date(supabaseUser.created_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center flex-col gap-4 bg-background text-foreground">
        <p className="text-muted-foreground text-sm font-semibold">Please log in to view your profile.</p>
        <Link href="/login">
          <Button size="sm">Go to Login</Button>
        </Link>
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
  } = analytics || {};

  // Calculate percentage of daily goal achieved
  const goalGoal = daily_reading_goal_minutes || 15;
  const goalTime = daily_reading_time_minutes || 0;
  const goalPercentage = Math.min(100, Math.round((goalTime / goalGoal) * 100));

  // Max value for weekly chart scaling
  const maxSaves = Math.max(...weekly_saves, 0);
  const maxCompletions = Math.max(...weekly_completions, 0);
  const chartMax = Math.max(maxSaves, maxCompletions, 3);

  const sections = [
    { id: "account", label: "Account", icon: User },
    { id: "activity", label: "Activity Stats", icon: Activity },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "logout", label: "Log Out", icon: LogOutIcon },
  ] as const;

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.65_0.2_270_/_6%)] blur-[140px]" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.55_0.18_300_/_5%)] blur-[140px]" />
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
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Analytics
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Main content layout */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/10 pb-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border border-border/30 ring-2 ring-primary/10">
              <AvatarImage src={avatarUrl || user.user_metadata?.avatar_url} alt={getDisplayName(user)} />
              <AvatarFallback className="bg-primary/20 text-primary text-lg font-bold">
                {getInitials(user)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{getDisplayName(user)}</h1>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{user.email}</p>
            </div>
          </div>
        </div>

        {/* Responsive Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-start">
          {/* Navigation Sidebar */}
          <div className="col-span-1 flex flex-row md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 md:border-r md:border-border/10 md:pr-4">
            {sections.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSection(sec.id)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs font-semibold tracking-wider uppercase transition-all text-left whitespace-nowrap cursor-pointer ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/20 border border-transparent"
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" />
                  {sec.label}
                </button>
              );
            })}
          </div>

          {/* Section Detail Panel */}
          <div className="col-span-1 md:col-span-3">
            {activeSection === "account" && (
              <div className="space-y-6">
                <Card className="glass border-border/20 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                      <UserCheck className="h-5 w-5 text-primary" /> Profile Settings
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Update your basic account profile credentials.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleUpdateProfile} className="space-y-4 max-w-lg">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Display Name</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Your full name"
                            className="pl-9 glass border-border/20"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Avatar Image URL</label>
                        <div className="relative">
                          <Camera className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="text"
                            value={avatarUrl}
                            onChange={(e) => setAvatarUrl(e.target.value)}
                            placeholder="https://example.com/avatar.jpg"
                            className="pl-9 glass border-border/20 font-mono text-xs"
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        disabled={updatingProfile}
                        className="gradient-primary text-white border-0 hover:opacity-90 cursor-pointer font-semibold text-xs py-2 px-4 rounded-lg mt-2 transition-all"
                      >
                        {updatingProfile ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Updating...
                          </>
                        ) : (
                          "Update Profile"
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card className="glass border-border/20 shadow-sm font-mono text-xs text-muted-foreground">
                  <CardContent className="pt-6 space-y-2">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-primary" />
                      <span>Email address:</span>
                      <span className="text-foreground font-bold font-sans">{user.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      <span>Account joined:</span>
                      <span className="text-foreground font-bold font-sans">{getJoinedDate(user)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeSection === "activity" && (
              <div className="space-y-6">
                {analyticsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : analyticsError ? (
                  <div className="glass p-6 rounded-2xl border border-border/15 text-center text-xs text-muted-foreground">
                    Failed to load activity statistics. Please try refreshing.
                  </div>
                ) : (
                  <>
                    {/* Streaks & Progress Cards */}
                    <div className="grid gap-6 md:grid-cols-2">
                      {/* Streak Card */}
                      <Card className="glass border-border/20 shadow-sm relative overflow-hidden">
                        <div className="absolute -top-10 -right-10 w-24 h-24 bg-orange-550/10 rounded-full blur-xl pointer-events-none" />
                        <CardHeader className="pb-2 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            Streak consistency
                          </CardTitle>
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-550/15 border border-orange-500/20">
                            <Flame className="h-4.5 w-4.5 text-orange-500 animate-pulse" />
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-baseline gap-2 mb-4">
                            <span className="text-3xl font-extrabold tracking-tight text-orange-400">
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
                        </CardContent>
                      </Card>

                      {/* Goal progress card */}
                      <Card className="glass border-border/20 shadow-sm relative overflow-hidden">
                        <div className="absolute -top-10 -right-10 w-24 h-24 bg-primary/10 rounded-full blur-xl pointer-events-none" />
                        <CardHeader className="pb-2 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            Daily progress
                          </CardTitle>
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 border border-primary/20">
                            <Zap className="h-4.5 w-4.5 text-primary" />
                          </div>
                        </CardHeader>
                        <CardContent className="flex flex-col justify-between h-[132px]">
                          <div>
                            <div className="flex items-baseline gap-2 mb-2">
                              <span className="text-3xl font-extrabold tracking-tight text-primary">
                                {goalTime}
                              </span>
                              <span className="text-xs text-muted-foreground font-semibold">
                                / {goalGoal} minutes completed
                              </span>
                            </div>
                            
                            <div className="w-full bg-secondary/50 rounded-full h-2.5 overflow-hidden border border-border/20">
                              <div
                                style={{ width: `${goalPercentage}%` }}
                                className={`h-full gradient-primary rounded-full transition-all duration-500 glow-primary ${
                                  goalPercentage === 100 ? "bg-emerald-500" : ""
                                }`}
                              />
                            </div>
                          </div>

                          <div className="space-y-2 border-t border-border/10 pt-3 text-xs mt-4">
                            <div className="flex justify-between text-muted-foreground">
                              <span>Goal achieved</span>
                              <span className={`font-bold ${goalPercentage === 100 ? "text-emerald-500" : "text-foreground"}`}>
                                {goalPercentage}%
                              </span>
                            </div>
                            <div className="flex justify-between text-muted-foreground">
                              <span>Total completed</span>
                              <span className="font-bold text-foreground">{total_completed} items</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Weekly Activity chart */}
                    <Card className="glass border-border/20 shadow-sm relative overflow-hidden">
                      <CardHeader className="pb-3 flex flex-row items-center justify-between">
                        <div>
                          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            Weekly Saves & Completions
                          </CardTitle>
                        </div>
                        <div className="flex gap-3 text-[10px] font-bold uppercase tracking-wider">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded bg-primary" />
                            <span className="text-muted-foreground font-semibold">Saves</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded bg-emerald-500" />
                            <span className="text-muted-foreground font-semibold">Completions</span>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <div className="flex items-end justify-between h-36 pt-4 px-2">
                          {weekly_labels.map((label: string, index: number) => {
                            const savesVal = weekly_saves[index] || 0;
                            const completionsVal = weekly_completions[index] || 0;

                            const savesPercent = (savesVal / chartMax) * 100;
                            const completionsPercent = (completionsVal / chartMax) * 100;

                            return (
                              <div key={index} className="flex flex-col items-center flex-1 group/bar">
                                <div className="relative w-12 flex justify-center gap-1.5 h-28 items-end">
                                  {/* Saves Bar */}
                                  <div
                                    style={{ height: `${Math.max(savesPercent, 3)}%` }}
                                    className={`w-3.5 rounded-t-sm transition-all duration-500 bg-primary/75 hover:bg-primary shadow-sm relative ${
                                      savesVal > 0 ? "opacity-100" : "opacity-20"
                                    }`}
                                  >
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
                                <span className="text-[10px] text-muted-foreground mt-2 font-semibold group-hover/bar:text-foreground transition-colors">
                                  {label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Badges and achievements */}
                    {badges.length > 0 ? (
                      <Card className="glass border-border/20 shadow-sm">
                        <CardHeader className="pb-3 border-b border-border/10 flex flex-row items-center gap-2">
                          <Award className="h-4.5 w-4.5 text-primary animate-float" />
                          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            Earned Badges
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                            {badges.map((badge: any) => {
                              const BadgeIcon = ICON_MAP[badge.icon as keyof typeof ICON_MAP] || Award;
                              return (
                                <div
                                  key={badge.id}
                                  className="flex items-center gap-3 p-3 rounded-xl border border-border/10 hover:border-primary/15 transition-all bg-secondary/10 hover:bg-secondary/20"
                                >
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-primary text-white shadow-sm glow-primary">
                                    <BadgeIcon className="h-4.5 w-4.5" />
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="text-xs font-bold truncate">{badge.title}</h4>
                                    <p className="text-[9px] text-muted-foreground truncate leading-relaxed">
                                      {badge.description}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="glass border-border/20 border-dashed py-8 text-center text-xs text-muted-foreground">
                        No achievements earned yet. Add and complete items to unlock badges!
                      </Card>
                    )}
                  </>
                )}
              </div>
            )}

            {activeSection === "settings" && (
              <Card className="glass border-border/20 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                    <Settings className="h-5 w-5 text-primary" /> Application Preferences
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Configure your daily learning targets and UI settings.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleUpdateGoal} className="space-y-6 max-w-lg">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Daily Reading Goal
                      </label>
                      <CardDescription className="text-[10px] mb-2 leading-relaxed">
                        Setting a goal helps you build consistency. Streaks track completed articles and videos toward this daily time goal.
                      </CardDescription>
                      <select
                        value={readingGoal}
                        onChange={(e) => setReadingGoal(e.target.value)}
                        className="w-full text-sm px-3.5 py-2.5 rounded-lg border bg-secondary/30 text-muted-foreground border-border/20 cursor-pointer hover:border-border/40 transition-all outline-none"
                      >
                        <option value="5">5 minutes / day</option>
                        <option value="10">10 minutes / day</option>
                        <option value="15">15 minutes / day</option>
                        <option value="30">30 minutes / day</option>
                        <option value="45">45 minutes / day</option>
                        <option value="60">60 minutes / day</option>
                      </select>
                    </div>

                    <div className="border-t border-border/10 pt-4 space-y-1">
                      <h4 className="text-xs font-bold text-foreground">Appearance / Theme</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        QueueIt is built with a custom default dark glassmorphic styling system to provide a premium, modern environment for reading. Light mode settings are currently unavailable.
                      </p>
                    </div>

                    <Button
                      type="submit"
                      disabled={updatingGoal}
                      className="gradient-primary text-white border-0 hover:opacity-90 cursor-pointer font-semibold text-xs py-2 px-4 rounded-lg transition-all"
                    >
                      {updatingGoal ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save Goal settings"
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {activeSection === "logout" && (
              <Card className="glass border-border/20 border-red-500/10 shadow-sm max-w-md">
                <CardHeader>
                  <CardTitle className="text-lg font-bold text-destructive">Sign Out Account</CardTitle>
                  <CardDescription className="text-xs">
                    Are you sure you want to sign out of your QueueIt account?
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    You will need to re-authenticate with your email and password to access your content queues, collection folders, and AI assistants.
                  </p>
                  <div className="flex gap-3 mt-4">
                    <Button
                      variant="ghost"
                      onClick={() => setActiveSection("account")}
                      className="text-xs font-semibold cursor-pointer border border-border/20 px-4 py-2 hover:bg-secondary/45"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="bg-destructive hover:bg-destructive/90 text-white font-semibold text-xs py-2 px-4 rounded-lg cursor-pointer"
                    >
                      {loggingOut ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Signing Out...
                        </>
                      ) : (
                        "Yes, Sign Out"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
