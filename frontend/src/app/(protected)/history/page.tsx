"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
} from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { QueueList } from "@/components/queue-list";
import Link from "next/link";

export default function HistoryPage() {
  const router = useRouter();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

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
                className="glass-strong border-border/30"
              >
                <ArrowLeftIcon className="mr-1 h-4 w-4" />
                Back to Dashboard
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
                  <DropdownMenuItem className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </DropdownMenuItem>
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
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            History
          </h1>
          <p className="mt-2 text-muted-foreground text-lg">
            Review your completed items.
          </p>
        </div>

        {/* History list */}
        <QueueList initialStatusFilter="completed" />
      </main>
    </div>
  );
}
