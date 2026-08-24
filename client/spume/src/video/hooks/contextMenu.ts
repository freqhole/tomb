// composable context menu actions for videos — mirrors
// music/hooks/contextMenu.ts's useSongContextMenu shape, simplified for
// the video MVP (no playlists/tags/share/artist-artist nav yet).
import { IconNames } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { createFavoriteMenuAction } from "../../music/hooks/contextMenu";
import { showEditVideo } from "./modals";
import { canUpdateVideo } from "../data/permissions";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { addVideoToQueue, playVideoNext } from "../services/videoQueueActions";
import type { VideoSummary } from "../data/types";

export interface VideoContextMenuOptions {
  /** whether the video is currently favorited */
  isFavorite?: boolean;
  /** callback after a successful edit save */
  onSave?: () => void;
  /** whether to show play/queue actions (false in contexts like the
   *  queue sidebar where they don't make sense) */
  showPlayActions?: boolean;
  /** custom actions to append */
  customActions?: MenuAction[];
}

export function useVideoContextMenu(
  video: VideoSummary,
  options: VideoContextMenuOptions = {}
): MenuAction[] {
  const actions: MenuAction[] = [];

  if (options.showPlayActions !== false) {
    actions.push({
      label: "play now",
      icon: IconNames.play,
      onClick: async () => {
        await playVideoQueue([video], 0);
      },
    });

    actions.push({
      label: "play next",
      icon: IconNames.queue,
      onClick: async () => {
        await playVideoNext(video);
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        await addVideoToQueue(video);
      },
    });

    actions.push({ type: "separator" });
  }

  actions.push(createFavoriteMenuAction("video", video.id, options.isFavorite ?? false));

  if (canUpdateVideo()) {
    actions.push({
      label: "edit info...",
      icon: IconNames.edit,
      onClick: () => {
        showEditVideo({ videoId: video.id, onSave: options.onSave });
      },
    });
  }

  if (options.customActions?.length) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}
