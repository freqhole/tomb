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
  // all local files stored in opfs
  opfs_path: string | null;
  file_name: string | null; // original filename
  file_size: number | null; // file size in bytes
  last_modified: number | null; // file last modified timestamp

  // downloaded source (if source_type === "downloaded")
  source_url: string | null; // original download url

  // remote source (if source_type === "remote", future)
  server_id: string | null;
  remote_song_id: string | null;
}

// database schema version
export const MUSIC_DB_NAME = "freqhole_music";
export const MUSIC_DB_VERSION = 1;

// music store names
export const STORE_MUSIC_SONGS = "music_songs";
