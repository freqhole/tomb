// tanstack query hooks for browsing video series / season detail —
// mirrors music/queries/songs.ts's album query hooks shape.
import {
  createInfiniteQuery,
  createMutation,
  createQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { getVideoDataSource } from "../data";
import type { VideoSeason, VideoSeries, VideoSummary } from "../data/types";
import { videoQueryKeys } from "./queryKeys";

interface UseVideoSeriesListQueryOptions {
  search?: () => string | undefined;
  pageSize?: number;
  // "autocomplete" isolates this query's cache key from the master
  // "browse all series" list — required for any small/typeahead usage
  // (see videoQueryKeys.series.autocomplete for why sharing a key is unsafe).
  keyScope?: "list" | "autocomplete";
}

export function useVideoSeriesListQuery(options?: UseVideoSeriesListQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const search = options?.search;
  const keyScope = options?.keyScope ?? "list";

  return createInfiniteQuery(() => ({
    queryKey:
      keyScope === "autocomplete"
        ? videoQueryKeys.series.autocomplete(search?.())
        : videoQueryKeys.series.list(search?.()),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getVideoDataSource();
      const result = await dataSource.getVideoSeriesList({
        offset: pageParam,
        limit: pageSize,
        search: search?.(),
      });
      return result;
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
  /** videos attached directly to the series with no season (season-less
   * docuseries episodes) — these were previously silently dropped since
   * the old query only ever walked `seasons`, never the series' own
   * season-less videos. */
  unassignedVideos: VideoSummary[];
}

export function useVideoSeriesDetailQuery(seriesId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.series.detail(seriesId() || ""),
    queryFn: async (): Promise<VideoSeriesDetail | null> => {
      const id = seriesId();
      if (!id) return null;

      const dataSource = getVideoDataSource();
      return dataSource.getVideoSeriesDetail(id);
    },
    enabled: !!seriesId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

export function useCreateVideoSeriesMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: { title: string; description?: string | null }) => {
      const dataSource = getVideoDataSource();
      if (!dataSource.createVideoSeries) {
        throw new Error("current data source does not support creating video series");
      }
      return dataSource.createVideoSeries(params);
    },
    onSuccess: () => {
      // refetchType: "all" (not just "active") — the series list query is
      // created with refetchOnMount: false, so a series created while
      // that list wasn't mounted (e.g. from EditVideoModal's "create new
      // series" affordance) would otherwise sit invalidated-but-unfetched
      // until the next full reload, since remounting alone won't refetch.
      queryClient.invalidateQueries({
        queryKey: videoQueryKeys.series.all(),
        refetchType: "all",
      });
    },
  }));
}

/** every season belonging to a series (no search — series rarely have
 * enough seasons to need it, mirrors the plain-Select fetch this hook
 * replaces in EditVideoModal.tsx/BulkEditVideosModal.tsx). */
export function useVideoSeasonsQuery(seriesId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.series.seasons(seriesId() || ""),
    queryFn: async () => {
      const id = seriesId();
      if (!id) return [];
      const dataSource = getVideoDataSource();
      return dataSource.getVideoSeasons(id);
    },
    enabled: !!seriesId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

export function useCreateVideoSeasonMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      series_id: string;
      season_number: number;
      title?: string | null;
      description?: string | null;
    }) => {
      const dataSource = getVideoDataSource();
      if (!dataSource.createVideoSeason) {
        throw new Error("current data source does not support creating video seasons");
      }
      return dataSource.createVideoSeason(params);
    },
    onSuccess: (_result, params) => {
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.seasons(params.series_id) });
    },
  }));
}

export interface UpdateVideoSeasonMutationParams {
  season_id: string;
  series_id: string;
  season_number?: number;
  title?: string | null;
  description?: string | null;
  poster_blob_id?: string | null;
}

export function useUpdateVideoSeasonMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: UpdateVideoSeasonMutationParams) => {
      const dataSource = getVideoDataSource();
      if (!dataSource.updateVideoSeason) {
        throw new Error("current data source does not support updating video seasons");
      }
      const { series_id: _series_id, ...updateParams } = params;
      await dataSource.updateVideoSeason(updateParams);
    },
    onSuccess: (_result, params) => {
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.seasons(params.series_id) });
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.detail(params.series_id) });
    },
  }));
}

export interface UpdateVideoSeriesMutationParams {
  series_id: string;
  title?: string;
  description?: string | null;
  poster_blob_id?: string | null;
}

export function useUpdateVideoSeriesMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: UpdateVideoSeriesMutationParams) => {
      const dataSource = getVideoDataSource();
      if (!dataSource.updateVideoSeries) {
        throw new Error("current data source does not support updating video series");
      }
      await dataSource.updateVideoSeries(params);
    },
    onSuccess: (_result, params) => {
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.all() });
      queryClient.invalidateQueries({
        queryKey: videoQueryKeys.series.detail(params.series_id),
      });
    },
  }));
}

export function useDeleteVideoSeriesMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (seriesId: string) => {
      const dataSource = getVideoDataSource();
      if (!dataSource.deleteVideoSeries) {
        throw new Error("current data source does not support deleting video series");
      }
      await dataSource.deleteVideoSeries(seriesId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.all() });
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
    },
  }));
}
