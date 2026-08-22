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

// criteria filters cascade to whole matched albums/artists/playlists (see
// grimoire's radio/stations/repository.rs) — favorite has no value at
// all, rating is clamped 1-5, the rest are plain non-negative integers.
export function isReferenceFilterType(t: FilterType): t is ReferenceFilterType {
  return (REFERENCE_FILTER_TYPES as readonly string[]).includes(t);
}

export function isRatingFilterType(t: FilterType): boolean {
  return t === "rating_gte" || t === "rating_lte";
}

// clause types where "my <thing>" vs "everyone's <thing>" is a real
// per-clause choice (see grimoire migration 055's `criteria_scope`
// column) - reference/count/duration/added-days types have no such
// concept.
export function isScopableFilterType(t: FilterType): boolean {
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
  switch (f.filter_type as FilterType) {
    case "favorite":
      return `favorited (${scopeLabel(f, fallbackScope)})`;
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
