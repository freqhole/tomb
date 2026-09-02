// single playlist row for a video-typed merged playlist item - extracted
// out of PlaylistDetailPanel.tsx's inline <For> render registry to keep
// that file under the project's file-size budget (mirrors QueueSongRow/
// VideoQueueRow's extraction pattern from phase 4b's QueueSidebar split).
import { createMemo, Show, type Accessor } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import { IconButton } from "../../../components/buttons/IconButton";
import { DraggableRow, DraggableRowVideoContent } from "../../../components/lists/DraggableRow";
import { ContextMenu, ClickDropdownMenu } from "../../../components/overlays/ContextMenu";
import { isCharnelMode } from "../../../app/services/charnel";
import { useVideoContextMenu } from "../../../video/hooks/contextMenu";
import { useVideoSeasonsQuery } from "../../../video/queries/series";
import { formatSeasonLabel } from "../../../components/forms/VideoSeasonAutocomplete";
import { useLocalVideoPosterUrl } from "../../../video/components/VideoCard";
import type { PlaylistVideoItem } from "../../../video/queries/playlistItems";
import type { MergedPlaylistItem } from "./usePlaylistMergedItems";

export interface PlaylistVideoRowProps {
  item: Extract<MergedPlaylistItem, { kind: "video" }>;
  index: number;
  playlistId: string;
  isTouch: boolean;
  isNarrow: Accessor<boolean>;
  editMode: Accessor<boolean>;
  favoriteVideoIds: Accessor<Set<string>>;
  videoSeriesList: Accessor<{ id: string; title: string }[]>;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onPointerDown: (e: PointerEvent) => void;
  onDoubleClick: () => void;
  onFavoriteToggle: (videoId: string, isFavorite: boolean) => void;
  onRemove: (item: PlaylistVideoItem) => void;
}

export function PlaylistVideoRow(props: PlaylistVideoRowProps) {
  const videoItem = props.item.videoItem;
  const isFavorite = () => props.favoriteVideoIds().has(videoItem.video.id);

  // OPFS-backed local poster (no remote_blob_id) - MediaThumbnail's
  // `images` prop only understands local_blob_id/remote_blob_id/
  // remote_url, not OPFS paths, so a purely-local video's poster is
  // resolved separately and passed as a plain thumbnailUrl (mirrors
  // VideoCard.tsx's pattern).
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    videoItem.video.source_type === "local" ? videoItem.video.poster_opfs_path : null
  );

  const contextMenuActions = useVideoContextMenu(videoItem.video, {
    showPlayActions: true,
    showRemoveFromPlaylist: true,
    playlistId: props.playlistId,
    isFavorite: isFavorite(),
  });

  // content-type/series/season/episode subtitle line, e.g. "series ·
  // Voyager" or "season 2 · episode 5" - mirrors VideoCard.tsx's pattern.
  const seasonsQuery = useVideoSeasonsQuery(() => videoItem.video.series_id ?? undefined);
  const subtitle = createMemo(() => {
    const video = videoItem.video;
    const series = video.series_id
      ? props.videoSeriesList().find((s) => s.id === video.series_id)
      : undefined;

    const season = video.season_id
      ? (seasonsQuery.data ?? []).find((s) => s.id === video.season_id)
      : undefined;
    const seasonLabel = season ? formatSeasonLabel(season.season_number, season.title) : null;

    const parts = [video.content_type || null, series?.title ?? null].filter(Boolean) as string[];
    if (seasonLabel) parts.push(seasonLabel);
    if (video.episode_number != null) {
      parts.push(`episode ${video.episode_number}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  });

  const row = (
    <DraggableRow
      id={props.item.key}
      index={props.index}
      isDragging={props.isDragging}
      isDropTarget={props.isDropTarget}
      isPlaying={appState()?.current_sha256 === videoItem.video.id}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      onPointerDown={props.onPointerDown}
      onDoubleClick={props.onDoubleClick}
      onPlayClick={props.onDoubleClick}
      fallbackIcon="video"
      cornerBadgeIcon="video"
      images={
        videoItem.video.poster_blob_id
          ? [
              {
                remote_blob_id: videoItem.video.poster_blob_id,
                remote_server_id: videoItem.video.remote_server_id ?? undefined,
                is_primary: true,
                blob_type: "thumbnail",
              },
            ]
          : []
      }
      thumbnailUrl={
        videoItem.video.source_type === "local" ? (localPosterUrl() ?? undefined) : undefined
      }
      disabled={isCharnelMode()}
      showDragHandle={props.isTouch && props.editMode()}
    >
      <DraggableRowVideoContent
        title={videoItem.video.title}
        subtitle={subtitle()}
        durationSeconds={videoItem.video.duration_seconds ?? undefined}
        playCount={videoItem.video.play_count ?? null}
        isFavorite={isFavorite()}
        videoId={videoItem.video.id}
        onFavoriteToggle={props.onFavoriteToggle}
        alwaysShowActions={props.isTouch}
        compact={props.isNarrow()}
        actions={
          <>
            <Show when={props.isTouch && contextMenuActions.length > 0}>
              <ClickDropdownMenu
                trigger={
                  <IconButton
                    icon="more"
                    size="sm"
                    variant="ghost"
                    aria-label="video actions"
                    data-testid="btn-more-video"
                  />
                }
                actions={contextMenuActions}
              />
            </Show>
            <Show when={!props.isNarrow()} fallback={null}>
              <IconButton
                icon="close"
                size="sm"
                variant="ghost"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  props.onRemove(videoItem);
                }}
                aria-label="remove from playlist"
              />
            </Show>
          </>
        }
      />
    </DraggableRow>
  );

  return props.isTouch ? row : <ContextMenu actions={contextMenuActions}>{row}</ContextMenu>;
}
