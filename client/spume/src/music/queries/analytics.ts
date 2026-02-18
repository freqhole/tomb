// query hooks for analytics and feed data
import { createQuery, createInfiniteQuery } from "@tanstack/solid-query";
import * as apiClient from "freqhole-api-client";
import { getCurrentRemote } from "../data";
import type { FeedItem, FeedResponse, ImageMetadata } from "../data/types";
import { queryKeys } from "./queryKeys";

// adapt raw API images to app-level ImageMetadata
function adaptFeedImages(
  images: Array<{ blob_id: string; is_primary: number; blob_type: string }> | null | undefined,
  baseUrl: string,
): ImageMetadata[] | null {
  if (!images || images.length === 0) return null;
  return images.map((img) => ({
    remote_blob_id: img.blob_id,
    remote_url: `${baseUrl}/api/blobs/${img.blob_id}`,
    is_primary: img.is_primary === 1,
    blob_type: (img.blob_type as ImageMetadata["blob_type"]) ?? "thumbnail",
  }));
}

// adapt a raw API feed response to app-level types
function adaptFeedResponse(data: any, baseUrl: string): FeedResponse {
  return {
    items: (data.items ?? []).map((item: any): FeedItem => ({
      id: item.id,
      feed_type: item.feed_type,
      song_id: item.song_id ?? null,
      album_id: item.album_id ?? null,
      artist_id: item.artist_id ?? null,
      playlist_id: item.playlist_id ?? null,
      title: item.title,
      subtitle: item.subtitle ?? null,
      images: adaptFeedImages(item.images, baseUrl),
      created_at: item.created_at,
      user_id: item.user_id ?? null,
      username: item.username ?? null,
      play_count: item.play_count ?? null,
      rating: item.rating ?? null,
      target_type: item.target_type ?? null,
      session_id: item.session_id ?? null,
      session_type: item.session_type ?? null,
      session_status: item.session_status ?? null,
      progress_percent: item.progress_percent ?? null,
      songs_completed: item.songs_completed ?? null,
      total_songs: item.total_songs ?? null,
      artist_name: item.artist_name ?? null,
      album_title: item.album_title ?? null,
      genre: item.genre ?? null,
      genre_id: item.genre_id ?? null,
      year: item.year ?? null,
      song_count: item.song_count ?? null,
      total_duration_ms: item.total_duration_ms ?? null,
      description: item.description ?? null,
      tags: item.tags ?? null,
      is_favorite: item.is_favorite ?? false,
      collage_images: adaptFeedImages(item.collage_images, baseUrl),
    })),
    total: data.total ?? 0,
  };
}

// activity feed query (non-paginated, legacy)
export function useActivityFeedQuery(limit: number = 50) {
  return createQuery(() => ({
    queryKey: queryKeys.analytics.feed(limit),
    queryFn: async (): Promise<FeedResponse> => {
      const remote = getCurrentRemote();
      if (!remote) return { items: [], total: 0 };

      const result = await apiClient.music.activityFeed(remote.base_url, {
        limit,
        offset: null,
        feed_types: null,
        user_id: null,
      });

      if (!result.success) {
        throw new Error("failed to fetch activity feed");
      }

      return adaptFeedResponse(result.data, remote.base_url);
    },
    enabled: !!getCurrentRemote(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchInterval: 60_000,
  }));
}

// feed item type literal values for filtering
export type FeedItemTypeFilter =
  | "recent_listen"
  | "recent_favorite"
  | "recent_album"
  | "recent_rating"
  | "recent_playlist"
  | "listen_session"
  | "new_image";

// all available feed type filter values (listen_session first, recent_listen removed)
export const ALL_FEED_TYPES: FeedItemTypeFilter[] = [
  "listen_session",
  "recent_favorite",
  "recent_album",
  "recent_rating",
  "recent_playlist",
  "new_image",
];

// human-readable labels for feed types
export const FEED_TYPE_LABELS: Record<FeedItemTypeFilter, string> = {
  recent_listen: "listens",
  recent_favorite: "favorites",
  recent_album: "albums",
  recent_rating: "ratings",
  recent_playlist: "playlists",
  listen_session: "listening sessions",
  new_image: "images",
};

// infinite scrolling activity feed query with optional filters
export function useActivityFeedInfiniteQuery(
  pageSize: number = 50,
  feedTypes?: () => FeedItemTypeFilter[] | null,
  userId?: () => string | null,
) {
  return createInfiniteQuery(() => {
    const types = feedTypes?.() ?? null;
    const uid = userId?.() ?? null;
    return {
      queryKey: queryKeys.analytics.feedInfinite(types, uid),
      queryFn: async ({ pageParam }: { pageParam: number }): Promise<FeedResponse> => {
        const remote = getCurrentRemote();
        if (!remote) return { items: [], total: 0 };

        const result = await apiClient.music.activityFeed(remote.base_url, {
          limit: pageSize,
          offset: pageParam,
          feed_types: types,
          user_id: uid,
        });

        if (!result.success) {
          throw new Error("failed to fetch activity feed");
        }

        return adaptFeedResponse(result.data, remote.base_url);
      },
      getNextPageParam: (lastPage: FeedResponse, allPages: FeedResponse[]) => {
        const totalFetched = allPages.reduce((sum, page) => sum + page.items.length, 0);
        if (totalFetched >= lastPage.total) return undefined;
        return totalFetched;
      },
      initialPageParam: 0,
      enabled: !!getCurrentRemote(),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    };
  });
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
