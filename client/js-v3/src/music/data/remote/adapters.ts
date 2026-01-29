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
  | 'artist_name' | 'album_title'
  | 'album_added_at' | 'album_primary_genre_id' | 'album_primary_genre_name'
  // images
  | 'images'
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
    images?: Array<{
      blob_id: string;
      is_primary: boolean | number;
      blob_type?: string;
    }>;
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
    blob_type?: string;
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
    album_added_at: song.created_at, // use song's created_at as proxy
    album_primary_genre_id: album?.genre_id || item.genre?.id || null,
    album_primary_genre_name: album?.genre || item.genre?.name || null,

    // song-specific images with exact priority hierarchy:
    // 1. song primary → 2. any song thumbnail → 3. album primary → 4. album thumbnail → 5. waveform
    images: (() => {
      const mapImage = (img: any) => ({
        remote_blob_id: img.blob_id,
        remote_url: `${baseUrl}/api/blobs/${img.blob_id}`,
        is_primary: !!img.is_primary,
        blob_type: img.blob_type as 'thumbnail' | 'waveform' | 'original' | 'preview',
      });
      
      const songImages = (item.images || []).map(mapImage);
      const albumImages = (album?.images || []).map(mapImage);
      
      // priority helpers
      // song images: use 'thumbnail' blob_type (has parent_blob_id pointing to audio)
      // album images: use 'original' blob_type (standalone images with no parent)
      const findSongPrimary = (imgs: ReturnType<typeof mapImage>[]) => 
        imgs.find(img => img.blob_type === 'thumbnail' && img.is_primary);
      const findSongThumbnail = (imgs: ReturnType<typeof mapImage>[]) => 
        imgs.find(img => img.blob_type === 'thumbnail');
      const findAlbumPrimary = (imgs: ReturnType<typeof mapImage>[]) => 
        imgs.find(img => img.blob_type === 'original' && img.is_primary);
      const findAlbumOriginal = (imgs: ReturnType<typeof mapImage>[]) => 
        imgs.find(img => img.blob_type === 'original');
      const findWaveform = (imgs: ReturnType<typeof mapImage>[]) => 
        imgs.find(img => img.blob_type === 'waveform');
      
      // exact priority order
      const candidates = [
        findSongPrimary(songImages),    // 1. song primary thumbnail
        findSongThumbnail(songImages),  // 2. any song thumbnail
        findAlbumPrimary(albumImages),  // 3. album primary original
        findAlbumOriginal(albumImages), // 4. any album original
        findWaveform(songImages),       // 5. song waveform (last resort)
      ].filter(Boolean) as ReturnType<typeof mapImage>[];
      
      return candidates.length > 0 ? candidates : undefined;
    })(),

    // user-specific metadata (from API response top-level)
    is_favorite: item.is_favorite || false,
    user_rating: item.rating ?? undefined,
    album_is_favorite: item.album_is_favorite ?? false,
    album_rating: item.album_rating ?? undefined,
    album_tags: item.album_tags || undefined,
    album_sub_genres: album?.sub_genres || undefined,
    album_images: album?.images?.map((img: any) => ({
      remote_url: `${baseUrl}/api/blobs/${img.blob_id}`,
      is_primary: !!img.is_primary,
      blob_type: img.blob_type as 'thumbnail' | 'waveform' | 'original' | 'preview',
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
