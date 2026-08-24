// local taxonomy api shim
//
// presents a tiny subset of the real freqhole-api-client surface
// (`client.music.{listTaxonKinds, getAlbumTaxonLinks, queryTaxons,
//  createTaxon, createTaxonKind, addAlbumTaxon, removeAlbumTaxon,
//  deleteTaxon, listTaxonsByKind, listTaxonParentsForKind}`) backed by
// the local indexeddb `taxons` + `album_taxons` stores. lets the album
// editor + autocomplete components reuse the same call shape whether
// the active source is a peer remote or the local library.
//
// `createTaxonKind` is a no-op stub today — kinds are not persisted
// in idb. `listTaxonKinds` synthesises a "well-known" list (music
// domain only) plus kind_slugs discovered in local storage, scoped by
// the caller's `domain` — see `resolveKindSlugsForDomain` below.

import {
  upsertTaxon,
  linkAlbumTaxon,
  unlinkAlbumTaxon,
  linkEntityTaxon,
  unlinkEntityTaxon,
  getEntityTaxons,
  getKindSlugsLinkedToEntityType,
  deleteTaxon as deleteLocalTaxon,
  queryTaxons as queryLocalTaxons,
  getAlbumTaxons,
  countAlbumsByKindForRemote,
  findTaxon,
} from "../storage/db/taxons";
import { LOCAL_TAXON_REMOTE_ID } from "../storage/types";

// result shape mirrors freqhole-api-client's `SafeParseResult<T>` so
// call sites can keep doing `if (resp.success) { use resp.data }`.
type ShimResult<T> = { success: true; data: T } | { success: false; error: Error };

const ok = <T>(data: T): ShimResult<T> => ({ success: true, data });
const fail = <T = never>(message: string): ShimResult<T> => ({
  success: false,
  error: new Error(message),
});

// ---- response shapes (subset of freqhole-api-client codegen) ----

interface ShimTaxonKind {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  color: string | null;
  value_type: string;
  unit: string | null;
  display_order: number;
  is_user_defined: boolean;
  created_at: number;
  album_count: number;
}

interface ShimTaxon {
  id: string;
  kind_id: string;
  kind_slug: string;
  slug: string;
  label: string;
  description: string | null;
  color: string | null;
  is_user_defined: boolean;
  created_at: number;
  created_by: string | null;
}

interface ShimTaxonWithStats {
  id: string;
  kind_id: string;
  kind_slug: string;
  slug: string;
  label: string;
  created_at: number;
  album_count: number;
  song_count: number;
  total_duration: number;
}

interface ShimAlbumTaxonLink {
  album_id: string;
  taxon_id: string;
  kind_slug: string;
  label: string;
  origin: string;
  confidence: number | null;
  created_at: number;
  created_by: string | null;
}

// generic entity-taxon link (mirrors ShimAlbumTaxonLink, but for any
// non-album entity type, e.g. video). `entity_id` reuses the shape of
// the real remote `EntityTaxonLink` codegen type.
interface ShimEntityTaxonLink {
  entity_type: string;
  entity_id: string;
  taxon_id: string;
  kind_slug: string;
  label: string;
  origin: string;
  confidence: number | null;
  created_at: number;
  created_by: string | null;
}

interface ShimTaxonsQueryResult {
  items: ShimTaxonWithStats[];
  total_count: number;
  has_more: boolean;
  offset: number;
  limit: number;
}

// well-known kinds always surfaced by `listTaxonKinds`, even when the
// local store is empty. order mirrors the typical server `display_order`.
const WELL_KNOWN_KINDS: { slug: string; label: string }[] = [
  { slug: "genre", label: "genre" },
  { slug: "mood", label: "mood" },
  { slug: "style", label: "style" },
  { slug: "era", label: "era" },
  { slug: "label", label: "label" },
  { slug: "tag", label: "tag" },
];

function synthesiseKind(
  slug: string,
  label: string,
  idx: number,
  albumCount: number
): ShimTaxonKind {
  return {
    id: `local-kind-${slug}`,
    slug,
    label,
    description: null,
    color: null,
    value_type: "categorical",
    unit: null,
    display_order: idx,
    is_user_defined: false,
    created_at: 0,
    album_count: albumCount,
  };
}

function unassignedHubKind(albumCount: number): ShimTaxonKind {
  return {
    id: "synth::unassigned",
    slug: "unassigned",
    label: "unassigned",
    description: "synthesised hub: albums with no taxon assignments",
    color: null,
    value_type: "categorical",
    unit: null,
    display_order: 9002,
    is_user_defined: false,
    created_at: 0,
    album_count: albumCount,
  };
}

// which kind_slugs should even be considered for a `listTaxonKinds`
// call. the local `taxons` store is flat/global (kind_slug values
// synced down from a remote for autocomplete, not scoped by domain),
// so unlike the server's `taxon_kindz.domain` column there's no
// per-kind domain to filter on directly:
//   - music (or unfiltered): every well-known default, plus anything
//     else discovered in the local taxons store (matches this shim's
//     original, pre-domain behavior).
//   - any other domain (e.g. "video"): well-known defaults are
//     music-only and must NOT appear. scope instead to kind_slugs
//     actually linked to an entity of that type via `entity_taxons`
//     (only true, reliable signal for "this kind applies here"
//     available locally).
async function resolveKindSlugsForDomain(domain: string | null): Promise<string[]> {
  if (domain === null || domain === "music") {
    const rows = await queryLocalTaxons({ remote_id: LOCAL_TAXON_REMOTE_ID });
    const discovered = new Set(rows.map((r) => r.kind_slug));
    const wellKnownSlugs = WELL_KNOWN_KINDS.map((k) => k.slug);
    for (const slug of wellKnownSlugs) discovered.delete(slug);
    return [...wellKnownSlugs, ...discovered];
  }
  return [...(await getKindSlugsLinkedToEntityType(domain))];
}

export const localTaxonomyClient = {
  music: {
    async listTaxonKinds(req?: { domain?: string | null }): Promise<ShimResult<ShimTaxonKind[]>> {
      const domain = req?.domain ?? null;
      const isMusicScope = domain === null || domain === "music";
      const wellKnownLabels = new Map(WELL_KNOWN_KINDS.map((k) => [k.slug, k.label]));

      const [kindSlugs, counts] = await Promise.all([
        resolveKindSlugsForDomain(domain),
        countAlbumsByKindForRemote(LOCAL_TAXON_REMOTE_ID),
      ]);

      const out = kindSlugs.map((slug, idx) =>
        synthesiseKind(slug, wellKnownLabels.get(slug) ?? slug, idx, counts.byKind.get(slug) ?? 0)
      );

      // "unassigned" hub (albums with no taxon links) is an album-only
      // concept, like the server-side synth hub it mirrors — only ever
      // shown for the music scope.
      if (isMusicScope && counts.unassigned > 0) {
        out.push(unassignedHubKind(counts.unassigned));
      }
      return ok(out);
    },

    async listTaxonsByKind(req: { kind_slug: string }): Promise<ShimResult<ShimTaxon[]>> {
      const rows = await queryLocalTaxons({
        remote_id: LOCAL_TAXON_REMOTE_ID,
        kind_slug: req.kind_slug,
      });
      const items: ShimTaxon[] = rows.map((r) => ({
        id: r.taxon_id,
        kind_id: `local-kind-${r.kind_slug}`,
        kind_slug: r.kind_slug,
        slug: r.slug,
        label: r.label,
        description: null,
        color: null,
        is_user_defined: true,
        created_at: r.created_at,
        created_by: null,
      }));
      return ok(items);
    },

    async listTaxonParentsForKind(_req: {
      kind_slug: string;
    }): Promise<ShimResult<{ child_id: string; parent_id: string }[]>> {
      // local taxons have no hierarchy today.
      return ok([]);
    },

    async queryTaxons(req: {
      kind_slug?: string | null;
      q?: string | null;
      limit?: number | null;
      offset?: number | null;
    }): Promise<ShimResult<ShimTaxonsQueryResult>> {
      const limit = req.limit ?? 100;
      const offset = req.offset ?? 0;
      const rows = await queryLocalTaxons({
        remote_id: LOCAL_TAXON_REMOTE_ID,
        kind_slug: req.kind_slug ?? undefined,
        partial: req.q ?? undefined,
        limit: limit + offset, // upper bound; we slice below
      });
      const total = rows.length;
      const page = rows.slice(offset, offset + limit);
      const items: ShimTaxonWithStats[] = page.map((r) => ({
        id: r.taxon_id,
        kind_id: `local-kind-${r.kind_slug}`,
        kind_slug: r.kind_slug,
        slug: r.slug,
        label: r.label,
        created_at: r.created_at,
        // counts are best-effort; the autocomplete only reads label.
        album_count: 0,
        song_count: 0,
        total_duration: 0,
      }));
      return ok({
        items,
        total_count: total,
        has_more: offset + page.length < total,
        offset,
        limit,
      });
    },

    async createTaxon(req: {
      kind_slug: string;
      label: string;
      description?: string | null;
      parent_ids?: string[] | null;
    }): Promise<ShimResult<ShimTaxon>> {
      const row = await upsertTaxon({
        remote_id: LOCAL_TAXON_REMOTE_ID,
        kind_slug: req.kind_slug,
        label: req.label,
      });
      return ok({
        id: row.taxon_id,
        kind_id: `local-kind-${row.kind_slug}`,
        kind_slug: row.kind_slug,
        slug: row.slug,
        label: row.label,
        description: null,
        color: null,
        is_user_defined: true,
        created_at: row.created_at,
        created_by: null,
      });
    },

    async createTaxonKind(_req: {
      slug: string;
      label: string;
    }): Promise<ShimResult<ShimTaxonKind>> {
      // kinds are not persisted in idb yet; createTaxon auto-discovers
      // a new kind_slug at write time, so explicit kind creation isn't
      // strictly necessary. surface failure so the ui's "create kind"
      // affordance can render an explanatory toast.
      return fail("creating taxon kinds is not yet supported on the local library");
    },

    async deleteTaxon(req: { id: string }): Promise<ShimResult<{ success: true }>> {
      await deleteLocalTaxon(req.id);
      return ok({ success: true as const });
    },

    async addAlbumTaxon(req: {
      album_id: string;
      taxon_id: string;
      origin: string;
      confidence?: number | null;
    }): Promise<ShimResult<{ success: true }>> {
      await linkAlbumTaxon(req.album_id, req.taxon_id);
      return ok({ success: true as const });
    },

    async removeAlbumTaxon(req: {
      album_id: string;
      taxon_id: string;
      origin?: string | null;
    }): Promise<ShimResult<{ success: true }>> {
      await unlinkAlbumTaxon(req.album_id, req.taxon_id);
      return ok({ success: true as const });
    },

    async getAlbumTaxonLinks(req: { album_id: string }): Promise<ShimResult<ShimAlbumTaxonLink[]>> {
      const taxons = await getAlbumTaxons(req.album_id);
      const links: ShimAlbumTaxonLink[] = taxons.map((t) => ({
        album_id: req.album_id,
        taxon_id: t.taxon_id,
        kind_slug: t.kind_slug,
        label: t.label,
        origin: "user",
        confidence: null,
        created_at: t.created_at,
        created_by: null,
      }));
      return ok(links);
    },

    // ---- generic entity taxon links (non-album entities, e.g. video) ----

    async addEntityTaxon(req: {
      entity_type: string;
      entity_id: string;
      taxon_id: string;
      origin: string;
      confidence?: number | null;
    }): Promise<ShimResult<{ success: true }>> {
      await linkEntityTaxon(req.entity_type, req.entity_id, req.taxon_id);
      return ok({ success: true as const });
    },

    async removeEntityTaxon(req: {
      entity_type: string;
      entity_id: string;
      taxon_id: string;
      origin?: string | null;
    }): Promise<ShimResult<{ success: true }>> {
      await unlinkEntityTaxon(req.entity_type, req.entity_id, req.taxon_id);
      return ok({ success: true as const });
    },

    async getEntityTaxonLinks(req: {
      entity_type: string;
      entity_id: string;
    }): Promise<ShimResult<ShimEntityTaxonLink[]>> {
      const taxons = await getEntityTaxons(req.entity_type, req.entity_id);
      const links: ShimEntityTaxonLink[] = taxons.map((t) => ({
        entity_type: req.entity_type,
        entity_id: req.entity_id,
        taxon_id: t.taxon_id,
        kind_slug: t.kind_slug,
        label: t.label,
        origin: "user",
        confidence: null,
        created_at: t.created_at,
        created_by: null,
      }));
      return ok(links);
    },
  },
};

// re-export findTaxon for ui dedup checks; not part of the api surface
// but lives next door so a single import covers all local-taxonomy work.
export { findTaxon };

export type LocalTaxonomyClient = typeof localTaxonomyClient;
