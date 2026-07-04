// Frontend API helper — all calls go through apiClient which handles auth.
// All functions use canonical field names matching the database schema.

import { createClient } from "./supabase/client";
import type { ItemFilters, QueueItem, ReadingAnalyticsData } from "@/types";

// Normalise base URL – strip trailing slash to avoid "//api" problems
const API_BASE = `${(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "")}/api`;

// ---------------------------------------------------------------------------
// Core client with auth header injection
// ---------------------------------------------------------------------------

export async function apiClient(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized — no session");
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
    ...(options.headers as Record<string, string>),
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      let errMessage = "API Error";
      try {
        const errData = await response.json();
        errMessage = errData.detail || errData.message || JSON.stringify(errData);
      } catch {
        errMessage = response.statusText;
      }
      throw new Error(errMessage);
    }

    return response.json();
  } catch (e) {
    console.error("[apiClient] network or parsing error for", endpoint, e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Items API
// ---------------------------------------------------------------------------

/** Add a new item to the queue by URL */
export async function addItem(url: string, title?: string) {
  try {
    const response = await apiClient("/items", {
      method: "POST",
      body: JSON.stringify({ url, title }),
    });
    // Backend returns the created item directly
    return response;
  } catch (err) {
    console.error("[addItem] error", err);
    throw err;
  }
}

/** Get list of items with optional filters */
export async function getItems(filters?: ItemFilters) {
  const params = new URLSearchParams();
  if (filters?.status && filters.status !== "all") params.append("status", filters.status);
  if (filters?.type && filters.type !== "all") params.append("type", filters.type);
  if (filters?.tag) params.append("tag", filters.tag);
  if (filters?.collection_id) params.append("collection_id", filters.collection_id);
  if (filters?.search) params.append("search", filters.search);
  if (filters?.sort) params.append("sort", filters.sort);
  if (filters?.limit) params.append("limit", filters.limit.toString());
  if (filters?.offset) params.append("offset", filters.offset.toString());

  const qs = params.toString();
  const response = await apiClient(`/items${qs ? `?${qs}` : ""}`);
  // Backend returns { items, total }
  return response;
}

/** Search items by text query */
export async function searchItems(q: string, limit = 20) {
  const params = new URLSearchParams({ q, limit: limit.toString() });
  return apiClient(`/items/search/all?${params.toString()}`);
}

/** Get a single item by ID */
export async function getItem(id: string) {
  return apiClient(`/items/${id}`);
}

/** Full edit: title, tags, summary, description, collection_id, read_progress, actual_time_spent */
export async function editItem(
  id: string,
  data: Partial<Pick<QueueItem, "title" | "tags" | "ai_summary" | "description" | "collection_id" | "read_progress" | "actual_time_spent">>
) {
  return apiClient(`/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/** Quick update: status toggle, is_favorite toggle, progress, collection, actual_time_spent */
export async function updateItem(
  id: string,
  data: {
    status?: QueueItem["status"];
    is_favorite?: boolean;
    read_progress?: number;
    collection_id?: string | null;
    actual_time_spent?: number;
  }
) {
  return apiClient(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Get history statistics for completed items */
export async function getHistoryStats(): Promise<{
  items_completed: number;
  total_time_consumed: number;
  top_categories: { category: string; count: number }[];
  completion_streak: number;
}> {
  return apiClient("/items/history/stats");
}

/** Delete an item */
export async function deleteItem(id: string) {
  return apiClient(`/items/${id}`, { method: "DELETE" });
}

/** Recalculate priorities for all unread items */
export async function recalculatePriorities() {
  return apiClient("/items/recalculate-priorities", { method: "POST" });
}

/** Get the AI recommendation for the next item */
export async function getRecommendedNext() {
  return apiClient("/items/recommendations/next");
}

/** Generate audio summary for an item */
export async function generateAudioSummary(id: string) {
  return apiClient(`/items/${id}/audio-summary`, { method: "POST" });
}

/** Get streak and badges data for the current user */
export async function getStreakData() {
  return apiClient("/items/user/streak");
}

/** Backfill missing AI summaries for all items */
export async function backfillSummaries() {
  return apiClient("/items/backfill-summaries", { method: "POST" });
}

/** Retry AI summary generation for a failed or pending item */
export async function retryAI(id: string) {
  return apiClient(`/items/${id}/retry`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Collections API
// ---------------------------------------------------------------------------

import type { Collection } from "@/types";

/** Get all collections */
export async function getCollections(): Promise<Collection[]> {
  return apiClient("/collections");
}

/** Create a new collection */
export async function createCollection(name: string, color?: string): Promise<Collection> {
  return apiClient("/collections", {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });
}

/** Update a collection name or color */
export async function updateCollection(id: string, name?: string, color?: string): Promise<Collection> {
  return apiClient(`/collections/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, color }),
  });
}

/** Delete a collection */
export async function deleteCollection(id: string) {
  return apiClient(`/collections/${id}`, { method: "DELETE" });
}

/** Trigger AI auto-reclassification of uncategorized items */
export async function reclassifyItems() {
  return apiClient("/items/reclassify", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Bulk Actions API
// ---------------------------------------------------------------------------

/** Perform bulk operations on multiple queue items */
export async function bulkItemsAction(data: {
  ids: string[];
  action: "delete" | "move" | "status" | "favorite";
  status?: QueueItem["status"];
  collection_id?: string | null;
  is_favorite?: boolean;
}) {
  return apiClient("/items/bulk", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  response: string;
  sources: QueueItem[];
}

/**
 * Stream a chat message via SSE.
 * Calls onToken for each text chunk, onDone({ response, sources }) when complete.
 * Returns a cleanup function that aborts the fetch.
 */
export function sendChatMessageStream(
  message: string,
  history: ChatMessage[],
  onToken: (text: string) => void,
  onDone: (result: ChatResponse) => void,
  onError: (err: Error) => void
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        onError(new Error("Unauthorized — no session"));
        return;
      }

      const response = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ message, history }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errMsg = "Chat API error";
        try {
          const errData = await response.json();
          errMsg = errData.detail || errData.message || errMsg;
        } catch {}
        onError(new Error(errMsg));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError(new Error("No response body"));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let sources: QueueItem[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw);
            if (event.type === "token") {
              accumulatedText += event.text;
              onToken(event.text);
            } else if (event.type === "sources") {
              sources = event.data ?? [];
            } else if (event.type === "done") {
              onDone({ response: accumulatedText, sources });
              return;
            } else if (event.type === "error") {
              onError(new Error(event.text || "Stream error"));
              return;
            }
          } catch {
            // Malformed SSE line — skip
          }
        }
      }

      // Stream ended without "done" event — still resolve
      onDone({ response: accumulatedText, sources });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return () => controller.abort();
}

/** Non-streaming fallback (kept for compatibility) */
export async function sendChatMessage(message: string, history: ChatMessage[]): Promise<ChatResponse> {
  return new Promise((resolve, reject) => {
    let response = "";
    let sources: QueueItem[] = [];
    sendChatMessageStream(
      message,
      history,
      (token) => { response += token; },
      (result) => resolve(result),
      (err) => reject(err)
    );
  });
}

/** Get full reading analytics */
export async function getReadingAnalytics(): Promise<ReadingAnalyticsData> {
  return apiClient("/items/analytics/reading");
}

