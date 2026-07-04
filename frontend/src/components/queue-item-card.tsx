"use client";

import { useState, useRef, memo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GitBranch,
  MessageSquare,
  ExternalLink,
  PlayCircle,
  BookOpen,
  Clock,
  CheckCircle2,
  Trash2,
  MoreVertical,
  Loader2,
  CircleDot,
  Edit,
  Sparkles,
  Heart,
  Bookmark,
  PauseCircle,
  ChevronDown,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import type { QueueItem } from "@/types";
import { updateItem, editItem, deleteItem, retryAI } from "@/lib/api";
import { useCollections, ANALYTICS_CACHE_KEY } from "@/hooks/use-swr-queries";
import { mutate } from "swr";

interface QueueItemCardProps {
  item: QueueItem;
  onUpdate: () => void;
  onTagClick?: (tag: string) => void;
  onDeleteOptimistic?: (id: string) => Promise<void>;
  onStatusChangeOptimistic?: (id: string, newStatus: QueueItem["status"]) => Promise<void>;
  onFavoriteToggleOptimistic?: (id: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins} min`;
}

function formatTimeSpent(minutes?: number | null): string {
  if (!minutes) return "0 min";
  if (minutes < 1) {
    const secs = Math.round(minutes * 60);
    return `${secs}s`;
  }
  const mins = Math.floor(minutes);
  const secs = Math.round((minutes - mins) * 60);
  if (secs > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${mins} min`;
}

function timeAgo(dateString: string): string {
  try {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function getFallbackGradient(contentType: string) {
  switch (contentType) {
    case "youtube":
      return "from-red-950/40 via-background to-background border-red-500/5";
    case "github":
      return "from-neutral-900 via-background to-background border-neutral-500/5";
    case "twitter":
      return "from-cyan-950/40 via-background to-background border-cyan-500/5";
    case "reddit":
      return "from-orange-950/40 via-background to-background border-orange-500/5";
    case "instagram":
      return "from-pink-950/40 via-background to-background border-pink-500/5";
    case "article":
      return "from-blue-950/40 via-background to-background border-blue-500/5";
    default:
      return "from-purple-950/40 via-background to-background border-purple-500/5";
  }
}

const statusConfig = {
  unread: {
    label: "Unread",
    Icon: CircleDot,
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  reading: {
    label: "Reading",
    Icon: Loader2,
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  processing: {
    label: "Processing...",
    Icon: Loader2,
    className: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  completed: {
    label: "Completed",
    Icon: CheckCircle2,
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  archived: {
    label: "Archived",
    Icon: Bookmark,
    className: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  },
} as const;

function getSourceMeta(sourceType: string) {
  switch (sourceType) {
    case "youtube":
      return { Icon: PlayCircle, label: "YouTube" };
    case "twitter":
      return { Icon: MessageSquare, label: "Twitter/X" };
    case "reddit":
      return { Icon: MessageSquare, label: "Reddit" };
    case "github":
      return { Icon: GitBranch, label: "GitHub" };
    case "article":
      return { Icon: BookOpen, label: "Article" };
    default:
      return { Icon: ExternalLink, label: "Link" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const QueueItemCard = memo(function QueueItemCard({
  item,
  onUpdate,
  onTagClick,
  onDeleteOptimistic,
  onStatusChangeOptimistic,
  onFavoriteToggleOptimistic,
}: QueueItemCardProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isRetryingAI, setIsRetryingAI] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showExpanded, setShowExpanded] = useState(false);
  
  // Edit mode fields
  const [editTitle, setEditTitle] = useState(item.title || "");
  const [editTags, setEditTags] = useState((item.tags || []).join(", "));
  const [editSummary, setEditSummary] = useState(item.ai_summary || "");

  // Read progress state
  const [progress, setProgress] = useState(item.read_progress ?? 0);
  const progressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active reading timer state
  const [activeTimerSeconds, setActiveTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(item.status === "reading");

  // Reset timer state when item ID or status changes
  useEffect(() => {
    setActiveTimerSeconds(0);
    setIsTimerRunning(item.status === "reading");
  }, [item.id, item.status]);

  // Sync incremental timer updates to backend every 10 seconds of active reading
  useEffect(() => {
    if (item.status !== "reading" || !isTimerRunning) return;
    
    const interval = setInterval(() => {
      setActiveTimerSeconds((prev) => {
        const next = prev + 1;
        if (next % 10 === 0) {
          const increment = 10 / 60.0;
          updateItem(item.id, { 
            actual_time_spent: (item.actual_time_spent || 0) + increment 
          }).then(() => {
            mutate(ANALYTICS_CACHE_KEY);
          }).catch((err) => {
            console.error("Failed to sync timer:", err);
          });
        }
        return next;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [item.status, isTimerRunning, item.id, item.actual_time_spent]);

  const handleToggleTimer = async () => {
    if (isTimerRunning) {
      setIsTimerRunning(false);
      const remainingMinutes = activeTimerSeconds / 60.0;
      setActiveTimerSeconds(0);
      try {
        await updateItem(item.id, { 
          actual_time_spent: (item.actual_time_spent || 0) + remainingMinutes 
        });
        toast.success("Timer paused. Reading progress saved.");
        onUpdate();
      } catch (err: any) {
        toast.error("Failed to pause timer", { description: err.message });
      }
    } else {
      setIsTimerRunning(true);
    }
  };

  const handleCompleteTimer = async () => {
    setIsTimerRunning(false);
    const remainingMinutes = activeTimerSeconds / 60.0;
    setActiveTimerSeconds(0);
    setActionLoading("status");
    try {
      await updateItem(item.id, {
        status: "completed",
        read_progress: 100,
        actual_time_spent: (item.actual_time_spent || 0) + remainingMinutes
      });
      toast.success("Marked complete! ✓");
      onUpdate();
      mutate(ANALYTICS_CACHE_KEY);
    } catch (err: any) {
      toast.error("Failed to complete item", { description: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  const [logoFailed, setLogoFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  // Fetch folders for dropdown/move selection
  const { collections } = useCollections();

  useEffect(() => {
    setLogoFailed(false);
    setThumbFailed(false);
    setProgress(item.read_progress ?? 0);
  }, [item.id, item.read_progress]);

  // Sync edit fields when the backend data is updated via SWR
  useEffect(() => {
    setEditTitle(item.title || "");
    setEditTags((item.tags || []).join(", "));
    setEditSummary(item.ai_summary || "");
  }, [item.title, item.tags, item.ai_summary]);

  // Audio summary playback hooks
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const toggleAudio = () => {
    if (!audioRef.current && item.audio_url) {
      audioRef.current = new Audio(item.audio_url);
      audioRef.current.onended = () => setIsPlaying(false);
    }
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const statusInfo = statusConfig[item.status as keyof typeof statusConfig] ?? statusConfig.unread;
  const { Icon: StatusIcon } = statusInfo;
  const { Icon: SourceIcon } = getSourceMeta(item.content_type);
  const isYouTube = item.content_type === "youtube";

  const handleStatusChange = async (newStatus: QueueItem["status"]) => {
    if (onStatusChangeOptimistic) {
      await onStatusChangeOptimistic(item.id, newStatus);
    } else {
      setActionLoading("status");
      try {
        await updateItem(item.id, { status: newStatus });
        toast.success(newStatus === "completed" ? "Marked complete! ✓" : "Status updated");
        onUpdate();
        mutate(ANALYTICS_CACHE_KEY);
      } catch (e: any) {
        toast.error("Failed to update status", { description: e.message });
      } finally {
        setActionLoading(null);
      }
    }
  };

  const handleFavoriteToggle = async () => {
    if (onFavoriteToggleOptimistic) {
      await onFavoriteToggleOptimistic(item.id);
    } else {
      setActionLoading("favorite");
      try {
        await updateItem(item.id, { is_favorite: !item.is_favorite });
        toast.success(item.is_favorite ? "Removed from favorites" : "Added to favorites ★");
        onUpdate();
      } catch (e: any) {
        toast.error("Failed to update favorite", { description: e.message });
      } finally {
        setActionLoading(null);
      }
    }
  };

  const handleRetryAI = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRetryingAI(true);
    try {
      await retryAI(item.id);
      toast.success("Enqueued for AI summary generation!");
      onUpdate();
    } catch (err: any) {
      toast.error("Failed to retry AI summary", { description: err.message });
    } finally {
      setIsRetryingAI(false);
    }
  };

  // Progress change slider trigger
  const handleProgressChange = (val: number) => {
    setProgress(val);

    if (progressTimeoutRef.current) clearTimeout(progressTimeoutRef.current);
    progressTimeoutRef.current = setTimeout(async () => {
      try {
        await updateItem(item.id, { read_progress: val });
        onUpdate();
        mutate(ANALYTICS_CACHE_KEY);
      } catch (err: any) {
        toast.error("Failed to save progress", { description: err.message });
      }
    }, 500); // 500ms debounce to prevent API spamming
  };



  // Move directly to a collection
  const handleMoveCollection = async (collectionId: string | null) => {
    setActionLoading("move");
    try {
      await updateItem(item.id, { collection_id: collectionId });
      toast.success("Folder updated");
      onUpdate();
    } catch (err: any) {
      toast.error("Failed to move item", { description: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  const handleEditSave = async () => {
    setActionLoading("edit");
    try {
      const tagsArray = editTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      await editItem(item.id, {
        title: editTitle || undefined,
        tags: tagsArray,
        ai_summary: editSummary || undefined,
      });
      setIsEditing(false);
      toast.success("Item updated");
      onUpdate();
    } catch (e: any) {
      toast.error("Failed to update item", { description: e.message });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this item from your queue?")) return;
    if (onDeleteOptimistic) {
      await onDeleteOptimistic(item.id);
    } else {
      setActionLoading("delete");
      try {
        await deleteItem(item.id);
        toast.success("Item deleted");
        onUpdate();
        mutate(ANALYTICS_CACHE_KEY);
      } catch (e: any) {
        toast.error("Failed to delete item", { description: e.message });
      } finally {
        setActionLoading(null);
      }
    }
  };

  const currentFolder = collections.find((c) => c.id === item.collection_id);

  return (
    <Card
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        if (item.collection_id) {
          e.dataTransfer.setData("application/collection-id", item.collection_id);
        }
        e.dataTransfer.setData("application/read-time", String(item.estimated_read_time || 0));
        e.dataTransfer.effectAllowed = "move";
        e.currentTarget.classList.add("opacity-50");
      }}
      onDragEnd={(e) => {
        e.currentTarget.classList.remove("opacity-50");
      }}
      className={`group glass border border-border/15 transition-all duration-300 hover:border-primary/25 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/5 overflow-hidden flex flex-col h-auto min-h-[90px] ${
        item.status === "completed" ? "opacity-65" : ""
      }`}
    >
      <CardContent className="p-0 flex flex-col flex-1">
        {isEditing ? (
          <div className="space-y-4 p-5 flex flex-col flex-1">
            <h4 className="text-sm font-semibold gradient-text">Edit Queue Item</h4>
            <div className="space-y-3 flex-1">
              <div>
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">
                  Title
                </label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Title"
                  className="font-semibold text-sm bg-secondary/20 border-border/10 focus-visible:ring-primary/45"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">
                  Tags (comma-separated)
                </label>
                <Input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="Tags (comma separated)"
                  className="text-xs bg-secondary/20 border-border/10 focus-visible:ring-primary/45"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">
                  AI Summary
                </label>
                <Textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  placeholder="Summary"
                  className="text-xs bg-secondary/20 border-border/10 focus-visible:ring-primary/45 resize-none font-sans"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t border-border/10">
              <Button
                size="sm"
                onClick={handleEditSave}
                disabled={actionLoading === "edit"}
                className="gradient-primary text-white border-0 cursor-pointer"
              >
                {actionLoading === "edit" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Save Changes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsEditing(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-1">
            <div className="flex items-start gap-4 p-5">
              {/* Logo / Thumbnail */}
              <div
                onClick={() => window.open(item.url, "_blank")}
                className="relative flex-shrink-0 w-14 h-14 min-w-14 overflow-hidden rounded-md border border-border/10 bg-secondary/10 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                title="Open Link"
              >
                {item.thumbnail_url && !thumbFailed ? (
                  <img
                    src={item.thumbnail_url}
                    alt={item.title || ""}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={() => setThumbFailed(true)}
                  />
                ) : item.logo_url && !logoFailed ? (
                  <div
                    className={`flex items-center justify-center w-full h-full p-2.5 bg-gradient-to-br ${getFallbackGradient(
                      item.content_type
                    )}`}
                  >
                    <img
                      src={item.logo_url}
                      alt={item.source_name || ""}
                      className="w-7 h-7 object-contain bg-transparent animate-pulse-slow"
                      onError={() => setLogoFailed(true)}
                    />
                  </div>
                ) : (
                  <div
                    className={`fallback-gradient flex items-center justify-center bg-gradient-to-br ${getFallbackGradient(
                      item.content_type
                    )} w-full h-full`}
                  >
                    <SourceIcon className="h-6 w-6 opacity-15 text-foreground/40" />
                  </div>
                )}

                {item.thumbnail_url && !thumbFailed && item.logo_url && !logoFailed && (
                  <div className="absolute bottom-0 right-0 w-5 h-5 bg-background/95 border-t border-l border-border/10 p-0.5 flex items-center justify-center rounded-tl-md shadow-sm">
                    <img
                      src={item.logo_url}
                      alt={item.source_name || ""}
                      className="w-3.5 h-3.5 object-contain"
                      onError={() => setLogoFailed(true)}
                    />
                  </div>
                )}
              </div>

              {/* Title & tags */}
              <div className="flex flex-col flex-1 min-w-0">
                <h3
                  className={`font-semibold text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-200 cursor-pointer ${
                    item.status === "completed" ? "line-through opacity-65" : ""
                  }`}
                  onClick={() => window.open(item.url, "_blank")}
                  title={item.title || item.url}
                >
                  {item.title || item.url}
                </h3>

                <div className="flex flex-wrap gap-1.5 items-center mb-1 mt-1">
                  {/* Folder collection badge if set */}
                  {currentFolder && (
                    <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 bg-amber-500/10 text-amber-500 border border-amber-500/15">
                      <FolderOpen className="h-2.5 w-2.5" />
                      {currentFolder.name}
                    </span>
                  )}

                  {/* Tag chips */}
                  {item.tags && item.tags.length > 0 && item.tags[0] !== "uncategorized" && (
                    <>
                      {item.tags.slice(0, 3).map((tag) => (
                        <button
                          key={tag}
                          onClick={() => onTagClick?.(tag)}
                          className="text-[9px] bg-primary/10 text-primary border border-primary/15 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold hover:bg-primary/20 transition-all cursor-pointer"
                        >
                          #{tag}
                        </button>
                      ))}
                    </>
                  )}
                </div>

                {/* AI Summary Block */}
                {(item.processing_status === "queued" || item.processing_status === "processing") ? (
                  <div className="mb-2 text-xs text-muted-foreground flex gap-2 items-center bg-purple-500/5 rounded-lg p-2 border border-purple-500/5 animate-pulse">
                    <Loader2 className="h-4 w-4 text-purple-400 animate-spin shrink-0" />
                    <p className="leading-relaxed font-semibold text-purple-400">
                      {item.processing_status === "queued" ? "Queued for AI summary..." : "Generating AI summary..."}
                    </p>
                  </div>
                ) : (item.processing_status === "pending_quota" || item.processing_status === "ai_pending") ? (
                  <div className="mb-2 text-xs text-muted-foreground flex gap-2 items-center bg-amber-500/5 rounded-lg p-2 border border-amber-500/10">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <p className="leading-relaxed font-semibold text-amber-600 dark:text-amber-400">
                      AI summary pending (free tier limit reached). It will be generated automatically after quota reset.
                    </p>
                  </div>
                ) : (item.processing_status === "failed") ? (
                  <div className="mb-2 text-xs text-muted-foreground flex gap-2 items-center justify-between bg-red-500/5 rounded-lg p-2 border border-red-500/10">
                    <div className="flex gap-2 items-center">
                      <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                      <p className="leading-relaxed font-semibold text-red-600 dark:text-red-400">
                        AI Summary generation failed.
                      </p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleRetryAI} 
                      className="h-7 text-[10px] uppercase font-bold border-red-500/30 text-red-500 hover:bg-red-500/10 cursor-pointer"
                      disabled={isRetryingAI}
                    >
                      {isRetryingAI ? "Retrying..." : "Retry AI"}
                    </Button>
                  </div>
                ) : item.ai_summary ? (
                  <div className="mb-2 text-xs text-muted-foreground flex gap-2 items-start bg-primary/5 rounded-lg p-2 border border-primary/5">
                    <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5 animate-pulse-slow" />
                    <p className="line-clamp-2 leading-relaxed">{item.ai_summary}</p>
                    {item.audio_url && (
                      <Button variant="ghost" size="sm" onClick={toggleAudio} className="h-6 w-6 p-0 shrink-0 cursor-pointer">
                        {isPlaying ? (
                          <PauseCircle className="h-4 w-4 text-primary animate-pulse" />
                        ) : (
                          <PlayCircle className="h-4 w-4 text-primary" />
                        )}
                      </Button>
                    )}
                  </div>
                ) : null}

                {/* Active Reading Timer Block */}
                {item.status === "reading" && (
                  <div className="mb-3 flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-xs text-amber-500">
                    <div className="flex items-center gap-2 font-semibold">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      <span>Reading: {formatTimeSpent((item.actual_time_spent || 0) + activeTimerSeconds / 60.0)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleToggleTimer}
                        className="h-7 px-2 text-[10px] font-bold uppercase tracking-wider text-amber-500 hover:bg-amber-500/10 border border-amber-500/15 cursor-pointer"
                      >
                        {isTimerRunning ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCompleteTimer}
                        disabled={actionLoading !== null}
                        className="h-7 px-2 text-[10px] font-bold uppercase tracking-wider text-emerald-500 hover:bg-emerald-500/10 border border-emerald-500/15 cursor-pointer"
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                )}

                {/* Metadata Row */}
                <div className="flex items-center justify-between text-xs text-muted-foreground/80 mt-auto pt-2 border-t border-border/10">
                  <div className="flex items-center gap-2 font-medium">
                    {item.estimated_read_time && !isYouTube && item.status !== "completed" && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {item.estimated_read_time}m read
                      </span>
                    )}
                    {item.duration_seconds && isYouTube && item.status !== "completed" && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDuration(item.duration_seconds)} watch
                      </span>
                    )}
                    {item.status === "completed" && (
                      <>
                        <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Completed {item.completed_at ? timeAgo(item.completed_at) : ""}
                        </span>
                        <span className="text-muted-foreground/45">·</span>
                        <span className="flex items-center gap-1 text-muted-foreground/90">
                          <Clock className="h-3.5 w-3.5" />
                          Spent: {formatTimeSpent(item.actual_time_spent)}
                        </span>
                      </>
                    )}
                    {item.status !== "completed" && item.created_at && (
                      <span className="text-muted-foreground/60">{timeAgo(item.created_at)}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 font-bold uppercase text-[9px]">
                    {item.read_progress > 0 && item.read_progress < 100 && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                        {item.read_progress}% read
                      </span>
                    )}
                    <div className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${statusInfo.className}`}>
                      <StatusIcon className={`h-3 w-3 ${item.status === "reading" && isTimerRunning ? "animate-spin" : ""}`} />
                      {statusInfo.label}
                    </div>
                  </div>
                </div>

                {/* Bottom Card Actions */}
                <div className="flex items-center justify-between border-t border-border/10 pt-2 mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowExpanded(!showExpanded)}
                    className="h-8 px-2 text-xs text-primary/95 hover:text-primary hover:bg-primary/5 cursor-pointer font-semibold"
                  >
                    {showExpanded ? "Show less" : "Show details"}
                    <ChevronDown
                      className={`ml-1 h-3.5 w-3.5 transition-transform duration-300 ${
                        showExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/40 cursor-pointer"
                      onClick={() => {
                        window.open(item.url, "_blank");
                        if (item.status === "unread") {
                          handleStatusChange("reading");
                        }
                      }}
                      title="Open Link"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/40 cursor-pointer"
                      onClick={handleFavoriteToggle}
                      disabled={actionLoading === "favorite"}
                      title={item.is_favorite ? "Favorited" : "Add to Favorites"}
                    >
                      <Heart
                        className={`h-4 w-4 transition-colors ${
                          item.is_favorite ? "fill-red-400 text-red-400" : ""
                        }`}
                      />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex items-center justify-center rounded-md hover:bg-accent/40 hover:text-foreground h-8 w-8 cursor-pointer disabled:opacity-50"
                        disabled={actionLoading !== null}
                      >
                        {actionLoading && actionLoading !== "favorite" && actionLoading !== "status" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          <MoreVertical className="h-4 w-4" />
                        )}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 glass border-border/20">
                        <DropdownMenuItem
                          className="cursor-pointer text-xs font-semibold"
                          onClick={() => {
                            setEditTitle(item.title || "");
                            setEditTags((item.tags || []).join(", "));
                            setEditSummary(item.ai_summary || "");
                            setIsEditing(true);
                          }}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit Info
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border/10" />

                        {/* Move folder inside card menu */}
                        {collections.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="flex items-center w-full px-2 py-1.5 text-xs font-semibold hover:bg-secondary rounded cursor-pointer">
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Move to folder...
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="glass border-border/20 max-h-48 overflow-y-auto">
                              <DropdownMenuItem
                                className="text-xs cursor-pointer"
                                onClick={() => handleMoveCollection(null)}
                              >
                                Uncategorized
                              </DropdownMenuItem>
                              {collections.map((c) => (
                                <DropdownMenuItem
                                  key={c.id}
                                  className="text-xs cursor-pointer font-medium"
                                  onClick={() => handleMoveCollection(c.id)}
                                >
                                  {c.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}

                        <DropdownMenuSeparator className="bg-border/10" />
                        {item.status !== "reading" && item.status !== "completed" && (
                          <DropdownMenuItem
                            className="cursor-pointer text-xs font-semibold"
                            onClick={() => handleStatusChange("reading")}
                          >
                            <PlayCircle className="mr-2 h-4 w-4 text-amber-400" />
                            Start reading
                          </DropdownMenuItem>
                        )}
                        {item.status !== "completed" && (
                          <DropdownMenuItem
                            className="cursor-pointer text-xs font-semibold"
                            onClick={() => handleStatusChange("completed")}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-400" />
                            Mark complete
                          </DropdownMenuItem>
                        )}
                        {item.status === "completed" && (
                          <DropdownMenuItem
                            className="cursor-pointer text-xs font-semibold"
                            onClick={() => handleStatusChange("unread")}
                          >
                            <CircleDot className="mr-2 h-4 w-4 text-blue-400" />
                            Re-queue
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className="bg-border/10" />
                        <DropdownMenuItem
                          className="cursor-pointer text-xs font-semibold text-destructive focus:text-destructive"
                          onClick={handleDelete}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Item
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </div>

            {/* Collapsible Details & Notes Panel */}
            {showExpanded && (
              <div className="p-5 border-t border-border/10 space-y-4 bg-secondary/5 animate-in fade-in slide-in-from-top-1 duration-200">
                {/* 1. Read Progress control slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <span>Read Progress</span>
                    <span className="text-primary">{progress}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={progress}
                    onChange={(e) => handleProgressChange(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Setting progress to 100% completes this item automatically. Setting progress between 5% and 95% queues it as "Reading".
                  </p>
                </div>



                {/* 3. Folder collection dropdown */}
                {collections.length > 0 && (
                  <div className="space-y-1">
                    <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Assign Folder / Collection
                    </span>
                    <select
                      value={item.collection_id || ""}
                      onChange={(e) => handleMoveCollection(e.target.value || null)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border bg-secondary/15 text-muted-foreground border-border/10 cursor-pointer outline-none w-full"
                    >
                      <option value="">Uncategorized / No folder</option>
                      {collections.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 4. Full AI summary & details preview */}
                {(item.processing_status === "queued" || item.processing_status === "processing") ? (
                  <div className="space-y-1 animate-pulse">
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" /> Full AI Summary
                    </h4>
                    <p className="text-xs text-purple-400 font-semibold leading-relaxed bg-purple-500/5 rounded p-2.5 border border-purple-500/5">
                      {item.processing_status === "queued" ? "Queued for AI summary..." : "Generating AI summary..."}
                    </p>
                  </div>
                ) : (item.processing_status === "pending_quota" || item.processing_status === "ai_pending") ? (
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" /> Full AI Summary
                    </h4>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold leading-relaxed bg-amber-500/5 rounded p-2.5 border border-amber-500/10">
                      AI summary generation pending (daily quota exceeded). It will be retried automatically when the quota resets.
                    </p>
                  </div>
                ) : (item.processing_status === "failed") ? (
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" /> Full AI Summary
                    </h4>
                    <p className="text-xs text-red-600 dark:text-red-400 font-semibold leading-relaxed bg-red-500/5 rounded p-2.5 border border-red-500/10">
                      AI summary generation failed. You can retry manually.
                    </p>
                  </div>
                ) : (item.full_summary || item.ai_summary) ? (
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5" /> Full AI Summary
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line bg-secondary/10 rounded p-2.5 border border-border/5">
                      {item.full_summary || item.ai_summary}
                    </p>
                  </div>
                ) : null}

                {item.extracted_text && (
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-muted-foreground/85 uppercase tracking-wider flex items-center gap-1">
                      <BookOpen className="h-3.5 w-3.5" /> Extracted Text Preview
                    </h4>
                    <div className="relative max-h-36 overflow-y-auto rounded bg-secondary/20 border border-border/10 p-2.5 text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-line">
                      {item.extracted_text.slice(0, 1000)}
                      {item.extracted_text.length > 1000 ? "..." : ""}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-[11px] bg-secondary/20 rounded p-2.5 border border-border/5">
                  <div>
                    <span className="block text-muted-foreground/50 font-medium mb-0.5">Author</span>
                    <span className="text-foreground truncate block font-semibold">
                      {item.author || "Unknown"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-muted-foreground/50 font-medium mb-0.5">Source Link</span>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-semibold flex items-center gap-0.5 truncate"
                    >
                      Visit Link <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

// Skeleton for loading state
export function QueueCardSkeleton() {
  return (
    <div className="rounded-xl glass border-border/10 animate-pulse overflow-hidden flex flex-col h-full">
      <div className="w-full aspect-video bg-secondary/20" />
      <div className="p-5 space-y-3 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex gap-2 mb-2">
            <div className="h-4 w-14 rounded bg-secondary/30" />
            <div className="h-4 w-12 rounded bg-secondary/30" />
          </div>
          <div className="h-5 w-3/4 rounded bg-secondary/30 mb-2" />
          <div className="h-4 w-full rounded bg-secondary/20" />
        </div>
        <div className="h-4 w-1/3 rounded bg-secondary/20 mt-4" />
      </div>
    </div>
  );
}
