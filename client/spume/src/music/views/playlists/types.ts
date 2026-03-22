// shared types for playlist view components
import type { ImageMetadata, Playlist } from "../../services/storage/types";
import type { Song } from "../../data/types";

export interface PlaylistViewState {
  selectedPlaylistId: string | null;
  editMode: boolean;
  editTitle: string;
  editDescription: string;
  playlistImages: ImageMetadata[];
  draggedSongId: string | null;
  dropTargetIndex: number | null;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
}

export interface PlaylistWithSongs extends Playlist {
  songs?: Song[];
}
