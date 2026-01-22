// search query hooks for suggestions and full search results
import { createInfiniteQuery, createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getDataSource } from "../data";
import type {
  SearchField,
  SearchResponse,
  SuggestionsResponse,
} from "../data/types";

interface UseSearchSuggestionsOptions {
  field: Accessor<SearchField>;
  partial: Accessor<string>;
  pageSize?: number;
  enabled?: Accessor<boolean>;
}

// hook for search suggestions (autocomplete) with infinite scroll
export function useSearchSuggestions(options: UseSearchSuggestionsOptions) {
  const field = options.field;
  const partial = options.partial;
  const pageSize = options.pageSize || 10;
  const enabled = options.enabled || (() => true);

  return createInfiniteQuery(() => ({
    queryKey: ["search", "suggestions", field(), partial()],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();
      const partialValue = partial();

      // only search if we have at least 2 characters
      if (partialValue.length < 2) {
        return {
          suggestions: [],
          query_time_ms: 0,
          total_count: 0,
          page: 1,
          page_size: pageSize,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        } as SuggestionsResponse;
      }

      // check if data source supports search
      if (!dataSource.searchSuggestions) {
        return {
          suggestions: [],
          query_time_ms: 0,
          total_count: 0,
          page: 1,
          page_size: pageSize,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        } as SuggestionsResponse;
      }

      return dataSource.searchSuggestions({
        field: field(),
        partial: partialValue,
        page: pageParam,
        page_size: pageSize,
      });
    },
    getNextPageParam: (lastPage) => {
      // check if there are more pages
      if (!lastPage.has_next) return undefined;
      return lastPage.page + 1;
    },
    initialPageParam: 1,
    enabled: () => enabled() && partial().length >= 2,
    staleTime: 30 * 1000, // 30 seconds - suggestions are fairly stable
    gcTime: 60 * 1000, // 1 minute
  }));
}

interface UseSearchQueryOptions {
  query: Accessor<string>;
  field?: Accessor<SearchField | null>;
  pageSize?: number;
  enabled?: Accessor<boolean>;
}

// hook for full search with infinite scroll
export function useSearchQuery(options: UseSearchQueryOptions) {
  const query = options.query;
  const field = options.field || (() => null);
  const pageSize = options.pageSize || 50;
  const enabled = options.enabled || (() => true);

  return createInfiniteQuery(() => ({
    queryKey: ["search", "results", query(), field()],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();
      const queryValue = query();

      // only search if we have at least 2 characters
      if (queryValue.length < 2) {
        return {
          songs: [],
          artists: null,
          albums: null,
          genres: null,
          playlists: null,
          total_count: 0,
          page: 1,
          page_size: pageSize,
          total_pages: 0,
          has_next: false,
          has_prev: false,
          query_time_ms: 0,
          applied_filters: null,
          sort_applied: null,
        } as SearchResponse;
      }

      // check if data source supports search
      if (!dataSource.search) {
        return {
          songs: [],
          artists: null,
          albums: null,
          genres: null,
          playlists: null,
          total_count: 0,
          page: 1,
          page_size: pageSize,
          total_pages: 0,
          has_next: false,
          has_prev: false,
          query_time_ms: 0,
          applied_filters: null,
          sort_applied: null,
        } as SearchResponse;
      }

      return dataSource.search({
        query: queryValue,
        field: field(),
        page: pageParam,
        page_size: pageSize,
      });
    },
    getNextPageParam: (lastPage) => {
      // check if there are more pages
      if (!lastPage.has_next) return undefined;
      return lastPage.page + 1;
    },
    initialPageParam: 1,
    enabled: () => enabled() && query().length >= 2,
    staleTime: 2 * 60 * 1000, // 2 minutes - search results can be cached briefly
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }));
}
