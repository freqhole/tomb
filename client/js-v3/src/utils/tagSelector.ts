// utility for showing the tag selector modal
// provides a simple function-based API for managing album tags from anywhere

import { render } from "solid-js/web";
import { TagSelectorModal } from "../components/modals/TagSelectorModal";

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

  // render modal
  render(
    () =>
      TagSelectorModal({
        albumIds,
        albumTitle,
        onClose: cleanup,
      }),
    container,
  );
}
