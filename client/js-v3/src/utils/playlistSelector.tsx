// playlist selector utility for showing "add to playlist" modal
// provides a simple API for playlist selection without managing modal state in every component

import { QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { queryClient } from "..";
import { PlaylistSelectorModal } from "../components/dialogs/PlaylistSelectorModal";

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
    // create a container for the modal
    const container = document.createElement("div");
    document.body.appendChild(container);

    // create signals for modal state
    let isOpen: () => boolean;
    let setIsOpen: (value: boolean) => void;

    const cleanup = () => {
      dispose();
      document.body.removeChild(container);
    };

    const handleClose = () => {
      setIsOpen(false);
      cleanup();
      resolve();
    };

    // render the modal with solid-js
    const dispose = render(() => {
      [isOpen, setIsOpen] = createSignal(true);

      return (
        <QueryClientProvider client={queryClient}>
          <PlaylistSelectorModal
            isOpen={isOpen()}
            onClose={handleClose}
            songIds={songIds}
          />
        </QueryClientProvider>
      );
    }, container);
  });
}
