// tanstack query hooks for browsing video series / season detail —
// mirrors music/queries/songs.ts's album query hooks shape.
import { createInfiniteQuery, createQuery } from "@tanstack/solid-query";
import { getVideoDataSource } from "../data";
import type { VideoSeason, VideoSeries, VideoSummary } from "../data/types";
import { videoQueryKeys } from "./queryKeys";

interface UseVideoSeriesListQueryOptions {
  search?: () => string | undefined;
  pageSize?: number;
}

export function useVideoSeriesListQuery(options?: UseVideoSeriesListQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const search = options?.search;

  return createInfiniteQuery(() => ({
    queryKey: videoQueryKeys.series.list(search?.()),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getVideoDataSource();
      return dataSource.getVideoSeriesList({
        offset: pageParam,
        limit: pageSize,
        search: search?.(),
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

export interface VideoSeriesDetail {
  series: VideoSeries;
  seasons: (VideoSeason & { videos: VideoSummary[] })[];
}

export function useVideoSeriesDetailQuery(seriesId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.series.detail(seriesId() || ""),
    queryFn: async (): Promise<VideoSeriesDetail | null> => {
      const id = seriesId();
      if (!id) return null;

      const dataSource = getVideoDataSource();
      const series = await dataSource.getVideoSeriesById(id);
      if (!series) return null;

      const seasons = await dataSource.getVideoSeasons(id);
      const seasonsWithVideos = await Promise.all(
        seasons.map(async (season) => ({
          ...season,
          videos: await dataSource.getVideosBySeason(season.id),
        }))
      );

      return { series, seasons: seasonsWithVideos };
    },
    enabled: !!seriesId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}
