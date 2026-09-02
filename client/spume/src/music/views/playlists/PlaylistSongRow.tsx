// single playlist row for a song-typed merged playlist item - extracted
// out of PlaylistDetailPanel.tsx's inline <For> render registry to keep
// that file under the project's file-size budget (mirrors QueueSongRow/
// VideoQueueRow's extraction pattern from phase 4b's QueueSidebar split).
import { Show, type Accessor } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import { IconButton } from "../../../components/buttons/IconButton";
import { DraggableRow, DraggableRowSongContent } from "../../../components/lists/DraggableRow";
import { ContextMenu, ClickDropdownMenu } from "../../../components/overlays/ContextMenu";
import { isCharnelMode } from "../../../app/services/charnel";
import { useSongContextMenu } from "../../hooks/contextMenu";
import { canRemoveSongsFromPlaylist } from "../../data/permissions";
import type { Song } from "../../data/types";
import type { MergedPlaylistItem } from "./usePlaylistMergedItems";

export interface PlaylistSongRowProps {
  item: Extract<MergedPlaylistItem, { kind: "song" }>;
  index: number;
  playlistId: string;
  playlistOwnerId: string | null;
  isTouch: boolean;
  isNarrow: Accessor<boolean>;
  editMode: Accessor<boolean>;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onPointerDown: (e: PointerEvent) => void;
  onDoubleClick: () => void;
  onFavoriteToggle: (songId: string, sha256: string, isFavorite: boolean) => void;
  onRemove: (song: Song) => void;
}

export function PlaylistSongRow(props: PlaylistSongRowProps) {
  const song = props.item.song;
  const contextMenuActions = useSongContextMenu(song, {
    showPlayActions: true,
    showRemoveFromPlaylist: true,
    playlistId: props.playlistId,
    isFavorite: song.is_favorite ?? false,
  });

  const row = (
    <DraggableRow
      id={props.item.key}
      index={props.index}
      isDragging={props.isDragging}
      isDropTarget={props.isDropTarget}
      isPlaying={appState()?.current_sha256 === song.sha256}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      onPointerDown={props.onPointerDown}
      onDoubleClick={props.onDoubleClick}
      onPlayClick={props.onDoubleClick}
      images={[...(song.images || []), ...(song.album_images || [])]}
      disabled={isCharnelMode()}
      showDragHandle={props.isTouch && props.editMode()}
    >
      <DraggableRowSongContent
        title={song.title}
        artist={song.artist_name}
        album={song.album_title}
        durationSeconds={song.duration_seconds}
        playCount={song.play_count ?? null}
        isFavorite={song.is_favorite}
        songId={song.id}
        sha256={song.sha256}
        alwaysShowActions={props.isTouch}
        compact={props.isNarrow()}
        onFavoriteToggle={(songId, isFavorite) =>
          props.onFavoriteToggle(songId, song.sha256, isFavorite)
        }
        actions={
          <>
            <Show when={props.isTouch && contextMenuActions.length > 0}>
              <ClickDropdownMenu
                trigger={
                  <IconButton
                    icon="more"
                    size="sm"
                    variant="ghost"
                    aria-label="song actions"
                    data-testid="btn-more-song"
                  />
                }
                actions={contextMenuActions}
              />
            </Show>
            <Show
              when={!props.isNarrow() && canRemoveSongsFromPlaylist(props.playlistOwnerId)}
              fallback={null}
            >
              <IconButton
                icon="close"
                size="sm"
                variant="ghost"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  props.onRemove(song);
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
