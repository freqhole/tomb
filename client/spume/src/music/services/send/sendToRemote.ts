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

import { schema } from "freqhole-api-client";
import type {
  SyncAlbumRequest,
  SyncAlbumResponse,
  SyncPlaylistRequest,
  SyncPlaylistResponse,
  SyncSongByBlake3Request,
  SyncSongByBlake3Response,
  Transport,
} from "freqhole-api-client";
const {
  HasBlobsResponseSchema,
  SyncAlbumResponseSchema,
  SyncPlaylistResponseSchema,
  SyncSongByBlake3ResponseSchema,
} = schema;
import {
  getTransportForRemote,
  isP2PTransportType,
} from "../../../app/api/client";
import { extractNodeIdStrict } from "../../../app/services/remotes/peerAddr";
import { getLocalNodeId } from "../../../app/services/charnel";
import {
  isP2PRemote,
  type Remote,
} from "../../../app/services/storage/schemas/remote";
import { debug, info, warn, error as logError } from "../../../utils/logger";
import type { RemoteSong } from "../../data/remote/adapters";
import type { ImageMetadata } from "../storage/types";
import {
  buildSyncAlbumRequest,
  buildSyncPlaylistRequest,
  buildSyncSongByBlake3Request,
  type BuildSyncAlbumOptions,
  type BuildSyncPlaylistOptions,
} from "./buildSyncRequests";
import { uploadImagesToDest, createImageBlobCache } from "./uploadImagesToDest";

const TAG = "sendToRemote";

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
    public readonly progress: SendProgress,
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
class EnvelopeError extends Error {
  readonly errorType?: string;
  readonly title?: string;
  readonly detail?: string;
  constructor(
    message: string,
    opts?: { errorType?: string; title?: string; detail?: string },
  ) {
    super(message);
    this.name = "EnvelopeError";
    this.errorType = opts?.errorType;
    this.title = opts?.title;
    this.detail = opts?.detail;
  }
}

function unwrapEnvelope<T>(
  label: string,
  body: string,
  status: number,
  parse: (v: unknown) => { success: true; data: T } | { success: false; error: { message: string } },
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
    const first = raw.errors?.[0];
    const detail = first?.detail ?? raw.message ?? "server reported failure";
    throw new EnvelopeError(`${label}: ${detail}`, {
      errorType: first?.error_type,
      title: first?.title,
      detail: first?.detail,
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
  opts: SendOptions = {},
): Promise<SendProgress> {
  const sendId = newSendId();
  const lp = `[send:${sendId}]`;
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const skipExisting = opts.skipExisting ?? true;
  const retrySet = opts.retryBlake3s ? new Set(opts.retryBlake3s) : null;

  info(
    TAG,
    `${lp} start: kind=${payload.kind} source=${source.remote_id}(${source.name ?? "?"}) dest=${dest.remote_id}(${dest.name ?? "?"}) concurrency=${concurrency} skipExisting=${skipExisting} retry=${retrySet ? retrySet.size : 0}`,
  );

  const songs =
    payload.kind === "song" ? [payload.song] : payload.songs;
  const progress: SendProgress = {
    phase: "preparing",
    totalSongs: songs.length,
    syncedSongs: 0,
    skippedSongs: 0,
    failedSongs: 0,
    errors: [],
    syncedBlake3s: [],
    failedBlake3s: [],
  };
  const emit = () => opts.onProgress?.({ ...progress });
  emit();

  // validate transports + node id up front.
  const destOk = isP2PTransportType(dest) || dest.is_charnel_managed === true;
  if (!destOk) {
    logError(
      TAG,
      `${lp} invalid dest transport: dest=${dest.remote_id} is_charnel=${dest.is_charnel_managed}`,
    );
    throw new SendToRemoteError(
      "destination must be a p2p remote or the local charnel app",
      progress,
    );
  }
  let sourceNodeId: string | null = null;
  if (isP2PRemote(source)) {
    sourceNodeId = extractNodeIdStrict(source.peer_addr);
  }
  if (!sourceNodeId && source.is_charnel_managed) {
    sourceNodeId = getLocalNodeId();
  }
  if (!sourceNodeId) {
    logError(
      TAG,
      `${lp} no source node id: source=${source.remote_id} is_charnel=${source.is_charnel_managed} is_p2p=${isP2PRemote(source)}`,
    );
    throw new SendToRemoteError(
      "source remote has no usable iroh node id",
      progress,
    );
  }
  info(
    TAG,
    `${lp} source_node_id=${sourceNodeId} (full, 64-hex)`,
  );
  info(
    TAG,
    `${lp} source.peer_addr=${isP2PRemote(source) ? source.peer_addr : "(not p2p)"} source.is_charnel_managed=${source.is_charnel_managed} source.name=${source.name}`,
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
    progress.errors.push(
      `${skippedNoHash} song(s) skipped — no blake3/sha256 available`,
    );
    warn(
      TAG,
      `${lp} ${skippedNoHash} of ${songs.length} songs skipped (no blake3/sha256)`,
    );
    emit();
  }
  info(TAG, `${lp} eligible songs: ${eligibleSongs.length}`);

  // shared per-send cache: source-image bytes are fetched once and reused
  // across album / song / playlist uploads. dramatically cuts redundant
  // source-bandwidth when embedded artwork is repeated across N tracks.
  const imageCache = createImageBlobCache();

  // optional pre-check: ask dest which blobs it already has.
  let alreadyPresent: Set<string> = new Set();
  if (skipExisting && eligibleSongs.length > 0) {
    try {
      const blake3s = eligibleSongs.map((s) => s.blake3 as string);
      debug(TAG, `${lp} POST /api/blobz/has (${blake3s.length} hashes)`);
      const resp = await destTransport.request(
        "POST",
        "/api/blobz/has",
        JSON.stringify({ blake3s }),
      );
      debug(TAG, `${lp} /api/blobz/has -> http ${resp.status}`);
      if (resp.status >= 200 && resp.status < 300) {
        const rawJson = JSON.parse(resp.body) as { data?: unknown };
        const inner = rawJson?.data ?? rawJson;
        const parsed = HasBlobsResponseSchema.safeParse(inner);
        if (parsed.success) {
          alreadyPresent = new Set(parsed.data.blake3s_present);
          info(
            TAG,
            `${lp} dest already has ${alreadyPresent.size}/${blake3s.length} blobs`,
          );
        } else {
          warn(
            TAG,
            `${lp} /api/blobz/has returned invalid shape: ${parsed.error.message}`,
          );
        }
      }
    } catch (e) {
      warn(TAG, `${lp} /api/blobz/has pre-check failed: ${String(e)}`);
    }
  }

  // ---- ALBUM envelope + images ----
  let destAlbumId: string | null = null;
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
    };
    const albumReq: SyncAlbumRequest = buildSyncAlbumRequest(albumOpts);

    info(
      TAG,
      `${lp} POST /api/sync/album title="${payload.title}" artist="${payload.artistName}" expected_songs=${expected.length}`,
    );
    try {
      const resp = await destTransport.request(
        "POST",
        "/api/sync/album",
        JSON.stringify(albumReq),
      );
      debug(TAG, `${lp} /api/sync/album -> http ${resp.status}`);
      const data = unwrapEnvelope<SyncAlbumResponse>(
        "sync_album",
        resp.body,
        resp.status,
        (v) => SyncAlbumResponseSchema.safeParse(v),
      );
      destAlbumId = data.album_id;
      info(
        TAG,
        `${lp} sync_album ok: album_id=${data.album_id} artist_id=${data.artist_id} existing=${data.existing}`,
      );
    } catch (e) {
      progress.phase = "failed";
      progress.errors.unshift(`sync_album failed: ${String(e)}`);
      emit();
      logError(TAG, `${lp} sync_album failed: ${String(e)}`);
      throw new SendToRemoteError(`sync_album failed: ${String(e)}`, progress);
    }

    // upload album images now that we know the dest album id.
    if (destAlbumId && payload.images && payload.images.length > 0) {
      await uploadImagesToDest({
        sourceTransport,
        destTransport,
        entityType: "album",
        entityId: destAlbumId,
        images: payload.images,
        logPrefix: lp,
        imageCache,
        destRemote: dest,
      }).catch((e) => {
        warn(TAG, `${lp} album image upload threw: ${String(e)}`);
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

  info(
    TAG,
    `${lp} song phase: ${eligibleSongs.length} song(s), concurrency=${concurrency}`,
  );

  // when the payload is an album, propagate the album_type so the server's
  // per-song find_or_create_album_for_artist call doesn't auto-flip the
  // existing album_type back to "album" (clobbering a compilation set by
  // sync_album).
  const songIsCompilation =
    payload.kind === "album" && payload.albumType === "compilation";

  // for album / playlist payloads we ALWAYS call sync_song_by_blake3 even
  // when the dest already has the blob: the server's blake3 shortcut is
  // cheap (no blob pull), and it now reconciles artist/album/genre
  // junctions. skipping these calls would leave previously-imported songs
  // orphaned from the freshly-created dest album (the classic "missing
  // last song" symptom on partial-album sync).
  const reconcileEvenIfPresent =
    payload.kind === "album" || payload.kind === "playlist";

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

    const req: SyncSongByBlake3Request | null = buildSyncSongByBlake3Request({
      remoteName,
      sourceRemoteId,
      sourceNodeId,
      song,
      isCompilation: songIsCompilation,
    });
    if (!req) {
      progress.skippedSongs += 1;
      progress.errors.push(`skipped ${song.title} — no blake3/sha256`);
      warn(
        TAG,
        `${lp} skipping "${song.title}" — no blake3/sha256 (shouldn't happen after filter)`,
      );
      emit();
      return;
    }

    let destSongId: string | null = null;
    try {
      info(
        TAG,
        `${lp} POST /api/sync/song-by-blake3 "${song.title}" blake3=${blake3} sha256=${(song.sha256 as string).slice(0, 16)} size=${song.file_size ?? "?"} source_node_id=${sourceNodeId} source_remote=${sourceRemoteId}${blobAlready ? " (blob already on dest, reconciling links)" : ""}`,
      );
      const resp = await destTransport.request(
        "POST",
        "/api/sync/song-by-blake3",
        JSON.stringify(req),
      );
      debug(TAG, `${lp} /api/sync/song-by-blake3 -> http ${resp.status}`);
      const data = unwrapEnvelope<SyncSongByBlake3Response>(
        "sync_song_by_blake3",
        resp.body,
        resp.status,
        (v) => SyncSongByBlake3ResponseSchema.safeParse(v),
      );
      destSongId = data.song_id;
      progress.syncedSongs += 1;
      progress.syncedBlake3s.push(blake3);
      info(
        TAG,
        `${lp} sync_song ok: "${song.title}" song_id=${data.song_id} blob_id=${data.media_blob_id} existing=${data.existing}`,
      );
    } catch (e) {
      progress.failedSongs += 1;
      progress.failedBlake3s.push(blake3);
      const et = e instanceof EnvelopeError ? e.errorType : undefined;
      if (et === "peer_unauthorized") {
        progress.errors.unshift(
          `access required: ${source.name ?? "source"} has not authorized ${dest.name ?? "dest"} — an access request was sent automatically. accept it on ${source.name ?? "the source"}, then retry the send.`,
        );
        logError(
          TAG,
          `${lp} song sync blocked by peer_unauthorized for "${song.title}" (${shortHash}); knock sent by dest.`,
        );
      } else {
        progress.errors.unshift(
          `sync_song_by_blake3 failed for ${song.title}: ${String(e)}`,
        );
        logError(
          TAG,
          `${lp} song sync failed for "${song.title}" (${shortHash}): ${String(e)}`,
        );
      }
    } finally {
      emit();
    }

    // upload song images now that we have the dest song id.
    // skip any song image whose source blob_id is already covered by the
    // album cover (avoids N copies of embedded artwork on the dest).
    if (destSongId && song.images && song.images.length > 0) {
      await uploadImagesToDest({
        sourceTransport,
        destTransport,
        entityType: "song",
        entityId: destSongId,
        images: song.images,
        logPrefix: `${lp} "${song.title}"`,
        imageCache,
        skipBlobIds: albumImageBlobIds,
        destRemote: dest,
      }).catch((e) => {
        warn(TAG, `${lp} song image upload threw for "${song.title}": ${String(e)}`);
        return { attempted: 0, uploaded: 0, skipped: 0, failed: 0 };
      });
    }
  });

  // ---- PLAYLIST envelope + images ----
  let destPlaylistId: string | null = null;
  if (payload.kind === "playlist" && !retrySet) {
    progress.phase = "syncing-playlist";
    emit();

    const playlistOpts: BuildSyncPlaylistOptions = {
      remoteName,
      sourceRemoteId,
      sourceNodeId,
      playlistId: payload.playlistId,
      title: payload.title,
      description: payload.description,
      songBlake3s: songs
        .map((s) => s.blake3)
        .filter((b): b is string => !!b),
    };
    const playlistReq: SyncPlaylistRequest = buildSyncPlaylistRequest(playlistOpts);

    info(
      TAG,
      `${lp} POST /api/sync/playlist title="${payload.title}" songs=${playlistOpts.songBlake3s.length}`,
    );
    try {
      const resp = await destTransport.request(
        "POST",
        "/api/sync/playlist",
        JSON.stringify(playlistReq),
      );
      debug(TAG, `${lp} /api/sync/playlist -> http ${resp.status}`);
      const data = unwrapEnvelope<SyncPlaylistResponse>(
        "sync_playlist",
        resp.body,
        resp.status,
        (v) => SyncPlaylistResponseSchema.safeParse(v),
      );
      destPlaylistId = data.playlist_id;
      info(
        TAG,
        `${lp} sync_playlist ok: playlist_id=${data.playlist_id} songs_added=${data.songs_added} stubs=${data.song_stubs_created} missing=${data.missing_song_blake3s.length}`,
      );
      if (data.missing_song_blake3s.length > 0) {
        const head = data.missing_song_blake3s
          .slice(0, 3)
          .map((h) => h.slice(0, 8))
          .join(",");
        const tail = data.missing_song_blake3s.length > 3 ? "..." : "";
        warn(
          TAG,
          `${lp} playlist missing ${data.missing_song_blake3s.length} song(s) on dest: ${head}${tail}`,
        );
      }
    } catch (e) {
      progress.phase = "failed";
      progress.errors.unshift(`sync_playlist failed: ${String(e)}`);
      emit();
      logError(TAG, `${lp} sync_playlist failed: ${String(e)}`);
      throw new SendToRemoteError(
        `sync_playlist failed: ${String(e)}`,
        progress,
      );
    }

    if (destPlaylistId && payload.images && payload.images.length > 0) {
      await uploadImagesToDest({
        sourceTransport,
        destTransport,
        entityType: "playlist",
        entityId: destPlaylistId,
        images: payload.images,
        logPrefix: lp,
        imageCache,
        destRemote: dest,
      }).catch((e) => {
        warn(TAG, `${lp} playlist image upload threw: ${String(e)}`);
        return { attempted: 0, uploaded: 0, skipped: 0, failed: 0 };
      });
    }
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
        JSON.stringify({ blake3s: allBlake3s }),
      );
      if (resp.status >= 200 && resp.status < 300) {
        const rawJson = JSON.parse(resp.body) as { data?: unknown };
        const inner = rawJson?.data ?? rawJson;
        const parsed = HasBlobsResponseSchema.safeParse(inner);
        if (parsed.success) {
          const present = new Set(parsed.data.blake3s_present);
          const missing = eligibleSongs.filter(
            (s) => !present.has(s.blake3 as string),
          );
          if (missing.length === 0) {
            info(TAG, `${lp} verify: all ${allBlake3s.length} song(s) present on dest`);
          } else {
            warn(
              TAG,
              `${lp} verify: ${missing.length}/${allBlake3s.length} song(s) missing on dest, attempting one resync pass`,
            );
            // sequential, no concurrency — these are stragglers, prefer
            // gentle pressure over speed.
            for (const song of missing) {
              const blake3 = song.blake3 as string;
              const shortHash = blake3.slice(0, 16);
              const req: SyncSongByBlake3Request | null =
                buildSyncSongByBlake3Request({
                  remoteName,
                  sourceRemoteId,
                  sourceNodeId,
                  song,
                  isCompilation: songIsCompilation,
                });
              if (!req) continue;
              try {
                info(
                  TAG,
                  `${lp} verify: resync "${song.title}" (${shortHash})`,
                );
                const r = await destTransport.request(
                  "POST",
                  "/api/sync/song-by-blake3",
                  JSON.stringify(req),
                );
                const data = unwrapEnvelope<SyncSongByBlake3Response>(
                  "sync_song_by_blake3 (verify)",
                  r.body,
                  r.status,
                  (v) => SyncSongByBlake3ResponseSchema.safeParse(v),
                );
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
                info(
                  TAG,
                  `${lp} verify: recovered "${song.title}" song_id=${data.song_id} existing=${data.existing}`,
                );
                emit();
              } catch (e) {
                warn(
                  TAG,
                  `${lp} verify: resync failed for "${song.title}" (${shortHash}): ${String(e)}`,
                );
                if (!progress.failedBlake3s.includes(blake3)) {
                  progress.failedBlake3s.push(blake3);
                  progress.failedSongs += 1;
                }
                progress.errors.unshift(
                  `verify resync failed for ${song.title}: ${String(e)}`,
                );
                emit();
              }
            }
          }
        } else {
          warn(
            TAG,
            `${lp} verify: /api/blobz/has returned invalid shape: ${parsed.error.message}`,
          );
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
    `${lp} done: synced=${progress.syncedSongs} failed=${progress.failedSongs} skipped=${progress.skippedSongs}`,
  );
  return progress;
}

// simple worker-pool helper. processes `items` with up to `limit` in flight.
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
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
      })(),
    );
  }
  await Promise.all(runners);
}

// re-export for downstream consumers.
export type { Transport };
