// adaptAlbum
//
// converts an `AlbumSummary` (the wire shape returned by the library
// query) into an `AlbumNodeData` (the graph-local shape consumed by
// AlbumGraphCanvas, AlbumDetailPopover, and relations.ts).
//
// taxons-first: prefer `taxons[].filter(kind_slug === "genre" | "mood"
// | "style" | "era" | "label")` and fall back to the legacy top-level
// `genres[]` / `label` fields. era falls back to a 5-year year bucket
// when no `era` taxon exists.

import type { AlbumSummary, TaxonRef } from "../../../music/data/types";
import type { AlbumNodeData } from "../../../components/graph/types";

/** node id namespacing — keeps cross-remote albums distinct when
 *  multiple remotes contribute to a single graph. */
export function albumNodeId(remoteId: string, albumId: string): string {
  return `${remoteId}::${albumId}`;
}

/** 5-year bucket era fallback. 1993 → "1990-1994", 2001 → "2000-2004". */
export function yearBucketEra(year: number | null | undefined): string | null {
  if (year == null || !Number.isFinite(year)) return null;
  const start = Math.floor(year / 5) * 5;
  return `${start}-${start + 4}`;
}

function taxonsOfKind(taxons: TaxonRef[] | undefined, kindSlug: string): string[] {
  if (!taxons) return [];
  const out: string[] = [];
  for (const t of taxons) if (t.kind_slug === kindSlug) out.push(t.label);
  return out;
}

function firstTaxonOfKind(
  taxons: TaxonRef[] | undefined,
  kindSlug: string,
): string | null {
  if (!taxons) return null;
  for (const t of taxons) if (t.kind_slug === kindSlug) return t.label;
  return null;
}

export interface AdaptAlbumOpts {
  remoteId: string;
}

export function adaptAlbum(summary: AlbumSummary, opts: AdaptAlbumOpts): AlbumNodeData {
  // prefer the explicit `is_primary` image; fall back to the first;
  // then to a server thumbnail blob route by `remote_blob_id`.
  const primaryImage =
    summary.images?.find((i) => i.is_primary) ?? summary.images?.[0] ?? null;
  const imageUrl =
    primaryImage?.remote_url ??
    (primaryImage?.remote_blob_id
      ? `/api/v1/blobs/${primaryImage.remote_blob_id}`
      : null);

  // taxons-first; legacy genres[] is the fallback.
  const genreTaxons = taxonsOfKind(summary.taxons, "genre");
  const genres =
    genreTaxons.length > 0 ? genreTaxons : (summary.genres ?? []).map((g) => g.name);

  const moods = taxonsOfKind(summary.taxons, "mood");
  const styles = taxonsOfKind(summary.taxons, "style");
  const labelFromTaxon = firstTaxonOfKind(summary.taxons, "label");
  const eraFromTaxon = firstTaxonOfKind(summary.taxons, "era");

  return {
    id: albumNodeId(opts.remoteId, summary.album_id),
    title: summary.title,
    artistId: summary.artist_id,
    artistName: summary.artist_name ?? "",
    year: summary.year ?? null,
    imageUrl,
    image: primaryImage,
    genres,
    tags: (summary.tags ?? []).map((label) => ({ label, weight: 1 })),
    moods,
    styles,
    label: labelFromTaxon ?? summary.label ?? null,
    era: eraFromTaxon ?? yearBucketEra(summary.year),
    relatedArtistIds: [],
    trackCount: summary.song_count ?? 0,
    totalDurationSec: summary.total_duration ?? 0,
    rating: summary.user_rating ?? null,
    isFavorite: summary.is_favorite ?? false,
    sourceRemoteId: opts.remoteId,
  };
}

