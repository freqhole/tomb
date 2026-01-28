// shared types for playlist view components
import type { ImageMetadata, Playlist } from "../../services/storage/types";
import type { Song } from "../../data/types";
import type { DownloadProgress, SyncCheckResult } from "../../services/playlists/downloadSync";

export interface PlaylistViewState {
  selectedPlaylistId: string | null;
  editMode: boolean;
  editTitle: string;
  editDescription: string;
  playlistImages: ImageMetadata[];
  draggedSongId: string | null;
  dropTargetIndex: number | null;
  syncStatus: SyncCheckResult | null;
  syncSourceRemoteName: string | null;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  isSyncing: boolean;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
}

export interface PlaylistWithSongs extends Playlist {
  songs?: Song[];
}
