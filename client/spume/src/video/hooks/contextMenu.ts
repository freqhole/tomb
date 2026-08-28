// composable context menu actions for videos — mirrors
// music/hooks/contextMenu.ts's useSongContextMenu shape, simplified for
// the video MVP (no playlists/tags/share/artist-artist nav yet).
import { useNavigate } from "@solidjs/router";
import { IconNames } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { createFavoriteMenuAction } from "../../music/hooks/contextMenu";
import { showPlaylistSelectorForVideos } from "../../music/hooks/playlistSelectorState";
import { showTagSelector } from "../../music/hooks/modals";
import { createVideoTagAdapter } from "../../components/modals/tagAdapters/videoTagAdapter";
import { buildRoute } from "../../music/utils/routing";
import { confirm } from "../../app/services/confirmState";
import { toast } from "../../components/feedback/Toast";
import { showEditVideo, showEditVideoSeries, showBulkEditVideos } from "./modals";
import { canUpdateVideo } from "../data/permissions";
import { getVideoDataSource } from "../data";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import {
  addVideoToQueue,
  addVideosToQueue,
  playVideoNext,
  shuffleVideos,
} from "../services/videoQueueActions";
import { useDeleteVideoMutation } from "../queries/videos";
import { useDeleteVideoSeriesMutation } from "../queries/series";
import { useRemovePlaylistItemsMutation } from "../queries/playlistItems";
import type { VideoSeries, VideoSummary } from "../data/types";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";

export interface VideoContextMenuOptions {
  /** whether the video is currently favorited */
  isFavorite?: boolean;
  /** callback after a successful edit save */
  onSave?: () => void;
  /** callback after a successful delete (e.g. remove from a local list) */
  onDeleted?: () => void;
  /** whether to show play/queue actions (false in contexts like the
   *  queue sidebar where they don't make sense) */
  showPlayActions?: boolean;
  /** whether to show "remove from playlist" action (playlist detail view only) */
  showRemoveFromPlaylist?: boolean;
  /** playlist id for remove action */
  playlistId?: string;
  /** callback after a successful "remove from playlist" (e.g. refresh the list) */
  onRemovedFromPlaylist?: () => void;
  /** whether to show "remove from queue" action (queue view only) */
  showRemoveFromQueue?: boolean;
  /** queue index for remove action */
  queueIndex?: number;
  /** callback when remove from queue is clicked */
  onRemoveFromQueue?: () => void;
  /** whether to show "clear queue above" action (queue view only) */
  showClearAbove?: boolean;
  /** callback when clear queue above is clicked */
  onClearAbove?: () => void;
  /** whether to show "clear queue below" action (queue view only) */
  showClearBelow?: boolean;
  /** callback when clear queue below is clicked */
  onClearBelow?: () => void;
  /** custom actions to append */
  customActions?: MenuAction[];
}

export function useVideoContextMenu(
  video: VideoSummary | QueuedVideo,
  options: VideoContextMenuOptions = {}
): MenuAction[] {
  const navigate = useNavigate();
  const deleteMutation = useDeleteVideoMutation();
  const removeFromPlaylistMutation = useRemovePlaylistItemsMutation();
  const actions: MenuAction[] = [];

  // queue management actions FIRST (when in queue context) — mirrors
  // useSongContextMenu's queue-action ordering.
  if (options.showRemoveFromQueue && options.queueIndex !== undefined) {
    actions.push({
      label: "remove from queue",
      icon: IconNames.close,
      onClick: () => {
        options.onRemoveFromQueue?.();
      },
    });

    if (options.showClearAbove && options.queueIndex > 0) {
      actions.push({
        label: "clear queue before",
        icon: IconNames.chevronUp,
        onClick: () => {
          options.onClearAbove?.();
        },
      });
    }

    if (options.showClearBelow) {
      actions.push({
        label: "clear queue after",
        icon: IconNames.chevronDown,
        onClick: () => {
          options.onClearBelow?.();
        },
      });
    }

    actions.push({ type: "separator" });
  }

  if (options.showPlayActions !== false) {
    actions.push({
      label: "play now",
      icon: IconNames.play,
      onClick: async () => {
        // source is required so a history entry is created and watch-progress
        // tracking starts (without it, position never resumes on reload).
        await playVideoQueue([video], 0, {
          type: "video",
          label: video.title,
          entity_id: video.id,
        });
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

  actions.push({
    label: "view details",
    icon: IconNames.info,
    onClick: () => {
      navigate(buildRoute(`/video/${video.id}`));
    },
  });

  if (video.series_id) {
    actions.push({
      label: "view series",
      icon: IconNames.list,
      onClick: () => {
        navigate(buildRoute(`/video/series/${video.series_id}`));
      },
    });
  }

  actions.push(createFavoriteMenuAction("video", video.id, options.isFavorite ?? false));

  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: () => {
      void showPlaylistSelectorForVideos([video.id]);
    },
  });

  if (options.showRemoveFromPlaylist && options.playlistId) {
    actions.push({
      label: "remove from playlist",
      icon: IconNames.close,
      onClick: async () => {
        try {
          await removeFromPlaylistMutation.mutateAsync({
            playlistId: options.playlistId!,
            items: [{ entity_type: "video", entity_id: video.id }],
          });
          options.onRemovedFromPlaylist?.();
        } catch (err) {
          console.error("failed to remove video from playlist:", err);
          toast.error("failed to remove video from playlist");
        }
      },
    });
  }

  if (canUpdateVideo()) {
    actions.push({ type: "separator" });

    actions.push({
      label: "edit info...",
      icon: IconNames.edit,
      onClick: () => {
        showEditVideo({ videoId: video.id, onSave: options.onSave });
      },
    });

    actions.push({
      label: "tags",
      icon: IconNames.tag,
      onClick: () => {
        showTagSelector({
          entityIds: [video.id],
          entityTitle: video.title,
          entityKindLabel: "videos",
          adapter: createVideoTagAdapter("video"),
          onSave: options.onSave,
        });
      },
    });

    actions.push({
      label: "delete",
      icon: IconNames.delete,
      destructive: true,
      onClick: async () => {
        const confirmed = await confirm({
          title: "delete video",
          message: `are you sure you want to delete "${video.title}"? this cannot be undone.`,
          confirmText: "delete",
          variant: "danger",
        });
        if (!confirmed) return;
        try {
          await deleteMutation.mutateAsync(video.id);
          toast.success("video deleted");
          options.onDeleted?.();
        } catch (err) {
          console.error("failed to delete video:", err);
          toast.error("failed to delete video");
        }
      },
    });
  }

  if (options.customActions?.length) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}

export interface VideoSeriesContextMenuOptions {
  /** whether the series is currently favorited */
  isFavorite?: boolean;
  /** callback after a successful edit save */
  onSave?: () => void;
  /** callback after a successful delete (e.g. navigate away) */
  onDeleted?: () => void;
  /** custom actions to append */
  customActions?: MenuAction[];
}

// play-all/queue-all/shuffle-all/add-to-playlist/bulk-edit/tags all need
// the series' full video list, but most callers (grid tiles, list rows)
// only have the bare series row on hand — fetch on demand when
// `allVideos` wasn't already preloaded (e.g. by the detail panel, which
// has it from its own query) rather than requiring every caller to fetch
// series detail just to build a context menu.
async function resolveSeriesVideos(
  series: VideoSeries,
  preloaded: VideoSummary[]
): Promise<VideoSummary[]> {
  if (preloaded.length > 0) return preloaded;
  try {
    const dataSource = getVideoDataSource();
    const detail = await dataSource.getVideoSeriesDetail(series.id);
    if (!detail) return [];
    return [...detail.seasons.flatMap((season) => season.videos), ...detail.unassignedVideos];
  } catch (err) {
    console.error("failed to load series videos:", err);
    return [];
  }
}

// note: no rating action here — `RatingTarget`
// (grimoire/src/users/favoritez/models.rs) only supports the "video"
// target, not a series-level one, so series can't be rated today.
export function useVideoSeriesContextMenu(
  series: VideoSeries,
  allVideos: VideoSummary[],
  options: VideoSeriesContextMenuOptions = {}
): MenuAction[] {
  const deleteMutation = useDeleteVideoSeriesMutation();
  const actions: MenuAction[] = [];

  actions.push({
    label: "play all",
    icon: IconNames.play,
    onClick: async () => {
      const videos = await resolveSeriesVideos(series, allVideos);
      if (videos.length === 0) return;
      await playVideoQueue(videos, 0, {
        type: "series",
        label: series.title,
        entity_id: series.id,
      });
    },
  });

  actions.push({
    label: "add all to queue",
    icon: IconNames.queue,
    onClick: async () => {
      const videos = await resolveSeriesVideos(series, allVideos);
      await addVideosToQueue(videos);
    },
  });

  actions.push({
    label: "shuffle all",
    icon: IconNames.shuffle,
    onClick: async () => {
      const videos = await resolveSeriesVideos(series, allVideos);
      if (videos.length === 0) return;
      await playVideoQueue(shuffleVideos(videos), 0, {
        type: "series",
        label: series.title,
        entity_id: series.id,
      });
    },
  });

  actions.push({ type: "separator" });

  actions.push(createFavoriteMenuAction("video_series", series.id, options.isFavorite ?? false));

  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: async () => {
      const videos = await resolveSeriesVideos(series, allVideos);
      if (videos.length === 0) return;
      void showPlaylistSelectorForVideos(videos.map((v) => v.id));
    },
  });

  if (canUpdateVideo()) {
    actions.push({
      label: "edit series...",
      icon: IconNames.edit,
      onClick: () => {
        showEditVideoSeries({ seriesId: series.id, onSave: options.onSave });
      },
    });

    actions.push({
      label: "bulk edit...",
      icon: IconNames.edit,
      onClick: async () => {
        const videos = await resolveSeriesVideos(series, allVideos);
        if (videos.length === 0) {
          toast.error("this series has no videos to edit");
          return;
        }
        showBulkEditVideos({
          videoIds: videos.map((v) => v.id),
          onSuccess: options.onSave,
        });
      },
    });

    actions.push({
      label: "tags",
      icon: IconNames.tag,
      onClick: async () => {
        const videos = await resolveSeriesVideos(series, allVideos);
        if (videos.length === 0) {
          toast.error("this series has no videos to tag");
          return;
        }
        showTagSelector({
          entityIds: videos.map((v) => v.id),
          entityTitle: series.title,
          entityKindLabel: "videos",
          adapter: createVideoTagAdapter("video"),
          onSave: options.onSave,
        });
      },
    });

    actions.push({
      label: "delete series",
      icon: IconNames.delete,
      destructive: true,
      onClick: async () => {
        const confirmed = await confirm({
          title: "delete series",
          message: `are you sure you want to delete "${series.title}"? this removes all its seasons and episodes and cannot be undone.`,
          confirmText: "delete",
          variant: "danger",
        });
        if (!confirmed) return;
        try {
          await deleteMutation.mutateAsync(series.id);
          toast.success("series deleted");
          options.onDeleted?.();
        } catch (err) {
          console.error("failed to delete video series:", err);
          toast.error("failed to delete series");
        }
      },
    });
  }

  if (options.customActions?.length) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}
