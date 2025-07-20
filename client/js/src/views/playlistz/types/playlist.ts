export interface Playlist {
  id: string; // UUID
  title: string; // User-editable playlist name
  description?: string; // Optional description
  image?: string; // Base64 encoded image or blob URL
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
  songIds: string[]; // Ordered array of song IDs
}

export interface Song {
  id: string; // UUID
  file: File; // Original audio file
  title: string; // User-editable song title
  artist: string; // User-editable artist name
  album: string; // User-editable album name
  duration: number; // Length in seconds
  position: number; // Position within playlist (0-based)
  image?: string; // Base64 encoded cover art
  createdAt: number; // Timestamp
  updatedAt: number; // Timestamp
  playlistId: string; // Reference to parent playlist
}

export interface AudioState {
  currentSong: Song | null;
  currentPlaylist: Playlist | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  currentIndex: number;
}

export interface PlaylistStats {
  totalSongs: number;
  totalDuration: number; // in seconds
  lastPlayed?: number; // timestamp
}

// For file upload processing
export interface FileUploadResult {
  success: boolean;
  song?: Song;
  error?: string;
}

// For metadata extraction
export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArt?: string; // Base64 encoded
}
