// orchestrator: send an album or playlist from a source remote to a
// destination remote.
//
// audio is never serialized inline — the destination pulls each song's
// blob directly from the source via iroh-blobs (`source_node_id` + blake3).
// this module only ships json payloads describing what to sync.
//
// flow for an album:
//   1. validate dest is a p2p transport and source has an iroh node id.
//   2. POST `/api/sync/album` to dest with album shell + expected song blake3s.
//   3. for each song with a blake3, POST `/api/sync/song-by-blake3` to dest
//      (concurrency limited; default 2). each call triggers an iroh pull.
//   4. emit progress after every song result.
//
// flow for a playlist:
//   1. validate dest is a p2p transport and source has an iroh node id.
//   2. for each song with a blake3, POST `/api/sync/song-by-blake3` (same
//      concurrency-limited loop). songs without blake3 are skipped.
//   3. POST `/api/sync/playlist` with the list of song blake3s. dest creates
//      stub song rows for any blake3 it already has metadata for but doesn't
//      have a song row for, and reports the rest as `missing_song_blake3s`.

import { schema } from "freqhole-api-client";
import type {
  SyncAlbumRequest,
  SyncPlaylistRequest,
  SyncSongByBlake3Request,
} from "freqhole-api-client";
const {
  HasBlobsResponseSchema,
  SyncAlbumResponseSchema,
  SyncPlaylistResponseSchema,
  SyncSongByBlake3ResponseSchema,
} = schema;
import { getTransportForRemote, isP2PTransportType } from "../../../app/api/client";
import { extractNodeIdStrict } from "../../../app/services/remotes/peerAddr";
import {
  isP2PRemote,
  type Remote,
} from "../../../app/services/storage/schemas/remote";
import { debug, error as logError } from "../../../utils/logger";
import type { RemoteSong } from "../../data/remote/adapters";
import {
  buildSyncAlbumRequest,
  buildSyncPlaylistRequest,
  buildSyncSongByBlake3Request,
  type BuildSyncAlbumOptions,
  type BuildSyncPlaylistOptions,
} from "./buildSyncRequests";

export type SendPhase =
  | "preparing"
  | "syncing-album"
  | "syncing-songs"
  | "syncing-playlist"
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
  songs: RemoteSong[];
}

export interface SendPlaylistPayload {
  kind: "playlist";
  playlistId: string;
  title: string;
  description?: string | null;
  songs: RemoteSong[];
}

export type SendPayload = SendAlbumPayload | SendPlaylistPayload;

export interface SendOptions {
  /** how many `sync_song_by_blake3` requests to run concurrently. default 2. */
  concurrency?: number;
  /** if true, pre-check dest with `/api/has_blobs` and skip songs already present. default true. */
  skipExisting?: boolean;
  /** progress callback fired after each phase change and each song result. */
  onProgress?: (progress: SendProgress) => void;
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
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const skipExisting = opts.skipExisting ?? true;

  const songs = payload.songs;
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
  if (!isP2PTransportType(dest)) {
    throw new SendToRemoteError(
      "destination must be a p2p remote (wasm or app transport)",
      progress,
    );
  }
  if (!isP2PRemote(source)) {
    throw new SendToRemoteError(
      "source must be a p2p remote with a peer address",
      progress,
    );
  }
  const sourceNodeId = extractNodeIdStrict(source.peer_addr);
  if (!sourceNodeId) {
    throw new SendToRemoteError(
      "source remote has no usable iroh node id",
      progress,
    );
  }

  const destTransport = await getTransportForRemote(dest);
  const remoteName = source.name ?? source.remote_id;
  const sourceRemoteId = source.remote_id;

  // collect songs that have a blake3; non-blake3 songs cannot be pulled.
  const eligibleSongs = songs.filter((s) => !!s.blake3 && !!s.sha256);
  const skippedNoHash = songs.length - eligibleSongs.length;
  if (skippedNoHash > 0) {
    progress.skippedSongs += skippedNoHash;
    progress.errors.push(
      `${skippedNoHash} song(s) skipped — no blake3/sha256 available`,
    );
    emit();
  }

  // optional pre-check: ask dest which blobs it already has.
  let alreadyPresent: Set<string> = new Set();
  if (skipExisting && eligibleSongs.length > 0) {
    try {
      const blake3s = eligibleSongs.map((s) => s.blake3 as string);
      const resp = await destTransport.request(
        "POST",
        "/api/has_blobs",
        JSON.stringify({ blake3s }),
      );
      if (resp.status >= 200 && resp.status < 300) {
        const parsed = HasBlobsResponseSchema.safeParse(JSON.parse(resp.body));
        if (parsed.success) {
          alreadyPresent = new Set(parsed.data.blake3s_present);
          debug(
            "sendToRemote",
            `dest already has ${alreadyPresent.size}/${blake3s.length} blobs`,
          );
        }
      }
    } catch (e) {
      // pre-check is best-effort; log and continue.
      debug("sendToRemote", `has_blobs pre-check failed: ${String(e)}`);
    }
  }

  // ---- ALBUM ----
  if (payload.kind === "album") {
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

    try {
      const resp = await destTransport.request(
        "POST",
        "/api/sync/album",
        JSON.stringify(albumReq),
      );
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`http ${resp.status}: ${resp.body}`);
      }
      const parsed = SyncAlbumResponseSchema.safeParse(JSON.parse(resp.body));
      if (!parsed.success) {
        throw new Error("invalid sync_album response shape");
      }
    } catch (e) {
      progress.phase = "failed";
      progress.errors.unshift(`sync_album failed: ${String(e)}`);
      emit();
      throw new SendToRemoteError(`sync_album failed: ${String(e)}`, progress);
    }
  }

  // ---- SONGS (shared by album + playlist) ----
  progress.phase = "syncing-songs";
  emit();

  await runWithConcurrency(eligibleSongs, concurrency, async (song) => {
    const blake3 = song.blake3 as string;
    if (alreadyPresent.has(blake3)) {
      progress.syncedSongs += 1;
      progress.syncedBlake3s.push(blake3);
      emit();
      return;
    }
    const req: SyncSongByBlake3Request | null =
      buildSyncSongByBlake3Request({
        remoteName,
        sourceRemoteId,
        sourceNodeId,
        song,
      });
    if (!req) {
      progress.skippedSongs += 1;
      progress.errors.push(`skipped ${song.title} — no blake3/sha256`);
      emit();
      return;
    }
    try {
      const resp = await destTransport.request(
        "POST",
        "/api/sync/song-by-blake3",
        JSON.stringify(req),
      );
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`http ${resp.status}: ${resp.body}`);
      }
      const parsed = SyncSongByBlake3ResponseSchema.safeParse(
        JSON.parse(resp.body),
      );
      if (!parsed.success) {
        throw new Error("invalid sync_song_by_blake3 response shape");
      }
      progress.syncedSongs += 1;
      progress.syncedBlake3s.push(blake3);
    } catch (e) {
      progress.failedSongs += 1;
      progress.failedBlake3s.push(blake3);
      progress.errors.unshift(
        `sync_song_by_blake3 failed for ${song.title}: ${String(e)}`,
      );
      logError("sendToRemote", `song sync failed: ${String(e)}`);
    } finally {
      emit();
    }
  });

  // ---- PLAYLIST tail ----
  if (payload.kind === "playlist") {
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
    const playlistReq: SyncPlaylistRequest =
      buildSyncPlaylistRequest(playlistOpts);

    try {
      const resp = await destTransport.request(
        "POST",
        "/api/sync/playlist",
        JSON.stringify(playlistReq),
      );
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`http ${resp.status}: ${resp.body}`);
      }
      const parsed = SyncPlaylistResponseSchema.safeParse(JSON.parse(resp.body));
      if (!parsed.success) {
        throw new Error("invalid sync_playlist response shape");
      }
    } catch (e) {
      progress.phase = "failed";
      progress.errors.unshift(`sync_playlist failed: ${String(e)}`);
      emit();
      throw new SendToRemoteError(
        `sync_playlist failed: ${String(e)}`,
        progress,
      );
    }
  }

  progress.phase = "done";
  emit();
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
