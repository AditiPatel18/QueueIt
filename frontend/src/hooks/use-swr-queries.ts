import useSWR from "swr";
import { getItems, getCollections, getStreakData, getRecommendedNext, getHistoryStats, getReadingAnalytics } from "@/lib/api";
import type { ItemFilters, ItemsResponse, Collection, ReadingAnalyticsData } from "@/types";

export const ITEMS_CACHE_KEY = "api/items";
export const COLLECTIONS_CACHE_KEY = "api/collections";
export const ANALYTICS_CACHE_KEY = "api/user/analytics";
export const RECOMMENDATION_CACHE_KEY = "api/items/recommendations/next";
export const HISTORY_STATS_CACHE_KEY = "api/items/history/stats";
export const READING_ANALYTICS_CACHE_KEY = "api/items/analytics/reading";

/** Hook to fetch and cache user history statistics */
export function useHistoryStats() {
  const { data, error, isLoading, mutate: mutateHistoryStats } = useSWR(
    HISTORY_STATS_CACHE_KEY,
    () => getHistoryStats(),
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  );

  return {
    stats: data || { items_completed: 0, total_time_consumed: 0, top_categories: [], completion_streak: 0 },
    error,
    isLoading,
    mutateHistoryStats,
  };
}

/** Hook to fetch and cache queue items with filters */
export function useItems(filters: ItemFilters) {
  // Use a composite key for filters
  const key = `${ITEMS_CACHE_KEY}?${JSON.stringify(filters)}`;
  
  const { data, error, isLoading, mutate: mutateItems } = useSWR<ItemsResponse>(
    key,
    () => getItems(filters),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
      refreshInterval: (latestData) =>
        latestData?.items?.some((item) => item.processing_status === "processing" || item.processing_status === "queued") ? 2000 : 0,
    }
  );

  return {
    items: data?.items || [],
    total: data?.total || 0,
    error,
    isLoading,
    mutateItems,
  };
}

/** Hook to fetch and cache user folders/collections */
export function useCollections() {
  const { data, error, isLoading, mutate: mutateCollections } = useSWR<Collection[]>(
    COLLECTIONS_CACHE_KEY,
    () => getCollections(),
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  );

  return {
    collections: data || [],
    error,
    isLoading,
    mutateCollections,
  };
}

/** Hook to fetch and cache user dashboard analytics */
export function useAnalytics() {
  const { data, error, isLoading, mutate: mutateAnalytics } = useSWR(
    ANALYTICS_CACHE_KEY,
    () => getStreakData(),
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  );

  return {
    analytics: data,
    error,
    isLoading,
    mutateAnalytics,
  };
}

/** Hook to fetch and cache user AI recommendation */
export function useRecommendation() {
  const { data, error, isLoading, mutate: mutateRecommendation } = useSWR(
    RECOMMENDATION_CACHE_KEY,
    () => getRecommendedNext(),
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  );

  return {
    recommendation: data?.suggestion || null,
    error,
    isLoading,
    mutateRecommendation,
  };
}

/** Hook to fetch and cache user reading analytics */
export function useReadingAnalytics() {
  const { data, error, isLoading, mutate: mutateReadingAnalytics } = useSWR<ReadingAnalyticsData>(
    READING_ANALYTICS_CACHE_KEY,
    () => getReadingAnalytics(),
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  );

  return {
    analytics: data,
    error,
    isLoading,
    mutateReadingAnalytics,
  };
}
