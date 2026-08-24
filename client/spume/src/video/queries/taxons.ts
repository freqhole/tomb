// read-only taxon fetch for a video entity — reuses the generic
// entities.getEntityTaxons route (entity_taxonz table, entity_type
// agnostic) plus a per-id music.getTaxon resolve step, since
// getEntityTaxons only returns raw links (taxon_id, no label/kind_slug).
// mirrors useVideoFavoriteStatuses.ts's remote-client-or-empty pattern:
// local (no-remote) mode has no taxon data for video yet, so it
// resolves to an empty list rather than reaching into a local store.
import { createQuery } from "@tanstack/solid-query";
import { getRemoteClient } from "../../music/data";
import type { TaxonRef } from "../../music/services/storage/types";
import { videoQueryKeys } from "./queryKeys";

export function useVideoTaxonsQuery(videoId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.videos.taxons(videoId() || ""),
    queryFn: async (): Promise<TaxonRef[]> => {
      const id = videoId();
      if (!id) return [];

      const client = await getRemoteClient();
      if (!client) return [];

      const linksResult = await client.entities.getEntityTaxons({
        entity_type: "video",
        entity_id: id,
      });
      if (!linksResult.success) return [];

      const taxonIds = [...new Set(linksResult.data.map((link) => link.taxon_id))];
      if (taxonIds.length === 0) return [];

      const taxons = await Promise.all(
        taxonIds.map((taxonId) => client.music.getTaxon({ id: taxonId }))
      );

      return taxons
        .filter((result) => result.success)
        .map((result) => {
          const taxon = result.data;
          return { id: taxon.id, kind_slug: taxon.kind_slug, label: taxon.label };
        });
    },
    enabled: !!videoId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}
