// read-only taxon fetch for a video entity — reuses the generic
// entities.getEntityTaxons route (entity_taxonz table, entity_type
// agnostic) plus a per-id music.getTaxon resolve step, since
// getEntityTaxons only returns raw links (taxon_id, no label/kind_slug).
// local (no-remote) mode reads the local `entity_taxons` indexeddb store
// via localTaxonomyClient instead, whose links already come resolved.
import { createQuery } from "@tanstack/solid-query";
import { getRemoteClient } from "../../music/data";
import { localTaxonomyClient } from "../../music/services/local-api/localTaxonomyClient";
import type { TaxonRef } from "../../music/services/storage/types";
import { videoQueryKeys } from "./queryKeys";

type RemoteClient = NonNullable<Awaited<ReturnType<typeof getRemoteClient>>>;

async function fetchLocalTaxonsForEntity(
  entityType: "video" | "video_series",
  entityId: string
): Promise<TaxonRef[]> {
  const resp = await localTaxonomyClient.music.getEntityTaxonLinks({
    entity_type: entityType,
    entity_id: entityId,
  });
  if (!resp.success) return [];
  const byId = new Map<string, TaxonRef>();
  for (const link of resp.data) {
    byId.set(link.taxon_id, { id: link.taxon_id, kind_slug: link.kind_slug, label: link.label });
  }
  return Array.from(byId.values());
}

async function fetchTaxonsForEntity(
  client: RemoteClient | null,
  entityType: "video" | "video_series",
  entityId: string
): Promise<TaxonRef[]> {
  if (!client) return fetchLocalTaxonsForEntity(entityType, entityId);
  const linksResult = await client.entities.getEntityTaxons({
    entity_type: entityType,
    entity_id: entityId,
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
}

export function useVideoTaxonsQuery(videoId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.videos.taxons(videoId() || ""),
    queryFn: async (): Promise<TaxonRef[]> => {
      const id = videoId();
      if (!id) return [];

      const client = await getRemoteClient();
      return fetchTaxonsForEntity(client, "video", id);
    },
    enabled: !!videoId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

/** taxons attached directly to a video series entity (not its videos'
 * taxons — see useVideoSeriesAggregateTaxonsQuery for the combined
 * view). */
export function useVideoSeriesTaxonsQuery(seriesId: () => string | undefined) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.series.taxons(seriesId() || ""),
    queryFn: async (): Promise<TaxonRef[]> => {
      const id = seriesId();
      if (!id) return [];

      const client = await getRemoteClient();
      return fetchTaxonsForEntity(client, "video_series", id);
    },
    enabled: !!seriesId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

/** unique taxons collected across a series' own taxons plus every taxon
 * on any video belonging to it — used by VideoSeriesDetailPanel's
 * header alongside useVideoSeriesAggregateTagsQuery. */
export function useVideoSeriesAggregateTaxonsQuery(
  seriesId: () => string | undefined,
  videoIds: () => string[]
) {
  return createQuery(() => ({
    queryKey: [...videoQueryKeys.series.taxons(seriesId() || ""), "aggregate", videoIds()],
    queryFn: async (): Promise<TaxonRef[]> => {
      const id = seriesId();
      if (!id) return [];

      const client = await getRemoteClient();
      const ids = videoIds();
      const results = await Promise.all([
        fetchTaxonsForEntity(client, "video_series", id),
        ...ids.map((videoId) => fetchTaxonsForEntity(client, "video", videoId)),
      ]);

      const merged = new Map<string, TaxonRef>();
      for (const taxon of results.flat()) merged.set(taxon.id, taxon);
      return Array.from(merged.values());
    },
    enabled: !!seriesId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}
