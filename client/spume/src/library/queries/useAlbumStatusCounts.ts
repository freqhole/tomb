// query hook for per-status album counts from the server.
//
// intentionally does NOT include the status filter in the request body —
// the endpoint returns counts for ALL statuses so every chip shows the
// count it *would* return if selected (standard faceted-search UX).
//
// keys on remote + search (same base filters as useLibraryAlbumsQuery).

import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import {
  MB_STATUS_GROUP_MEMBERS,
  type MbStatusGroup,
} from "../data/mbStatusGroups";

export interface AlbumStatusCountsResult {
  /** true grand total (matches query_albums total_count with no status filter) */
  total: number;
  /** counts keyed by raw mb_lookup_status enum value */
  byStatus: Record<string, number>;
  /** counts keyed by MbStatusGroup (sum of member enum values) */
  byGroup: Record<MbStatusGroup, number>;
}

const EMPTY: AlbumStatusCountsResult = {
  total: 0,
  byStatus: {},
  byGroup: {
    untouched: 0,
    in_flight: 0,
    needs_attention: 0,
    done: 0,
    deferred: 0,
    error: 0,
  },
};

export interface AlbumStatusCountsOptions {
  remote: Accessor<Remote | undefined>;
  search?: Accessor<string | undefined>;
}

export function useAlbumStatusCounts(opts: AlbumStatusCountsOptions) {
  return createQuery(() => ({
    queryKey: [
      "album-status-counts",
      opts.remote()?.remote_id ?? null,
      opts.search?.() ?? null,
    ],
    enabled: !!opts.remote(),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AlbumStatusCountsResult> => {
      const remote = opts.remote();
      if (!remote) return EMPTY;

      const client = await getClientForRemote(remote);
      const result = await client.music.queryAlbumStatusCounts({
        q: opts.search?.() ?? null,
        search_fields: null,
        filters: {},
        sort_by: null,
        sort_direction: null,
        limit: null,
        offset: null,
        user_id: null,
        favorites_only: null,
        min_rating: null,
        mb_lookup_status: null,
      });

      if (!result.success || !result.data) {
        return EMPTY;
      }

      const byStatus = result.data.by_status as Record<string, number>;
      const total = result.data.total;

      // fold enum-level counts into group counts
      const byGroup = {} as Record<MbStatusGroup, number>;
      for (const [group, members] of Object.entries(MB_STATUS_GROUP_MEMBERS) as [
        MbStatusGroup,
        readonly string[],
      ][]) {
        byGroup[group] = members.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
      }

      return { total, byStatus, byGroup };
    },
  }));
}
