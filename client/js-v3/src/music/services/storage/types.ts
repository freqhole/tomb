// music domain storage types

export type MusicSourceType = "local" | "downloaded" | "remote";

export interface MusicSong {
  id: string;

  // metadata (always present)
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  mime_type: string;
  added_at: number;

  // source discriminator
  source_type: MusicSourceType;

  // local file source (if source_type === "local")
  // store the actual audio blob for local files
  audio_blob: Blob | null;

  // downloaded source (if source_type === "downloaded")
  source_url: string | null;
  opfs_path: string | null;
  file_size: number | null;

  // remote source (if source_type === "remote", future)
  server_id: string | null;
  remote_song_id: string | null;
}

// database schema version
export const MUSIC_DB_NAME = "freqhole_music";
export const MUSIC_DB_VERSION = 1;

// music store names
export const STORE_MUSIC_SONGS = "music_songs";
