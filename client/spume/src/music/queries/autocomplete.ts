// autocomplete query hooks for artists and albums
// these are separate from the main list queries because they:
// - use smaller limits (10-20 items instead of 100)
// - are optimized for fast, debounced search-as-you-type
// - don't need pagination (just top results)
//
// when given an optional `remote` accessor, the queries route through
// the picked remote's client (instead of the global active datasource).
// this lets surfaces like the library view (which can browse a remote
// that isn't the active source) get sensible autocomplete results.

import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getDataSource } from "../data";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { queryKeys } from "./queryKeys";

const AUTOCOMPLETE_LIMIT = 15;
const AUTOCOMPLETE_STALE_TIME = 2 * 60 * 1000; // 2 minutes

// artist autocomplete query hook
export function useArtistAutocompleteQuery(
  searchTerm: Accessor<string | undefined>,
  remote?: Accessor<Remote | undefined>,
) {
  return createQuery(() => ({
    queryKey: [
      ...queryKeys.artists.autocomplete(searchTerm()),
      remote?.()?.remote_id ?? null,
    ] as const,
    queryFn: async () => {
      const term = searchTerm();
      if (!term || term.trim().length === 0) {
        return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
      }

      const r = remote?.();
      if (r) {
        const client = await getClientForRemote(r);
        const resp = await client.music.queryArtists({
          q: term.trim(),
          search_fields: null,
          filters: {},
          sort_by: null,
          sort_direction: null,
          limit: AUTOCOMPLETE_LIMIT,
          offset: 0,
          user_id: null,
          favorites_only: null,
          min_rating: null,
        });
        if (!resp.success || !resp.data) {
          return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
        }
        const mapImg = (
          arr: Array<{ blob_id: string; is_primary: number; blob_type: "original" | "thumbnail" | "waveform" | "preview" }> | null | undefined,
        ) =>
          arr
            ? arr.map((i) => ({
                blob_id: i.blob_id,
                is_primary: !!i.is_primary,
                blob_type: i.blob_type,
              }))
            : undefined;
        return {
          items: resp.data.items.map((it) => ({
            artist_id: it.artist.id,
            name: it.artist.name,
            bio: it.artist.bio ?? null,
            album_count: it.album_count,
            song_count: it.song_count,
            total_duration: it.total_duration ?? 0,
            images: mapImg(it.images ?? it.artist.images),
            urls: undefined,
            is_favorite: undefined,
          })),
          total: resp.data.total_count,
          offset: resp.data.offset,
          limit: resp.data.limit,
          has_more: resp.data.has_more,
        };
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
  remote?: Accessor<Remote | undefined>,
) {
  return createQuery(() => ({
    queryKey: [
      ...queryKeys.albums.autocomplete(searchTerm(), artistId?.()),
      remote?.()?.remote_id ?? null,
    ] as const,
    queryFn: async () => {
      const term = searchTerm();
      if (!term || term.trim().length === 0) {
        return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
      }

      const r = remote?.();
      if (r) {
        const client = await getClientForRemote(r);
        const filters: Record<string, unknown> = {};
        const aid = artistId?.();
        if (aid) filters.artist_id = aid;
        const resp = await client.music.queryAlbums({
          q: term.trim(),
          search_fields: null,
          filters,
          sort_by: null,
          sort_direction: null,
          limit: AUTOCOMPLETE_LIMIT,
          offset: 0,
          user_id: null,
          favorites_only: null,
          min_rating: null,
        });
        if (!resp.success || !resp.data) {
          return { items: [], total: 0, offset: 0, limit: 0, has_more: false };
        }
        const mapImg = (
          arr: Array<{ blob_id: string; is_primary: number; blob_type: "original" | "thumbnail" | "waveform" | "preview" }> | null | undefined,
        ) =>
          arr
            ? arr.map((i) => ({
                blob_id: i.blob_id,
                is_primary: !!i.is_primary,
                blob_type: i.blob_type,
              }))
            : undefined;
        return {
          items: resp.data.items.map((it) => ({
            album_id: it.album.id,
            title: it.album.title,
            artist_id: it.artist?.id ?? "",
            artist_name: it.artist?.name ?? "",
            album_type: it.album.album_type,
            song_count: it.album.song_count,
            total_duration: it.album.total_duration,
            images: mapImg(it.album.images),
            is_favorite: it.is_favorite ?? undefined,
          })),
          total: resp.data.total_count,
          offset: resp.data.offset,
          limit: resp.data.limit,
          has_more: resp.data.has_more,
        };
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
