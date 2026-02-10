// autocomplete query hooks for artists and albums
// these are separate from the main list queries because they:
// - use smaller limits (10-20 items instead of 100)
// - are optimized for fast, debounced search-as-you-type
// - don't need pagination (just top results)

import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getDataSource } from "../data";
import { queryKeys } from "./queryKeys";

const AUTOCOMPLETE_LIMIT = 15;
const AUTOCOMPLETE_STALE_TIME = 2 * 60 * 1000; // 2 minutes

// artist autocomplete query hook
export function useArtistAutocompleteQuery(
  searchTerm: Accessor<string | undefined>,
) {
  return createQuery(() => ({
    queryKey: queryKeys.artists.autocomplete(searchTerm()),
    queryFn: async () => {
      const term = searchTerm();
      if (!term || term.trim().length === 0) {
        return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
      }

      const dataSource = getDataSource();
      if (!dataSource.getArtists) {
        return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
      }

      return dataSource.getArtists({
        search: term.trim(),
        limit: AUTOCOMPLETE_LIMIT,
        offset: 0,
      });
    },
    enabled: () => {
      const term = searchTerm();
      return !!term && term.trim().length > 0;
    },
    staleTime: AUTOCOMPLETE_STALE_TIME,
    gcTime: 5 * 60 * 1000, // 5 minutes
  }));
}

// album autocomplete query hook
// optionally filters by artist_id to show only albums by that artist
export function useAlbumAutocompleteQuery(
  searchTerm: Accessor<string | undefined>,
  artistId?: Accessor<string | undefined>,
) {
  return createQuery(() => ({
    queryKey: queryKeys.albums.autocomplete(searchTerm(), artistId?.()),
    queryFn: async () => {
      const term = searchTerm();
      if (!term || term.trim().length === 0) {
        return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
      }

      const dataSource = getDataSource();
      if (!dataSource.getAlbums) {
        return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
      }

      return dataSource.getAlbums({
        search: term.trim(),
        artist_id: artistId?.(),
        limit: AUTOCOMPLETE_LIMIT,
        offset: 0,
      });
    },
    enabled: () => {
      const term = searchTerm();
      return !!term && term.trim().length > 0;
    },
    staleTime: AUTOCOMPLETE_STALE_TIME,
    gcTime: 5 * 60 * 1000, // 5 minutes
  }));
}
