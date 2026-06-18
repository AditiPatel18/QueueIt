"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { QueueItemCard, QueueCardSkeleton } from "@/components/queue-item-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddItemDialog } from "@/components/add-item-dialog";
import {
  Loader2,
  Inbox,
  Plus,
  RefreshCw,
  Search,
  Filter,
  X,
  Sparkles,
  Flame,
  Zap,
  Award,
} from "lucide-react";
import { toast } from "sonner";
import { getItems, recalculatePriorities, getStreakData } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { QueueItem, StatusFilter, TypeFilter, SortOption } from "@/types";

interface QueueListProps {
  refreshSignal?: number;
  onRefresh?: () => void;
  initialStatusFilter?: StatusFilter;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "reading", label: "Reading" },
  { value: "completed", label: "Completed" },
];

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "article", label: "Articles" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "Twitter/X" },
  { value: "reddit", label: "Reddit" },
  { value: "github", label: "GitHub" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "priority", label: "Priority" },
  { value: "shortest", label: "Shortest" },
  { value: "longest", label: "Longest" },
];

export function QueueList({ refreshSignal, onRefresh, initialStatusFilter }: QueueListProps) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [streak, setStreak] = useState<any>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter || "all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");

  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilters = search || activeTag || statusFilter !== "all" || typeFilter !== "all" || sort !== "newest";

  const fetchItems = useCallback(
    async (opts: { showRefreshing?: boolean } = {}) => {
      if (opts.showRefreshing) setRefreshing(true);

      try {
        getStreakData()
          .then((data) => setStreak(data))
          .catch((err) => console.error("Failed to load streak:", err));

        const res = await getItems({
          status: statusFilter !== "all" ? statusFilter : undefined,
          type: typeFilter !== "all" ? typeFilter : undefined,
          tag: activeTag || undefined,
          search: search || undefined,
          sort,
          limit: 50,
        });

        if (!res) throw new Error("Failed to fetch items");

        if (res && typeof res === "object" && "items" in res) {
          setItems(res.items as QueueItem[]);
          setTotal(res.total as number);
        } else if (Array.isArray(res)) {
          setItems(res as QueueItem[]);
          setTotal(res.length);
        } else {
          setItems([]);
          setTotal(0);
        }
      } catch (err: any) {
        console.error("[QueueList] fetch error:", err);
        const message = typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err, null, 2);
        toast.error("Failed to load queue", { description: message });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, activeTag, statusFilter, typeFilter, sort, refreshSignal]
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetchItems();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchItems]);

  // Refresh on window focus or visibility change
  useEffect(() => {
    const handleFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        fetchItems();
      }
    };
    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);
    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
    };
  }, [fetchItems]);

  // Realtime subscription for items table
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("items-realtime-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "items",
        },
        () => {
          fetchItems();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchItems]);

  const handleRefresh = () => {
    fetchItems({ showRefreshing: true });
    onRefresh?.();
  };

  const handleTagClick = (tag: string) => {
    setActiveTag(tag === activeTag ? null : tag);
  };

  const clearFilters = () => {
    setSearch("");
    setActiveTag(null);
    setStatusFilter("all");
    setTypeFilter("all");
    setSort("newest");
    if (searchInputRef.current) searchInputRef.current.value = "";
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const res = await recalculatePriorities();
      if (res) {
        toast.success(`Priorities recalculated for ${res.updated ?? 0} items`);
        fetchItems({ showRefreshing: true });
      }
    } catch (err: any) {
      const message = typeof err === "string" ? err : err instanceof Error ? err.message : JSON.stringify(err, null, 2);
      toast.error("Failed to recalculate", { description: message });
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <div>
      {/* Search + Filter bar */}
      <div className="space-y-3 mb-6">
        {/* Search row */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search your queue..."
              defaultValue={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 glass border-border/20"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Filter chips row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Status filter */}
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all cursor-pointer ${
                  statusFilter === opt.value
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-secondary/30 text-muted-foreground border-border/20 hover:border-border/40"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-border/40 mx-1 hidden sm:block" />

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="text-xs px-3 py-1.5 rounded-full border bg-secondary/30 text-muted-foreground border-border/20 cursor-pointer hover:border-border/40 transition-all outline-none"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="text-xs px-3 py-1.5 rounded-full border bg-secondary/30 text-muted-foreground border-border/20 cursor-pointer hover:border-border/40 transition-all outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>

          {/* Active tag badge */}
          {activeTag && (
            <div className="flex items-center gap-1 text-xs bg-primary/15 text-primary border border-primary/30 px-2 py-1 rounded-full">
              <Filter className="h-3 w-3" />
              #{activeTag}
              <button
                onClick={() => setActiveTag(null)}
                className="hover:text-primary/60 transition-colors cursor-pointer ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* List header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{total}</span>{" "}
          {total === 1 ? "item" : "items"}
          {statusFilter !== "all" && ` · ${statusFilter}`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRecalculate}
          disabled={recalculating}
          className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          title="Recalculate AI priorities"
        >
          {recalculating ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Recalculate priorities
        </Button>
      </div>

      {/* Stats and Recommendations */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4">
          <div className="glass p-4 rounded-xl border border-border/20">
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Estimated Time</p>
            <p className="text-2xl font-semibold">
              {Math.round(items.reduce((acc, item) => acc + (item.duration_seconds ?? 0), 0) / 60)}h
            </p>
          </div>
          <div className="glass p-4 rounded-xl border border-border/20">
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Focus Score</p>
            <p className="text-2xl font-semibold">
              {items.length > 0 
                ? Math.round(items.reduce((acc, item) => acc + (item.priority_score ?? 0), 0) / items.length) 
                : 0}
            </p>
          </div>
        </div>
        <div className="glass p-4 rounded-xl border border-border/20 bg-primary/5 border-primary/10">
          <p className="text-xs text-primary/80 font-medium mb-1 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> AI Recommendation
          </p>
          <p className="text-sm font-medium">
            {items[0] ? `Focus on "${items[0].title}" next` : "Add items to get recommendations"}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <QueueCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        /* Empty state */
        <Card className="glass border-border/20 border-dashed mt-4">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
              <Inbox className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {hasFilters ? "No items match your filters" : "Your queue is empty"}
            </h2>
            <p className="max-w-md text-muted-foreground mb-8">
              {hasFilters
                ? "Try adjusting your search or filters to find what you're looking for."
                : "Start saving articles, videos, tweets, GitHub repos, and more. Everything you want to consume later will appear here."}
            </p>
            {hasFilters ? (
              <Button
                variant="outline"
                onClick={clearFilters}
                className="cursor-pointer"
              >
                <X className="mr-2 h-4 w-4" />
                Clear filters
              </Button>
            ) : (
              <AddItemDialog
                trigger={
                  <Button
                    id="empty-state-add-btn"
                    className="gradient-primary text-white border-0 hover:opacity-90 transition-opacity glow-primary cursor-pointer"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add your first item
                  </Button>
                }
                onItemAdded={handleRefresh}
              />
            )}
          </CardContent>
        </Card>
      ) : (
        /* Items list */
        <div className="space-y-3">
          {items.map((item) => (
            <QueueItemCard
              key={item.id}
              item={item}
              onUpdate={handleRefresh}
              onTagClick={handleTagClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
