// helpers to convert spume-side song / album / playlist view data into the
// codegen `Sync*Request` shapes accepted by grimoire.
//
// song/album images are inlined as blake3 hash references (see
// `syncImages.ts`'s `inlineImagesForSync` - resolved via a cheap metadata
// lookup, never raw bytes) directly into these requests, so the
// destination's background sync job can pull + attach them itself without
// any synchronous id round-trip back to the caller. playlist images still
// go through the older post-hoc `/api/upload/image` path for now.

import type {
  SyncAlbumRequest,
  SyncPlaylistRequest,
  SyncSongByBlake3Request,
  Transport,
} from "@freqhole/api-client";
import type { ImageMetadata } from "../storage/types";
import type { RemoteSong } from "../../data/remote/adapters";
import { inlineImagesForSync, toInlinableImages, type InlineImageCache } from "../sync/syncImages";

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
  /** where to pull image bytes from (the source's own instance) and a
   * shared per-run cache so a cover art shared across many songs in the
   * same album is only resolved once. */
  sourceTransport: Transport;
  imageCache: InlineImageCache;
}

/**
 * build a `SyncSongByBlake3Request` from a `RemoteSong`.
 *
 * returns null when the song has no `blake3` (cannot be pulled by iroh).
 * callers should treat this as a skip and report it.
 */
export async function buildSyncSongByBlake3Request(
  opts: BuildSyncSongOptions
): Promise<SyncSongByBlake3Request | null> {
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

  const [songImages, albumImages] = await Promise.all([
    inlineImagesForSync(
      toInlinableImages(song.images),
      opts.sourceTransport,
      opts.imageCache,
      `[song "${song.title}"]`
    ),
    inlineImagesForSync(
      toInlinableImages(song.album_images),
      opts.sourceTransport,
      opts.imageCache,
      `[album "${song.album_title}"]`
    ),
  ]);

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
    duration_ms: song.duration_seconds != null ? Math.round(song.duration_seconds * 1000) : null,
    year: song.year ?? null,
    bpm: song.bpm ?? null,
    track_artist: song.track_artist ?? null,
    lyrics: song.lyrics ?? null,
    metadata: song.metadata ?? null,
    genre_name: opts.genreName ?? null,
    song_images: songImages,
    album_images: albumImages,
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
  /** album-level images, inlined as blake3 refs (see `BuildSyncSongOptions`). */
  images?: ImageMetadata[];
  sourceTransport: Transport;
  imageCache: InlineImageCache;
}

export async function buildSyncAlbumRequest(
  opts: BuildSyncAlbumOptions
): Promise<SyncAlbumRequest> {
  const images = await inlineImagesForSync(
    toInlinableImages(opts.images),
    opts.sourceTransport,
    opts.imageCache,
    `[album "${opts.title}"]`
  );
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
    images,
    expected_song_blake3s: opts.expectedSongBlake3s,
    remote_name: opts.remoteName,
  };
}

export interface BuildSyncPlaylistOptions extends SendCommonContext {
  playlistId: string;
  title: string;
  description?: string | null;
  /** every member (song or video) in playlist order - one shared position
   * space, so this must be a single ordered list rather than one list per
   * kind (which couldn't represent interleaved song/video order). members
   * without a blake3 should be filtered out by the caller. */
  members: Array<{ kind: "song" | "video"; blake3: string }>;
  images?: ImageMetadata[];
  sourceTransport: Transport;
  imageCache: InlineImageCache;
}

export async function buildSyncPlaylistRequest(
  opts: BuildSyncPlaylistOptions
): Promise<SyncPlaylistRequest> {
  const images = await inlineImagesForSync(
    toInlinableImages(opts.images),
    opts.sourceTransport,
    opts.imageCache,
    `[playlist "${opts.title}"]`
  );
  return {
    source_remote_id: opts.sourceRemoteId ?? null,
    source_node_id: opts.sourceNodeId,
    remote_playlist_id: opts.playlistId,
    title: opts.title,
    description: opts.description ?? null,
    members: opts.members,
    images,
    remote_name: opts.remoteName,
  };
}
