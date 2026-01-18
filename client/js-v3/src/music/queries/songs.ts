// infinite query hook for songs with album-grouped sorting
import { createInfiniteQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { querySongsWithDetails } from "../services/storage/db";
import type { SongQueryResult } from "../services/storage/types";

export type SongSortField =
  | "added_at"
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "year";

export type SongSortDirection = "asc" | "desc";

interface UseSongsInfiniteQueryOptions {
  sortField?: Accessor<SongSortField>;
  sortDirection?: Accessor<SongSortDirection>;
  pageSize?: number;
}

export function useSongsInfiniteQuery(options?: UseSongsInfiniteQueryOptions) {
  const sortField = options?.sortField || (() => "added_at" as const);
  const sortDirection = options?.sortDirection || (() => "desc" as const);
  const pageSize = options?.pageSize || 100;

  return createInfiniteQuery(() => ({
    queryKey: ["songs", "infinite", sortField(), sortDirection()],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const results = await querySongsWithDetails({
        offset: pageParam,
        limit: pageSize,
        sortField: sortField(),
        sortDirection: sortDirection(),
      });
      return results;
    },
    getNextPageParam: (
      lastPage: SongQueryResult[],
      allPages: SongQueryResult[][],
    ) => {
      // if last page was less than page size, no more pages
      if (lastPage.length < pageSize) return undefined;
      // next offset = total songs loaded so far
      return allPages.flat().length;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000, // 5 minutes - prevent refetch on remount
    gcTime: 10 * 60 * 1000, // 10 minutes - keep data in cache
    refetchOnMount: false, // don't refetch on remount, keep accumulated pages
    refetchOnWindowFocus: false, // don't refetch on window focus
  }));
}
