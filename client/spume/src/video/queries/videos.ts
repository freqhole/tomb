// tanstack query hooks for browsing/playing videos — mirrors
// music/queries/songs.ts's useAlbumsQuery/useAlbumQuery shape.
import {
  createInfiniteQuery,
  createMutation,
  createQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { getVideoDataSource } from "../data";
import type { VideoQueryParams } from "../data/types";
import type { TagFilter } from "../../components/forms/TagFilterPicker";
import { videoQueryKeys } from "./queryKeys";

interface UseVideosQueryOptions {
  search?: () => string | undefined;
  tagFilters?: () => TagFilter[];
  sortField?: () => VideoQueryParams["sort_by"];
  sortDirection?: () => VideoQueryParams["sort_direction"];
  contentTypes?: () => string[] | undefined;
  pageSize?: number;
}

export function useVideosQuery(options?: UseVideosQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const search = options?.search;
  const tagFilters = options?.tagFilters;
  const sortField = options?.sortField || (() => "added_at" as const);
  const sortDirection = options?.sortDirection || (() => "desc" as const);
  const contentTypes = options?.contentTypes;

  return createInfiniteQuery(() => ({
    queryKey: videoQueryKeys.videos.list(
      search?.(),
      tagFilters?.(),
      sortField(),
      sortDirection(),
      undefined,
      undefined,
      contentTypes?.()
    ),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getVideoDataSource();
      const currentTagFilters = tagFilters?.();
      const includeTags = currentTagFilters?.filter((f) => f.mode === "include").map((f) => f.tag);
      const excludeTags = currentTagFilters?.filter((f) => f.mode === "exclude").map((f) => f.tag);
      const currentContentTypes = contentTypes?.();
      return dataSource.getVideos({
        offset: pageParam,
        limit: pageSize,
        search: search?.(),
        sort_by: sortField(),
        sort_direction: sortDirection(),
        include_tags: includeTags && includeTags.length > 0 ? includeTags : undefined,
        exclude_tags: excludeTags && excludeTags.length > 0 ? excludeTags : undefined,
        content_types:
          currentContentTypes && currentContentTypes.length > 0 ? currentContentTypes : undefined,
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

export function useVideoWithMetadataQuery(videoId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: [...videoQueryKeys.videos.detail(videoId() || ""), "with-metadata"],
    queryFn: async () => {
      const id = videoId();
      if (!id) return null;
      const dataSource = getVideoDataSource();
      if (!dataSource.getVideoWithMetadata) return null;
      return dataSource.getVideoWithMetadata(id);
    },
    enabled: !!videoId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

export interface UpdateVideoMutationParams {
  video_id: string;
  title?: string;
  description?: string | null;
  episode_number?: number | null;
  release_date?: string | null;
  series_id?: string | null;
  season_id?: string | null;
  content_type?: string;
  /** force series_id (and season_id) to NULL - passing series_id: null
   * alone is NOT enough on the remote data source (COALESCE-on-write
   * can't tell "no change" from "clear"). ignored by the local data
   * source, which always applies null fields as-is. */
  clear_series_id?: boolean;
  /** force season_id to NULL. */
  clear_season_id?: boolean;
}

export function useUpdateVideoMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: UpdateVideoMutationParams) => {
      const dataSource = getVideoDataSource();
      if (!dataSource.updateVideo) {
        throw new Error("current data source does not support updating videos");
      }
      await dataSource.updateVideo(params);
    },
    onSuccess: (_result, params) => {
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
      queryClient.invalidateQueries({
        queryKey: videoQueryKeys.videos.detail(params.video_id),
      });
    },
  }));
}

export function useDeleteVideoMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (videoId: string) => {
      const dataSource = getVideoDataSource();
      if (!dataSource.deleteVideo) {
        throw new Error("current data source does not support deleting videos");
      }
      await dataSource.deleteVideo(videoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
    },
  }));
}
