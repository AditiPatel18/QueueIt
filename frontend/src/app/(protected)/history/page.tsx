"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  ArrowLeftIcon,
  CheckCircle2,
  Clock,
  Flame,
} from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { QueueList } from "@/components/queue-list";
import { useHistoryStats } from "@/hooks/use-swr-queries";
import Link from "next/link";
import { RemindersPopover } from "@/components/reminders-popover";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

export default function HistoryPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const { stats, isLoading: statsLoading } = useHistoryStats();

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 -left-40 h-[400px] w-[400px] rounded-full bg-[oklch(0.5_0.2_270_/_8%)] blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[400px] w-[400px] rounded-full bg-[oklch(0.45_0.18_300_/_6%)] blur-[120px]" />
      </div>

      {/* Navigation */}
      <Navbar />

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            History
          </h1>
          <p className="mt-2 text-muted-foreground text-lg">
            Review your completed items.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-10">
          <div className="p-5 rounded-2xl glass border border-border/10 flex items-center gap-4 bg-secondary/5">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Completed Items</p>
              <h3 className="text-2xl font-bold mt-0.5">{statsLoading ? "..." : stats.items_completed}</h3>
            </div>
          </div>

          <div className="p-5 rounded-2xl glass border border-border/10 flex items-center gap-4 bg-secondary/5">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Time Consumed</p>
              <h3 className="text-2xl font-bold mt-0.5">
                {statsLoading ? "..." : `${Math.ceil(stats.total_time_consumed)}m`}
              </h3>
            </div>
          </div>

          <div className="p-5 rounded-2xl glass border border-border/10 flex items-center gap-4 bg-secondary/5">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <Flame className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Completion Streak</p>
              <h3 className="text-2xl font-bold mt-0.5">
                {statsLoading ? "..." : `${stats.completion_streak} days`}
              </h3>
            </div>
          </div>

          <div className="p-5 rounded-2xl glass border border-border/10 flex items-center gap-4 bg-secondary/5">
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <LayersIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Top Category</p>
              <h3 className="text-sm font-bold mt-0.5 truncate max-w-[150px]">
                {statsLoading ? "..." : (stats.top_categories?.[0]?.category ? `${stats.top_categories[0].category.toUpperCase()} (${stats.top_categories[0].count})` : "None")}
              </h3>
            </div>
          </div>
        </div>

        {/* History list */}
        <QueueList initialStatusFilter="completed" isHistoryView={true} />
      </main>

      {/* Shared Footer */}
      <Footer />
    </div>
  );
}
