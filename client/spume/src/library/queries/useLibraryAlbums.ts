// per-remote albums query for the library table.
//
// unlike `useAlbumsQuery` (which targets the *current* data source), this
// hook lets the library view query an arbitrary remote regardless of the
// current source/route context. infinite scroll with the same `query_albums`
// route used by the per-remote albums page.

import { createInfiniteQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { AlbumSummary, PaginatedResponse } from "../../music/data/types";
import { adaptApiImage, adaptApiUrls } from "../../music/data/remote/adapters";
import type { MbLookupStatus } from "../data/albumMetadata";
import { isInFlight } from "../data/mbStatusGroups";

export interface LibraryAlbumsQueryOptions {
  remote: Accessor<Remote | undefined>;
  search?: Accessor<string | undefined>;
  pageSize?: number;
  sortBy?: Accessor<string | undefined>;
  sortDirection?: Accessor<"asc" | "desc">;
}

const DEFAULT_PAGE_SIZE = 100;

export function useLibraryAlbumsQuery(opts: LibraryAlbumsQueryOptions) {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;

  return createInfiniteQuery(() => ({
    queryKey: [
      "library-albums",
      opts.remote()?.remote_id ?? null,
      opts.search?.() ?? null,
      opts.sortBy?.() ?? null,
      opts.sortDirection?.() ?? null,
    ],
    enabled: !!opts.remote(),
    queryFn: async ({ pageParam }: { pageParam: number }): Promise<PaginatedResponse<AlbumSummary>> => {
      const remote = opts.remote();
      if (!remote) {
        return { items: [], total: 0, offset: 0, limit: pageSize, has_more: false };
      }
      const client = await getClientForRemote(remote);
      const result = await client.music.queryAlbums({
        q: opts.search?.() ?? null,
        search_fields: null,
        filters: {},
        sort_by: opts.sortBy?.() ?? null,
        sort_direction: opts.sortDirection?.() ?? null,
        limit: pageSize,
        offset: pageParam,
        user_id: null,
        favorites_only: null,
        min_rating: null,
      });

      if (!result.success || !result.data) {
        throw new Error("failed to query albums for remote");
      }

      const baseUrl = (remote as { base_url?: string }).base_url ?? "";
      const remoteId = remote.remote_id;
      return {
        items: result.data.items.map((item): AlbumSummary => ({
          album_id: item.album.id,
          title: item.album.title,
          artist_id: item.artist?.id ?? "",
          artist_name: item.artist?.name ?? "unknown artist",
          album_type: item.album.album_type,
          year: undefined,
          release_date: item.album.release_date ?? undefined,
          label: item.album.label ?? undefined,
          genres: item.album.genres ?? undefined,
          song_count: item.album.song_count,
          total_duration: item.album.total_duration,
          images:
            item.images && item.images.length > 0
              ? item.images.map((img) => adaptApiImage(img, baseUrl, remoteId))
              : undefined,
          urls: adaptApiUrls(item.album.urls),
          is_favorite: item.is_favorite ?? undefined,
          user_rating: item.rating ?? undefined,
          tags: item.album_tags ?? undefined,
          created_at: item.album.created_at,
          updated_at: item.album.updated_at,
          created_by_username: item.album.created_by_username ?? undefined,
          updated_by_username: item.album.updated_by_username ?? undefined,
          metadata: item.album.metadata ?? null,
          mb_lookup_status: item.album.mb_lookup_status ?? null,
          mb_lookup_at: item.album.mb_lookup_at ?? null,
          mb_lookup_by: item.album.mb_lookup_by ?? null,
        })),
        total: result.data.total_count,
        offset: result.data.offset,
        limit: result.data.limit,
        has_more: result.data.has_more,
      };
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    initialPageParam: 0,
    placeholderData: (prev) => prev,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // poll while any visible row is in `auto_applying`. that status is
    // owned by a server-side background job (`AutoApplyAlbumEnrichment`)
    // that wasn't enqueued from this client, so the in-flight job
    // tracker can't invalidate us when it finishes. cheap re-poll until
    // the row flips out of `auto_applying`.
    refetchInterval: (query) => {
      const data = query.state.data as
        | { pages?: Array<{ items: Array<{ mb_lookup_status?: string | null }> }> }
        | undefined;
      const pages = data?.pages ?? [];
      for (const p of pages) {
        for (const it of p.items) {
          if (isInFlight(it.mb_lookup_status as MbLookupStatus | null | undefined)) return 5000;
        }
      }
      return false;
    },
  }));
}
