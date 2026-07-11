"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  Plus,
  Loader2,
  Sparkles,
  User,
  ChevronDownIcon,
  Inbox,
} from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { AddItemDialog } from "@/components/add-item-dialog";
import { QueueList } from "@/components/queue-list";
import { CollectionsSidebar } from "@/components/collections-sidebar";
import { RemindersPopover } from "@/components/reminders-popover";
import { toast } from "sonner";
import { getItem } from "@/lib/api";


function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Support both ?item= (reminder emails) and ?item_id= (legacy deep-links)
  const queryItemId = searchParams?.get("item") || searchParams?.get("item_id");
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Verify deep-linked item existence and show toast if missing
  useEffect(() => {
    if (queryItemId) {
      const verifyItem = async () => {
        try {
          await getItem(queryItemId);
        } catch (err) {
          console.error("Error verifying deep linked item:", err);
          toast.error("Item not found. Redirecting to your dashboard.");
          router.replace("/dashboard");
        }
      };
      verifyItem();
    }
  }, [queryItemId, router]);

  // Folders filtering state
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

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

  const handleItemAdded = useCallback(() => {
    setRefreshSignal((s) => s + 1);
  }, []);

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
            <Link href="/chat">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                AI Chat
              </Button>
            </Link>

            <Link href="/history">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                History
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

            <RemindersPopover />

            <AddItemDialog
              trigger={
                <Button
                  id="add-content-btn"
                  size="sm"
                  className="gradient-primary text-white border-0 hover:opacity-90 transition-opacity cursor-pointer glow-primary"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add Content
                </Button>
              }
              onItemAdded={handleItemAdded}
            />

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
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12 space-y-10">
        {/* Welcome section */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Welcome back,{" "}
            <span className="gradient-text">{user ? getDisplayName(user) : ""}</span>
          </h1>
          <p className="mt-2 text-muted-foreground text-lg">
            Your content queue is ready. What will you save today?
          </p>
        </div>



        {/* Collections side-by-side layout */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 items-start">
          {/* Folders navigation panel */}
          <div className="md:col-span-1 md:sticky md:top-24 max-h-[calc(100vh-120px)] overflow-y-auto border-r border-border/10 pr-6 scrollbar-none">
            <CollectionsSidebar
              selectedCollectionId={selectedCollectionId}
              onSelectCollection={setSelectedCollectionId}
            />
          </div>

          {/* Items queue */}
          <div className="md:col-span-3">
            <QueueList
              selectedCollectionId={selectedCollectionId}
              refreshSignal={refreshSignal}
              onRefresh={() => {}}
            />
          </div>
        </div>

        {/* Quick tips — shown below queue */}
        <div className="grid gap-4 md:grid-cols-3 pt-6 border-t border-border/10">
          {[
            {
              icon: Sparkles,
              title: "Paste any URL",
              description: "We'll automatically detect the content type and extract metadata.",
            },
            {
              icon: LayersIcon,
              title: "Organize with folders",
              description: "Create custom folders/collections to categorize and structure your queues.",
            },
            {
              icon: Inbox,
              title: "Read distraction-free",
              description: "Open articles in a clean reader view, right inside QueueIt.",
            },
          ].map((tip) => (
            <div
              key={tip.title}
              className="rounded-xl glass p-5 transition-all duration-300 hover:border-primary/15"
            >
              <tip.icon className="mb-3 h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold mb-1">{tip.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {tip.description}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
