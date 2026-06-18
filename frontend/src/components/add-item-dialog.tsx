"use client";

import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  LinkIcon,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircleIcon,
} from "lucide-react";

interface AddItemDialogProps {
  trigger: React.ReactNode;
  onItemAdded?: () => void;
}

type DialogState = "idle" | "extracting" | "success" | "error";

export function AddItemDialog({ trigger, onItemAdded }: AddItemDialogProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [state, setState] = useState<DialogState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setState("idle");
      setUrl("");
      setErrorMessage("");
      setSavedTitle("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const isValidUrl = (text: string) => {
    try {
      new URL(text);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim() || !isValidUrl(url.trim())) {
      setErrorMessage("Please enter a valid URL");
      setState("error");
      return;
    }

    setState("extracting");
    setErrorMessage("");

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setErrorMessage("You must be logged in to save content");
        setState("error");
        return;
      }

      const requestBody = { url: url.trim() };
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const requestUrl = `${API_URL}/api/items`;

      console.log("[AddItem] POST", requestUrl, requestBody);

      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(requestBody),
        });
      } catch (networkErr) {
        // Network-level failure — server is down, CORS blocked, etc.
        console.error("[AddItem] Network error:", networkErr);
        throw new Error(
          "Cannot reach the backend server. Make sure it's running on port 8000."
        );
      }

      console.log("[AddItem] Response status:", response.status);

      let data;
      try {
        data = await response.json();
      } catch (e) {
        data = {};
      }

      if (!response.ok) {
        console.error("[AddItem] Error response:", data);
        throw new Error(
          data?.error || data?.detail || `Server error (${response.status}): Failed to save content`
        );
      }

      const item = data;
      console.log("[AddItem] Saved item:", item?.id, item?.title);

      setSavedTitle(item?.title || "Content saved!");
      setState("success");

      // Close after brief success animation
      setTimeout(() => {
        setOpen(false);
        onItemAdded?.();
      }, 1500);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      console.error("[AddItem] Final error:", message);
      setErrorMessage(message);
      setState("error");
    }
  };

  // Handle paste anywhere in dialog
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (isValidUrl(text)) {
      setUrl(text);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement}></DialogTrigger>
      <DialogContent
        className="sm:max-w-[520px] glass-strong border-border/20 gap-0"
      >
        <div onPaste={handlePaste}>
        <DialogHeader className="pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <LinkIcon className="h-4 w-4 text-white" />
            </div>
            Add to Queue
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Paste a URL and we&apos;ll extract the content automatically.
          </DialogDescription>
        </DialogHeader>

        {state === "success" ? (
          <div className="flex flex-col items-center py-8 gap-4 animate-in fade-in-0 zoom-in-95 duration-300">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-lg">Saved to your queue!</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-[300px] truncate">
                {savedTitle}
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                ref={inputRef}
                id="url-input"
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (state === "error") setState("idle");
                }}
                disabled={state === "extracting"}
                className={`h-12 pl-4 pr-4 text-base bg-secondary/50 border-border/30 focus-visible:ring-primary/50 transition-all ${
                  state === "error"
                    ? "border-destructive/50 focus-visible:ring-destructive/30"
                    : ""
                }`}
              />
            </div>

            {/* Error message */}
            {state === "error" && errorMessage && (
              <div className="flex items-center gap-2 text-sm text-destructive animate-in fade-in-0 slide-in-from-top-1 duration-200">
                <AlertCircleIcon className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Extracting indicator */}
            {state === "extracting" && (
              <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-primary/5 border border-primary/10 animate-in fade-in-0 duration-200">
                <div className="relative">
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-primary animate-pulse" />
                </div>
                <div>
                  <p className="text-sm font-medium text-primary">
                    Extracting content...
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Analyzing page metadata and content
                  </p>
                </div>
              </div>
            )}

            {/* Submit button */}
            <Button
              id="submit-url-btn"
              type="submit"
              disabled={!url.trim() || state === "extracting"}
              className="w-full h-11 gradient-primary text-white border-0 hover:opacity-90 transition-all duration-200 disabled:opacity-40 cursor-pointer"
            >
              {state === "extracting" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {state === "extracting" ? "Extracting..." : "Save to Queue"}
            </Button>

            {/* Supported content hint */}
            <p className="text-xs text-center text-muted-foreground/60 pt-1">
              Supports articles, blog posts, YouTube videos, and more
            </p>
          </form>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
