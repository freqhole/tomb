// radio queue adapter — drives local playback from a broadcaster's
// timeline snapshot when the listener is in timeline/queue mode.
//
// activated when:
//   - hasMSE is false (mobile safari, no MediaSource support)
//   - the broadcaster has forced timeline_only_mode for the station
//   - the listener has experienced too many resyncs (poor network)
//
// the adapter watches radioTimelineSnapshot() for track transitions and
// calls playSong() with the appropriate initial position. it pre-caches
// upcoming songs in the background so transitions are gapless.

import { createEffect, createRoot, on } from "solid-js";
import { localDataSource } from "../../../music/data/local/localSource";
import { RemoteMusicDataSource } from "../../../music/data/remote/remoteSource";
import { allowTimelineAutoplay, isPlaying, pause, playSong } from "../../../music/services/audio/player";
import { getBlobObjectURL } from "../../../music/services/storage/blobs";
import { preCacheP2PBlob } from "../../../music/services/storage/blobResolver";
import { resolveBlobUrl } from "../../../music/services/storage/blobResolver";
import { getRemoteByPeerAddr, getRemoteById, getTauriManagedRemote } from "../remotes/remoteManager";
import { getPendingRemoteByPeerAddr } from "../storage/db";
import {
  applyTimelineNowPlaying,
  radioTimelineSnapshot,
  radioUseTimelineMode,
  radioCurrentPeerAddr,
  radioCurrentRemoteServerId,
  radioCurrentIsLocal,
  markTimelinePlaybackStarted,
  markTimelinePlaybackBlocked,
  handleTimelineAutoplayBlocked,
  recordCurrentRadioTrackHistory,
} from "./radioService";
import { getSongDisplayImages, pickBestImage } from "../../../utils/images";
import type { Remote } from "../storage/schemas/remote";
import type { Song } from "../../../music/services/storage/types";

// ---- state ---------------------------------------------------------------

// id of the currently-playing timeline item. transitions trigger a new
// playSong call; same id = no-op so we don't restart the current track.
let currentTimelineItemId: string | null = null;
// song id paired with the current item. used to collapse the bootstrap
// case where a synthesized fallback item is immediately replaced by the
// broadcaster's real timeline item for the same song.
let currentTimelineSongId: string | null = null;
// abort token: incremented on each stop() to cancel in-flight fetches.
let adapterGeneration = 0;
// whether the adapter is currently active.
let active = false;
// first track in a timeline session must never auto-play; we wait for an
// explicit user play action once, then allow normal transitions.
let requiresExplicitStart = true;
// one-shot flag consumed by startQueueModeAdapter. lets a user-initiated
// resume survive the stop/start cycle triggered by radioPause/radioResume.
let allowAutoplayOnNextStart = false;
// dispose fn returned by createRoot — cleans up the reactive effect on stop.
let disposeRoot: (() => void) | null = null;

// ---- public API ----------------------------------------------------------

/** mark that the user explicitly pressed play for timeline mode. */
export function acknowledgeTimelineUserStart(): void {
  requiresExplicitStart = false;
  allowAutoplayOnNextStart = true;
}

/** start the queue-mode adapter effect. safe to call multiple times;
 * subsequent calls are no-ops if already active. */
export function startQueueModeAdapter(): void {
  if (active) return;
  active = true;
  adapterGeneration += 1;
  currentTimelineItemId = null;
  currentTimelineSongId = null;
  requiresExplicitStart = !allowAutoplayOnNextStart;
  allowAutoplayOnNextStart = false;

  console.info(
    "[radio-queue-adapter] starting (generation:",
    adapterGeneration,
    "requiresExplicitStart:",
    requiresExplicitStart,
    ")",
  );

  // createRoot gives the effect a reactive owner so it tracks dependencies
  // correctly and can be disposed when the session ends. without this,
  // createEffect outside a component render context only fires once and
  // never re-runs when signals change.
  disposeRoot = createRoot((dispose) => {
    createEffect(
      on(
        () => [radioUseTimelineMode(), radioTimelineSnapshot()] as const,
        ([inTimelineMode, snapshot]) => {
          console.info(
            "[radio-queue-adapter] effect triggered — inTimelineMode:",
            inTimelineMode,
            "snapshot:", snapshot ? `seq=${snapshot.timeline_seq} current=${snapshot.current?.song_id ?? "null"}` : "null",
          );
          if (!inTimelineMode || !snapshot) return;
          const current = snapshot.current;
          if (!current) {
            console.info("[radio-queue-adapter] snapshot has no current item yet");
            return;
          }
          // only transition when the item id changes (track boundary).
          if (current.timeline_item_id === currentTimelineItemId) {
            console.info("[radio-queue-adapter] same timeline_item_id, no-op:", current.timeline_item_id);
            return;
          }
          const fallbackToRealSameSong =
            currentTimelineItemId?.startsWith("fallback-") === true &&
            current.song_id === currentTimelineSongId;
          if (fallbackToRealSameSong) {
            console.info(
              "[radio-queue-adapter] replacing fallback timeline item with broadcaster item for same song:",
              current.timeline_item_id,
            );
            currentTimelineItemId = current.timeline_item_id;
            return;
          }
          // mark this item as handled before async work so repeated
          // timeline snapshots don't trigger expensive duplicate fetches.
          currentTimelineItemId = current.timeline_item_id;
          currentTimelineSongId = current.song_id;
          const gen = adapterGeneration;
          console.info("[radio-queue-adapter] track transition → item", current.timeline_item_id, "song", current.song_id);
          void handleTrackTransition(current, snapshot, gen);
        },
      ),
    );
    return dispose;
  });
}

/** stop the adapter. clears state and cancels any in-flight work. */
export function stopQueueModeAdapter(): void {
  console.info("[radio-queue-adapter] stopping (generation:", adapterGeneration, ")");
  active = false;
  adapterGeneration += 1;
  currentTimelineItemId = null;
  currentTimelineSongId = null;
  requiresExplicitStart = true;
  if (disposeRoot) {
    disposeRoot();
    disposeRoot = null;
  }
}

// ---- internal ------------------------------------------------------------

interface TimelineCurrentLike {
  timeline_item_id: string;
  song_id: string;
  start_at_ms: number;
  duration_ms: number | null;
}

interface TimelineSnapshotLike {
  upcoming: Array<{ song_id: string; planned_start_at_ms: number }>;
}

async function resolveTimelineArt(
  song: Song,
): Promise<{ artBlobId: string | null; artUrl: string | null }> {
  const bestImage =
    pickBestImage(getSongDisplayImages(song) ?? song.album_images ?? song.artist_images) ??
    pickBestImage(song.images ?? song.album_images ?? song.artist_images);
  if (!bestImage) {
    return { artBlobId: null, artUrl: null };
  }

  if (bestImage.local_blob_id) {
    return {
      artBlobId: null,
      artUrl: await getBlobObjectURL(bestImage.local_blob_id),
    };
  }

  if (bestImage.remote_blob_id && bestImage.remote_server_id) {
    try {
      return {
        artBlobId: bestImage.remote_blob_id,
        artUrl: await resolveBlobUrl(bestImage.remote_blob_id, bestImage.remote_server_id, "image"),
      };
    } catch (e) {
      console.warn("[radio-queue-adapter] resolveBlobUrl failed for timeline art:", e);
    }
  }

  return {
    artBlobId: bestImage.remote_blob_id ?? null,
    artUrl: bestImage.remote_url ?? null,
  };
}

function buildRemoteFromPending(peerAddr: string, pending: {
  id: string;
  transport: "http" | "wasm" | "app";
  server_name: string | null;
}): Remote {
  const now = Date.now();
  const remoteId = `pending-${pending.id}`;
  const name = pending.server_name ?? `pending ${peerAddr.slice(0, 10)}`;

  if (pending.transport === "http") {
    return {
      transport: "http",
      remote_id: remoteId,
      name,
      is_active: false,
      last_connected_at: null,
      created_at: now,
      updated_at: now,
      description: null,
      image_url: null,
      image_blob_id: null,
      version: null,
      last_info_check: null,
      base_url: peerAddr,
      peer_addr: undefined,
    };
  }

  return {
    transport: pending.transport,
    remote_id: remoteId,
    name,
    is_active: false,
    last_connected_at: null,
    created_at: now,
    updated_at: now,
    description: null,
    image_url: null,
    image_blob_id: null,
    version: null,
    last_info_check: null,
    peer_addr: peerAddr,
  };
}

async function resolveRemote(): Promise<Remote | null> {
  // prefer the resolved remote_id (stored once the remote is known), then
  // fall back to the peer addr lookup.
  const remoteId = radioCurrentRemoteServerId();
  console.info("[radio-queue-adapter] resolveRemote — remoteId:", remoteId, "peerAddr:", radioCurrentPeerAddr());
  if (remoteId) {
    const remote = await getRemoteById(remoteId);
    if (remote) return remote;
    console.warn("[radio-queue-adapter] getRemoteById returned null for remoteId:", remoteId);
  }
  const peerAddr = radioCurrentPeerAddr();
  if (!peerAddr) {
    console.warn("[radio-queue-adapter] no peerAddr available to resolve remote");
    return null;
  }
  const remote = (await getRemoteByPeerAddr(peerAddr)) ?? null;
  if (remote) return remote;

  console.warn("[radio-queue-adapter] getRemoteByPeerAddr returned null for:", peerAddr);
  const pending = await getPendingRemoteByPeerAddr(peerAddr);
  if (!pending) return null;

  // accepted/connected pending remotes can serve API calls before the
  // user completes full "save remote" setup. build a transient remote
  // object so timeline mode can fetch songs immediately.
  const transientRemote = buildRemoteFromPending(peerAddr, pending);
  console.info(
    "[radio-queue-adapter] using pending remote fallback:",
    pending.id,
    pending.transport,
  );
  return transientRemote;
}

async function handleTrackTransition(
  current: TimelineCurrentLike,
  snapshot: TimelineSnapshotLike,
  gen: number,
): Promise<void> {
  if (gen !== adapterGeneration) return;

  const localSession = radioCurrentIsLocal();
  const remote = localSession ? await getTauriManagedRemote() : await resolveRemote();
  if (gen !== adapterGeneration) return;

  if (localSession && remote) {
    console.info(
      "[radio-queue-adapter] fetching song",
      current.song_id,
      "from tauri local transport",
      remote.remote_id,
    );
  } else if (localSession) {
    console.info("[radio-queue-adapter] fetching song", current.song_id, "from local source");
  } else if (remote) {
    console.info("[radio-queue-adapter] fetching song", current.song_id, "from remote", remote.remote_id);
  } else {
    console.info(
      "[radio-queue-adapter] no remote resolved; trying local source fallback for song",
      current.song_id,
    );
  }
  let song;
  try {
    if (localSession && remote) {
      const ds = new RemoteMusicDataSource(remote);
      song = await ds.getSongById(current.song_id);
    } else if (localSession || !remote) {
      song = await localDataSource.getSongById(current.song_id);
    } else {
      const ds = new RemoteMusicDataSource(remote);
      song = await ds.getSongById(current.song_id);
    }
  } catch (e) {
    console.warn("[radio-queue-adapter] getSongById failed:", e);
    markTimelinePlaybackBlocked(
      localSession || !remote
        ? "failed to fetch current radio song from local library"
        : "failed to fetch current radio song from remote",
    );
    return;
  }
  if (!song) {
    console.warn(
      "[radio-queue-adapter] getSongById returned null for song_id:",
      current.song_id,
      localSession || !remote ? "(local lookup)" : "(remote lookup)",
    );
    if (!localSession && !remote) {
      markTimelinePlaybackBlocked(
        "timeline mode needs a configured remote for this broadcaster (add it in remotes)",
      );
    } else {
      markTimelinePlaybackBlocked("radio track metadata could not be resolved");
    }
    return;
  }
  if (gen !== adapterGeneration) return;

  // compute how far into the track we are based on wall-clock time.
  const nowMs = Date.now();
  const elapsedMs = Math.max(0, nowMs - current.start_at_ms);
  const initialPosition = elapsedMs / 1000; // seconds
  const resolvedArt = await resolveTimelineArt(song);
  if (gen !== adapterGeneration) return;

  console.info(
    `[radio-queue-adapter] playing "${song.title}" at ${Math.round(initialPosition)}s` +
      ` (item ${current.timeline_item_id}, duration_ms=${current.duration_ms})`,
  );

  applyTimelineNowPlaying({
    songId: song.id ?? null,
    title: song.title,
    artist: song.artist_name ?? null,
    album: song.album_title ?? null,
    durationMs: current.duration_ms ?? null,
    artBlobId: resolvedArt.artBlobId,
    artUrl: resolvedArt.artUrl,
  });

  try {
    if (requiresExplicitStart) {
      // make the first timeline item load-only: never auto-play on tune.
      pause();
    } else {
      // first tune intentionally sets the global user-paused flag via
      // pause(); clear it here so user-approved timeline playback can
      // auto-start on later transitions.
      allowTimelineAutoplay();
    }
    await playSong(song, { initialPosition });
  } catch (e) {
    console.warn("[radio-queue-adapter] playSong failed:", e);
    const errName =
      typeof e === "object" && e !== null && "name" in e
        ? String((e as { name?: unknown }).name ?? "")
        : "";
    const errMessage =
      typeof e === "object" && e !== null && "message" in e
        ? String((e as { message?: unknown }).message ?? "")
        : String(e ?? "");
    const autoplayBlocked =
      errName === "NotAllowedError" ||
      /not allowed by the user agent|denied permission/i.test(errMessage);
    if (autoplayBlocked) {
      console.warn(
        "[radio-queue-adapter] autoplay blocked by platform policy; pausing session and waiting for explicit play",
      );
      handleTimelineAutoplayBlocked();
      return;
    }
    markTimelinePlaybackBlocked("failed to start timeline audio playback");
    return;
  }

  if (requiresExplicitStart) {
    // first track is loaded and ready, but intentionally paused pending
    // explicit user action.
    recordCurrentRadioTrackHistory({
      songId: song.id ?? null,
      title: song.title,
      artist: song.artist_name ?? null,
      album: song.album_title ?? null,
      durationMs: current.duration_ms ?? null,
      artBlobId: resolvedArt.artBlobId,
      artThumb: null,
      historyKey: `timeline:${current.timeline_item_id}`,
    });
    handleTimelineAutoplayBlocked();
  } else {
    if (!isPlaying()) {
      markTimelinePlaybackBlocked("timeline audio did not start after loading track");
      return;
    }
    recordCurrentRadioTrackHistory({
      songId: song.id ?? null,
      title: song.title,
      artist: song.artist_name ?? null,
      album: song.album_title ?? null,
      durationMs: current.duration_ms ?? null,
      artBlobId: resolvedArt.artBlobId,
      artThumb: null,
      historyKey: `timeline:${current.timeline_item_id}`,
    });
    markTimelinePlaybackStarted();
  }

  if (gen !== adapterGeneration) return;

  // pre-cache upcoming songs so the next transition has audio ready.
  const upcomingIds = snapshot.upcoming.map((u) => u.song_id);
  console.info("[radio-queue-adapter] pre-caching", upcomingIds.length, "upcoming songs");
  if (!localSession && upcomingIds.length > 0 && remote?.remote_id) {
    void preCacheUpcoming(upcomingIds, remote, gen);
  }
}

async function preCacheUpcoming(
  songIds: string[],
  remote: Remote,
  gen: number,
): Promise<void> {
  if (!remote.remote_id) return;
  const remoteId = remote.remote_id;
  const ds = new RemoteMusicDataSource(remote);
  const songs = await ds.getSongsByIds(songIds).catch(() => []);
  if (gen !== adapterGeneration || songs.length === 0) return;

  // pre-cache each song's audio blob in the background; failures are silent
  // because this is best-effort — the main play path will fetch if needed.
  for (const song of songs) {
    if (gen !== adapterGeneration) return;
    if (song.media_blob_id) {
      void preCacheP2PBlob(song.media_blob_id, remoteId, song.sha256, "audio");
    }
  }
}
