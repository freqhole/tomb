// helpers to convert spume-side song / album / playlist view data into the
// codegen `Sync*Request` shapes accepted by grimoire.
//
// image transfer is NOT inlined on sync requests anymore — dest entity ids
// are returned by each sync endpoint, and `uploadImagesToDest` then pushes
// each image via the normal `/api/upload/image` endpoint after the fact.
// these builders always emit empty image arrays; the field is kept for
// back-compat with the server's request schema.

import type {
  SyncAlbumRequest,
  SyncPlaylistRequest,
  SyncSongByBlake3Request,
} from "freqhole-api-client";
import type { ImageMetadata } from "../storage/types";
import type { RemoteSong } from "../../data/remote/adapters";

// mime -> file extension fallback for cases where `file_name` is not set
// on a remote song (which is the common case — the adapter populates
// `mime_type` from the media blob but leaves `file_name` null). mirrors
// the server-side `detect_extension` fallback table so dest writes the
// blob to disk with the right extension instead of `.bin`.
const AUDIO_MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/ogg": "ogg",
  "audio/vorbis": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
};

function audioExtensionFromMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  return AUDIO_MIME_TO_EXT[mime.toLowerCase()] ?? null;
}

/** caller-provided context shared by all sync request builders. */
export interface SendCommonContext {
  /** dest-side display name for the source remote (used in feed events). */
  remoteName: string;
  /** source-side `remote.remote_id` (uuid) — opaque, used for grouping. */
  sourceRemoteId?: string | null;
  /** source-side iroh node id (64-hex). required for audio pulls. */
  sourceNodeId: string;
}

export interface BuildSyncSongOptions extends SendCommonContext {
  song: RemoteSong;
  /** optional override; defaults to `${title}.${ext}` derived from mime. */
  filename?: string;
  /** primary genre name shared with the album, if known. */
  genreName?: string | null;
  /** is this song part of a compilation album? */
  isCompilation?: boolean;
}

/**
 * build a `SyncSongByBlake3Request` from a `RemoteSong`.
 *
 * returns null when the song has no `blake3` (cannot be pulled by iroh).
 * callers should treat this as a skip and report it.
 */
export function buildSyncSongByBlake3Request(
  opts: BuildSyncSongOptions,
): SyncSongByBlake3Request | null {
  const { song, sourceNodeId, sourceRemoteId, remoteName } = opts;
  if (!song.blake3) return null;
  if (!song.sha256) return null;

  // remote songs always have file_name === null (the API doesn't expose
  // the original on-disk filename), so fall back to title + a mime-derived
  // extension. without a real extension the destination's `detect_extension`
  // produces `.bin` and audio fails to play. defaults to `.mp3` only as a
  // last resort because mp3 is overwhelmingly the most common audio mime.
  const filename =
    opts.filename ??
    song.file_name ??
    (() => {
      const ext = audioExtensionFromMime(song.mime_type) ?? "mp3";
      const title = song.title || song.id;
      return `${title}.${ext}`;
    })();

  return {
    blake3: song.blake3,
    sha256: song.sha256,
    size: song.file_size ?? null,
    filename,
    source_node_id: sourceNodeId,
    source_remote_id: sourceRemoteId ?? null,
    remote_name: remoteName,
    title: song.title,
    artist_name: song.artist_name || "unknown artist",
    album_title: song.album_title || "unknown album",
    track_number: song.track_number ?? 0,
    disc_number: song.disc_number ?? 1,
    duration_ms:
      song.duration_seconds != null
        ? Math.round(song.duration_seconds * 1000)
        : null,
    year: song.year ?? null,
    bpm: song.bpm ?? null,
    track_artist: song.track_artist ?? null,
    lyrics: song.lyrics ?? null,
    metadata: song.metadata ?? null,
    genre_name: opts.genreName ?? null,
    // images transferred post-hoc via /api/upload/image.
    song_images: [],
    is_compilation: opts.isCompilation ?? false,
  };
}

export interface BuildSyncAlbumOptions extends SendCommonContext {
  albumId: string;
  title: string;
  artistName: string;
  albumType?: string | null;
  releaseDate?: string | null;
  label?: string | null;
  genres?: string[];
  urls?: string[];
  tags?: string[];
  /** blake3s of every song expected to follow in `sync_song_by_blake3` calls. */
  expectedSongBlake3s: string[];
  /** album-level images. transferred after sync/album returns the dest album id. */
  images?: ImageMetadata[];
}

export function buildSyncAlbumRequest(
  opts: BuildSyncAlbumOptions,
): SyncAlbumRequest {
  return {
    source_remote_id: opts.sourceRemoteId ?? null,
    source_node_id: opts.sourceNodeId,
    remote_album_id: opts.albumId,
    title: opts.title,
    artist_name: opts.artistName || "unknown artist",
    album_type: opts.albumType ?? null,
    release_date: opts.releaseDate ?? null,
    label: opts.label ?? null,
    genres: opts.genres ?? [],
    urls: opts.urls ?? [],
    mb_release_id: null,
    mb_release_group_id: null,
    tags: opts.tags ?? [],
    // images transferred post-hoc via /api/upload/image.
    images_base64: [],
    expected_song_blake3s: opts.expectedSongBlake3s,
    remote_name: opts.remoteName,
  };
}

export interface BuildSyncPlaylistOptions extends SendCommonContext {
  playlistId: string;
  title: string;
  description?: string | null;
  /** blake3s of every song in playlist order. songs without blake3 should be filtered out by the caller. */
  songBlake3s: string[];
  images?: ImageMetadata[];
}

export function buildSyncPlaylistRequest(
  opts: BuildSyncPlaylistOptions,
): SyncPlaylistRequest {
  return {
    source_remote_id: opts.sourceRemoteId ?? null,
    remote_playlist_id: opts.playlistId,
    title: opts.title,
    description: opts.description ?? null,
    song_blake3s: opts.songBlake3s,
    // images transferred post-hoc via /api/upload/image.
    images: [],
    remote_name: opts.remoteName,
  };
}
