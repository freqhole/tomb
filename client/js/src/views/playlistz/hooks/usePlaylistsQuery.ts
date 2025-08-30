import { createSignal, onCleanup, createEffect } from "solid-js";
import { createPlaylistsQuery as createRawPlaylistsQuery } from "../services/indexedDBService.js";
import type { Playlist } from "../types/playlist.js";

/**
 * SolidJS hook that creates a reactive playlist query
 * bridge the custom IndexedDB signal to SolidJS reactivity
 */
export function usePlaylistsQuery() {
  // signal for reactive updates
  const [playlists, setPlaylists] = createSignal<Playlist[]>([], {
    equals: false,
  });

  // the underlying IndexedDB query
  const rawQuery = createRawPlaylistsQuery();

  // subscribe to updates and propagate to signalz
  const unsubscribe = rawQuery.subscribe((value) => {
    setPlaylists([...value]); // Force new array reference for reactivity
  });

  // additional effect for reactivity
  createEffect(() => {
    playlists();
  });

  // cleanup subscription when component unmounts
  onCleanup(() => {
    unsubscribe();
  });

  return playlists;
}
