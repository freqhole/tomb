// useRelatedArtistsByIds
//
// issues a single `POST /api/related-artists/list-batch` call for all
// unique artist ids and aggregates the results into a Map<artistId,
// Set<related artistId>>. only in-library matches (where the api
// returned `related_artist_id` truthy) are kept — the graph can't
// draw a wire to an artist that isn't a node.
//
// results are cached for 5 minutes (enrichment-driven data that
// rarely changes); the query refetches when the artist-id set
// changes.

import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";

export type RelatedArtistsMap = Map<string, Set<string>>;

const EMPTY: RelatedArtistsMap = new Map();

export interface UseRelatedArtistsByIdsOptions {
  remote: Accessor<Remote | undefined>;
  /** unique artist ids to fetch related-artist rows for. order doesn't
   *  matter; the query key is computed from a sorted snapshot so two
   *  callers with the same set hit the same cache entry. */
  artistIds: Accessor<string[]>;
  /** disable polling / fetching entirely (e.g. when the content-kind
   *  selector is set to `albums` so artist nodes aren't visible). */
  enabled?: Accessor<boolean>;
}

export function useRelatedArtistsByIds(opts: UseRelatedArtistsByIdsOptions) {
  return createQuery(() => {
    const remote = opts.remote();
    // sort so identical sets — regardless of insertion order — produce
    // the same cache key.
    const ids = [...opts.artistIds()].sort();
    const enabled = (opts.enabled?.() ?? true) && !!remote && ids.length > 0;
    return {
      queryKey: ["related-artists-by-ids", remote?.remote_id ?? null, ids],
      enabled,
      // related-artist data is harvested by background enrichment jobs
      // and rarely changes between sessions. long stale window keeps
      // the graph from re-fetching when the user toggles content-kind
      // back and forth.
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      queryFn: async (): Promise<RelatedArtistsMap> => {
        if (!remote || ids.length === 0) return EMPTY;
        const client = await getClientForRemote(remote);
        const resp = await client.music.listRelatedArtistsBatch({
          artist_ids: ids,
        });
        if (!resp.success || !resp.data) return EMPTY;
        const out: RelatedArtistsMap = new Map();
        for (const entry of resp.data.entries ?? []) {
          const inLibIds = new Set<string>();
          for (const item of entry.items ?? []) {
            // only in-library matches are useful for the graph — external
            // related artists have no node to wire to.
            const target = (item as { related_artist_id?: string | null })
              .related_artist_id;
            if (target) inLibIds.add(target);
          }
          if (inLibIds.size > 0) out.set(entry.artist_id, inLibIds);
        }
        return out;
      },
    };
  });
}
