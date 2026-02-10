// global playlist selector state service
// provides a reactive signal-based approach instead of manual DOM manipulation

import { createSignal } from "solid-js";

interface PlaylistSelectorState {
  isOpen: boolean;
  songIds: string[];
  resolve: (() => void) | null;
}

const defaultState: PlaylistSelectorState = {
  isOpen: false,
  songIds: [],
  resolve: null,
};

// global signal for playlist selector state
const [playlistSelectorState, setPlaylistSelectorState] =
  createSignal<PlaylistSelectorState>(defaultState);

/**
 * show a playlist selector modal and return a promise that resolves when the modal is closed
 *
 * usage:
 * ```typescript
 * await showPlaylistSelector(["song-id-1", "song-id-2"]);
 * // modal is now closed and songs have been added (or user cancelled)
 * ```
 */
export function showPlaylistSelector(songIds: string[]): Promise<void> {
  return new Promise((resolve) => {
    setPlaylistSelectorState({
      isOpen: true,
      songIds,
      resolve,
    });
  });
}

// called when the playlist selector modal is closed
export function closePlaylistSelector(): void {
  const state = playlistSelectorState();
  if (state.resolve) {
    state.resolve();
  }
  setPlaylistSelectorState(defaultState);
}

// export the signal for reading in components
export { playlistSelectorState };
