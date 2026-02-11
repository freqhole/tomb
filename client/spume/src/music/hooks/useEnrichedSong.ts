// helper functions to get latest song data from query cache
// these are NOT reactive hooks - they're synchronous lookups
// components should call these inside their own createMemo/createEffect

import type { QueryClient } from "@tanstack/solid-query";
import type { Song } from "../services/storage/types";
import { queryKeys } from "../queries/queryKeys";

/**
 * looks up a song in the query cache and returns the latest version.
 * merges cached fields (is_favorite, user_rating) with the provided song.
 *
 * this is NOT a reactive hook - it's a synchronous cache lookup.
 * call it inside your component's createMemo/createEffect for reactivity.
 *
 * @example
 * const enrichedSong = createMemo(() => {
 *   const song = currentSong();
 *   return song ? enrichSongFromCache(queryClient, song) : null;
 * });
 */
export function enrichSongFromCache(
  queryClient: QueryClient,
  song: Song,
): Song {
  // search cache for latest version
  const cached = findSongInCache(queryClient, song.sha256, song.id);

  if (!cached) return song;

  // merge cached fields with original
  return {
    ...song,
    is_favorite: cached.is_favorite ?? song.is_favorite,
    user_rating: cached.user_rating ?? song.user_rating,
  };
}

/**
 * enriches multiple songs from cache.
 * call this inside your component's createMemo for reactivity.
 */
export function enrichSongsFromCache(
  queryClient: QueryClient,
  songs: Song[],
): Song[] {
  return songs.map((song) => enrichSongFromCache(queryClient, song));
}

/**
 * searches the query cache for a song by sha256 or id.
 * returns the cached song if found, null otherwise.
 */
function findSongInCache(
  queryClient: QueryClient,
  sha256: string,
  id: string,
): Song | null {
  // 1. check specific song query
  const songQuery =
    queryClient.getQueryData<Song>([...queryKeys.songs.all(), sha256]) ||
    queryClient.getQueryData<Song>([...queryKeys.songs.all(), id]);
  if (songQuery) return songQuery;

  // 2. check all infinite songs queries
  const songsQueries = queryClient.getQueriesData<{
    pages: Array<{ items: Song[] }>;
  }>({
    queryKey: [...queryKeys.songs.all(), "infinite"],
    exact: false,
  });

  for (const [_key, data] of songsQueries) {
    if (!data?.pages) continue;
    for (const page of data.pages) {
      const found = page.items.find((s) => s.sha256 === sha256 || s.id === id);
      if (found) return found;
    }
  }

  // 3. check album songs
  const albumQueries = queryClient.getQueriesData<{
    items: Song[];
  }>({
    queryKey: ["album", "songs"],
    exact: false,
  });

  for (const [_key, data] of albumQueries) {
    if (!data?.items) continue;
    const found = data.items.find((s) => s.sha256 === sha256 || s.id === id);
    if (found) return found;
  }

  // 4. check artist songs
  const artistQueries = queryClient.getQueriesData<{
    items: Song[];
  }>({
    queryKey: ["artist", "songs"],
    exact: false,
  });

  for (const [_key, data] of artistQueries) {
    if (!data?.items) continue;
    const found = data.items.find((s) => s.sha256 === sha256 || s.id === id);
    if (found) return found;
  }

  // 5. check genre songs
  const genreQueries = queryClient.getQueriesData<{
    items: Song[];
  }>({
    queryKey: ["genre", "songs"],
    exact: false,
  });

  for (const [_key, data] of genreQueries) {
    if (!data?.items) continue;
    const found = data.items.find((s) => s.sha256 === sha256 || s.id === id);
    if (found) return found;
  }

  // 6. check playlist songs
  const playlistQueries = queryClient.getQueriesData<{
    pages: Array<{ items: Song[] }>;
  }>({
    queryKey: ["playlists"],
    exact: false,
  });

  for (const [_key, data] of playlistQueries) {
    if (!data?.pages) continue;
    for (const page of data.pages) {
      const found = page.items?.find((s) => s.sha256 === sha256 || s.id === id);
      if (found) return found;
    }
  }

  // not found in cache
  return null;
}
