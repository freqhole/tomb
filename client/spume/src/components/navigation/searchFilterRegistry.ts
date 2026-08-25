// registry for top-nav search's "press return to filter this view" behavior.
//
// previously `TopNavSearch.tsx` hardcoded a `FILTERABLE_KEYS`/`FILTER_ONLY_KEYS`
// Set of route keys that grew by one entry per domain. new domains
// (photos/ebooks/etc) register themselves here instead of editing
// `TopNavSearch.tsx`'s internals every time.
import type { RouteKey } from "../../music/utils/routing";

export interface SearchFilterRegistration {
  /** route key returned by `matchRoute()` this registration applies to */
  routeKey: RouteKey;
  /** plural noun shown in the "press return to filter X" hint */
  label: string;
  /**
   * true = filters inline, debounced as-you-type, no press-enter and no
   * autocomplete dropdown (mirrors the pre-existing "library" behavior).
   * false/undefined = press-enter-to-filter, with autocomplete
   * suggestions shown while typing (songs/albums/artists/playlists/
   * video/series today).
   */
  filterOnly?: boolean;
}

const registry = new Map<RouteKey, SearchFilterRegistration>();

/** register a collection view as filterable by top-nav search. */
export function registerSearchFilter(registration: SearchFilterRegistration): void {
  registry.set(registration.routeKey, registration);
}

export function getSearchFilterRegistration(
  routeKey: RouteKey | null
): SearchFilterRegistration | undefined {
  return routeKey ? registry.get(routeKey) : undefined;
}

export function isFilterableRoute(routeKey: RouteKey | null): boolean {
  return getSearchFilterRegistration(routeKey) !== undefined;
}

export function isFilterOnlyRoute(routeKey: RouteKey | null): boolean {
  return getSearchFilterRegistration(routeKey)?.filterOnly === true;
}

// --- built-in registrations ---
//
// note: the old `FILTERABLE_KEYS` set also contained "genres" and
// "videos" (plural). "genres" was confirmed dead code (no genres-list
// view exists, and "genres" was never a `matchRoute()` return value -
// only "songs"/"albums"/etc are real `RouteKey`s). "videos" (plural)
// was ALSO dead: `matchRoute()` only ever returns "video" (singular,
// see `music/utils/routing.ts`'s `VIEW_KEYS`), so the old entry never
// actually matched anything. both are corrected/dropped here rather
// than carried forward.
registerSearchFilter({ routeKey: "songs", label: "songs" });
registerSearchFilter({ routeKey: "albums", label: "albums" });
registerSearchFilter({ routeKey: "artists", label: "artists" });
registerSearchFilter({ routeKey: "playlists", label: "playlists" });
registerSearchFilter({ routeKey: "video", label: "videos" });
registerSearchFilter({ routeKey: "series", label: "series" });
