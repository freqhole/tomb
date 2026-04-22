// helpers to convert spume-side song / album / playlist view data into the
// codegen `Sync*Request` shapes accepted by grimoire.
//
// note: image refs are intentionally minimal here — only `content_sha256`
// is populated (no inline base64). the destination will report any missing
// image sha256s, and a future polish pass (step 11) can fetch + inline them.

import type {
  SyncAlbumRequest,
  SyncImageRef,
  SyncPlaylistRequest,
  SyncSongByBlake3Request,
} from "freqhole-api-client";
import type { ImageMetadata } from "../storage/types";
import type { RemoteSong } from "../../data/remote/adapters";

/** caller-provided context shared by all sync request builders. */
export interface SendCommonContext {
  /** dest-side display name for the source remote (used in feed events). */
  remoteName: string;
  /** source-side `remote.remote_id` (uuid) — opaque, used for grouping. */
  sourceRemoteId?: string | null;
  /** source-side iroh node id (64-hex). required for audio pulls. */
  sourceNodeId: string;
}

/** convert an `ImageMetadata` to a sha256-only `SyncImageRef`. */
//
// `ImageMetadata` does not currently carry sha256; only `blob_id`. when the
// image's underlying sha256 is unknown we have to skip the ref entirely —
// dest cannot do anything useful with a remote-server-scoped blob id.
//
// callers can opt in to passing sha256-aware images via the `imageRefsFromSha256s`
// helper below.
export function imageRefsFromSha256s(
  sha256s: string[],
  primaryIndex: number = 0,
  mimeType: string = "image/jpeg",
  blobType: string = "original",
): SyncImageRef[] {
  return sha256s.map((sha256, idx) => ({
    content_sha256: sha256,
    data_base64: null,
    mime_type: mimeType,
    is_primary: idx === primaryIndex,
    blob_type: blobType,
  }));
}

/** drop image metadatas that lack a usable sha256 reference. */
//
// today this returns an empty array because `ImageMetadata` does not carry
// sha256. left as a documented seam so step 11 can plumb sha256 through
// without rewriting every call site.
export function imageRefsFromImageMetadata(
  _images: ImageMetadata[] | undefined,
): SyncImageRef[] {
  return [];
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

  const filename =
    opts.filename ??
    song.file_name ??
    `${song.title || song.id}.bin`;

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
    song_images: imageRefsFromImageMetadata(song.images),
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
  /** album-level images. */
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
    images_base64: imageRefsFromImageMetadata(opts.images),
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
    images: imageRefsFromImageMetadata(opts.images),
    remote_name: opts.remoteName,
  };
}
