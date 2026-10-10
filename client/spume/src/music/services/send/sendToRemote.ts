// orchestrator: send an album or playlist from a source remote to a
// destination remote.
//
// two-channel design:
//
// 1. audio moves via iroh-blobs verified streaming. the client never
//    carries audio bytes. dest receives `POST /api/sync/song-by-blake3`
//    and pulls directly from the source peer (`source_node_id` + blake3).
//
// 2. images move via the normal `/api/upload/image` multipart endpoint.
//    after each sync/* call returns a dest entity id, we walk the
//    source-side `ImageMetadata[]`, pull bytes via the source transport's
//    `fetchBlob`, and re-upload to dest with `associate_with` pointing
//    at the freshly-created entity id. this reuses the same dedupe +
//    conversion + association machinery used everywhere else.
//
// this module only ships json envelopes (and a small image FormData
// per image); audio never touches the client.
//
// flow for an album:
//   1. validate dest is a p2p transport and source has an iroh node id.
//   2. POST `/api/sync/album` to dest -> capture dest `album_id`.
//   3. upload album images to dest (associated with `album_id`).
//   4. for each song with a blake3, POST `/api/sync/song-by-blake3`
//      (concurrency-limited, default 2). dest pulls the audio via iroh.
//      capture dest `song_id` and upload song images to dest.
//   5. emit progress after every song result.
//
// flow for a playlist:
//   1. validate dest and source as above.
//   2. for each song with a blake3, POST `/api/sync/song-by-blake3`,
//      then upload song images.
//   3. POST `/api/sync/playlist` -> capture dest `playlist_id`, upload
//      playlist images.

import { schema } from "@freqhole/api-client";
import type {
  SyncAlbumRequest,
  SyncAlbumResponse,
  SyncJobQueuedResponse,
  SyncPlaylistRequest,
  SyncPlaylistResponse,
  SyncSongByBlake3Request,
  Transport,
} from "@freqhole/api-client";
const {
  HasBlobsResponseSchema,
  SyncAlbumResponseSchema,
  SyncJobQueuedResponseSchema,
  SyncPlaylistResponseSchema,
} = schema;
import { getTransportForRemote } from "../../../app/api/client";
import { waitForJobResult } from "../../../app/services/jobs/jobService";
import { isP2PRemote, type Remote } from "../../../app/services/storage/schemas/remote";
import {
  isValidSendDestination,
  resolveSourceNodeId,
  checkBlobsPresentOnDest,
  peerUnauthorizedMessage,
} from "../../../app/services/send/sendValidation";
import { debug, info, warn, error as logError } from "../../../utils/logger";
import type { RemoteSong } from "../../data/remote/adapters";
import { RemoteMusicDataSource } from "../../data/remote/remoteSource";
import type { ImageMetadata } from "../storage/types";
import { readAudioFromOPFS } from "../opfs/helpers";
import { ensureBlobServable } from "../../../lib/api/blobServing";
import type { VideoSummary } from "../../../video/data/types";
import { buildSyncVideoByBlake3Body } from "../../../video/services/sync/buildSyncVideoRequest";
import {
  buildSyncAlbumRequest,
  buildSyncPlaylistRequest,
  buildSyncSongByBlake3Request,
  type BuildSyncAlbumOptions,
  type BuildSyncPlaylistOptions,
} from "./buildSyncRequests";
import { uploadImagesToDest, createImageBlobCache } from "./uploadImagesToDest";
import type { InlineImageCache } from "../sync/syncImages";

const TAG = "sendToRemote";

// real audio/video files routinely take 8-70+ seconds to pull on the dest
// side (see sync_song_by_blake3_impl's doc comment) - generous but bounded.
const SYNC_JOB_TIMEOUT_MS = 120_000;

export type SendPhase =
  | "preparing"
  | "syncing-album"
  | "syncing-songs"
  | "syncing-playlist"
  | "verifying"
  | "done"
  | "failed";

export interface SendProgress {
  phase: SendPhase;
  totalSongs: number;
  syncedSongs: number;
  skippedSongs: number;
  failedSongs: number;
  /** error messages collected during the run, most recent first. */
  errors: string[];
  /** blake3s of songs that have already been synced this run. */
  syncedBlake3s: string[];
  /** blake3s of songs that failed to sync this run. */
  failedBlake3s: string[];
  /** video members of a playlist send (always 0 for album/song sends). */
  totalVideos: number;
  syncedVideos: number;
  skippedVideos: number;
  failedVideos: number;
  syncedVideoBlake3s: string[];
  failedVideoBlake3s: string[];
}

export interface SendAlbumPayload {
  kind: "album";
  albumId: string;
  title: string;
  artistName: string;
  albumType?: string | null;
  releaseDate?: string | null;
  label?: string | null;
  genres?: string[];
  /** album-level images. pushed to dest via /api/upload/image. */
  images?: ImageMetadata[];
  songs: RemoteSong[];
}

export interface SendPlaylistPayload {
  kind: "playlist";
  playlistId: string;
  title: string;
  description?: string | null;
  /** playlist-level images. pushed to dest via /api/upload/image. */
  images?: ImageMetadata[];
  songs: RemoteSong[];
  /** video members, if any - playlists are mixed song+video (see
   * docs/playlist-unification-plan.md). omit entirely for a song-only
   * playlist (or a caller not yet updated for video parity). */
  videos?: VideoSummary[];
  /** the playlist's TRUE member order (one shared position space across
   * song+video - see `SyncPlaylistMember`). when omitted, falls back to
   * `songs`' own order (song-only playlist). */
  memberOrder?: Array<{ kind: "song" | "video"; blake3: string }>;
}

export interface SendSongPayload {
  kind: "song";
  song: RemoteSong;
}

export type SendPayload = SendAlbumPayload | SendPlaylistPayload | SendSongPayload;

export interface SendOptions {
  /** how many `sync_song_by_blake3` requests to run concurrently. default 2. */
  concurrency?: number;
  /** if true, pre-check dest with `/api/blobz/has` and skip songs already present. default true. */
  skipExisting?: boolean;
  /** progress callback fired after each phase change and each song result. */
  onProgress?: (progress: SendProgress) => void;
  /**
   * if set, restrict the song-pull loop to these blake3s and skip the
   * album/playlist envelope phases. used by the retry-failed affordance.
   */
  retryBlake3s?: string[];
}

export class SendToRemoteError extends Error {
  constructor(
    message: string,
    public readonly progress: SendProgress
  ) {
    super(message);
    this.name = "SendToRemoteError";
  }
}

// short random id to prefix all log lines in one send run, so a single
// flow can be followed in the browser console across many interleaved
// sources/dests.
function newSendId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// parse a GrimoireResponse envelope. returns the inner data on success,
// throws with the structured error detail on failure. the dest's sync
// handlers always respond with `{ success, message, data?, errors }`.
//
// exported so other domains' send orchestrators (e.g. video's
// sendVideoToRemote.ts) can parse the same `{success,message,data,errors}`
// envelope shape without duplicating this logic.
export class EnvelopeError extends Error {
  readonly errorType?: string;
  readonly title?: string;
  readonly detail?: string;
  /** every `ErrorDetail` the response carried, in order (see unwrapEnvelope). */
  readonly errors?: Array<{ errorType?: string; title?: string; detail?: string }>;
  constructor(
    message: string,
    opts?: {
      errorType?: string;
      title?: string;
      detail?: string;
      errors?: Array<{ errorType?: string; title?: string; detail?: string }>;
    }
  ) {
    super(message);
    this.name = "EnvelopeError";
    this.errorType = opts?.errorType;
    this.title = opts?.title;
    this.detail = opts?.detail;
    this.errors = opts?.errors;
  }
}

export function unwrapEnvelope<T>(
  label: string,
  body: string,
  status: number,
  parse: (v: unknown) => { success: true; data: T } | { success: false; error: { message: string } }
): T {
  if (status < 200 || status >= 300) {
    throw new EnvelopeError(`${label}: http ${status}: ${body}`);
  }
  let raw: {
    success?: boolean;
    message?: string;
    data?: unknown;
    errors?: Array<{ detail?: string; error_type?: string; title?: string }>;
  };
  try {
    raw = JSON.parse(body);
  } catch (e) {
    throw new EnvelopeError(`${label}: invalid json response: ${String(e)}`);
  }
  if (raw?.success === false) {
    const allErrors = raw.errors ?? [];
    const first = allErrors[0];
    const detail = first?.detail ?? raw.message ?? "server reported failure";
    // combine every ErrorDetail's text into the message shown by default,
    // while still exposing the first entry's error_type as the primary
    // classification and the full array for callers that want to inspect
    // every error (only the first one drove `detail` above previously).
    const combinedDetail =
      allErrors.length > 1
        ? allErrors.map((e) => e.detail ?? e.title ?? "unknown error").join("; ")
        : detail;
    throw new EnvelopeError(`${label}: ${combinedDetail}`, {
      errorType: first?.error_type,
      title: first?.title,
      detail: first?.detail,
      errors: allErrors.map((e) => ({
        errorType: e.error_type,
        title: e.title,
        detail: e.detail,
      })),
    });
  }
  const inner = raw?.data ?? raw;
  const parsed = parse(inner);
  if (!parsed.success) {
    throw new EnvelopeError(`${label}: invalid response shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * send `payload` from `source` to `dest`. resolves with the final progress
 * snapshot. on fatal validation errors throws `SendToRemoteError` whose
 * `progress` field describes what (if anything) was synced before failure.
 */
export async function sendToRemote(
  payload: SendPayload,
  source: Remote,
  dest: Remote,
  opts: SendOptions = {}
): Promise<SendProgress> {
  const sendId = newSendId();
  const lp = `[send:${sendId}]`;
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const skipExisting = opts.skipExisting ?? true;
  const retrySet = opts.retryBlake3s ? new Set(opts.retryBlake3s) : null;

  info(
    TAG,
    `${lp} start: kind=${payload.kind} source=${source.remote_id}(${source.name ?? "?"}) dest=${dest.remote_id}(${dest.name ?? "?"}) concurrency=${concurrency} skipExisting=${skipExisting} retry=${retrySet ? retrySet.size : 0}`
  );

  const songs = payload.kind === "song" ? [payload.song] : payload.songs;
  const videos = payload.kind === "playlist" ? (payload.videos ?? []) : [];
  const progress: SendProgress = {
    phase: "preparing",
    totalSongs: songs.length,
    syncedSongs: 0,
    skippedSongs: 0,
    failedSongs: 0,
    errors: [],
    syncedBlake3s: [],
    failedBlake3s: [],
    totalVideos: videos.length,
    syncedVideos: 0,
    skippedVideos: 0,
    failedVideos: 0,
    syncedVideoBlake3s: [],
    failedVideoBlake3s: [],
  };
  const emit = () => opts.onProgress?.({ ...progress });
  emit();

  // validate transports + node id up front.
  if (!isValidSendDestination(dest)) {
    logError(
      TAG,
      `${lp} invalid dest transport: dest=${dest.remote_id} is_charnel=${dest.is_charnel_managed}`
    );
    throw new SendToRemoteError(
      "destination must be a p2p remote or the local charnel app",
      progress
    );
  }
  const sourceNodeId = resolveSourceNodeId(source);
  if (!sourceNodeId) {
    logError(
      TAG,
      `${lp} no source node id: source=${source.remote_id} is_charnel=${source.is_charnel_managed} is_p2p=${isP2PRemote(source)}`
    );
    throw new SendToRemoteError("source remote has no usable iroh node id", progress);
  }
  info(TAG, `${lp} source_node_id=${sourceNodeId} (full, 64-hex)`);
  info(
    TAG,
    `${lp} source.peer_addr=${isP2PRemote(source) ? source.peer_addr : "(not p2p)"} source.is_charnel_managed=${source.is_charnel_managed} source.name=${source.name}`
  );

  const destTransport = await getTransportForRemote(dest);
  const sourceTransport = await getTransportForRemote(source);
  const remoteName = source.name ?? source.remote_id;
  const sourceRemoteId = source.remote_id;

  // collect songs that have a blake3; non-blake3 songs cannot be pulled.
  let eligibleSongs = songs.filter((s) => !!s.blake3 && !!s.sha256);
  if (retrySet) {
    eligibleSongs = eligibleSongs.filter((s) => retrySet.has(s.blake3 as string));
  }
  progress.totalSongs = eligibleSongs.length;
  const skippedNoHash = retrySet ? 0 : songs.length - eligibleSongs.length;
  if (skippedNoHash > 0) {
    progress.skippedSongs += skippedNoHash;
    progress.errors.push(`${skippedNoHash} song(s) skipped — no blake3/sha256 available`);
    warn(TAG, `${lp} ${skippedNoHash} of ${songs.length} songs skipped (no blake3/sha256)`);
    emit();
  }
  info(TAG, `${lp} eligible songs: ${eligibleSongs.length}`);

  // collect videos that have a blake3 (playlist sends only).
  let eligibleVideos = videos.filter((v) => !!v.blake3);
  if (retrySet) {
    eligibleVideos = eligibleVideos.filter((v) => retrySet.has(v.blake3 as string));
  }
  progress.totalVideos = eligibleVideos.length;
  const skippedNoHashVideos = retrySet ? 0 : videos.length - eligibleVideos.length;
  if (skippedNoHashVideos > 0) {
    progress.skippedVideos += skippedNoHashVideos;
    progress.errors.push(`${skippedNoHashVideos} video(s) skipped — no blake3 available`);
    warn(TAG, `${lp} ${skippedNoHashVideos} of ${videos.length} videos skipped (no blake3)`);
    emit();
  }
  info(TAG, `${lp} eligible videos: ${eligibleVideos.length}`);

  // refresh every eligible song's images directly from the source backend
  // before sending anything - whatever cache fed `songs` originally isn't
  // guaranteed to reflect images added after the song was first loaded
  // (e.g. a waveform generated well after import, or artist photos that
  // were never fetched at all by this view). goes through the same
  // Remote -> Transport abstraction as every other call in this file, so
  // it works regardless of what source/dest actually are underneath.
  // only `images`/`album_images`/`artist_images` are overwritten - other
  // song fields (e.g. `opfs_path`, local-only) are left untouched.
  if (eligibleSongs.length > 0) {
    try {
      const sourceDataSource = new RemoteMusicDataSource(source);
      const fresh = await sourceDataSource.getSongsByIds(eligibleSongs.map((s) => s.id));
      const freshById = new Map(fresh.map((s) => [s.id, s]));
      eligibleSongs = eligibleSongs.map((s) => {
        const freshSong = freshById.get(s.id);
        if (!freshSong) return s;
        return {
          ...s,
          images: freshSong.images,
          album_images: freshSong.album_images,
          artist_images: freshSong.artist_images,
        };
      });
      info(
        TAG,
        `${lp} refreshed images for ${freshById.size}/${eligibleSongs.length} song(s) from source`
      );
    } catch (e) {
      warn(
        TAG,
        `${lp} failed to refresh song images from source, using cached copies: ${String(e)}`
      );
    }
  }

  // shared per-send cache: source-image bytes are fetched once and reused
  // across album / song / playlist uploads. dramatically cuts redundant
  // source-bandwidth when embedded artwork is repeated across N tracks.
  const imageCache = createImageBlobCache();
  // separate cache for the newer blake3-ref inline path (song/album images
  // riding in the sync request itself) - keyed/shaped differently than
  // `imageCache` above, which backs the older post-hoc artist-image upload.
  const inlineImageCache: InlineImageCache = new Map();

  // artist images are keyed by dest artist_id, not by song/album - the same
  // artist usually shows up across many songs (and the album itself), so
  // this avoids re-uploading the same photo once per song.
  const uploadedArtistIds = new Set<string>();

  // optional pre-check: ask dest which blobs it already has.
  let alreadyPresent: Set<string> = new Set();
  if (skipExisting && eligibleSongs.length > 0) {
    const blake3s = eligibleSongs.map((s) => s.blake3 as string);
    debug(TAG, `${lp} POST /api/blobz/has (${blake3s.length} hashes)`);
    alreadyPresent = await checkBlobsPresentOnDest(destTransport, blake3s, TAG, lp);
    info(TAG, `${lp} dest already has ${alreadyPresent.size}/${blake3s.length} blobs`);
  }

  // ---- ALBUM envelope + images ----
  let destArtistIdFromAlbum: string | null = null;
  if (payload.kind === "album" && !retrySet) {
    progress.phase = "syncing-album";
    emit();

    const expected = eligibleSongs.map((s) => s.blake3 as string);
    const albumOpts: BuildSyncAlbumOptions = {
      remoteName,
      sourceRemoteId,
      sourceNodeId,
      albumId: payload.albumId,
      title: payload.title,
      artistName: payload.artistName,
      albumType: payload.albumType,
      releaseDate: payload.releaseDate,
      label: payload.label,
      genres: payload.genres,
      expectedSongBlake3s: expected,
      images: payload.images,
      sourceTransport,
      imageCache: inlineImageCache,
    };
    const albumReq: SyncAlbumRequest = await buildSyncAlbumRequest(albumOpts);

    info(
      TAG,
      `${lp} POST /api/sync/album title="${payload.title}" artist="${payload.artistName}" expected_songs=${expected.length}`
    );
    try {
      const resp = await destTransport.request("POST", "/api/sync/album", JSON.stringify(albumReq));
      debug(TAG, `${lp} /api/sync/album -> http ${resp.status}`);
      const data = unwrapEnvelope<SyncAlbumResponse>("sync_album", resp.body, resp.status, (v) =>
        SyncAlbumResponseSchema.safeParse(v)
      );
      destArtistIdFromAlbum = data.artist_id;
      info(
        TAG,
        `${lp} sync_album ok: album_id=${data.album_id} artist_id=${data.artist_id} existing=${data.existing}`
      );
    } catch (e) {
      progress.phase = "failed";
      progress.errors.unshift(`sync_album failed: ${String(e)}`);
      emit();
      logError(TAG, `${lp} sync_album failed: ${String(e)}`);
      throw new SendToRemoteError(`sync_album failed: ${String(e)}`, progress);
    }

    // album images now ride inline in the sync/album request itself (see
    // buildSyncAlbumRequest) - no post-hoc upload needed.

    // upload artist images too, keyed off the artist_id sync_album already
    // resolved/created - representative artist images come from the first
    // eligible song (all songs on an album share the same primary artist).
    const albumArtistId = destArtistIdFromAlbum;
    const albumArtistImages = eligibleSongs[0]?.artist_images;
    if (
      albumArtistId &&
      !uploadedArtistIds.has(albumArtistId) &&
      albumArtistImages &&
      albumArtistImages.length > 0
    ) {
      uploadedArtistIds.add(albumArtistId);
      await uploadImagesToDest({
        sourceTransport,
        destTransport,
        entityType: "artist",
        entityId: albumArtistId,
        images: albumArtistImages,
        logPrefix: lp,
        imageCache,
        destRemote: dest,
      }).catch((e) => {
        warn(TAG, `${lp} artist image upload threw: ${String(e)}`);
        return { attempted: 0, uploaded: 0, skipped: 0, failed: 0 };
      });
    }
  }

  // collect album-image source blob_ids so per-song image uploads can skip
  // them: embedded artwork extracted from audio tags is normally tagged on
  // BOTH the album and every song that came from the album, leading to N+1
  // duplicate uploads of the same JPEG. one upload at the album level is
  // canonical; per-song associations of the same blob are noise.
  const albumImageBlobIds = new Set<string>();
  if (payload.kind === "album") {
    for (const img of payload.images ?? []) {
      if (img.remote_blob_id) albumImageBlobIds.add(img.remote_blob_id);
    }
  }

  // ---- SONGS (shared by album + playlist + standalone song) ----
  progress.phase = "syncing-songs";
  emit();

  info(TAG, `${lp} song phase: ${eligibleSongs.length} song(s), concurrency=${concurrency}`);

  // when the payload is an album, propagate the album_type so the server's
  // per-song find_or_create_album_for_artist call doesn't auto-flip the
  // existing album_type back to "album" (clobbering a compilation set by
  // sync_album).
  const songIsCompilation = payload.kind === "album" && payload.albumType === "compilation";

  // for album / playlist payloads we ALWAYS call sync_song_by_blake3 even
  // when the dest already has the blob: the server's blake3 shortcut is
  // cheap (no blob pull), and it now reconciles artist/album/genre
  // junctions. skipping these calls would leave previously-imported songs
  // orphaned from the freshly-created dest album (the classic "missing
  // last song" symptom on partial-album sync).
  const reconcileEvenIfPresent = payload.kind === "album" || payload.kind === "playlist";

  await runWithConcurrency(eligibleSongs, concurrency, async (song) => {
    const blake3 = song.blake3 as string;
    const shortHash = blake3.slice(0, 16);

    if (alreadyPresent.has(blake3) && !reconcileEvenIfPresent) {
      progress.syncedSongs += 1;
      progress.syncedBlake3s.push(blake3);
      info(TAG, `${lp} song "${song.title}" (${shortHash}) already on dest, skipping pull`);
      emit();
      return;
    }
    const blobAlready = alreadyPresent.has(blake3);

    // stage this song's bytes with our own midden node before asking dest
    // to pull them - grimoire's pull path (pull_audio_blob_to_local_
    // storage_with_progress) tries a direct iroh-blobs fetch first, then
    // falls back to a grimoire-only EnsureBlobRequest federation message a
    // plain browser can never answer. without this, a song whose blake3
    // was never registered with this node (e.g. registerBlake3 failed at
    // import time, or this song was synced-to-local from elsewhere and
    // never itself re-registered) fails outright with no fallback. no-op
    // when there's nothing local to stage (song.opfs_path null - the song
    // came from a genuinely different remote, not this device) or when
    // already staged this session. see
    // docs/blob-transfer-opfs-and-sha256-refactor-plan.md phase 6.
    if (song.opfs_path) {
      await ensureBlobServable(blake3, () => readAudioFromOPFS(song.opfs_path!)).catch(() => {});
    }

    const req: SyncSongByBlake3Request | null = await buildSyncSongByBlake3Request({
      remoteName,
      sourceRemoteId,
      sourceNodeId,
      song,
      isCompilation: songIsCompilation,
      sourceTransport,
      imageCache: inlineImageCache,
    });
    if (!req) {
      progress.skippedSongs += 1;
      progress.errors.push(`skipped ${song.title} — no blake3/sha256`);
      warn(
        TAG,
        `${lp} skipping "${song.title}" — no blake3/sha256 (shouldn't happen after filter)`
      );
      emit();
      return;
    }

    let destArtistId: string | null = null;
    try {
      info(
        TAG,
        `${lp} POST /api/sync/song-by-blake3 "${song.title}" blake3=${blake3} sha256=${(song.sha256 as string).slice(0, 16)} size=${song.file_size ?? "?"} source_node_id=${sourceNodeId} source_remote=${sourceRemoteId}${blobAlready ? " (blob already on dest, reconciling links)" : ""}`
      );
      const resp = await destTransport.request(
        "POST",
        "/api/sync/song-by-blake3",
        JSON.stringify(req)
      );
      debug(TAG, `${lp} /api/sync/song-by-blake3 -> http ${resp.status}`);
      // dest enqueues a background job and returns immediately (see
      // SyncJobQueuedResponse's doc comment) - song/album images ride
      // inline in `req` itself, resolved by the job unattended. artist_id
      // IS still available synchronously though (resolved/created before
      // the job was even enqueued), so artist images can upload right away.
      const data = unwrapEnvelope<SyncJobQueuedResponse>(
        "sync_song_by_blake3",
        resp.body,
        resp.status,
        (v) => SyncJobQueuedResponseSchema.safeParse(v)
      );
      destArtistId = data.artist_id ?? null;
      info(TAG, `${lp} sync_song queued: "${song.title}" job_id=${data.job_id}`);
      // the dest only QUEUES the job here - audio hasn't actually moved
      // yet. await its real completion (same JobPoller/waitForJobResult
      // machinery syncSongToLocal.ts uses, not a new polling loop) before
      // counting this song as synced - previously this counted it
      // "synced" the instant it was merely queued, which is why send
      // progress jumped to 100% almost immediately regardless of how
      // long the actual dest-side pull+import took.
      const polled = await waitForJobResult(dest, data.job_id, SYNC_JOB_TIMEOUT_MS);
      if (polled.status !== "completed") {
        throw new Error(`dest sync job did not complete: ${polled.errorMessage ?? polled.status}`);
      }
      progress.syncedSongs += 1;
      progress.syncedBlake3s.push(blake3);
    } catch (e) {
      progress.failedSongs += 1;
      progress.failedBlake3s.push(blake3);
      const et = e instanceof EnvelopeError ? e.errorType : undefined;
      if (et === "peer_unauthorized") {
        progress.errors.unshift(peerUnauthorizedMessage(source, dest));
        logError(
          TAG,
          `${lp} song sync blocked by peer_unauthorized for "${song.title}" (${shortHash}); knock sent by dest.`
        );
      } else {
        progress.errors.unshift(`sync_song_by_blake3 failed for ${song.title}: ${String(e)}`);
        logError(TAG, `${lp} song sync failed for "${song.title}" (${shortHash}): ${String(e)}`);
      }
    } finally {
      emit();
    }

    // song/album images now ride inline in the sync request itself (see
    // buildSyncSongByBlake3Request) - no post-hoc upload needed.

    // upload this song's artist images too, keyed off the dest artist_id
    // (resolved synchronously before the sync job was even enqueued - see
    // song.rs's sync_song_by_blake3) - deduped per run since many songs
    // (and the album itself) typically share one artist.
    if (
      destArtistId &&
      !uploadedArtistIds.has(destArtistId) &&
      song.artist_images &&
      song.artist_images.length > 0
    ) {
      uploadedArtistIds.add(destArtistId);
      await uploadImagesToDest({
        sourceTransport,
        destTransport,
        entityType: "artist",
        entityId: destArtistId,
        images: song.artist_images,
        logPrefix: `${lp} "${song.title}"`,
        imageCache,
        destRemote: dest,
      }).catch((e) => {
        warn(TAG, `${lp} artist image upload threw for "${song.title}": ${String(e)}`);
        return { attempted: 0, uploaded: 0, skipped: 0, failed: 0 };
      });
    }
  });

  // sync each video (playlist sends only) - mirrors the song loop above
  // but simpler: videos carry their own images inline already (see
  // buildSyncVideoByBlake3Body), no separate album/artist-image dance.
  await runWithConcurrency(eligibleVideos, concurrency, async (video) => {
    const blake3 = video.blake3 as string;
    const shortHash = blake3.slice(0, 16);
    try {
      const body = await buildSyncVideoByBlake3Body({
        video: { ...video, queue_entry_id: video.id },
        metadataRemote: source,
        sourceTransport,
        blake3,
        size: null,
        filename: video.title || video.id,
        sourceNodeId,
        sourceRemoteId,
        remoteName,
      });
      info(TAG, `${lp} POST /api/sync/video-by-blake3 "${video.title}" blake3=${shortHash}`);
      const resp = await destTransport.request(
        "POST",
        "/api/sync/video-by-blake3",
        JSON.stringify(body)
      );
      debug(TAG, `${lp} /api/sync/video-by-blake3 -> http ${resp.status}`);
      const data = unwrapEnvelope<SyncJobQueuedResponse>(
        "sync_video_by_blake3",
        resp.body,
        resp.status,
        (v) => SyncJobQueuedResponseSchema.safeParse(v)
      );
      info(TAG, `${lp} sync_video queued: "${video.title}" job_id=${data.job_id}`);
      // see the song loop above's identical fix - await real completion
      // before counting this video as synced.
      const polled = await waitForJobResult(dest, data.job_id, SYNC_JOB_TIMEOUT_MS);
      if (polled.status !== "completed") {
        throw new Error(`dest sync job did not complete: ${polled.errorMessage ?? polled.status}`);
      }
      progress.syncedVideos += 1;
      progress.syncedVideoBlake3s.push(blake3);
    } catch (e) {
      progress.failedVideos += 1;
      progress.failedVideoBlake3s.push(blake3);
      progress.errors.unshift(`sync_video_by_blake3 failed for ${video.title}: ${String(e)}`);
      logError(TAG, `${lp} video sync failed for "${video.title}" (${shortHash}): ${String(e)}`);
    } finally {
      emit();
    }
  });

  // ---- PLAYLIST envelope + images ----
  if (payload.kind === "playlist" && !retrySet) {
    progress.phase = "syncing-playlist";
    emit();

    // the playlist's TRUE member order (one shared position space across
    // song+video) - falls back to song-only order for a caller that hasn't
    // been updated to supply `memberOrder` yet.
    const members: Array<{ kind: "song" | "video"; blake3: string }> =
      payload.memberOrder ??
      songs
        .map((s) => ({ kind: "song" as const, blake3: s.blake3 as string }))
        .filter((m) => !!m.blake3);

    const playlistOpts: BuildSyncPlaylistOptions = {
      remoteName,
      sourceRemoteId,
      sourceNodeId,
      playlistId: payload.playlistId,
      title: payload.title,
      description: payload.description,
      images: payload.images,
      members,
      sourceTransport,
      imageCache: inlineImageCache,
    };
    const playlistReq: SyncPlaylistRequest = await buildSyncPlaylistRequest(playlistOpts);

    info(
      TAG,
      `${lp} POST /api/sync/playlist title="${payload.title}" members=${playlistOpts.members.length}`
    );
    try {
      const resp = await destTransport.request(
        "POST",
        "/api/sync/playlist",
        JSON.stringify(playlistReq)
      );
      debug(TAG, `${lp} /api/sync/playlist -> http ${resp.status}`);
      const data = unwrapEnvelope<SyncPlaylistResponse>(
        "sync_playlist",
        resp.body,
        resp.status,
        (v) => SyncPlaylistResponseSchema.safeParse(v)
      );
      info(
        TAG,
        `${lp} sync_playlist ok: playlist_id=${data.playlist_id} members_added=${data.members_added} stubs=${data.song_stubs_created} missing=${data.missing_member_blake3s.length}`
      );
      if (data.missing_member_blake3s.length > 0) {
        const head = data.missing_member_blake3s
          .slice(0, 3)
          .map((h) => h.slice(0, 8))
          .join(",");
        const tail = data.missing_member_blake3s.length > 3 ? "..." : "";
        warn(
          TAG,
          `${lp} playlist missing ${data.missing_member_blake3s.length} member(s) on dest: ${head}${tail}`
        );
      }
    } catch (e) {
      progress.phase = "failed";
      progress.errors.unshift(`sync_playlist failed: ${String(e)}`);
      emit();
      logError(TAG, `${lp} sync_playlist failed: ${String(e)}`);
      throw new SendToRemoteError(`sync_playlist failed: ${String(e)}`, progress);
    }

    // playlist images now ride inline in the sync request itself (see
    // buildSyncPlaylistRequest) - no post-hoc upload needed.
  }

  // ---- VERIFY pass (single retry, never loops) ----
  //
  // after the song-phase loop completes, ask dest one more time which
  // blake3s actually landed. anything in `eligibleSongs` that's still
  // missing gets ONE more sync_song_by_blake3 attempt (sequentially, low
  // concurrency to avoid thrash). this catches songs that were lost to
  // transient network errors or partial-failure races without requiring
  // the user to spot the gap and hit "retry failed".
  //
  // explicit single-pass: we never re-verify after retries, so an
  // infinite loop is impossible by construction.
  if (!retrySet && eligibleSongs.length > 0) {
    progress.phase = "verifying";
    emit();
    try {
      const allBlake3s = eligibleSongs.map((s) => s.blake3 as string);
      debug(TAG, `${lp} verify: POST /api/blobz/has (${allBlake3s.length} hashes)`);
      const resp = await destTransport.request(
        "POST",
        "/api/blobz/has",
        JSON.stringify({ blake3s: allBlake3s })
      );
      if (resp.status >= 200 && resp.status < 300) {
        const rawJson = JSON.parse(resp.body) as { data?: unknown };
        const inner = rawJson?.data ?? rawJson;
        const parsed = HasBlobsResponseSchema.safeParse(inner);
        if (parsed.success) {
          const present = new Set(parsed.data.blake3s_present);
          const missing = eligibleSongs.filter((s) => !present.has(s.blake3 as string));
          if (missing.length === 0) {
            info(TAG, `${lp} verify: all ${allBlake3s.length} song(s) present on dest`);
          } else {
            warn(
              TAG,
              `${lp} verify: ${missing.length}/${allBlake3s.length} song(s) missing on dest, attempting one resync pass`
            );
            // sequential, no concurrency — these are stragglers, prefer
            // gentle pressure over speed.
            for (const song of missing) {
              const blake3 = song.blake3 as string;
              const shortHash = blake3.slice(0, 16);
              // same eager staging as the main song loop above - a song
              // that's missing specifically because it was never
              // registered with our own midden node gets exactly one more
              // chance to register before this retry.
              if (song.opfs_path) {
                await ensureBlobServable(blake3, () => readAudioFromOPFS(song.opfs_path!)).catch(
                  () => {}
                );
              }
              const req: SyncSongByBlake3Request | null = await buildSyncSongByBlake3Request({
                remoteName,
                sourceRemoteId,
                sourceNodeId,
                song,
                isCompilation: songIsCompilation,
                sourceTransport,
                imageCache: inlineImageCache,
              });
              if (!req) continue;
              try {
                info(TAG, `${lp} verify: resync "${song.title}" (${shortHash})`);
                const r = await destTransport.request(
                  "POST",
                  "/api/sync/song-by-blake3",
                  JSON.stringify(req)
                );
                const data = unwrapEnvelope<SyncJobQueuedResponse>(
                  "sync_song_by_blake3 (verify)",
                  r.body,
                  r.status,
                  (v) => SyncJobQueuedResponseSchema.safeParse(v)
                );
                // same real-completion wait as the main song loop above,
                // before treating this straggler as recovered.
                const polled = await waitForJobResult(dest, data.job_id, SYNC_JOB_TIMEOUT_MS);
                if (polled.status !== "completed") {
                  throw new Error(
                    `dest sync job did not complete: ${polled.errorMessage ?? polled.status}`
                  );
                }
                // recover: drop from failed counters / lists if previously
                // recorded as failed; bump synced if not already counted.
                if (!progress.syncedBlake3s.includes(blake3)) {
                  progress.syncedSongs += 1;
                  progress.syncedBlake3s.push(blake3);
                }
                const failedIdx = progress.failedBlake3s.indexOf(blake3);
                if (failedIdx >= 0) {
                  progress.failedBlake3s.splice(failedIdx, 1);
                  progress.failedSongs = Math.max(0, progress.failedSongs - 1);
                }
                info(TAG, `${lp} verify: recovered "${song.title}" job_id=${data.job_id}`);
                emit();
              } catch (e) {
                warn(
                  TAG,
                  `${lp} verify: resync failed for "${song.title}" (${shortHash}): ${String(e)}`
                );
                if (!progress.failedBlake3s.includes(blake3)) {
                  progress.failedBlake3s.push(blake3);
                  progress.failedSongs += 1;
                }
                progress.errors.unshift(`verify resync failed for ${song.title}: ${String(e)}`);
                emit();
              }
            }
          }
        } else {
          warn(TAG, `${lp} verify: /api/blobz/has returned invalid shape: ${parsed.error.message}`);
        }
      } else {
        warn(TAG, `${lp} verify: /api/blobz/has -> http ${resp.status}`);
      }
    } catch (e) {
      warn(TAG, `${lp} verify pass failed: ${String(e)}`);
    }
  }

  progress.phase = "done";
  emit();
  info(
    TAG,
    `${lp} done: synced=${progress.syncedSongs} failed=${progress.failedSongs} skipped=${progress.skippedSongs}`
  );
  return progress;
}

// simple worker-pool helper. processes `items` with up to `limit` in flight.
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const runners: Promise<void>[] = [];
  const total = items.length;
  for (let i = 0; i < Math.min(limit, total); i++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = nextIndex++;
          if (idx >= total) return;
          await worker(items[idx]);
        }
      })()
    );
  }
  await Promise.all(runners);
}

// re-export for downstream consumers.
export type { Transport };
