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
    console.log(`🔄 Hook received update: ${value.length} playlists`);
    setPlaylists([...value]); // Force new array reference for reactivity
    console.log(`🔄 SolidJS signal updated with ${value.length} playlists`);
  });

  // Additional effect to ensure reactivity works
  createEffect(() => {
    const current = playlists();
    console.log(`🎯 Hook effect tracking: ${current.length} playlists`);
  });

  // Cleanup subscription when component unmounts
  onCleanup(() => {
    console.log("🧹 Cleaning up playlist query subscription");
    unsubscribe();
  });

  // Return the reactive SolidJS signal
  return playlists;
}
