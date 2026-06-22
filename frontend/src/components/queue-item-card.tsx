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
  Flame,
  Star,
  Heart,
  Bookmark,
  PauseCircle,
  ChevronDown,
} from "lucide-react";
import type { QueueItem } from "@/types";
import { updateItem, editItem, deleteItem } from "@/lib/api";

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

function getPriorityColor(score: number): string {
  if (score >= 75) return "text-red-400 border-red-500/20 bg-red-500/10";
  if (score >= 50) return "text-orange-400 border-orange-500/20 bg-orange-500/10";
  return "text-slate-400 border-slate-500/20 bg-slate-500/10";
}

function getSourceMeta(sourceType: string) {
  switch (sourceType) {
    case "youtube":
      return { Icon: PlayCircle, label: "YouTube", badgeClass: "bg-red-500/10 text-red-400 border-red-500/20" };

    case "twitter":
      return { Icon: MessageSquare, label: "Twitter/X", badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" };

    case "reddit":
      return { Icon: MessageSquare, label: "Reddit", badgeClass: "bg-orange-500/10 text-orange-400 border-orange-500/20" };

    case "github":
      return { Icon: GitBranch, label: "GitHub", badgeClass: "bg-neutral-500/10 text-neutral-450 border-neutral-500/20" };

    case "instagram":
      return { Icon: MessageSquare, label: "Instagram", badgeClass: "bg-pink-500/10 text-pink-400 border-pink-500/20" };

    case "article":
      return { Icon: BookOpen, label: "Article", badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20" };

    default:
      return { Icon: ExternalLink, label: "Link", badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20" };
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
  const [isEditing, setIsEditing] = useState(false);
  const [showExpanded, setShowExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title || "");
  const [editTags, setEditTags] = useState((item.tags || []).join(", "));
  const [editSummary, setEditSummary] = useState(item.ai_summary || "");
  const [logoFailed, setLogoFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
    setThumbFailed(false);
  }, [item.id]);
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
  const { Icon: SourceIcon, label: sourceLabel, badgeClass } = getSourceMeta(item.content_type);
  const isYouTube = item.content_type === "youtube";

  const handleStatusChange = async (newStatus: QueueItem["status"]) => {
    if (onStatusChangeOptimistic) {
      await onStatusChangeOptimistic(item.id, newStatus);
    } else {
      setActionLoading("status");
      try {
        const res = await updateItem(item.id, { status: newStatus });
        if (res && typeof res === 'object' && 'detail' in res) throw new Error((res as any).detail);
        toast.success(newStatus === "completed" ? "Marked as complete! ✓" : "Status updated");
        onUpdate();
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
        const res = await updateItem(item.id, { is_favorite: !item.is_favorite });
        if (res && typeof res === 'object' && 'detail' in res) throw new Error((res as any).detail);
        toast.success(item.is_favorite ? "Removed from favorites" : "Added to favorites ★");
        onUpdate();
      } catch (e: any) {
        toast.error("Failed to update favorite", { description: e.message });
      } finally {
        setActionLoading(null);
      }
    }
  };

  const handleEditSave = async () => {
    setActionLoading("edit");
    try {
      const tagsArray = editTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const res = await editItem(item.id, {
        title: editTitle || undefined,
        tags: tagsArray,
        ai_summary: editSummary || undefined,
      });
      if (res && typeof res === 'object' && 'detail' in res) throw new Error((res as any).detail);
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
        const res = await deleteItem(item.id);
        if (res && typeof res === 'object' && 'detail' in res) throw new Error((res as any).detail);
        toast.success("Item deleted");
        onUpdate();
      } catch (e: any) {
        toast.error("Failed to delete item", { description: e.message });
      } finally {
        setActionLoading(null);
      }
    }
  };

  return (
    <Card className={`group glass border-border/15 transition-all duration-300 hover:border-primary/20 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5 overflow-hidden flex flex-col h-auto min-h-[90px] ${item.status === "completed" ? "opacity-60" : ""}`}>
      <CardContent className="p-0 flex flex-col flex-1">
        {/* Edit mode vs view mode */}
        {isEditing ? (
          <div className="space-y-4 p-5 flex flex-col flex-1">
            <h4 className="text-sm font-semibold gradient-text">Edit Queue Item</h4>
            <div className="space-y-3 flex-1">
              <div>
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">Title</label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Title"
                  className="font-semibold text-sm bg-secondary/20 border-border/10 focus-visible:ring-primary/45"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">Tags (comma-separated)</label>
                <Input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="Tags (comma separated)"
                  className="text-xs bg-secondary/20 border-border/10 focus-visible:ring-primary/45"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">AI Summary</label>
                <Textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  placeholder="Summary (optional)"
                  className="text-xs bg-secondary/20 border-border/10 focus-visible:ring-primary/45 resize-none"
                  rows={4}
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
                {actionLoading === "edit" && (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                )}
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
          <div className="flex items-start gap-4 p-5">
            {/* Logo container */}
            <div className="relative flex-shrink-0 w-14 h-14 min-w-14 overflow-hidden rounded-md border border-border/10 bg-secondary/10 flex items-center justify-center">
              {item.thumbnail_url && !thumbFailed ? (
                <img
                  src={item.thumbnail_url}
                  alt={item.title || ""}
                  className="w-full h-full object-cover"
                  onError={() => setThumbFailed(true)}
                />
              ) : item.logo_url && !logoFailed ? (
                <div className={`flex items-center justify-center w-full h-full p-2.5 bg-gradient-to-br ${getFallbackGradient(item.content_type)}`}>
                  <img
                    src={item.logo_url}
                    alt={item.source_name || ""}
                    className="w-7 h-7 object-contain bg-transparent"
                    onError={() => setLogoFailed(true)}
                  />
                </div>
              ) : (
                /* Fallback gradient with source icon */
                <div className={`fallback-gradient flex items-center justify-center bg-gradient-to-br ${getFallbackGradient(item.content_type)} w-full h-full`}
                >
                  <SourceIcon className="h-6 w-6 opacity-15 text-foreground/40" />
                </div>
              )}

              {/* Platform Logo Overlay Badge (shows when thumbnail is displayed) */}
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

              {/* Content column */}
              <div className="flex flex-col flex-1 min-w-0">
                {/* Title */}
                <h3
                  className={`font-semibold text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-200 cursor-pointer ${item.status === "completed" ? "line-through opacity-70" : ""}`}
                  onClick={() => window.open(item.url, "_blank")}
                  title={item.title || item.url}
                >
                  {item.title || item.url}
                </h3>

                {/* Tags */}
                {item.tags && item.tags.length > 0 && item.tags[0] !== "uncategorized" && (
                  <div className="flex flex-wrap gap-1 mb-1 mt-1">
                    {item.tags.slice(0, 4).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => onTagClick?.(tag)}
                        className="text-[9px] bg-primary/10 text-primary border border-primary/15 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold hover:bg-primary/20 transition-all cursor-pointer"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* AI Summary */}

    {item.processing_status === "processing" ? (
      <div className="mb-2 text-xs text-muted-foreground flex gap-2 items-center bg-purple-500/5 rounded-lg p-2 border border-purple-500/5 animate-pulse">
        <Loader2 className="h-4 w-4 text-purple-400 animate-spin shrink-0" />
        <p className="leading-relaxed font-medium text-purple-400">Generating AI summary...</p>
      </div>
    ) : item.ai_summary ? (
      <div className="mb-2 text-xs text-muted-foreground flex gap-2 items-start bg-primary/5 rounded-lg p-2 border border-primary/5">
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5 animate-pulse-slow" />
        <p className="line-clamp-2 leading-relaxed">{item.ai_summary}</p>
        {item.audio_url && (
          <Button variant="ghost" size="sm" onClick={toggleAudio} className="h-6 w-6 p-0">
            {isPlaying ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
          </Button>
        )}
      </div>
    ) : null}

                {/* Metadata Row */}
                <div className="flex items-center justify-between text-xs text-muted-foreground/80 mt-auto pt-2 border-t border-border/10">
                  <div className="flex items-center gap-2">
                    {item.estimated_read_time && !isYouTube && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {item.estimated_read_time}m read
                      </span>
                    )}
                    {item.duration_seconds && isYouTube && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDuration(item.duration_seconds)} watch
                      </span>
                    )}
                      {item.created_at && (
                        <span className="text-muted-foreground/60">{timeAgo(item.created_at)}</span>
                      )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.processing_status === "processing" && (
                      <div className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase bg-purple-500/10 text-purple-400 border-purple-500/20 animate-pulse">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        AI Processing
                      </div>
                    )}
                    <div className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${statusInfo.className}`}
                    >
                      <StatusIcon className={`h-3 w-3 ${item.status === "reading" ? "animate-spin" : ""}`} />
                      {statusInfo.label}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between border-t border-border/10 pt-2 mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowExpanded(!showExpanded)}
                    className="h-8 px-2 text-xs text-primary/95 hover:text-primary hover:bg-primary/5 cursor-pointer font-medium"
                  >
                    {showExpanded ? "Show less" : "Show details"}
                    <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform duration-350 ${showExpanded ? "rotate-180" : ""}`} />
                  </Button>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/40 cursor-pointer"
                      onClick={() => window.open(item.url, "_blank")}
                      title="Open original"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent/40 cursor-pointer"
                      onClick={handleFavoriteToggle}
                      disabled={actionLoading === "favorite"}
                      title={item.is_favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Heart className={`h-4 w-4 transition-colors ${item.is_favorite ? "fill-red-400 text-red-400" : ""}`} />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex items-center justify-center rounded-md hover:bg-accent/40 hover:text-foreground h-8 w-8 cursor-pointer disabled:opacity-50"
                        disabled={actionLoading !== null}
                      >
                        {actionLoading && actionLoading !== "favorite" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreVertical className="h-4 w-4" />
                        )}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 glass-strong border-border/30">
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => {
                            setEditTitle(item.title || "");
                            setEditTags((item.tags || []).join(", "));
                            setEditSummary(item.ai_summary || "");
                            setIsEditing(true);
                          }}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit Item
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border/30" />
                        {item.status !== "reading" && item.status !== "completed" && (
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => handleStatusChange("reading")}
                          >
                            <PlayCircle className="mr-2 h-4 w-4 text-amber-400" />
                            Start Reading
                          </DropdownMenuItem>
                        )}
                        {item.status !== "completed" && (
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => handleStatusChange("completed")}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-400" />
                            Mark Complete
                          </DropdownMenuItem>
                        )}
                        {item.status === "completed" && (
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => handleStatusChange("unread")}
                          >
                            <CircleDot className="mr-2 h-4 w-4 text-blue-400" />
                            Re-queue
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className="bg-border/30" />
                        <DropdownMenuItem
                          className="cursor-pointer text-destructive focus:text-destructive"
                          onClick={handleDelete}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Collapsible details section */}
                {showExpanded && (
                  <div className="mt-4 pt-4 border-t border-border/10 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    {item.processing_status === "processing" ? (
                      <div className="flex flex-col items-center justify-center py-6 gap-2 bg-secondary/5 rounded-lg border border-border/5">
                        <Loader2 className="h-6 w-6 text-purple-400 animate-spin" />
                        <span className="text-xs text-muted-foreground">Extracting & summarizing content...</span>
                      </div>
                    ) : (
                      <>
                        {/* Full AI Summary */}
                        {item.ai_summary && (
                          <div className="space-y-1">
                            <h4 className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                              <Sparkles className="h-3.5 w-3.5" /> Full AI Summary
                            </h4>
                            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line bg-secondary/10 rounded p-2.5 border border-border/5">
                              {item.ai_summary}
                            </p>
                          </div>
                        )}
                        {/* Extracted Text Preview */}
                        {item.extracted_text && (
                          <div className="space-y-1">
                            <h4 className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
                              <BookOpen className="h-3.5 w-3.5" /> Extracted Text Preview
                            </h4>
                            <div className="relative max-h-36 overflow-y-auto rounded bg-secondary/20 border border-border/10 p-2.5 text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-line">
                              {item.extracted_text.slice(0, 1000)}
                              {item.extracted_text.length > 1000 ? "..." : ""}
                            </div>
                          </div>
                        )}
                        {/* Source Metadata grid */}
                        <div className="grid grid-cols-2 gap-3 text-[11px] bg-secondary/15 rounded p-2.5 border border-border/5">
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
                      </>
                    )}
                  </div>
                )}
              </div>
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
