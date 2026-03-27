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
  genres: () => buildRoute("/genres"),
  search: (query?: string) => {
    const base = buildRoute("/search");
    return query ? `${base}?q=${encodeURIComponent(query)}` : base;
  },

  // detail views
  album: (albumId: string) => buildRoute(`/albums/${albumId}`),
  artist: (artistId: string) => buildRoute(`/artists/${artistId}`),
  playlist: (playlistId: string) => buildRoute(`/playlists/${playlistId}`),
  genre: (genreId: string) => buildRoute(`/genres/${genreId}`),

  // settings & admin (top-level, not context-aware)
  settings: () => "/settings",
  settingsStorage: () => "/settings/storage",
  remotes: () => buildRoute("/remotes"),
  favorites: () => buildRoute("/favorites"),

  // gossip (top-level, not context-aware)
  gossip: () => "/gossip",
};

/**
 * get the default route for a given remote or local source.
 * 
 * @param remoteId - remote ID, "local", or undefined for current context
 *   - undefined: uses current context (getCurrentRemote)
 *   - "local": returns local default (/local/feed for Tauri, /local/songs for browser)
 *   - string: returns remote default (/{remoteId}/feed)
 */
export function getDefaultRoute(remoteId?: string): string {
  // explicit "local"
  if (remoteId === "local") {
    return isCharnelMode() ? "/local/feed" : "/local/songs";
  }
  
  // explicit remote ID
  if (remoteId) {
    return `/${remoteId}/feed`;
  }
  
  // use current context
  return hasFeedView() ? routes.feed() : routes.songs();
}

/** parameterless view route keys */
const VIEW_KEYS = ["feed", "songs", "albums", "artists", "playlists", "genres", "favorites", "search", "remotes", "settings", "gossip"] as const;

export type RouteKey = (typeof VIEW_KEYS)[number];

/**
 * match a path to a known route key
 * returns the route key (e.g., "songs", "albums", "feed") or null if no match.
 * strips query params before matching.
 * handles both exact matches and detail views (e.g., /albums/123 -> "albums")
 */
export function matchRoute(path: string): RouteKey | null {
  const pathname = path.split("?")[0].replace(/\/+$/, "");
  
  // check top-level routes first
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/gossip")) return "gossip";
  
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
