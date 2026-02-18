// routing utilities for context-aware navigation

import { getCurrentRemote } from "../data";

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
};

/** parameterless view route keys */
const VIEW_KEYS = ["feed", "songs", "albums", "artists", "playlists", "genres", "search", "remotes"] as const;

export type RouteKey = (typeof VIEW_KEYS)[number] | "settings";

/**
 * match a path to a known route key
 * returns the route key (e.g., "songs", "albums", "feed") or null if no match.
 * strips query params before matching. uses exact equality against routes.
 */
export function matchRoute(path: string): RouteKey | null {
  const pathname = path.split("?")[0].replace(/\/+$/, "");
  for (const key of VIEW_KEYS) {
    if (pathname === routes[key]().replace(/\/+$/, "")) return key;
  }
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}
