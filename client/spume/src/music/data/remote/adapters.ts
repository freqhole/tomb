// remote API adapter functions
// converts API responses to domain Song type with complete field mapping

import type { Song } from "../types";
import { getRemoteMediaUrl } from "../../../utils/urls";

// type-safe adapter return type - compiler enforces all Song fields are mapped
// Core required fields plus optional user-specific metadata
export type RemoteSong = Required<Pick<Song, 
  // core identification
  | 'id' | 'sha256' | 'media_blob_id' | 'title' | 'artist_id' | 'album_id'
  // track metadata
  | 'track_number' | 'disc_number' | 'duration_seconds' | 'year'
  | 'bpm' | 'track_artist' | 'lyrics' | 'metadata'
  | 'created_at' | 'updated_at'
  // denormalized display fields
  | 'artist_name' | 'album_title' | 'album_type'
  | 'album_added_at' | 'album_primary_genre_id' | 'album_primary_genre_name'
  // images and urls (always present, may be empty arrays)
  | 'images' | 'urls'
  // user-specific metadata (always present: boolean/arrays)
  | 'is_favorite' | 'album_is_favorite'
  | 'album_tags' | 'album_genres' | 'album_images'
  // source type and metadata
  | 'source_type' | 'opfs_path' | 'file_name' | 'file_size'
  | 'last_modified' | 'mime_type' | 'source_url' | 'downloaded_at'
  | 'remote_server_id' | 'remote_song_id' | 'blake3' | 'added_at'
>> & Pick<Song,
  // optional numeric ratings (undefined = not rated)
  | 'user_rating' | 'album_rating'
>;

// API image structure (from API: is_primary is number 0|1, blob_type is string)
export interface ApiImage {
  blob_id: string;
  is_primary: number;
  blob_type?: string;
}

// API URL structure (from API: id and name are nullish, accept null or undefined)
export interface ApiUrl {
  id?: string | null;
  name?: string | null;
  url: string;
}

// API response structure - defines adapter's contract with API client
// nullable arrays/fields accept null or undefined to match codegen nullish output
export interface ApiSongQueryItem {
  song: {
    id: string;
    title: string;
    media_blob_id: string;
    track_number: number;
    disc_number: number;
    duration?: number | null;  // milliseconds
    year?: number | null;
    bpm?: number | null;
    track_artist?: string | null;
    lyrics?: string | null;
    metadata?: string | null;
    created_at: number;
    updated_at: number;
    created_by_username?: string | null;
    updated_by_username?: string | null;
    images?: ApiImage[] | null;
    urls?: ApiUrl[] | null;
  };
  artist?: {
    id: string;
    name: string;
    images?: ApiImage[] | null;
  } | null;
  album?: {
    id: string;
    title: string;
    album_type: string;
    release_date?: string | null;
    genres?: {id: string; name: string}[] | null;
    images?: ApiImage[] | null;
  } | null;
  media_blob?: {
    sha256: string;
    size?: number | null; // file size in bytes (used for download progress)
    mime?: string | null;
    blake3?: string | null; // iroh-blobs content hash
  } | null;
  genre?: {
    id: string;
    name: string;
  } | null;
  is_favorite?: boolean | null;
  rating?: number | null;
  album_is_favorite?: boolean | null;
  album_rating?: number | null;
  album_tags?: string[] | null;
  images?: ApiImage[] | null;
}

// helper to convert API image to app ImageMetadata
export function adaptApiImage(img: ApiImage, baseUrl: string, remoteServerId?: string) {
  return {
    remote_blob_id: img.blob_id,
    remote_url: getRemoteMediaUrl(baseUrl, img.blob_id),
    remote_server_id: remoteServerId,
    is_primary: !!img.is_primary,
    blob_type: (img.blob_type || 'original') as 'thumbnail' | 'waveform' | 'original' | 'preview',
  };
}

// helper to convert API URLs to clean EntityUrl[] (filters out entries without id)
export function adaptApiUrls(urls: ApiUrl[] | null | undefined): Array<{id: string; name?: string; url: string}> | undefined {
  if (!urls || urls.length === 0) return undefined;
  return urls
    .filter((u): u is ApiUrl & { id: string } => u.id != null && u.url != null)
    .map(u => ({
      id: u.id,
      name: u.name ?? undefined,
      url: u.url,
    }));
}

// adapter to convert API song query result to domain Song type
export function adaptSongFromAPI(item: ApiSongQueryItem, baseUrl: string, remoteServerId: string): RemoteSong {
  const song = item.song;
  const artist = item.artist;
  const album = item.album;
  const blob = item.media_blob;

  const sha256 = blob?.sha256 || song.media_blob_id;

  const result = {
    id: song.id,
    sha256,
    media_blob_id: song.media_blob_id, // short blob ID for analytics FK
    title: song.title,
    artist_id: artist?.id || "",
    album_id: album?.id || "",
    track_number: song.track_number ?? 0,
    disc_number: song.disc_number ?? 1,
    duration_seconds: song.duration ? Math.floor(song.duration / 1000) : 0, // convert ms to seconds
    year:
      song.year ??
      (album?.release_date
        ? parseInt(album.release_date.substring(0, 4))
        : null),
    bpm: song.bpm ?? null,
    track_artist: song.track_artist ?? null,
    lyrics: song.lyrics ?? null,
    metadata: song.metadata ?? null,
    created_at: song.created_at,
    updated_at: song.updated_at,
    created_by_username: song.created_by_username ?? undefined,
    updated_by_username: song.updated_by_username ?? undefined,

    // denormalized fields
    artist_name: artist?.name || "unknown artist",
    album_title: album?.title || "unknown album",
    album_type: album?.album_type || "album",
    album_added_at: song.created_at, // use song's created_at as proxy
    album_primary_genre_id: item.genre?.id ?? null,
    album_primary_genre_name: album?.genres?.[0]?.name ?? item.genre?.name ?? null,

    // song-specific images only (album images stored separately in album_images)
    images: item.images?.map(img => adaptApiImage(img, baseUrl, remoteServerId)) ?? [],

    // user-specific metadata (from API response top-level)
    is_favorite: item.is_favorite ?? false,
    user_rating: item.rating ?? undefined,
    album_is_favorite: item.album_is_favorite ?? false,
    album_rating: item.album_rating ?? undefined,
    album_tags: item.album_tags ?? [],
    album_genres: album?.genres ?? [],
    album_images: album?.images?.map(img => adaptApiImage(img, baseUrl, remoteServerId)) ?? [],
    artist_images: artist?.images?.map(img => adaptApiImage(img, baseUrl, remoteServerId)) ?? [],

    // entity URLs (convert null fields to undefined)
    urls: adaptApiUrls(song.urls) ?? [],

    // remote source type
    source_type: "remote" as const,

    // local/downloaded fields (null for remote, except file_size which the
    // server reports via media_blob.size — needed for accurate download
    // progress on remote audio fetches)
    opfs_path: null,
    file_name: null,
    file_size: blob?.size ?? null,
    last_modified: null,
    mime_type: blob?.mime ?? null,
    source_url: getRemoteMediaUrl(baseUrl, song.media_blob_id),
    downloaded_at: null,

    // remote fields
    remote_server_id: remoteServerId,
    remote_song_id: song.id, // server's song.id for sync tracking
    blake3: blob?.blake3 ?? null, // for iroh-blobs verified streaming
    added_at: song.created_at,
  };

  return result;
}
