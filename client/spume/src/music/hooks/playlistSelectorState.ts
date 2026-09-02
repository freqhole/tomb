// global playlist selector state service
// provides a reactive signal-based approach instead of manual DOM manipulation

import { createSignal } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";

/** one entity to add to whichever playlist the user picks — mirrors the
 *  {entity_type, entity_id} shape already used by the generic
 *  playlist_itemz backend/reorderPlaylistItems, so a future mixed
 *  song+video selection (e.g. multi-select in a merged playlist view)
 *  needs no further state-shape changes here. */
export interface PlaylistSelectorItem {
  entity_type: "song" | "video";
  entity_id: string;
}

interface PlaylistSelectorState {
  isOpen: boolean;
  items: PlaylistSelectorItem[];
  /** when set, the modal scopes its queries/mutations to this remote
   *  rather than the globally-active data source. used by context-menu
   *  actions on songs that came from a remote different from the
   *  current source. */
  remote?: Remote;
  resolve: (() => void) | null;
}

const defaultState: PlaylistSelectorState = {
  isOpen: false,
  items: [],
  remote: undefined,
  resolve: null,
};

// global signal for playlist selector state
const [playlistSelectorState, setPlaylistSelectorState] =
  createSignal<PlaylistSelectorState>(defaultState);

/**
 * show a playlist selector modal for a generic (possibly mixed
 * song+video) set of items, and return a promise that resolves when the
 * modal is closed.
 */
export function showPlaylistSelectorForItems(
  items: PlaylistSelectorItem[],
  remote?: Remote
): Promise<void> {
  return new Promise((resolve) => {
    setPlaylistSelectorState({
      isOpen: true,
      items,
      remote,
      resolve,
    });
  });
}

/**
 * show a playlist selector modal and return a promise that resolves when the modal is closed
 *
 * usage:
 * ```typescript
 * await showPlaylistSelector(["song-id-1", "song-id-2"]);
 * // modal is now closed and songs have been added (or user cancelled)
 * ```
 */
export function showPlaylistSelector(songIds: string[], remote?: Remote): Promise<void> {
  return showPlaylistSelectorForItems(
    songIds.map((entity_id) => ({ entity_type: "song" as const, entity_id })),
    remote
  );
}

/**
 * show a playlist selector modal for adding videos instead of songs.
 *
 * usage:
 * ```typescript
 * await showPlaylistSelectorForVideos(["video-id-1"]);
 * ```
 */
export function showPlaylistSelectorForVideos(videoIds: string[], remote?: Remote): Promise<void> {
  return showPlaylistSelectorForItems(
    videoIds.map((entity_id) => ({ entity_type: "video" as const, entity_id })),
    remote
  );
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
