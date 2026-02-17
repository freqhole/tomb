// query hooks for analytics and feed data
import { createQuery } from "@tanstack/solid-query";
import * as apiClient from "freqhole-api-client";
import { getCurrentRemote } from "../data";
import { queryKeys } from "./queryKeys";

// activity feed query
export function useActivityFeedQuery(limit: number = 50) {
  return createQuery(() => ({
    queryKey: queryKeys.analytics.feed(limit),
    queryFn: async () => {
      const remote = getCurrentRemote();
      if (!remote) return { items: [], total: 0 };

      const result = await apiClient.music.activityFeed(remote.base_url, {
        limit,
        offset: null,
      });

      if (!result.success) {
        throw new Error("failed to fetch activity feed");
      }

      return result.data;
    },
    enabled: !!getCurrentRemote(),
    staleTime: 30_000, // 30 seconds
    gcTime: 5 * 60_000, // 5 minutes
    refetchInterval: 60_000, // auto-refresh every 60 seconds
  }));
}

// top songs query
export function useTopSongsQuery(limit: number = 10, days?: number) {
  return createQuery(() => ({
    queryKey: queryKeys.analytics.topSongs(limit, days?.toString()),
    queryFn: async () => {
      const remote = getCurrentRemote();
      if (!remote) return [];

      const result = await apiClient.music.topSongs(remote.base_url, {
        limit,
        days: days ?? null,
      });

      if (!result.success) {
        throw new Error("failed to fetch top songs");
      }

      return result.data;
    },
    enabled: !!getCurrentRemote(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  }));
}

// top albums query
export function useTopAlbumsQuery(limit: number = 10, days?: number) {
  return createQuery(() => ({
    queryKey: queryKeys.analytics.topAlbums(limit, days?.toString()),
    queryFn: async () => {
      const remote = getCurrentRemote();
      if (!remote) return [];

      const result = await apiClient.music.topAlbums(remote.base_url, {
        limit,
        days: days ?? null,
      });

      if (!result.success) {
        throw new Error("failed to fetch top albums");
      }

      return result.data;
    },
    enabled: !!getCurrentRemote(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  }));
}

// top artists query
export function useTopArtistsQuery(limit: number = 10, days?: number) {
  return createQuery(() => ({
    queryKey: queryKeys.analytics.topArtists(limit, days?.toString()),
    queryFn: async () => {
      const remote = getCurrentRemote();
      if (!remote) return [];

      const result = await apiClient.music.topArtists(remote.base_url, {
        limit,
        days: days ?? null,
      });

      if (!result.success) {
        throw new Error("failed to fetch top artists");
      }

      return result.data;
    },
    enabled: !!getCurrentRemote(),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  }));
}
