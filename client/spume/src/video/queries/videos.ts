// tanstack query hooks for browsing/playing videos — mirrors
// music/queries/songs.ts's useAlbumsQuery/useAlbumQuery shape.
import { createInfiniteQuery, createQuery } from "@tanstack/solid-query";
import { getVideoDataSource } from "../data";
import type { VideoQueryParams } from "../data/types";
import { videoQueryKeys } from "./queryKeys";

interface UseVideosQueryOptions {
  search?: () => string | undefined;
  sortField?: () => VideoQueryParams["sort_by"];
  sortDirection?: () => VideoQueryParams["sort_direction"];
  pageSize?: number;
}

export function useVideosQuery(options?: UseVideosQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const search = options?.search;
  const sortField = options?.sortField || (() => "added_at" as const);
  const sortDirection = options?.sortDirection || (() => "desc" as const);

  return createInfiniteQuery(() => ({
    queryKey: videoQueryKeys.videos.list(search?.(), sortField(), sortDirection()),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getVideoDataSource();
      return dataSource.getVideos({
        offset: pageParam,
        limit: pageSize,
        search: search?.(),
        sort_by: sortField(),
        sort_direction: sortDirection(),
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.has_more) return undefined;
      return allPages.reduce((sum, page) => sum + page.items.length, 0);
    },
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }));
}

export function useVideoQuery(videoId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.videos.detail(videoId() || ""),
    queryFn: async () => {
      const id = videoId();
      if (!id) return null;
      const dataSource = getVideoDataSource();
      return dataSource.getVideoById(id);
    },
    enabled: !!videoId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}
