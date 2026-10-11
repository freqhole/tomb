// syncs the selected playlist's primary image into the app-wide
// background image (the blurred backdrop behind the detail view) -
// extracted out of PlaylistDetailPanel.tsx to keep that file under the
// project's file-size budget. a thin adapter over the shared
// useBackgroundImageFromImages hook (picks the primary image, resolves and
// publishes it, and clears on unmount - which covers both deselecting this
// playlist and navigating away).
import type { Accessor } from "solid-js";
import { useBackgroundImageFromImages } from "../../../app/hooks/useBackgroundImageSource";
import type { Playlist } from "../../services/storage/types";

export function usePlaylistBackgroundImage(playlist: Accessor<Playlist | null>) {
  useBackgroundImageFromImages(() => playlist()?.images);
}
