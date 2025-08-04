import { createSignal, onCleanup, createEffect } from "solid-js";
import { createPlaylistsQuery as createRawPlaylistsQuery } from "../services/indexedDBService.js";
import type { Playlist } from "../types/playlist.js";

/**
 * SolidJS hook that creates a reactive playlist query
 * Bridges the custom IndexedDB signal to SolidJS reactivity
 */
export function usePlaylistsQuery() {
  // Create SolidJS signal for reactive updates
  const [playlists, setPlaylists] = createSignal<Playlist[]>([], {
    equals: false,
  });

  // Create the underlying IndexedDB query
  const rawQuery = createRawPlaylistsQuery();

  // Subscribe to updates and propagate to SolidJS signal
  const unsubscribe = rawQuery.subscribe((value) => {
    setPlaylists([...value]); // Force new array reference for reactivity
  });

  // Additional effect to ensure reactivity works
  createEffect(() => {
    playlists();
  });

  // Cleanup subscription when component unmounts
  onCleanup(() => {
    unsubscribe();
  });

  // Return the reactive SolidJS signal
  return playlists;
}
