"use client";

import { useState } from "react";
import { useCollections } from "@/hooks/use-swr-queries";
import { createCollection, updateCollection, deleteCollection, updateItem, reclassifyItems } from "@/lib/api";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Folder,
  FolderPlus,
  MoreVertical,
  Plus,
  Trash2,
  Edit2,
  FolderOpen,
  Palette,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CollectionsSidebarProps {
  selectedCollectionId: string | null;
  onSelectCollection: (id: string | null) => void;
}

const COLORS = [
  { name: "Blue", value: "blue", class: "bg-blue-500" },
  { name: "Red", value: "red", class: "bg-red-500" },
  { name: "Green", value: "green", class: "bg-green-500" },
  { name: "Purple", value: "purple", class: "bg-purple-500" },
  { name: "Orange", value: "orange", class: "bg-orange-500" },
  { name: "Yellow", value: "yellow", class: "bg-yellow-500" },
];

export function CollectionsSidebar({
  selectedCollectionId,
  onSelectCollection,
}: CollectionsSidebarProps) {
  const { collections, isLoading, mutateCollections } = useCollections();
  const { cache, mutate } = useSWRConfig();

  const handleItemDrop = async (
    itemId: string, 
    collectionId: string | null, 
    oldCollectionId: string | null, 
    readTime: number
  ) => {
    if (collectionId === oldCollectionId) return;

    // 1. Optimistically update collections counts & read times in the sidebar
    mutate(
      "api/collections",
      (currentCols: any) => {
        if (!Array.isArray(currentCols)) return currentCols;
        return currentCols.map((col: any) => {
          let count = col.item_count || 0;
          let time = col.read_time_minutes || 0;
          
          if (col.id === collectionId) {
            return {
              ...col,
              item_count: count + 1,
              read_time_minutes: time + readTime
            };
          }
          if (col.id === oldCollectionId) {
            return {
              ...col,
              item_count: Math.max(0, count - 1),
              read_time_minutes: Math.max(0, time - readTime)
            };
          }
          return col;
        });
      },
      { revalidate: false }
    );

    // 2. Optimistically update items in cached SWR queries
    for (const key of cache.keys()) {
      if (typeof key === "string" && key.startsWith("api/items")) {
        let keyFilters: any = {};
        try {
          const parts = key.split("?");
          if (parts.length > 1) {
            const decoded = decodeURIComponent(parts[1]);
            keyFilters = JSON.parse(decoded);
          }
        } catch (e) {}

        const targetCollectionId = keyFilters.collection_id;
        
        mutate(
          key,
          (currentData: any) => {
            if (!currentData || !currentData.items) return currentData;
            
            // If collection filter is active on this key and does not match the new collection, remove item
            if (targetCollectionId && targetCollectionId === oldCollectionId && oldCollectionId !== collectionId) {
              return {
                ...currentData,
                items: currentData.items.filter((item: any) => item.id !== itemId),
                total: Math.max(0, (currentData.total || 0) - 1)
              };
            }
            
            // Map collection_id of the item in place
            return {
              ...currentData,
              items: currentData.items.map((item: any) => {
                if (item.id === itemId) {
                  return { ...item, collection_id: collectionId };
                }
                return item;
              })
            };
          },
          { revalidate: false }
        );
      }
    }

    try {
      await updateItem(itemId, { collection_id: collectionId });
      toast.success(collectionId ? "Item moved to folder" : "Item removed from folder");
    } catch (err: any) {
      toast.error("Failed to move item", { description: err.message });
    } finally {
      // Revalidate in background to ensure correctness
      for (const key of cache.keys()) {
        if (typeof key === "string" && key.startsWith("api/items")) {
          mutate(key);
        }
      }
      mutate("api/collections");
    }
  };
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState("blue");
  const [isCreating, setIsCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Rename/recolor states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("blue");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setActionLoading(true);
    try {
      await createCollection(newFolderName.trim(), newFolderColor);
      setNewFolderName("");
      setNewFolderColor("blue");
      setIsCreating(false);
      mutateCollections();
      toast.success("Folder created!");
    } catch (err: any) {
      toast.error("Failed to create folder", { description: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    setActionLoading(true);
    try {
      await updateCollection(id, editName.trim(), editColor);
      setEditingId(null);
      mutateCollections();
      toast.success("Folder updated");
    } catch (err: any) {
      toast.error("Failed to update folder", { description: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete folder "${name}"? Saved items will remain but be uncategorized.`)) return;
    setActionLoading(true);
    try {
      await deleteCollection(id);
      if (selectedCollectionId === id) {
        onSelectCollection(null);
      }
      mutateCollections();
      toast.success("Folder deleted");
    } catch (err: any) {
      toast.error("Failed to delete folder", { description: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const [reclassifying, setReclassifying] = useState(false);

  const handleAutoOrganize = async () => {
    setReclassifying(true);
    try {
      await reclassifyItems();
      toast.success("AI auto-categorization started in background!", {
        description: "Uncategorized items will be assigned to folders shortly."
      });
      // Trigger a SWR collections and items refresh after a brief delay
      setTimeout(() => {
        mutateCollections();
        for (const key of cache.keys()) {
          if (typeof key === "string" && key.startsWith("api/items")) {
            mutate(key);
          }
        }
      }, 3000);
    } catch (err: any) {
      toast.error("Failed to start auto-categorization", { description: err.message });
    } finally {
      setReclassifying(false);
    }
  };

  const getFolderColorClass = (colorName: string) => {
    const found = COLORS.find((c) => c.value === colorName);
    return found ? found.class : "bg-blue-500";
  };

  return (
    <div className="w-full flex flex-col space-y-4">
      <div className="flex items-center justify-between border-b border-border/10 pb-2">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
          <Folder className="h-4 w-4 text-primary/80" />
          Folders / Collections
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAutoOrganize}
            disabled={reclassifying}
            className="h-7 px-2 text-[10px] text-primary hover:text-primary hover:bg-primary/5 flex items-center gap-1 cursor-pointer font-bold border border-primary/20 bg-primary/5 rounded-md"
            title="Reclassify All items"
          >
            {reclassifying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Reclassify All
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCreating(!isCreating)}
            className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
            title="Create Folder"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Create form */}
      {isCreating && (
        <form
          onSubmit={handleCreate}
          className="glass p-3.5 rounded-xl border border-primary/10 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold block mb-1">
              Folder Name
            </label>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Work, Learn"
              className="h-8 text-xs bg-secondary/10 border-border/10 focus-visible:ring-primary/40"
              disabled={actionLoading}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase font-semibold block mb-1">
              Color Accent
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setNewFolderColor(c.value)}
                  className={`w-5 h-5 rounded-full border cursor-pointer flex items-center justify-center transition-all ${c.class} ${
                    newFolderColor === c.value
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110 border-white/50"
                      : "border-transparent opacity-80 hover:opacity-100"
                  }`}
                  title={c.name}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-1.5 pt-1.5 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCreating(false)}
              className="h-7 text-[11px] cursor-pointer"
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="gradient-primary text-white h-7 text-[11px] border-0 cursor-pointer"
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
            </Button>
          </div>
        </form>
      )}

      {/* Folders List */}
      <div className="space-y-1">
        {/* 'All Items' trigger */}
        <button
          onClick={() => onSelectCollection(null)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDragEnter={(e) => {
            e.currentTarget.classList.add("bg-primary/20", "scale-[1.02]", "border-primary/30");
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove("bg-primary/20", "scale-[1.02]", "border-primary/30");
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("bg-primary/20", "scale-[1.02]", "border-primary/30");
            const itemId = e.dataTransfer.getData("text/plain");
            const oldCollectionId = e.dataTransfer.getData("application/collection-id") || null;
            const readTimeStr = e.dataTransfer.getData("application/read-time");
            const readTime = readTimeStr ? parseInt(readTimeStr, 10) : 0;
            if (itemId) {
              await handleItemDrop(itemId, null, oldCollectionId, readTime);
            }
          }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all duration-200 ${
            selectedCollectionId === null
              ? "bg-primary/10 text-primary border border-primary/15 border-l-[3px] border-l-primary font-bold shadow-md shadow-primary/5 pl-2.5"
              : "text-muted-foreground hover:bg-secondary/40 border border-transparent font-semibold"
          }`}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span>All Items</span>
        </button>

        {isLoading ? (
          <div className="py-6 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : collections.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground/80">
            No folders created yet
          </div>
        ) : (
          collections.map((folder) => {
            const isEditing = editingId === folder.id;

            if (isEditing) {
              return (
                <div
                  key={folder.id}
                  className="glass p-3 rounded-lg border border-border/10 space-y-2 mt-1 animate-in fade-in duration-150"
                >
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 text-xs bg-secondary/10 border-border/10 focus-visible:ring-primary/40"
                    disabled={actionLoading}
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setEditColor(c.value)}
                        className={`w-4 h-4 rounded-full border cursor-pointer flex items-center justify-center transition-all ${c.class} ${
                          editColor === c.value
                            ? "ring-1 ring-primary ring-offset-1 ring-offset-background scale-110"
                            : "border-transparent opacity-80"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      className="h-6 text-[10px] cursor-pointer"
                      disabled={actionLoading}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleUpdate(folder.id)}
                      className="gradient-primary text-white h-6 text-[10px] border-0 cursor-pointer"
                      disabled={actionLoading}
                    >
                      {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={folder.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(e) => {
                  e.currentTarget.classList.add("bg-primary/20", "scale-[1.02]", "border-primary/30");
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove("bg-primary/20", "scale-[1.02]", "border-primary/30");
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("bg-primary/20", "scale-[1.02]", "border-primary/30");
                  const itemId = e.dataTransfer.getData("text/plain");
                  const oldCollectionId = e.dataTransfer.getData("application/collection-id") || null;
                  const readTimeStr = e.dataTransfer.getData("application/read-time");
                  const readTime = readTimeStr ? parseInt(readTimeStr, 10) : 0;
                  if (itemId) {
                    await handleItemDrop(itemId, folder.id, oldCollectionId, readTime);
                  }
                }}
                className={`group/item flex items-center justify-between px-3 py-1.5 rounded-lg border transition-all duration-200 ${
                  selectedCollectionId === folder.id
                    ? "bg-primary/10 text-primary border-primary/15 border-l-[3px] border-l-primary font-bold shadow-md shadow-primary/5 pl-2.5"
                    : "text-muted-foreground hover:bg-secondary/40 border-transparent"
                }`}
              >
                <button
                  onClick={() => onSelectCollection(folder.id)}
                  className="flex-1 flex flex-col cursor-pointer text-left truncate py-0.5"
                >
                  <div className="flex items-center gap-2.5 text-xs font-semibold">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${getFolderColorClass(
                        folder.color
                      )}`}
                    />
                    <span className="truncate">{folder.name}</span>
                  </div>
                  {folder.item_count !== undefined && folder.item_count > 0 ? (
                    <span className="text-[10px] text-muted-foreground pl-5 mt-0.5">
                      {folder.item_count} {folder.item_count === 1 ? "item" : "items"}
                      {folder.read_time_minutes ? ` • ${folder.read_time_minutes}m read` : ""}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/40 pl-5 mt-0.5">
                      empty
                    </span>
                  )}
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger className="opacity-0 group-hover/item:opacity-100 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer rounded transition-opacity">
                    <MoreVertical className="h-3.5 w-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-32 glass border-border/20">
                    <DropdownMenuItem
                      className="cursor-pointer text-xs"
                      onClick={() => {
                        setEditingId(folder.id);
                        setEditName(folder.name);
                        setEditColor(folder.color);
                      }}
                    >
                      <Edit2 className="mr-1.5 h-3 w-3" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border/10" />
                    <DropdownMenuItem
                      className="cursor-pointer text-xs text-destructive focus:text-destructive"
                      onClick={() => handleDelete(folder.id, folder.name)}
                    >
                      <Trash2 className="mr-1.5 h-3 w-3" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
