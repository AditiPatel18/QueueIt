// Frontend API helper — all calls go through apiClient which handles auth.
// All functions use canonical field names matching the database schema.

import { createClient } from "./supabase/client";
import type { ItemFilters, QueueItem } from "@/types";

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

/** Full edit: title, tags, summary, description */
export async function editItem(
  id: string,
  data: Partial<Pick<QueueItem, "title" | "tags" | "ai_summary" | "description">>
) {
  return apiClient(`/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/** Quick update: status toggle, is_favorite toggle */
export async function updateItem(
  id: string,
  data: { status?: QueueItem["status"]; is_favorite?: boolean }
) {
  return apiClient(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
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
