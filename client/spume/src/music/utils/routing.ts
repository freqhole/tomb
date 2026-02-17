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

  // settings & admin
  settings: () => buildRoute("/settings"),
  remotes: () => buildRoute("/remotes"),
};
