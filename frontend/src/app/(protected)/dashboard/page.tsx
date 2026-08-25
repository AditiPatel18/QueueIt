"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  Plus,
  Loader2,
  Sparkles,
  User,
  ChevronDownIcon,
  Inbox,
} from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import { QueueList } from "@/components/queue-list";
import { CollectionsSidebar } from "@/components/collections-sidebar";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { toast } from "sonner";
import { getItem } from "@/lib/api";

const AddItemDialog = dynamic(
  () => import("@/components/add-item-dialog").then((m) => ({ default: m.AddItemDialog })),
  { ssr: false, loading: () => null }
);

const RemindersPopover = dynamic(
  () => import("@/components/reminders-popover").then((m) => ({ default: m.RemindersPopover })),
  { ssr: false, loading: () => null }
);


function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Support both ?item= (reminder emails) and ?item_id= (legacy deep-links)
  const queryItemId = searchParams?.get("item") || searchParams?.get("item_id");
  const { user, loading } = useAuth();
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

  const CONTENT_TYPES = [
    "Articles",
    "Videos",
    "PDFs",
    "GitHub Repositories",
    "Web Pages",
  ];
  const [contentTypeIndex, setContentTypeIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setContentTypeIndex((prev) => (prev + 1) % CONTENT_TYPES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

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
      <Navbar onItemAdded={handleItemAdded} />

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12 space-y-10">
        {/* Welcome section with animated rotating text */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Welcome back,{" "}
            <span className="gradient-text">{user ? getDisplayName(user) : ""}</span>
          </h1>
          <p className="mt-2 text-muted-foreground text-base sm:text-lg flex flex-wrap items-center gap-1.5">
            <span>Ready to queue your next</span>
            <span className="inline-block relative h-7 w-[210px] overflow-hidden align-middle">
              <span
                key={contentTypeIndex}
                className="absolute inset-0 font-bold gradient-text flex items-center animate-in fade-in slide-in-from-bottom-1 duration-300"
              >
                {CONTENT_TYPES[contentTypeIndex]}
              </span>
            </span>
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

      {/* Shared Footer */}
      <Footer />
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
