// routing utilities for context-aware navigation

import { getCurrentRemote } from "../data";
import { isCharnelMode } from "../../app/services/charnel";

/**
 * check if the current context supports feed view.
 * - browser "local" source does NOT have feed (no server backend)
 * - tauri "local" (is_charnel_managed) DOES have feed
 * - all remotes have feed
 */
export function hasFeedView(): boolean {
  const remote = getCurrentRemote();
  if (remote) {
    // all remotes have feed view
    return true;
  }
  // local source: only Tauri has feed (it has a local server backend)
  return isCharnelMode();
}

/**
 * get the current route prefix based on active data source
 * returns "/local" for local source or "/{remoteId}" for remote source
 */
export function getRoutePrefix(): string {
  const remote = getCurrentRemote();
  return remote ? `/${remote.remote_id}` : "/local";
}

/**
 * build a context-aware route path
 * automatically prepends the correct prefix based on active data source
 */
export function buildRoute(path: string): string {
  const prefix = getRoutePrefix();
  // ensure path starts with /
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${cleanPath}`;
}

/**
 * build a route for an *explicit* remote (or local) source, regardless
 * of the globally-active data source. use this from views that browse
 * one source while another is "current" (e.g. library multi-remote
 * table / graph), so click-throughs land on the correct remote-scoped
 * URL instead of the implicit one.
 *
 * pass `"local"`, `null`, or `undefined` for the local source.
 */
export function buildRouteFor(
  remoteId: string | null | undefined,
  path: string,
): string {
  const prefix = remoteId && remoteId !== "local" ? `/${remoteId}` : "/local";
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${prefix}${cleanPath}`;
}

/**
 * route helpers for music entities
 * all routes are context-aware and include the correct remote/local prefix
 */
export const routes = {
  // main views
  feed: () => buildRoute("/feed"),
  songs: () => buildRoute("/songs"),
  albums: () => buildRoute("/albums"),
  artists: () => buildRoute("/artists"),
  playlists: () => buildRoute("/playlists"),
  search: (query?: string) => {
    const base = buildRoute("/search");
    return query ? `${base}?q=${encodeURIComponent(query)}` : base;
  },

  // detail views
  album: (albumId: string) => buildRoute(`/albums/${albumId}`),
  artist: (artistId: string) => buildRoute(`/artists/${artistId}`),
  playlist: (playlistId: string) => buildRoute(`/playlists/${playlistId}`),

  // explicit-remote variants — for views that browse a different
  // source than the globally-active one (library multi-remote, graph
  // popover, federated search results, etc.). pass `"local"` / `null`
  // / `undefined` to target the local source.
  albumOn: (remoteId: string | null | undefined, albumId: string) =>
    buildRouteFor(remoteId, `/albums/${albumId}`),
  artistOn: (remoteId: string | null | undefined, artistId: string) =>
    buildRouteFor(remoteId, `/artists/${artistId}`),
  playlistOn: (remoteId: string | null | undefined, playlistId: string) =>
    buildRouteFor(remoteId, `/playlists/${playlistId}`),

  // settings & admin (top-level, not context-aware)
  settings: () => "/settings",
  settingsStorage: () => "/settings/storage",
  shared: () => "/shared",
  explore: () => "/explore",
  library: () => "/explore", // backcompat alias - points to explore
  remotes: () => buildRoute("/remotes"),
  favorites: () => buildRoute("/favorites"),
};

/**
 * get the default route for a given remote or local source.
 *
 * picks the *path* (feed vs songs vs albums) per source kind, then
 * defers prefix construction to `buildRouteFor` so prefix logic lives
 * in exactly one place.
 *
 * @param remoteId - remote ID, "local", or undefined for current context
 *   - undefined: uses current context (getCurrentRemote)
 *   - "local": returns local default (/local/feed for Tauri, /local/songs for browser)
 *   - string: returns remote default (/{remoteId}/albums)
 */
export function getDefaultRoute(remoteId?: string): string {
  // explicit "local" — feed if a local server backend exists (Tauri),
  // else just songs (browser local IDB).
  if (remoteId === "local") {
    return buildRouteFor("local", isCharnelMode() ? "/feed" : "/songs");
  }

  // explicit remote ID — land on albums by convention.
  if (remoteId) {
    return buildRouteFor(remoteId, "/albums");
  }

  // implicit / current context — use the active-source-aware helpers.
  return hasFeedView() ? routes.feed() : routes.songs();
}

/** parameterless view route keys */
const VIEW_KEYS = ["feed", "songs", "albums", "artists", "playlists", "favorites", "search", "remotes", "settings", "shared", "explore"] as const;

export type RouteKey = (typeof VIEW_KEYS)[number];

/**
 * match a path to a known route key
 * returns the route key (e.g., "songs", "albums", "feed") or null if no match.
 * strips query params before matching.
 * handles both exact matches and detail views (e.g., /albums/123 -> "albums")
 */
export function matchRoute(path: string): RouteKey | null {
  const pathname = path.split("?")[0].replace(/\/+$/, "");
  
  // check settings first (top-level route)
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/shared")) return "shared";
  if (pathname.startsWith("/explore") || pathname.startsWith("/library")) return "explore";
  
  // check each view key - exact match or detail view (starts with route + /)
  for (const key of VIEW_KEYS) {
    if (key === "settings") continue; // already handled above
    const routePath = routes[key]().replace(/\/+$/, "");
    // exact match or detail view (path starts with route/)
    if (pathname === routePath || pathname.startsWith(routePath + "/")) {
      return key;
    }
  }
  
  return null;
}
