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
  CheckCircle,
  FolderOpen,
  Trash2,
  Heart,
  CheckCircle2,
  Archive,
  CircleDot,
  Check,
  FolderSync,
} from "lucide-react";
import { toast } from "sonner";
import { useItems, useCollections, useAnalytics, useRecommendation, ITEMS_CACHE_KEY, ANALYTICS_CACHE_KEY, RECOMMENDATION_CACHE_KEY, STREAK_HEATMAP_CACHE_KEY } from "@/hooks/use-swr-queries";
import { mutate } from "swr";
import { recalculatePriorities, bulkItemsAction } from "@/lib/api";
import type { QueueItem, StatusFilter, TypeFilter, SortOption } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function getHistoryGroup(completedAtStr: string | null | undefined): string {
  if (!completedAtStr) return "Older";
  try {
    const completedDate = new Date(completedAtStr);
    const now = new Date();
    
    // Clear times for day-level comparison
    const completedDay = new Date(completedDate.getFullYear(), completedDate.getMonth(), completedDate.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const diffTime = today.getTime() - completedDay.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return "Completed Today";
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return "Last Week";
    } else {
      return "Older";
    }
  } catch {
    return "Older";
  }
}

function formatTotalTime(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}


interface QueueListProps {
  refreshSignal?: number;
  onRefresh?: () => void;
  initialStatusFilter?: StatusFilter;
  selectedCollectionId?: string | null;
  isHistoryView?: boolean;
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

export function QueueList({
  refreshSignal,
  onRefresh,
  initialStatusFilter,
  selectedCollectionId = null,
  isHistoryView = false,
}: QueueListProps) {
  // Filters & Sorting state
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatusFilter || "all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");

  // Selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Virtualization / Pagination state
  const [visibleCount, setVisibleCount] = useState(15);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [recalculating, setRecalculating] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Folders list for bulk move dropdown
  const { collections } = useCollections();

  // Analytics & Recommendation queries
  const { analytics } = useAnalytics();
  const { recommendation, isLoading: recommendationLoading } = useRecommendation();

  const hasFilters =
    debouncedSearch ||
    activeTag ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    sort !== "newest" ||
    selectedCollectionId !== null;

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // SWR queries
  const filters = {
    status: isHistoryView ? "completed" : (statusFilter !== "all" ? statusFilter : undefined),
    type: typeFilter !== "all" ? typeFilter : undefined,
    tag: activeTag || undefined,
    collection_id: selectedCollectionId || undefined,
    search: debouncedSearch || undefined,
    sort,
    limit: 100, // Load a large batch for smooth client virtualization
  };

  const { items, total, isLoading, mutateItems } = useItems(filters);

  // Trigger refresh when refreshSignal changes
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal > 0) {
      mutateItems();
      mutate("api/collections");
      mutate(ANALYTICS_CACHE_KEY);
      mutate(STREAK_HEATMAP_CACHE_KEY);
      mutate(RECOMMENDATION_CACHE_KEY);
    }
  }, [refreshSignal, mutateItems]);

  // Automatically refresh collections counts/streak when a processing item finishes
  const processingCount = items.filter(item => item.processing_status === "processing").length;
  const prevProcessingCountRef = useRef(processingCount);

  useEffect(() => {
    if (prevProcessingCountRef.current > 0 && processingCount === 0) {
      mutate("api/collections");
      mutate(ANALYTICS_CACHE_KEY);
      mutate(STREAK_HEATMAP_CACHE_KEY);
      mutate(RECOMMENDATION_CACHE_KEY);
    }
    prevProcessingCountRef.current = processingCount;
  }, [processingCount]);

  // Reset pagination & selection when filters change
  useEffect(() => {
    setVisibleCount(15);
    setSelectedIds(new Set());
  }, [debouncedSearch, activeTag, statusFilter, typeFilter, sort, selectedCollectionId]);

  // Infinite Scroll IntersectionObserver
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

  // Handle select toggling
  const handleSelectToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    const visibleItems = items.slice(0, visibleCount);
    const allSelected = visibleItems.every((item) => selectedIds.has(item.id));

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all visible
        visibleItems.forEach((item) => next.delete(item.id));
      } else {
        // Select all visible
        visibleItems.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  // SWR mutation triggers for optimistic updates
  const handleStatusChangeOptimistic = useCallback(
    async (id: string, newStatus: QueueItem["status"]) => {
      const previousItems = [...items];
      const nextItems = items.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            status: newStatus,
            read_progress: newStatus === "completed" ? 100 : newStatus === "unread" ? 0 : item.read_progress,
          };
        }
        return item;
      });

      // Optimistic mutate SWR
      mutateItems({ items: nextItems, total: nextItems.length }, { revalidate: false });

      try {
        const { updateItem } = await import("@/lib/api");
        await updateItem(id, { status: newStatus });
        toast.success(newStatus === "completed" ? "Marked complete! ✓" : "Status updated");
        mutateItems();
        mutate(ANALYTICS_CACHE_KEY);
        mutate(STREAK_HEATMAP_CACHE_KEY);
        mutate(RECOMMENDATION_CACHE_KEY);
      } catch (err: any) {
        mutateItems({ items: previousItems, total: previousItems.length }, { revalidate: true });
        toast.error("Failed to update status", { description: err.message });
      }
    },
    [items, mutateItems]
  );

  const handleFavoriteToggleOptimistic = useCallback(
    async (id: string) => {
      const previousItems = [...items];
      let isFav = false;
      const nextItems = items.map((item) => {
        if (item.id === id) {
          isFav = !item.is_favorite;
          return { ...item, is_favorite: isFav };
        }
        return item;
      });

      mutateItems({ items: nextItems, total: nextItems.length }, { revalidate: false });

      try {
        const { updateItem } = await import("@/lib/api");
        await updateItem(id, { is_favorite: isFav });
        toast.success(isFav ? "Added to favorites ★" : "Removed from favorites");
        mutateItems();
        mutate(ANALYTICS_CACHE_KEY);
        mutate(STREAK_HEATMAP_CACHE_KEY);
        mutate(RECOMMENDATION_CACHE_KEY);
      } catch (err: any) {
        mutateItems({ items: previousItems, total: previousItems.length }, { revalidate: true });
        toast.error("Failed to toggle favorite", { description: err.message });
      }
    },
    [items, mutateItems]
  );

  const handleDeleteOptimistic = useCallback(
    async (id: string) => {
      const previousItems = [...items];
      const nextItems = items.filter((item) => item.id !== id);

      mutateItems({ items: nextItems, total: nextItems.length }, { revalidate: false });

      try {
        const { deleteItem } = await import("@/lib/api");
        await deleteItem(id);
        toast.success("Item deleted");
        mutateItems();
        mutate(ANALYTICS_CACHE_KEY);
        mutate(STREAK_HEATMAP_CACHE_KEY);
        mutate(RECOMMENDATION_CACHE_KEY);
      } catch (err: any) {
        mutateItems({ items: previousItems, total: previousItems.length }, { revalidate: true });
        toast.error("Failed to delete item", { description: err.message });
      }
    },
    [items, mutateItems]
  );

  // Bulk operation triggers
  const handleBulkActionTrigger = async (
    action: "delete" | "move" | "status" | "favorite",
    actionData?: any
  ) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    const previousItems = [...items];
    let nextItems = [...items];

    if (action === "delete") {
      if (!window.confirm(`Delete ${ids.length} selected items?`)) return;
      nextItems = nextItems.filter((item) => !selectedIds.has(item.id));
    } else if (action === "favorite") {
      nextItems = nextItems.map((item) =>
        selectedIds.has(item.id) ? { ...item, is_favorite: !!actionData.is_favorite } : item
      );
    } else if (action === "status") {
      nextItems = nextItems.map((item) =>
        selectedIds.has(item.id)
          ? {
              ...item,
              status: actionData.status,
              read_progress:
                actionData.status === "completed"
                  ? 100
                  : actionData.status === "unread"
                  ? 0
                  : item.read_progress,
            }
          : item
      );
    } else if (action === "move") {
      nextItems = nextItems.map((item) =>
        selectedIds.has(item.id) ? { ...item, collection_id: actionData.collection_id } : item
      );
    }

    // Mutate SWR optimistically
    mutateItems({ items: nextItems, total: nextItems.length }, { revalidate: false });

    try {
      await bulkItemsAction({
        ids,
        action,
        status: action === "status" ? actionData.status : undefined,
        collection_id: action === "move" ? actionData.collection_id : undefined,
        is_favorite: action === "favorite" ? actionData.is_favorite : undefined,
      });

      toast.success(`Bulk operations completed on ${ids.length} items!`);
      setSelectedIds(new Set());
      mutateItems();
      mutate(ANALYTICS_CACHE_KEY);
      mutate(STREAK_HEATMAP_CACHE_KEY);
      mutate(RECOMMENDATION_CACHE_KEY);
    } catch (err: any) {
      mutateItems({ items: previousItems, total: previousItems.length }, { revalidate: true });
      toast.error("Bulk operations failed", { description: err.message });
    }
  };

  const handleRefresh = () => {
    mutateItems();
    mutate(ANALYTICS_CACHE_KEY);
    mutate(STREAK_HEATMAP_CACHE_KEY);
    mutate(RECOMMENDATION_CACHE_KEY);
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
        mutateItems();
      }
    } catch (err: any) {
      toast.error("Failed to recalculate priorities", { description: err.message });
    } finally {
      setRecalculating(false);
    }
  };

  const visibleItems = items.slice(0, visibleCount);
  
  // Grouping items by completion date for History view
  const groupedItems: { [key: string]: typeof items } = {
    "Completed Today": [],
    "Yesterday": [],
    "Last Week": [],
    "Older": [],
  };

  if (isHistoryView) {
    visibleItems.forEach((item) => {
      const group = getHistoryGroup(item.completed_at);
      groupedItems[group].push(item);
    });
  }

  const isAllSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedIds.has(item.id));

  return (
    <div>
      {/* Bulk actions toolbar */}
      {selectedIds.size > 0 && (
        <div className="glass p-3 rounded-xl border border-primary/25 bg-primary/5 flex items-center justify-between mb-4 animate-in slide-in-from-top-2 duration-250">
          <div className="flex items-center gap-3">
            <button
              onClick={handleSelectAllToggle}
              className="flex items-center justify-center w-5 h-5 rounded border border-border bg-secondary/50 text-primary cursor-pointer"
            >
              {isAllSelected && <Check className="h-3.5 w-3.5" />}
            </button>
            <span className="text-xs font-bold">
              {selectedIds.size} {selectedIds.size === 1 ? "item" : "items"} selected
            </span>
          </div>

          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleBulkActionTrigger("favorite", { is_favorite: true })}
              className="h-8 text-xs cursor-pointer text-red-400 hover:bg-red-500/5 hover:text-red-500"
              title="Add to Favorites"
            >
              <Heart className="h-4 w-4 fill-red-400" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleBulkActionTrigger("status", { status: "completed" })}
              className="h-8 text-xs cursor-pointer text-emerald-400 hover:bg-emerald-500/5 hover:text-emerald-500"
              title="Mark Complete"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleBulkActionTrigger("status", { status: "unread" })}
              className="h-8 text-xs cursor-pointer text-blue-400 hover:bg-blue-500/5 hover:text-blue-500"
              title="Re-queue"
            >
              <CircleDot className="h-4 w-4" />
            </Button>

            {/* Bulk Move Dropdown */}
            {collections.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex items-center justify-center rounded-md hover:bg-accent/40 h-8 w-8 cursor-pointer text-amber-400 hover:bg-amber-500/5 hover:text-amber-500 transition-colors"
                  title="Move to Folder"
                >
                  <FolderSync className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="glass border-border/20 max-h-48 overflow-y-auto">
                  <DropdownMenuItem
                    className="text-xs cursor-pointer"
                    onClick={() => handleBulkActionTrigger("move", { collection_id: null })}
                  >
                    Remove from folder
                  </DropdownMenuItem>
                  {collections.map((col) => (
                    <DropdownMenuItem
                      key={col.id}
                      className="text-xs cursor-pointer"
                      onClick={() => handleBulkActionTrigger("move", { collection_id: col.id })}
                    >
                      {col.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleBulkActionTrigger("delete")}
              className="h-8 text-xs cursor-pointer text-destructive hover:bg-destructive/5"
              title="Delete Selected"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="h-8 text-xs cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Search + Filter bar */}
      <div className="space-y-3 mb-6">
        {/* Search row — ~85% width */}
        <div className="flex gap-2">
          <div className="relative w-full md:w-[85%]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search your queue (title, summary, tags)..."
              defaultValue={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 glass border-border/20"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Filter chips row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Status filter */}
          {!isHistoryView && (
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
          )}

          {!isHistoryView && <div className="h-4 w-px bg-border/40 mx-1 hidden sm:block" />}

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
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
              Estimated Time
            </p>
            <p className="text-2xl font-bold tracking-tight">
              {formatTotalTime(analytics?.total_estimated_time_minutes ?? 0)}
            </p>
          </div>
          <div className="glass p-4 rounded-xl border border-border/20">
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">
              Read Progress
            </p>
            <p className="text-2xl font-bold tracking-tight">
              {analytics?.total_completed ?? 0}/{analytics?.total_items ?? 0}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              ({analytics?.completed_ratio_percent ?? 0}% completed)
            </p>
          </div>
        </div>
        <div className="glass p-4 rounded-xl border border-border/20 bg-primary/5 border-primary/10">
          <p className="text-xs text-primary/80 font-bold mb-1 flex items-center gap-1.5 uppercase tracking-wider">
            <Sparkles className="h-3 w-3 animate-pulse" /> AI Recommendation
          </p>
          {recommendationLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5 animate-pulse">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>Analyzing recommendations...</span>
            </div>
          ) : recommendation && recommendation.item_id ? (
            <div className="space-y-1 mt-1.5">
              <p className="text-xs font-semibold leading-normal line-clamp-2">
                Focus on <span className="text-primary font-bold">"{recommendation.title}"</span> next
              </p>
              {recommendation.reason && (
                <p className="text-[10px] text-muted-foreground leading-normal line-clamp-1 italic">
                  Reason: {recommendation.reason}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs font-semibold leading-relaxed text-muted-foreground mt-1.5">
              {recommendation?.reason || "Add items to get recommendations"}
            </p>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <QueueCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        /* Empty state — distinct "No matches" when searching */
        <Card className="glass border-border/20 border-dashed mt-4">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
              {debouncedSearch ? (
                <Search className="h-10 w-10 text-primary" />
              ) : (
                <Inbox className="h-10 w-10 text-primary" />
              )}
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {debouncedSearch
                ? "No matching items found."
                : selectedCollectionId
                ? "No items"
                : hasFilters
                ? "No items match your filters"
                : "Your queue is empty"}
            </h2>
            <p className="max-w-md text-muted-foreground mb-8">
              {debouncedSearch
                ? `No results found for "${debouncedSearch}". Try a different search term.`
                : selectedCollectionId
                ? "This collection is currently empty. Drag and drop items here from 'All Items' or assign them using the item details to organize your content."
                : hasFilters
                ? "Try adjusting your filters to find what you're looking for."
                : "Start saving articles, videos, tweets, GitHub repos, and more. Everything you want to consume later will appear here."}
            </p>
            {debouncedSearch || (hasFilters && !selectedCollectionId) ? (
              <Button variant="outline" onClick={clearFilters} className="cursor-pointer">
                <X className="mr-2 h-4 w-4" />
                {debouncedSearch ? "Clear search" : "Clear filters"}
              </Button>
            ) : (
              <AddItemDialog
                trigger={
                  <Button
                    id="empty-state-add-btn"
                    className="gradient-primary text-white border-0 hover:opacity-90 transition-opacity glow-primary cursor-pointer"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {selectedCollectionId ? "Add item to collection" : "Add your first item"}
                  </Button>
                }
                onItemAdded={handleRefresh}
              />
            )}
          </CardContent>
        </Card>
      ) : isHistoryView ? (
        /* Categorized History List View */
        <div className="space-y-6">
          {Object.entries(groupedItems).map(([groupName, groupItems]) => {
            if (groupItems.length === 0) return null;
            return (
              <div key={groupName} className="space-y-3">
                <h3 className="text-sm font-bold text-primary tracking-wide pt-4 border-b border-border/10 pb-1.5 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  {groupName}
                </h3>
                <div className="space-y-3">
                  {groupItems.map((item) => (
                    <div key={item.id} className="flex gap-3 items-center w-full">
                      {/* Checkbox for bulk actions */}
                      <button
                        onClick={() => handleSelectToggle(item.id)}
                        className={`flex items-center justify-center w-5 h-5 rounded border cursor-pointer transition-all ${
                          selectedIds.has(item.id)
                            ? "bg-primary text-white border-primary"
                            : "border-border hover:border-primary/50 text-transparent bg-secondary/20"
                        }`}
                      >
                        {selectedIds.has(item.id) && <Check className="h-3.5 w-3.5" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <QueueItemCard
                          item={item}
                          onUpdate={handleRefresh}
                          onTagClick={handleTagClick}
                          onDeleteOptimistic={handleDeleteOptimistic}
                          onStatusChangeOptimistic={handleStatusChangeOptimistic}
                          onFavoriteToggleOptimistic={handleFavoriteToggleOptimistic}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {items.length > visibleCount && (
            <div ref={sentinelRef} className="h-10 flex items-center justify-center pt-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      ) : (
        /* Items list with incremental render scrolling */
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <div key={item.id} className="flex gap-3 items-center w-full">
              {/* Checkbox for bulk actions */}
              <button
                onClick={() => handleSelectToggle(item.id)}
                className={`flex items-center justify-center w-5 h-5 rounded border cursor-pointer transition-all ${
                  selectedIds.has(item.id)
                    ? "bg-primary text-white border-primary"
                    : "border-border hover:border-primary/50 text-transparent bg-secondary/20"
                }`}
              >
                {selectedIds.has(item.id) && <Check className="h-3.5 w-3.5" />}
              </button>

              <div className="flex-1 min-w-0">
                <QueueItemCard
                  item={item}
                  onUpdate={handleRefresh}
                  onTagClick={handleTagClick}
                  onDeleteOptimistic={handleDeleteOptimistic}
                  onStatusChangeOptimistic={handleStatusChangeOptimistic}
                  onFavoriteToggleOptimistic={handleFavoriteToggleOptimistic}
                />
              </div>
            </div>
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
