// remote API adapter functions
// converts API responses to domain Song type with complete field mapping

import type { Song } from "../types";

// type-safe adapter return type - compiler enforces all Song fields are mapped
export type RemoteSong = Required<Pick<Song, 
  // core identification
  | 'id' | 'sha256' | 'title' | 'artist_id' | 'album_id'
  // track metadata
  | 'track_number' | 'disc_number' | 'duration_seconds' | 'year'
  | 'bpm' | 'key_signature' | 'lyrics' | 'metadata'
  | 'created_at' | 'updated_at'
  // denormalized display fields
  | 'artist_name' | 'album_title' | 'thumbnail_blob_id'
  | 'album_added_at' | 'album_primary_genre_id' | 'album_primary_genre_name'
  // user-specific metadata (optional fields)
  | 'is_favorite' | 'user_rating' | 'album_is_favorite' | 'album_rating'
  | 'album_tags' | 'album_sub_genres' | 'album_images'
  // source type and metadata
  | 'source_type' | 'opfs_path' | 'file_name' | 'file_size'
  | 'last_modified' | 'mime_type' | 'source_url' | 'downloaded_at'
  | 'remote_server_id' | 'remote_sha256' | 'added_at'
>>;

// API response structure - defines adapter's contract with API client
// this is not a copy of API types, but a structural interface defining what the adapter uses
export interface ApiSongQueryItem {
  song: {
    id: string;
    title: string;
    media_blob_id: string;
    track_number?: number;
    disc_number?: number;
    duration?: number;  // milliseconds
    year?: number | null;
    bpm?: number | null;
    key_signature?: string | null;
    lyrics?: string | null;
    metadata?: string | null;
    thumbnail_blob_id?: string | null;
    created_at: number;
    updated_at: number;
  };
  artist?: {
    id: string;
    name: string;
  };
  album?: {
    id: string;
    title: string;
    release_date?: string;
    genre_id?: string;
    genre?: string;
    sub_genres?: string[];
  };
  blob?: {
    sha256: string;
    mime_type?: string;
  };
  genre?: {
    id: string;
    name: string;
  };
  is_favorite?: boolean;
  rating?: number | null;
  album_is_favorite?: boolean;
  album_rating?: number | null;
  album_tags?: string[];
  images?: Array<{
    blob_id: string;
    is_primary: boolean | number;
  }>;
}

// adapter to convert API song query result to domain Song type
export function adaptSongFromAPI(item: ApiSongQueryItem, baseUrl: string, remoteServerId: string): RemoteSong {
  const song = item.song;
  const artist = item.artist;
  const album = item.album;
  const blob = item.blob;

  const sha256 = blob?.sha256 || song.media_blob_id;

  const result = {
    id: song.id,
    sha256,
    title: song.title,
    artist_id: artist?.id || "",
    album_id: album?.id || "",
    track_number: song.track_number || 0,
    disc_number: song.disc_number || 1,
    duration_seconds: song.duration ? Math.floor(song.duration / 1000) : 0, // convert ms to seconds
    year:
      song.year ||
      (album?.release_date
        ? parseInt(album.release_date.substring(0, 4))
        : null),
    bpm: song.bpm || null,
    key_signature: song.key_signature || null,
    lyrics: song.lyrics || null,
    metadata: song.metadata || null,
    created_at: song.created_at,
    updated_at: song.updated_at,

    // denormalized fields
    artist_name: artist?.name || "unknown artist",
    album_title: album?.title || "unknown album",
    thumbnail_blob_id: song.thumbnail_blob_id 
      ? `${baseUrl}/api/blobs/${song.thumbnail_blob_id}`
      : null,
    album_added_at: song.created_at, // use song's created_at as proxy
    album_primary_genre_id: album?.genre_id || item.genre?.id || null,
    album_primary_genre_name: album?.genre || item.genre?.name || null,

    // user-specific metadata (from API response top-level)
    is_favorite: item.is_favorite || false,
    user_rating: item.rating ?? undefined,
    album_is_favorite: item.album_is_favorite ?? false,
    album_rating: item.album_rating ?? undefined,
    album_tags: item.album_tags || undefined,
    album_sub_genres: album?.sub_genres || undefined,
    album_images: item.images?.map((img: any) => ({
      blob_id: img.blob_id,
      is_primary: img.is_primary ? 1 : 0,
    })) || undefined,

    // remote source type
    source_type: "remote" as const,

    // local/downloaded fields (null for remote)
    opfs_path: null,
    file_name: null,
    file_size: null,
    last_modified: null,
    mime_type: blob?.mime_type || null,
    source_url: `${baseUrl}/api/blobs/${song.media_blob_id}`,
    downloaded_at: null,

    // remote fields
    remote_server_id: remoteServerId,
    remote_sha256: song.id,
    added_at: song.created_at,
  };

  return result;
}
