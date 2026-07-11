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
  source_type?: string | null;
  source_domain?: string | null;
  logo_url?: string | null;
  thumbnail_url: string | null;
  estimated_read_time: number | null;  // minutes
  duration_seconds: number | null;
  extracted_text: string | null;
  author: string | null;
  tags: string[];
  ai_summary: string | null;
  full_summary?: string | null;
  priority_score: number;
  status: "unread" | "reading" | "completed" | "archived";
  processing_status: "queued" | "processing" | "completed" | "failed" | "pending_quota" | "ai_pending";
  is_favorite: boolean;
  created_at: string;
  completed_at?: string | null;
  audio_url?: string | null;
  collection_id?: string | null;
  read_progress: number;
  actual_time_spent?: number | null;
  estimated_time_minutes?: number | null;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
  item_count?: number;
  read_time_minutes?: number;
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
  collection_id?: string;
  search?: string;
  sort?: SortOption;
  limit?: number;
  offset?: number;
}

export interface ReadingAnalyticsData {
  reading_time: {
    daily: number;
    weekly: number;
    monthly: number;
    daily_goal: number;
  };
  average_completion_time: number;
  category_distribution: {
    category: string;
    count: number;
    time_spent: number;
  }[];
  most_viewed_categories: {
    category: string;
    views: number;
  }[];
  streak: {
    current: number;
    longest: number;
    completed_dates: string[];
  };
  productivity_score: number;
  top_ai_topics: {
    topic: string;
    count: number;
  }[];
  charts: {
    daily: {
      date: string;
      minutes: number;
      completions: number;
    }[];
    weekly: {
      week_start: string;
      minutes: number;
      completions: number;
    }[];
    monthly: {
      month: string;
      minutes: number;
      completions: number;
    }[];
  };
}

export interface ReadingAnalyticsDashboardData {
  total_items: number;
  completed_items: number;
  completion_percentage: number;
  total_reading_time: number;
  time_completed: number;
  remaining_time: number;
  average_reading_time_item: number;
  current_reading_streak: number;
  longest_streak: number;
  productivity_score: number;
  last_7_days: {
    date: string;
    completed_count: number;
    reading_minutes: number;
  }[];
  last_30_days: {
    date: string;
    completed_count: number;
    reading_minutes: number;
  }[];
  weekly_reading_minutes: number;
  monthly_reading_minutes: number;
  daily_completion_counts: Record<string, number>;
}

export interface ReminderSettings {
  enabled: boolean;
  reminder_time: string;
  snoozed_until: string | null;
  last_reminded_at: string | null;
  frequency: "daily" | "weekdays" | "weekly" | "custom";
  custom_days: string;
  timezone: string;
  browser_notifications: boolean;
  email_reminders: boolean;
}

export interface ReminderHistoryEntry {
  id: string;
  user_id: string;
  item_id: string | null;
  title: string;
  scheduled_time: string;
  sent_at: string;
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'completed' | 'snoozed' | 'read' | 'failed';
  channel: string;
  completed_at: string | null;
}

export interface GamificationBadge {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface GamificationData {
  xp: number;
  level: number;
  xp_needed: number;
  streak_freezes_available: number;
  last_freeze_used_at: string | null;
  daily_goal: number;
  current_streak: number;
  longest_streak: number;
  calendar: string[];
  badges: GamificationBadge[];
}

export interface RemindersResponse {
  settings: ReminderSettings;
  active_reminders: ReminderHistoryEntry[];
  unread_count: number;
  history: ReminderHistoryEntry[];
  gamification: GamificationData;
}


