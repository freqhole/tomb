// shared filter-clause type constants, extracted out of
// `RadioAdminView.tsx` - the same `filter_type`/`mode` vocabulary is used
// by both radio station seed filters and removable-storage sync
// filter-sets (see grimoire's `radio::stations::repository::parse_filter_clause`,
// reused by `grimoire::external_storage::add_filter_set_filter`).

export const REFERENCE_FILTER_TYPES = [
  "tag",
  "taxon",
  "artist",
  "album",
  "track",
  "playlist",
] as const;
export const CRITERIA_FILTER_TYPES = [
  "favorite",
  "rating_gte",
  "rating_lte",
  "play_count_gte",
  "play_count_lte",
  "duration_gte",
  "duration_lte",
  "added_days_gte",
  "added_days_lte",
] as const;
export const FILTER_TYPES = [...REFERENCE_FILTER_TYPES, ...CRITERIA_FILTER_TYPES] as const;
export type FilterType = (typeof FILTER_TYPES)[number];
export type ReferenceFilterType = (typeof REFERENCE_FILTER_TYPES)[number];
export const FILTER_MODES = ["include", "exclude"];

// radio-station-only video filter types (migrations 081/082) - kept out
// of the constants above since `FilterSetManager.tsx` (removable-storage
// sync filter-sets) also consumes those, and its resolver
// (external_storage/repository.rs) only ever calls the song-side
// `song_ids_for_clause` - a "video"/"video_series"/"all_videos" filter
// there would silently resolve to zero songs, not the video content a
// user would expect. `video`/`video_series` need a suggest lookup like
// the other reference types; `all_videos` is a no-value marker (mirrors
// `favorite`'s shape) - shuffle across every playable video.
export const VIDEO_REFERENCE_FILTER_TYPES = ["video", "video_series"] as const;
export const VIDEO_ONLY_FILTER_TYPES = ["all_videos"] as const;
export const RADIO_FILTER_TYPES = [
  ...FILTER_TYPES,
  ...VIDEO_REFERENCE_FILTER_TYPES,
  ...VIDEO_ONLY_FILTER_TYPES,
] as const;
export type RadioFilterType = (typeof RADIO_FILTER_TYPES)[number];
export type RadioReferenceFilterType =
  ReferenceFilterType | (typeof VIDEO_REFERENCE_FILTER_TYPES)[number];

// criteria filters cascade to whole matched albums/artists/playlists (see
// grimoire's radio/stations/repository.rs) — favorite has no value at
// all, rating is clamped 1-5, the rest are plain non-negative integers.
export function isReferenceFilterType(t: FilterType): t is ReferenceFilterType {
  return (REFERENCE_FILTER_TYPES as readonly string[]).includes(t);
}

// radio-only counterpart of `isReferenceFilterType` - also matches
// `video`/`video_series`, which need the same suggest-input treatment as
// tag/taxon/artist/album/playlist.
export function isRadioReferenceFilterType(t: RadioFilterType): t is RadioReferenceFilterType {
  return (
    (REFERENCE_FILTER_TYPES as readonly string[]).includes(t) ||
    (VIDEO_REFERENCE_FILTER_TYPES as readonly string[]).includes(t)
  );
}

// filter types that take no value at all (mode + type is the whole
// clause) - `favorite` (any of the caller's favorited songs/albums/etc.)
// and `all_videos` (every playable video in the library).
export function isNoValueFilterType(t: RadioFilterType): boolean {
  return t === "favorite" || t === "all_videos";
}

export function isRatingFilterType(t: RadioFilterType): boolean {
  return t === "rating_gte" || t === "rating_lte";
}

// clause types where "my <thing>" vs "everyone's <thing>" is a real
// per-clause choice (see grimoire migration 055's `criteria_scope`
// column) - reference/count/duration/added-days types have no such
// concept.
export function isScopableFilterType(t: RadioFilterType): boolean {
  return t === "favorite" || isRatingFilterType(t);
}

interface DisplayableFilter {
  filter_type: string;
  filter_value: string;
  filter_label: string;
  criteria_scope?: string | null;
}

// friendly label for criteria-type filters, which have no filter_label
// from the backend (only reference types get a joined name). radio
// stations resolve "favorite"/rating clauses against any user's data
// (no `criteria_scope` column there, so `f.criteria_scope` is always
// absent); external-storage sync clauses carry their own per-clause
// `criteria_scope` ("me"/"everyone") which takes priority when present,
// falling back to `fallbackScope` otherwise.
function scopeLabel(f: DisplayableFilter, fallbackScope: "any user" | "you"): string {
  if (f.criteria_scope === "everyone") return "any user";
  if (f.criteria_scope === "me") return "you";
  return fallbackScope;
}

export function filterDisplayValue(
  f: DisplayableFilter,
  fallbackScope: "any user" | "you" = "any user"
): string {
  switch (f.filter_type as RadioFilterType) {
    case "favorite":
      return `favorited (${scopeLabel(f, fallbackScope)})`;
    case "all_videos":
      return "every video in the library";
    case "rating_gte":
      return `rating >= ${f.filter_value} (${scopeLabel(f, fallbackScope)})`;
    case "rating_lte":
      return `rating <= ${f.filter_value} (${scopeLabel(f, fallbackScope)})`;
    case "play_count_gte":
      return `play count >= ${f.filter_value}`;
    case "play_count_lte":
      return `play count <= ${f.filter_value}`;
    case "duration_gte":
      return `duration >= ${f.filter_value}s`;
    case "duration_lte":
      return `duration <= ${f.filter_value}s`;
    case "added_days_gte":
      return `added at least ${f.filter_value}d ago`;
    case "added_days_lte":
      return `added at most ${f.filter_value}d ago`;
    default:
      return f.filter_label && f.filter_label.length > 0 ? f.filter_label : f.filter_value;
  }
}
