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
import { getItems, recalculatePriorities, getStreakData, getItem } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { QueueItem, StatusFilter, TypeFilter, SortOption } from "@/types";

function mapDbItemToQueueItem(dbItem: any): QueueItem {
  let tags: string[] = [];
  if (dbItem.tags) {
    if (Array.isArray(dbItem.tags)) {
      tags = dbItem.tags;
    } else if (typeof dbItem.tags === 'string') {
      tags = dbItem.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }

  return {
    id: dbItem.id,
    user_id: dbItem.user_id,
    url: dbItem.url,
    title: dbItem.title,
    description: dbItem.description,
    content_type: dbItem.content_type || "generic",
    source_name: dbItem.source_name,
    thumbnail_url: dbItem.thumbnail_url,
    estimated_read_time: dbItem.estimated_read_time,
    duration_seconds: dbItem.duration_seconds,
    extracted_text: dbItem.extracted_text,
    author: dbItem.author,
    tags,
    ai_summary: dbItem.ai_summary,
    priority_score: dbItem.priority_score ?? 50.0,
    status: dbItem.status || "unread",
    processing_status: dbItem.processing_status || "completed",
    is_favorite: !!dbItem.is_favorite,
    created_at: dbItem.created_at || dbItem.added_at,
    audio_url: dbItem.audio_url,
  };
}

function sortItems(itemsList: QueueItem[], sortOption: SortOption): QueueItem[] {
  return [...itemsList].sort((a, b) => {
    if (sortOption === "priority") {
      return (b.priority_score ?? 0) - (a.priority_score ?? 0);
    }
    if (sortOption === "shortest") {
      return (a.estimated_read_time ?? 0) - (b.estimated_read_time ?? 0);
    }
    if (sortOption === "longest") {
      return (b.estimated_read_time ?? 0) - (a.estimated_read_time ?? 0);
    }
    const dateA = new Date(a.created_at || a.added_at || 0).getTime();
    const dateB = new Date(b.created_at || b.added_at || 0).getTime();
    return dateB - dateA;
  });
}

function matchesFilters(
  item: QueueItem,
  statusFilter: StatusFilter,
  typeFilter: TypeFilter,
  activeTag: string | null,
  search: string
): boolean {
  if (statusFilter !== "all" && item.status !== statusFilter) return false;
  if (typeFilter !== "all" && item.content_type !== typeFilter) return false;
  if (activeTag && !item.tags.includes(activeTag)) return false;
  if (search) {
    const s = search.toLowerCase();
    const titleMatch = item.title?.toLowerCase().includes(s);
    const descMatch = item.description?.toLowerCase().includes(s);
    if (!titleMatch && !descMatch) return false;
  }
  return true;
}


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

  const [visibleCount, setVisibleCount] = useState(15);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFilters = search || activeTag || statusFilter !== "all" || typeFilter !== "all" || sort !== "newest";

  // Load from localStorage instantly on mount to avoid layout shift
  useEffect(() => {
    const cached = localStorage.getItem("queueit_items_cache");
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setItems(parsed);
          setTotal(parsed.length);
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed to parse cached items", e);
      }
    }
  }, []);

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
          limit: 100, // Load a larger batch so we don't have to refetch
        });

        if (!res) throw new Error("Failed to fetch items");

        let fetchedItems: QueueItem[] = [];
        let fetchedTotal = 0;

        if (res && typeof res === "object" && "items" in res) {
          fetchedItems = res.items as QueueItem[];
          fetchedTotal = res.total as number;
        } else if (Array.isArray(res)) {
          fetchedItems = res as QueueItem[];
          fetchedTotal = res.length;
        }

        setItems(fetchedItems);
        setTotal(fetchedTotal);

        // Cache queue
        localStorage.setItem("queueit_items_cache", JSON.stringify(fetchedItems));
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

  // Realtime subscription for items table - incremental state updates
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
        (payload) => {
          console.log("[Realtime] received event:", payload.eventType, payload);
          if (payload.eventType === "INSERT") {
            const newItem = mapDbItemToQueueItem(payload.new);
            if (!matchesFilters(newItem, statusFilter, typeFilter, activeTag, search)) return;
            setItems((prev) => {
              if (prev.some((item) => item.id === newItem.id)) return prev;
              const next = [newItem, ...prev];
              const sorted = sortItems(next, sort);
              localStorage.setItem("queueit_items_cache", JSON.stringify(sorted));
              return sorted;
            });
            setTotal((prev) => prev + 1);
          } else if (payload.eventType === "UPDATE") {
            const updatedItem = mapDbItemToQueueItem(payload.new);
            setItems((prev) => {
              let next = prev.map((item) => (item.id === updatedItem.id ? updatedItem : item));
              if (!matchesFilters(updatedItem, statusFilter, typeFilter, activeTag, search)) {
                next = next.filter((item) => item.id !== updatedItem.id);
              }
              const sorted = sortItems(next, sort);
              localStorage.setItem("queueit_items_cache", JSON.stringify(sorted));
              return sorted;
            });
          } else if (payload.eventType === "DELETE") {
            const deletedId = payload.old.id;
            setItems((prev) => {
              const next = prev.filter((item) => item.id !== deletedId);
              localStorage.setItem("queueit_items_cache", JSON.stringify(next));
              return next;
            });
            setTotal((prev) => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sort, statusFilter, typeFilter, activeTag, search]);

  // Reset visibleCount when filters change
  useEffect(() => {
    setVisibleCount(15);
  }, [search, activeTag, statusFilter, typeFilter, sort]);

  // Unified Poller for processing items - runs every 2s
  useEffect(() => {
    const processingItems = items.filter((item) => item.processing_status === "processing");
    if (processingItems.length === 0) return;

    const interval = setInterval(() => {
      processingItems.forEach(async (pItem) => {
        try {
          const updated = await getItem(pItem.id);
          if (updated && updated.processing_status !== "processing") {
            setItems((prev) => {
              const next = prev.map((item) => (item.id === pItem.id ? mapDbItemToQueueItem(updated) : item));
              localStorage.setItem("queueit_items_cache", JSON.stringify(next));
              return next;
            });
          }
        } catch (e) {
          console.error("Poller failed for item", pItem.id, e);
        }
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [items]);

  // IntersectionObserver for incremental virtualization
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 15, items.length));
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => {
      if (sentinel) {
        observer.unobserve(sentinel);
      }
    };
  }, [items.length, visibleCount]);

  // Optimistic Handlers
  const handleStatusChangeOptimistic = useCallback(async (id: string, newStatus: QueueItem["status"]) => {
    const oldItems = [...items];
    
    setItems((prev) => {
      const next = prev.map((item) => {
        if (item.id === id) {
          return { ...item, status: newStatus };
        }
        return item;
      });
      const filtered = next.filter((item) => matchesFilters(item, statusFilter, typeFilter, activeTag, search));
      localStorage.setItem("queueit_items_cache", JSON.stringify(filtered));
      return filtered;
    });

    try {
      const res = await updateItem(id, { status: newStatus });
      if (res && typeof res === 'object' && 'detail' in res) throw new Error((res as any).detail);
      toast.success(newStatus === "completed" ? "Marked as complete! ✓" : "Status updated");
    } catch (e: any) {
      setItems(oldItems);
      localStorage.setItem("queueit_items_cache", JSON.stringify(oldItems));
      toast.error("Failed to update status", { description: e.message });
    }
  }, [items, statusFilter, typeFilter, activeTag, search]);

  const handleFavoriteToggleOptimistic = useCallback(async (id: string) => {
    const oldItems = [...items];
    let isFav = false;
    
    setItems((prev) => {
      const next = prev.map((item) => {
        if (item.id === id) {
          isFav = !item.is_favorite;
          return { ...item, is_favorite: isFav };
        }
        return item;
      });
      localStorage.setItem("queueit_items_cache", JSON.stringify(next));
      return next;
    });

    try {
      const res = await updateItem(id, { is_favorite: isFav });
      if (res && typeof res === 'object' && 'detail' in res) throw new Error((res as any).detail);
      toast.success(isFav ? "Added to favorites ★" : "Removed from favorites");
    } catch (e: any) {
      setItems(oldItems);
      localStorage.setItem("queueit_items_cache", JSON.stringify(oldItems));
      toast.error("Failed to update favorite", { description: e.message });
    }
  }, [items]);

  const handleDeleteOptimistic = useCallback(async (id: string) => {
    const oldItems = [...items];
    
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      localStorage.setItem("queueit_items_cache", JSON.stringify(next));
      return next;
    });
    setTotal((prev) => Math.max(0, prev - 1));

    try {
      const res = await deleteItem(id);
      if (res && typeof res === 'object' && 'detail' in res) throw new Error((res as any).detail);
      toast.success("Item deleted");
    } catch (e: any) {
      setItems(oldItems);
      setTotal(oldItems.length);
      localStorage.setItem("queueit_items_cache", JSON.stringify(oldItems));
      toast.error("Failed to delete item", { description: e.message });
    }
  }, [items]);

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
          {items.slice(0, visibleCount).map((item) => (
            <QueueItemCard
              key={item.id}
              item={item}
              onUpdate={handleRefresh}
              onTagClick={handleTagClick}
              onDeleteOptimistic={handleDeleteOptimistic}
              onStatusChangeOptimistic={handleStatusChangeOptimistic}
              onFavoriteToggleOptimistic={handleFavoriteToggleOptimistic}
            />
          ))}
          {items.length > visibleCount && (
            <div ref={sentinelRef} className="h-10 flex items-center justify-center pt-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
