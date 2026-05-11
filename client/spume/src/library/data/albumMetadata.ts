// centralized client-side accessors for the album metadata blob.
//
// **all** library code that touches `Album.metadata` or `mb_lookup_status`
// must go through this module. never inline `JSON.parse(album.metadata)` or
// hand-roll status string comparisons elsewhere — extend this module instead.
// the on-the-wire shape is owned by `grimoire/src/music/entities/albums/metadata.rs`
// and re-exposed here as zod-typed accessors so everything stays in sync.

import {
  schema,
  type AlbumMetadata,
  type MbCandidate,
  type MbLookupStatus,
} from "freqhole-api-client";

export type { AlbumMetadata, MbCandidate, MbLookupStatus } from "freqhole-api-client";

/** every known mb_lookup_status value, in display order. */
export const MB_LOOKUP_STATUSES: readonly MbLookupStatus[] = [
  "NotAttempted",
  "Queued",
  "Searching",
  "Candidates",
  "NeedsReview",
  "FetchingDetail",
  "Confirmed",
  "Enriched",
  "Rejected",
  "NoMatch",
  "Error",
] as const;

/** human-readable label for a status. */
export function mbLookupStatusLabel(status: MbLookupStatus | null | undefined): string {
  switch (status) {
    case "NotAttempted":
    case null:
    case undefined:
      return "not attempted";
    case "Queued":
      return "queued";
    case "Searching":
      return "searching";
    case "Candidates":
      return "candidates";
    case "NeedsReview":
      return "needs review";
    case "FetchingDetail":
      return "fetching detail";
    case "Confirmed":
      return "confirmed";
    case "Enriched":
      return "enriched";
    case "Rejected":
      return "rejected";
    case "NoMatch":
      return "no match";
    case "Error":
      return "error";
    default:
      return String(status);
  }
}

/** parse the raw status string. unknown values fall back to "NotAttempted". */
export function parseMbLookupStatus(
  raw: string | null | undefined,
): MbLookupStatus {
  if (!raw) return "NotAttempted";
  if ((MB_LOOKUP_STATUSES as readonly string[]).includes(raw)) {
    return raw as MbLookupStatus;
  }
  return "NotAttempted";
}

const EMPTY: AlbumMetadata = {
  version: 1,
  musicbrainz: null,
  folksonomy: null,
  log: [],
};

/** parse the raw json metadata string into a typed AlbumMetadata.
 *  returns the empty default for null/empty/malformed input (logged in dev).
 */
export function parseAlbumMetadata(raw: string | null | undefined): AlbumMetadata {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    const result = schema.AlbumMetadataSchema.safeParse(parsed);
    if (result.success) return result.data;
    if (typeof console !== "undefined") {
      console.warn("[album-metadata] failed zod parse, returning empty", result.error);
    }
    return EMPTY;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[album-metadata] failed JSON.parse, returning empty", err);
    }
    return EMPTY;
  }
}

/** convenience: the confirmed mb release id, if any. */
export function confirmedMbReleaseId(meta: AlbumMetadata): string | null {
  return meta.musicbrainz?.release_id ?? null;
}

/** convenience: candidate count. */
export function mbCandidateCount(meta: AlbumMetadata): number {
  return meta.musicbrainz?.candidates?.length ?? 0;
}

/** convenience: top folksonomy tags merged across release + release-group. */
export function topFolksonomyTags(
  meta: AlbumMetadata,
  limit = 5,
): { name: string; count: number }[] {
  const fk = meta.folksonomy?.musicbrainz;
  if (!fk) return [];
  const merged = new Map<string, number>();
  const sources = [
    fk.release_tags ?? [],
    fk.release_group_tags ?? [],
    fk.release_genres ?? [],
    fk.release_group_genres ?? [],
  ];
  for (const list of sources) {
    for (const t of list) {
      if (!t?.name) continue;
      merged.set(t.name, (merged.get(t.name) ?? 0) + (t.count ?? 0));
    }
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/** convenience: highest-confidence candidate (by local_confidence). */
export function topCandidate(meta: AlbumMetadata): MbCandidate | null {
  const list = meta.musicbrainz?.candidates ?? [];
  if (list.length === 0) return null;
  return [...list].sort(
    (a, b) => (b.local_confidence ?? 0) - (a.local_confidence ?? 0),
  )[0];
}
