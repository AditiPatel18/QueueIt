"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  Loader2,
  User,
  ChevronDownIcon,
  ArrowLeft,
  Sparkles,
  Send,
  Trash2,
  MessageSquare,
  BookOpen,
  Video,
  GitBranch,
  Globe,
} from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { sendChatMessageStream, ChatMessage } from "@/lib/api";
import { QueueItem } from "@/types";

interface MessageWithSources {
  role: "user" | "assistant";
  content: string;
  sources?: QueueItem[];
  streaming?: boolean;
}

export default function ChatPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<MessageWithSources[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  // Holds the cleanup fn for the active stream (abort on unmount / clear)
  const abortStreamRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      abortStreamRef.current?.();
    };
  }, []);

  // Scroll to bottom on new messages / token appends
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const getInitials = (supabaseUser: SupabaseUser) => {
    const name = supabaseUser.user_metadata?.full_name || supabaseUser.email || "U";
    return name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getDisplayName = (supabaseUser: SupabaseUser) => {
    return supabaseUser.user_metadata?.full_name || supabaseUser.email?.split("@")[0] || "User";
  };

  const handleSend = useCallback(
    async (textToSend?: string) => {
      const text = (textToSend || input).trim();
      if (!text || isLoading) return;

      if (!textToSend) setInput("");
      setError(null);

      // Append user message
      const userMessage: MessageWithSources = { role: "user", content: text };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      // Add an empty streaming assistant message placeholder
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ]);

      // Build history (without the placeholder we just added)
      const apiHistory: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Start SSE stream
      const cleanup = sendChatMessageStream(
        text,
        apiHistory,
        // onToken — append to the last (streaming) message
        (token) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.streaming) {
              next[next.length - 1] = { ...last, content: last.content + token };
            }
            return next;
          });
        },
        // onDone — finalize message with sources
        (result) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.streaming) {
              next[next.length - 1] = {
                role: "assistant",
                content: result.response,
                sources: result.sources,
                streaming: false,
              };
            }
            return next;
          });
          setIsLoading(false);
          abortStreamRef.current = null;
        },
        // onError
        (err) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.streaming) {
              next.pop(); // remove placeholder
            }
            return next;
          });
          setError(err.message || "Failed to get response from AI. Please try again.");
          setIsLoading(false);
          abortStreamRef.current = null;
        }
      );

      abortStreamRef.current = cleanup;
    },
    [input, isLoading, messages]
  );

  const handleClearChat = () => {
    abortStreamRef.current?.();
    abortStreamRef.current = null;
    setMessages([]);
    setError(null);
    setIsLoading(false);
  };

  const getSourceIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case "youtube":
        return <Video className="h-3.5 w-3.5 text-red-500" />;
      case "github":
        return <GitBranch className="h-3.5 w-3.5 text-slate-300" />;
      case "article":
        return <BookOpen className="h-3.5 w-3.5 text-emerald-400" />;
      default:
        return <Globe className="h-3.5 w-3.5 text-sky-400" />;
    }
  };

  const starterPrompts = [
    {
      label: "What topics are in my queue?",
      text: "Provide a structured breakdown of the primary topics, technologies, or subjects represented in my queue.",
    },
    {
      label: "Summarize my YouTube videos",
      text: "Give me a high-level summary of all the YouTube videos currently in my queue.",
    },
    {
      label: "Find articles about development",
      text: "List and summarize the software development or engineering articles in my queue.",
    },
    {
      label: "What should I read next?",
      text: "Based on my unread queue items, recommend a high-value item for me to read or watch next and explain why.",
    },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col min-h-screen bg-background text-foreground">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.65_0.2_270_/_6%)] blur-[140px]" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.55_0.18_300_/_5%)] blur-[140px]" />
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
                className="glass-strong border-border/30 hover:bg-accent/40 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to Dashboard
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

      {/* Main chat area */}
      <div className="relative z-10 flex-1 flex flex-col max-w-4xl w-full mx-auto px-6 py-8 h-[calc(100vh-73px)]">
        {/* Header / controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary animate-pulse-slow">
              <Sparkles className="h-3 w-3" />
              Queue Assistant
            </span>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearChat}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear Conversation
            </Button>
          )}
        </div>

        {/* Message history */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-6 scrollbar-thin pb-28">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto py-12">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mb-6 glow-primary">
                <MessageSquare className="h-8 w-8 text-primary animate-float" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-2">
                Chat with your <span className="gradient-text">QueueIt Library</span>
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                Welcome to your AI Queue Assistant. Ask queries about the articles, YouTube videos, GitHub repos, and documents saved in your queue.
                <br />
                <span className="text-xs text-primary/70 font-semibold mt-2 block">
                  🔒 Encapsulated mode: Questions outside your queue context are restricted.
                </span>
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt.label}
                    onClick={() => handleSend(prompt.text)}
                    className="flex flex-col items-start p-4 rounded-xl border border-border/40 hover:border-primary/30 bg-card/45 hover:bg-card/90 transition-all text-left group cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-primary group-hover:text-primary-foreground transition-colors mb-1 font-mono">
                      {prompt.label}
                    </span>
                    <span className="text-xs text-muted-foreground line-clamp-2">
                      {prompt.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-4 transition-all ${
                      msg.role === "user"
                        ? "gradient-primary text-white border-0 glow-primary"
                        : "glass border-border/25 shadow-sm"
                    }`}
                  >
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                      {/* Blinking cursor while streaming */}
                      {msg.streaming && (
                        <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                      )}
                    </div>

                    {/* Sources references widget */}
                    {msg.role === "assistant" && !msg.streaming && msg.sources && msg.sources.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-border/20">
                        <div className="text-[11px] font-semibold text-muted-foreground mb-2 tracking-wider uppercase">
                          Cited Sources
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {msg.sources.map((src) => (
                            <a
                              key={src.id}
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-muted/40 border border-border/30 hover:border-primary/20 hover:bg-muted/80 transition-all font-medium text-foreground max-w-xs"
                            >
                              {getSourceIcon(src.content_type)}
                              <span className="truncate max-w-[160px]">{src.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Error state */}
              {error && (
                <div className="flex justify-center">
                  <div className="px-4 py-2.5 rounded-lg border border-destructive/20 bg-destructive/10 text-destructive text-xs font-semibold">
                    {error}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input box */}
        <div className="absolute bottom-6 left-6 right-6 z-20">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2 p-1.5 rounded-xl border border-border/40 glass-strong shadow-lg focus-within:border-primary/30 transition-all"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about your queue..."
              disabled={isLoading}
              className="flex-1 px-3 py-2 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none border-none"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || !input.trim()}
              className={`rounded-lg cursor-pointer transition-all ${
                input.trim()
                  ? "gradient-primary text-white border-0 glow-primary hover:opacity-90"
                  : "bg-muted text-muted-foreground border border-border/20 cursor-not-allowed"
              }`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
