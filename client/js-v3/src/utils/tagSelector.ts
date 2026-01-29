// utility for showing the tag selector modal
// provides a simple function-based API for managing album tags from anywhere

import { QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { queryClient } from "../queryClient";
import { TagSelectorModal } from "../components/modals/TagSelectorModal";
import { queryKeys } from "../music/queries/queryKeys";

/**
 * show tag selector modal for managing album tags
 * @param albumIds - album id(s) to manage tags for
 * @param albumTitle - optional album title to display (if single album)
 */
export function showTagSelector(albumIds: string[], albumTitle?: string): void {
  // create container element
  const container = document.createElement("div");
  document.body.appendChild(container);

  // cleanup function to remove modal
  const cleanup = () => {
    container.remove();
  };

  // callback to invalidate queries after save
  const handleSave = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
    queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.all() });
  };

  // render modal wrapped in QueryClientProvider
  render(
    () =>
      QueryClientProvider({
        client: queryClient,
        get children() {
          return TagSelectorModal({
            albumIds,
            albumTitle,
            onClose: cleanup,
            onSave: handleSave,
          });
        },
      }),
    container,
  );
}
