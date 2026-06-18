// Canonical QueueItem interface — matches the database schema exactly.
// Use this everywhere in the frontend. Never use ad-hoc field names.

export interface QueueItem {
  id: string;
  user_id: string;
  url: string;
  title: string | null;
  description: string | null;
  content_type: string;          // youtube | twitter | reddit | github | article | generic
  source_name: string | null;
  thumbnail_url: string | null;
  estimated_read_time: number | null;  // minutes
  duration_seconds: number | null;
  extracted_text: string | null;
  author: string | null;
  tags: string[];
  ai_summary: string | null;
  priority_score: number;
  status: "unread" | "reading" | "completed" | "archived";
  is_favorite: boolean;
  created_at: string;
  audio_url?: string | null;
}

export interface ItemsResponse {
  items: QueueItem[];
  total: number;
}


// Types for sorting options
export type SortOption = "newest" | "priority" | "shortest" | "longest";

// Existing code continues
// Types for status filter
export type StatusFilter = "all" | "unread" | "reading" | "completed" | "archived";

export type TypeFilter = "all" | "article" | "youtube" | "twitter" | "reddit" | "github";

export interface ItemFilters {
  status?: string;
  type?: string;
  tag?: string;
  search?: string;
  sort?: SortOption;
  limit?: number;
  offset?: number;
}
