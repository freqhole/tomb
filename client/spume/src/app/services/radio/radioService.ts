// radio service: tunes into a freqhole-radio/1 broadcaster via midden,
// pumps fMP4/AAC chunks into a MediaSource, and surfaces meta updates as
// solid signals.
//
// public API:
//   - tuneInto(peerAddr, opts?) → returns { audio, leave } + state signals
//   - currentSession() → currently-tuned session, if any
//   - leave() → tear down current session
//   - radioState() → coarse status signal: 'idle' | 'connecting' | 'playing' | 'error'

import { createSignal } from "solid-js";
import { schema, type PublicNowPlaying } from "freqhole-api-client";
import type { RadioHandleLike } from "freqhole-api-client";
import { getMiddenNode, isCharnelAvailable } from "../../api/client";
import { tuneRadioCharnel, tuneRadioCharnelLocal } from "./charnelRadioAdapter";
import {
  registerStopRadio,
  stopMusicForRadio,
} from "../playbackCoordinator";
import { recordHistoryEntry } from "./radioHistory";
import { setCurrentRadioStationPersisted } from "../storage/currentRadioStation";
import { getRemoteByPeerAddr } from "../remotes/remoteManager";
import { getClientForRemote } from "../../api/client";

const MSE_CODEC = 'audio/mp4; codecs="mp4a.40.2"';

export type RadioStatus = "idle" | "connecting" | "playing" | "paused" | "error";

interface RadioSession {
  peerAddr: string;
  stationId: string | null;
  stationName: string | null;
  isLocal: boolean;
  audio: HTMLAudioElement;
  leave: () => void;
}

// when the user pauses radio we fully drop the iroh session (so the
// broadcaster decrements its listener count) but stash enough context to
// re-tune on resume. cleared by leaveRadio + by a successful resume.
interface PausedContext {
  peerAddr: string;
  stationId: string | null;
  stationName: string | null;
  isLocal: boolean;
}
let pausedContext: PausedContext | null = null;

// module-level singletons. only one radio session at a time.
const [status, setStatus] = createSignal<RadioStatus>("idle");
const [error, setError] = createSignal<string | null>(null);
const [nowPlaying, setNowPlaying] = createSignal<PublicNowPlaying | null>(null);
// blob URL for the current track's inline album art (Hello/Meta `art` field).
// null when the track has no art or it hasn't been received yet. revoked
// whenever a new url replaces it so we don't leak URL.createObjectURL refs.
const [artUrl, setArtUrl] = createSignal<string | null>(null);
const [listenerCount, setListenerCount] = createSignal<number>(0);
const [currentPeerAddr, setCurrentPeerAddr] = createSignal<string | null>(null);
const [currentStationId, setCurrentStationId] = createSignal<string | null>(
  null,
);
// resolved remote_server_id for the currently-tuned peer (used by the player
// bar to fetch the waveform blob from the right backend). null while
// resolving or when no matching remote is configured locally.
const [currentRemoteServerId, setCurrentRemoteServerId] = createSignal<
  string | null
>(null);
// favorite state for the currently-playing radio track. mirrors the
// remote's `is_favorite` for the broadcasting peer + currently-logged-in
// user; reset on every track transition. null = unknown / not yet
// fetched (also covers "no registered remote for this peer" case where
// we can't talk to a favorites endpoint at all).
const [currentFavorite, setCurrentFavorite] = createSignal<boolean | null>(
  null,
);
const [stabilityMode, setStabilityMode] = createSignal<boolean>(false);

// listening elapsed time signal (milliseconds since this listener started
// hearing the current radio session). this is intentionally independent of
// track timing/seek position because live radio is not seekable.
const [elapsedMs, setElapsedMs] = createSignal<number>(0);
let listenStartedAtMs = 0;
let listenedAccumulatedMs = 0;
let elapsedTickHandle: number | null = null;

const startElapsedTicker = () => {
  if (elapsedTickHandle !== null) return;
  elapsedTickHandle = window.setInterval(() => {
    const now = Date.now();
    const inFlight =
      listenStartedAtMs > 0 ? Math.max(0, now - listenStartedAtMs) : 0;
    setElapsedMs(listenedAccumulatedMs + inFlight);
  }, 250);
};
const stopElapsedTicker = (opts: { reset?: boolean } = {}) => {
  if (elapsedTickHandle !== null) {
    window.clearInterval(elapsedTickHandle);
    elapsedTickHandle = null;
  }
  if (opts.reset) {
    listenStartedAtMs = 0;
    listenedAccumulatedMs = 0;
    setElapsedMs(0);
    return;
  }
  if (listenStartedAtMs > 0) {
    listenedAccumulatedMs += Math.max(0, Date.now() - listenStartedAtMs);
    listenStartedAtMs = 0;
  }
};

let activeSession: RadioSession | null = null;
// optional persistent <audio> element supplied by RadioBar. when set, new
// tunes attach their MediaSource to it instead of creating a fresh element.
// keeps playback alive across navigation and gives the global player bar a
// stable target for volume + visibility.
let audioSink: HTMLAudioElement | null = null;

export const radioStatus = status;
export const radioError = error;
export const radioNowPlaying = nowPlaying;
export const radioArtUrl = artUrl;
export const radioListenerCount = listenerCount;
export const radioCurrentPeerAddr = currentPeerAddr;
export const radioCurrentStationId = currentStationId;
export const radioCurrentRemoteServerId = currentRemoteServerId;
export const radioCurrentFavorite = currentFavorite;
export const radioElapsedMs = elapsedMs;
export const radioStabilityMode = stabilityMode;

// monotonically increasing tune attempt id. async callbacks from older
// attempts no-op when their id no longer matches this value.
let activeTuneAttemptId = 0;

function bumpTuneAttemptId(): number {
  activeTuneAttemptId = (activeTuneAttemptId + 1) >>> 0;
  if (activeTuneAttemptId === 0) activeTuneAttemptId = 1;
  return activeTuneAttemptId;
}

/**
 * enable/disable conservative buffering behavior for unstable links.
 */
export function setRadioStabilityMode(enabled: boolean): void {
  setStabilityMode(!!enabled);
}

export function currentRadioSession(): RadioSession | null {
  return activeSession;
}

// register our leave hook so the music player can interrupt us when
// the user starts playing local songs.
registerStopRadio(() => leaveRadio());

/**
 * register a persistent <audio> element to receive radio playback. pass
 * null to unregister. safe to call before any tune; tuneIntoRadio reads
 * the sink at call time.
 */
export function setRadioAudioSink(el: HTMLAudioElement | null): void {
  audioSink = el;
}

/**
 * set the radio sink's volume (0..1). no-op when no sink is registered
 * or the value is non-finite. clamps to [0,1].
 */
export function setRadioVolume(vol: number): void {
  if (!audioSink) return;
  if (!Number.isFinite(vol)) return;
  const clamped = Math.max(0, Math.min(1, vol));
  try {
    audioSink.volume = clamped;
  } catch (e) {
    console.warn("[radio] setRadioVolume failed:", e);
  }
}

/**
 * pause radio playback. fully drops the iroh session so the broadcaster
 * decrements its listener count ("pause as unlisten"). preserves the
 * displayed station + now-playing card so the player bar stays useful.
 * resume re-tunes from scratch and lands at the new live edge.
 */
export function radioPause(): void {
  if (status() !== "playing" && status() !== "connecting") return;
  if (!activeSession) return;
  // remember enough to resume.
  pausedContext = {
    peerAddr: activeSession.peerAddr,
    stationId: activeSession.stationId,
    stationName: activeSession.stationName,
    isLocal: activeSession.isLocal,
  };
  // drop the iroh session entirely (this signals leave to the
  // broadcaster). we don't call leaveRadio() because that resets the
  // displayed metadata; we want the bar to keep showing the station so
  // the user knows what they paused.
  try {
    activeSession.leave();
  } catch (e) {
    console.warn("[radio] pause: handle.leave threw:", e);
  }
  activeSession = null;
  stopElapsedTicker();
  setStatus("paused");
}

/**
 * resume after `radioPause()`. re-tunes to the same station; the
 * server-assigned position is the new live edge (live radio doesn't
 * rewind). no-op when not paused.
 */
export function radioResume(): void {
  if (status() !== "paused") return;
  const ctx = pausedContext;
  if (!ctx) {
    setStatus("idle");
    return;
  }
  pausedContext = null;
  void tuneIntoRadio(ctx.peerAddr, {
    stationId: ctx.stationId ?? undefined,
    stationName: ctx.stationName ?? undefined,
    isLocal: ctx.isLocal,
  }).catch((e) => {
    console.warn("[radio] resume re-tune failed:", e);
  });
}

/** stop the current radio session if any. safe to call when idle. */
export function leaveRadio(): void {
  // invalidate async callbacks from any in-flight/old tune attempt.
  bumpTuneAttemptId();
  pausedContext = null;
  if (activeSession) {
    try {
      activeSession.leave();
    } catch (e) {
      console.warn("[radio] leave threw:", e);
    }
    activeSession = null;
  }
  setStatus("idle");
  setError(null);
  setNowPlaying(null);
  swapArtUrl(null);
  setListenerCount(0);
  setCurrentPeerAddr(null);
  setCurrentStationId(null);
  setCurrentRemoteServerId(null);
  setCurrentFavorite(null);
  stopElapsedTicker({ reset: true });
  
  // clear persisted radio station
  void setCurrentRadioStationPersisted(null);
}

// replace the current art URL with a new one (or null), revoking the
// previous blob URL to release memory.
function swapArtUrl(next: string | null): void {
  const prev = artUrl();
  if (prev && prev !== next && prev.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(prev);
    } catch {
      // ignore — best effort
    }
  }
  setArtUrl(next);
}

// extract raw inline art metadata (`{mime, data}` base64) from the raw
// now_playing payload, for storing in history. returns null if absent.
function rawArtMetaFrom(raw: unknown): { mime: string; data: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const art = (raw as { art?: unknown }).art;
  if (!art || typeof art !== "object") return null;
  const a = art as { mime?: unknown; data?: unknown };
  if (typeof a.mime !== "string" || typeof a.data !== "string") return null;
  return { mime: a.mime, data: a.data };
}

// build a Blob URL from inline ArtData (`{mime, blob_id, data}`) on the
// raw now_playing payload. returns null if missing/malformed.
function artUrlFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const art = (raw as { art?: unknown }).art;
  if (!art || typeof art !== "object") return null;
  const a = art as { mime?: unknown; data?: unknown };
  if (typeof a.mime !== "string" || typeof a.data !== "string") return null;
  try {
    const bin = atob(a.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes as BlobPart], { type: a.mime });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn("[radio] art decode failed:", e);
    return null;
  }
}

interface TuneOptions {
  /** station id to tune into; omit to use the broadcaster's default. */
  stationId?: string;
  /** display name to show while connecting (replaced by hello when it arrives). */
  stationName?: string;
  /**
   * skip the iroh dial and subscribe to the local broadcaster directly.
   * used by charnel when tuning into one of its own stations (iroh
   * refuses to dial yourself). requires `isCharnelMode()`.
   */
  isLocal?: boolean;
}

function shouldRecordRadioHistoryEntry(np: PublicNowPlaying, songId: string | null): boolean {
  // ignore interstitial/placeholder cards emitted by broadcaster state
  // transitions; history should only contain real songs.
  if (!songId) return false;

  const title = (np.title ?? "").trim().toLowerCase();
  if (!title) return false;
  if (title.startsWith("[station id]")) return false;

  const interstitialTitles = new Set([
    "waiting for listeners…",
    "waiting for listeners...",
    "switching tracks…",
    "switching tracks...",
  ]);
  return !interstitialTitles.has(title);
}

/**
 * connect to a radio broadcaster. returns the audio element so views
 * can attach it to the dom (or to a layout-level player bar later).
 *
 * subsequent calls leave the previous session before starting the new one.
 */
export async function tuneIntoRadio(
  peerAddr: string,
  opts: TuneOptions = {},
): Promise<HTMLAudioElement> {
  // tear down any prior session.
  leaveRadio();
  const tuneAttemptId = bumpTuneAttemptId();
  const isActiveTune = () => tuneAttemptId === activeTuneAttemptId;

  const guarded = (fn: () => void) => {
    if (!isActiveTune()) return;
    fn();
  };

  // make sure local music isn't competing for the speakers.
  await stopMusicForRadio();
  if (!isActiveTune()) {
    throw new Error("radio tune superseded by a newer attempt");
  }

  setStatus("connecting");
  setCurrentPeerAddr(peerAddr);
  setCurrentStationId(opts.stationId ?? null);
  // resolve the matching local remote (if any) so the player bar can
  // fetch waveform blobs from the right backend. fire-and-forget;
  // missing or pending remotes just leave the signal null.
  void getRemoteByPeerAddr(peerAddr)
    .then((r) => {
      guarded(() => setCurrentRemoteServerId(r?.remote_id ?? null));
    })
    .catch(() => {
      guarded(() => setCurrentRemoteServerId(null));
    });

  // pick transport: charnel/tauri uses the native iroh path via
  // `radio_tune` IPC commands (or `radio_tune_local` for self-listen);
  // everywhere else uses midden wasm.
  const useCharnel = isCharnelAvailable();
  const useLocal = !!opts.isLocal && useCharnel;
  let node: { tune_radio: NonNullable<Awaited<ReturnType<typeof getMiddenNode>>["tune_radio"]> } | null = null;
  if (!useCharnel) {
    const middenNode = await getMiddenNode();
    if (!isActiveTune()) {
      throw new Error("radio tune superseded by a newer attempt");
    }
    if (typeof middenNode.tune_radio !== "function") {
      setStatus("error");
      setError("midden build missing tune_radio");
      throw new Error(
        "this midden build does not expose tune_radio (rebuild client/midden)",
      );
    }
    node = { tune_radio: middenNode.tune_radio.bind(middenNode) };
  }

  // ---- mse setup -------------------------------------------------------
  // prefer a persistent sink (mounted in the global RadioBar) so navigation
  // doesn't tear down the audio element. fall back to a transient element
  // for callers without a registered sink.
  const audio = audioSink ?? document.createElement("audio");
  const ownsAudio = audio !== audioSink;
  audio.autoplay = true;
  audio.preload = "auto";
  if (ownsAudio) {
    // only override volume on transient elements; the sink owns volume.
    audio.volume = 1.0;
  }

  const ms = new MediaSource();
  audio.src = URL.createObjectURL(ms);

  let sb: SourceBuffer | null = null;
  const queue: Uint8Array[] = [];
  let seekedToLive = false;

  // ---- diagnostics -----------------------------------------------------
  let sourceBufferResetCount = 0;
  let resyncCount = 0;
  let maxLiveEdgeBufferMs = 0;
  const chunkGapSamplesMs: number[] = [];
  let chunkGapSumMs = 0;
  let lastChunkAtMs: number | null = null;
  let diagnosticsTick: number | null = null;
  const pushChunkGapSample = (gapMs: number) => {
    chunkGapSamplesMs.push(gapMs);
    chunkGapSumMs += gapMs;
    if (chunkGapSamplesMs.length > 240) {
      const dropped = chunkGapSamplesMs.shift();
      if (typeof dropped === "number") chunkGapSumMs -= dropped;
    }
  };
  const percentile = (samples: number[], p: number): number => {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((sorted.length - 1) * p)),
    );
    return sorted[idx];
  };
  const startDiagnostics = () => {
    if (diagnosticsTick !== null) return;
    diagnosticsTick = window.setInterval(() => {
      if (!isActiveTune()) return;
      const samples = chunkGapSamplesMs.length;
      const avgChunkGapMs = samples > 0 ? chunkGapSumMs / samples : 0;
      const p95ChunkGapMs = percentile(chunkGapSamplesMs, 0.95);
      console.info(
        "[radio] session summary:",
        JSON.stringify({
          stall_count: stallCount,
          resync_count: resyncCount,
          sourcebuffer_reset_count: sourceBufferResetCount,
          max_live_edge_buffer_ms: maxLiveEdgeBufferMs,
          avg_chunk_gap_ms: Math.round(avgChunkGapMs),
          p95_chunk_gap_ms: Math.round(p95ChunkGapMs),
          queue_depth: queue.length,
        }),
      );
    }, 30_000);
  };
  const stopDiagnostics = () => {
    if (diagnosticsTick !== null) {
      window.clearInterval(diagnosticsTick);
      diagnosticsTick = null;
    }
  };

  // ---- history scope ---------------------------------------------------
  // tracked per-session so we only record one history row per actual
  // track transition. prefer `init_seq` when available; fall back to
  // song/title metadata when control messages omit sequence.
  // resets on leaveRadio via the new
  // session reset path.
  let lastHistoryTrackKey: string | null = null;
  const sessionPeerAddr = peerAddr;
  const sessionStationName = opts.stationName ?? null;
  const maybeRecordHistory = (
    np: PublicNowPlaying,
    rawArt: { mime?: string; data?: string } | null,
    initSeq?: number,
  ) => {
    const rawSongId = typeof np.song_id === "string" ? np.song_id.trim() : "";
    const songId = rawSongId.length > 0 ? rawSongId : null;
    if (!shouldRecordRadioHistoryEntry(np, songId)) return;
    const historyKey =
      typeof initSeq === "number"
        ? `init:${initSeq}`
        : `meta:${songId ?? ""}:${np.title}:${np.artist ?? ""}:${np.album ?? ""}`;
    if (historyKey === lastHistoryTrackKey) return;
    lastHistoryTrackKey = historyKey;
    // reset + best-effort fetch the favorite state for the new track
    // from the broadcasting peer. only works when the peer is also a
    // registered remote with an authenticated session.
    setCurrentFavorite(null);
    if (songId) {
      void fetchRadioFavorite(songId, sessionPeerAddr);
    }
    void recordHistoryEntry({
      station_id: currentStationId(),
      station_name: sessionStationName,
      peer_addr: sessionPeerAddr,
      song_id: songId,
      title: np.title,
      artist: np.artist ?? null,
      album: np.album ?? null,
      duration_ms: np.duration_ms ?? null,
      art_blob_id: np.art_blob_id ?? null,
      art_thumb_b64: rawArt?.data ?? null,
      art_thumb_mime: rawArt?.mime ?? null,
    }).catch((e) => console.warn("[radio] history write failed:", e));
  };

  const drain = () => {
    if (!isActiveTune()) return;
    if (!sb || sb.updating) return;
    const next = queue.shift();
    if (next) {
      try {
        sb.appendBuffer(next as BufferSource);
      } catch (e) {
        console.warn("[radio] appendBuffer failed:", e);
      }
      return;
    }
    // jump to the live edge once after the first append settles. catchup
    // chunks carry mid-track media timestamps, so the playhead at 0 sits
    // in an empty range until we seek forward. when the player has
    // stalled before, `liveEdgeBufferMs` shifts the target back from the
    // true edge so MSE has more headroom.
    if (!seekedToLive && sb.buffered.length > 0) {
      const start = sb.buffered.start(0);
      const end = sb.buffered.end(sb.buffered.length - 1);
      const targetFromEnd = Math.max(0, end - liveEdgeBufferMs / 1000);
      const target = Math.max(start, targetFromEnd);
      if (audio.currentTime < target) {
        audio.currentTime = target;
      }
      seekedToLive = true;
    }
  };

  // ---- recovery state ---------------------------------------------------
  await new Promise<void>((resolve) => {
    ms.addEventListener("sourceopen", () => resolve(), { once: true });
  });
  if (!isActiveTune()) {
    URL.revokeObjectURL(audio.src);
    audio.removeAttribute("src");
    audio.load();
    throw new Error("radio tune superseded by a newer attempt");
  }
  sb = ms.addSourceBuffer(MSE_CODEC);
  // sequence mode rewrites segment timestamps so cross-track + catchup
  // chunks form a single contiguous buffered range.
  sb.mode = "sequence";
  sb.addEventListener("updateend", drain);

  // server-driven resync: when the broadcaster sends ControlMessage::Lag
  // we tear down the SourceBuffer + queue and discard chunks until we
  // see `seq >= resyncAtSeq && isInit`. tracks rapid-resync as a UX
  // signal — ≥3 lags in 60s flips status to "error" so the user sees a
  // reconnect prompt instead of silent stuttering.
  let resyncAtSeq: number | null = null;
  const recentLags: number[] = [];
  const RAPID_LAG_THRESHOLD = 3;
  const RAPID_LAG_WINDOW_MS = 60_000;
  let lastResyncAtMs = 0;
  let pendingLagResyncSeq: number | null = null;
  const recentLagSignals: number[] = [];
  const LAG_SIGNAL_WINDOW_MS = 8_000;
  const RESYNC_SIGNALS_REQUIRED = stabilityMode() ? 3 : 2;
  const RESYNC_COOLDOWN_MS = stabilityMode() ? 8_000 : 5_000;
  // adaptive buffer: when MediaElement fires `waiting` / `stalled` we
  // bump the live-edge target back so the SourceBuffer has more headroom
  // before the playhead crosses into the unbuffered zone. starts at the
  // default (live edge) and grows by `LIVE_EDGE_BUMP_MS` per stall, up
  // to `MAX_LIVE_EDGE_BUFFER_MS` total.
  let liveEdgeBufferMs = 0;
  const LIVE_EDGE_BUMP_MS = stabilityMode() ? 2000 : 1500;
  const MAX_LIVE_EDGE_BUFFER_MS = stabilityMode() ? 9000 : 5000;
  let stallCount = 0;
  const onStall = () => {
    if (!isActiveTune()) return;
    stallCount += 1;
    if (liveEdgeBufferMs < MAX_LIVE_EDGE_BUFFER_MS) {
      liveEdgeBufferMs = Math.min(
        MAX_LIVE_EDGE_BUFFER_MS,
        liveEdgeBufferMs + LIVE_EDGE_BUMP_MS,
      );
      if (liveEdgeBufferMs > maxLiveEdgeBufferMs) {
        maxLiveEdgeBufferMs = liveEdgeBufferMs;
      }
      console.info(
        `[radio] stall #${stallCount} — bumping live-edge buffer to ${liveEdgeBufferMs}ms`,
      );
    }
    // best-effort underflow recovery: if we have buffered media but the
    // playhead is hugging/falling out of range, jump back to our current
    // live-edge target instead of waiting for autoplay heuristics.
    try {
      if (!sb || sb.buffered.length === 0) return;
      const start = sb.buffered.start(0);
      const end = sb.buffered.end(sb.buffered.length - 1);
      const targetFromEnd = Math.max(start, end - liveEdgeBufferMs / 1000);
      const nearEnd = end - audio.currentTime < 0.25;
      const outOfRange = audio.currentTime < start || audio.currentTime > end;
      if (nearEnd || outOfRange) {
        audio.currentTime = targetFromEnd;
      }
    } catch (e) {
      console.warn("[radio] stall seek recovery failed:", e);
    }
  };
  audio.addEventListener("waiting", onStall);
  audio.addEventListener("stalled", onStall);

  /** rebuild the SourceBuffer fresh — used after a Lag notice. */
  const resetSourceBuffer = (resyncSeq: number) => {
    if (!isActiveTune()) return;
    console.warn(`[radio] lag — resyncing at seq ${resyncSeq}`);
    resyncCount += 1;
    sourceBufferResetCount += 1;
    lastResyncAtMs = Date.now();
    resyncAtSeq = resyncSeq;
    queue.length = 0;
    seekedToLive = false;
    if (sb) {
      try {
        sb.removeEventListener("updateend", drain);
        if (sb.updating) {
          try {
            sb.abort();
          } catch {
            // best effort
          }
        }
        ms.removeSourceBuffer(sb);
      } catch (e) {
        console.warn("[radio] removeSourceBuffer failed:", e);
      }
      sb = null;
    }
    try {
      sb = ms.addSourceBuffer(MSE_CODEC);
      sb.mode = "sequence";
      sb.addEventListener("updateend", drain);
    } catch (e) {
      console.error("[radio] addSourceBuffer after lag failed:", e);
      setStatus("error");
      setError("media source rebuild failed; please reconnect");
    }
    // record + count this resync. when we churn faster than the user's
    // patience, surface as an error so they can take action.
    const now = Date.now();
    recentLags.push(now);
    while (
      recentLags.length > 0 &&
      now - recentLags[0] > RAPID_LAG_WINDOW_MS
    ) {
      recentLags.shift();
    }
    if (recentLags.length >= RAPID_LAG_THRESHOLD) {
      setStatus("error");
      setError(
        `connection unstable — ${recentLags.length} resyncs in the last minute`,
      );
    }
  };

  const applyControlSpecial = (msg: { type?: unknown }): boolean => {
    if (!isActiveTune()) return true;
    if (typeof msg.type !== "string") return false;
    if (msg.type === "lag") {
      const at = (msg as { resync_at_seq?: unknown }).resync_at_seq;
      if (typeof at === "number") {
        if (pendingLagResyncSeq === null || at > pendingLagResyncSeq) {
          pendingLagResyncSeq = at;
        }
        const now = Date.now();
        recentLagSignals.push(now);
        while (
          recentLagSignals.length > 0 &&
          now - recentLagSignals[0] > LAG_SIGNAL_WINDOW_MS
        ) {
          recentLagSignals.shift();
        }
        if (now - lastResyncAtMs < RESYNC_COOLDOWN_MS) {
          console.info(
            `[radio] lag signal in cooldown (${now - lastResyncAtMs}ms < ${RESYNC_COOLDOWN_MS}ms); deferring resync`,
          );
        } else if (recentLagSignals.length >= RESYNC_SIGNALS_REQUIRED) {
          resetSourceBuffer(pendingLagResyncSeq ?? at);
          pendingLagResyncSeq = null;
          recentLagSignals.length = 0;
        } else {
          console.info(
            `[radio] lag signal buffered (${recentLagSignals.length}/${RESYNC_SIGNALS_REQUIRED})`,
          );
        }
      }
      return true;
    }
    if (msg.type === "chunk_ready") {
      const beat = msg as { listener_count?: unknown };
      if (typeof beat.listener_count === "number") {
        setListenerCount(beat.listener_count);
      }
      // heartbeat — future: compare seq to lastSeenSeq for hung stream
      // detection. for now it also refreshes listener_count.
      return true;
    }
    if (msg.type === "goodbye") {
      const bye = msg as { reason?: unknown };
      const reason =
        typeof bye.reason === "string" && bye.reason.trim().length > 0
          ? bye.reason
          : "radio session ended";
      leaveRadio();
      guarded(() => {
        setStatus("error");
        setError(reason);
      });
      return true;
    }
    return false;
  };


  // ---- meta latching ---------------------------------------------------
  // pendingMeta keyed by init_seq; applied when the matching init chunk
  // is appended. avoids the ~12s drift between control-stream meta and
  // audio actually crossing into the new track.
  const pendingMeta = new Map<
    number,
    {
      now_playing: PublicNowPlaying;
      art_url: string | null;
      raw_art: { mime: string; data: string } | null;
      listener_count: number;
    }
  >();
  // most recent init_seq we've actually applied. interstitial / banner
  // meta updates from the broadcaster (e.g. "switching tracks…") arrive
  // tagged with the current init_seq so listeners see them immediately
  // rather than waiting for the next track's init chunk.
  let lastAppliedInit: number | null = null;

  const applyHello = (helloJson: string) => {
    if (!isActiveTune()) return;
    try {
      const msg = JSON.parse(helloJson);
      if (msg?.now_playing) {
        const np = coerceNowPlaying(msg.now_playing);
        if (np) {
          setNowPlaying(np);
          const rawArt = rawArtMetaFrom(msg.now_playing);
          swapArtUrl(artUrlFromRaw(msg.now_playing));
          maybeRecordHistory(
            np,
            rawArt,
            typeof msg?.init_seq === "number" ? msg.init_seq : undefined,
          );
        }
      }
      if (typeof msg?.listener_count === "number") {
        setListenerCount(msg.listener_count);
      }
      // seed the latch from the hello so any interstitial meta (init_seq
      // matching the current track) applies immediately even if it
      // arrives before the next chunk.
      if (typeof msg?.init_seq === "number") {
        lastAppliedInit = msg.init_seq;
      }
      if (listenStartedAtMs === 0) {
        listenStartedAtMs = Date.now();
      }
      setStatus("playing");
      startElapsedTicker();
      startDiagnostics();
    } catch (e) {
      console.warn("[radio] hello parse failed:", e);
    }
  };

  const applyMeta = (metaJson: string) => {
    if (!isActiveTune()) return;
    try {
      const msg = JSON.parse(metaJson);
      // dispatch lag / chunk_ready first — these are not metadata
      // updates, they're recovery / heartbeat signals routed through
      // the same json callback.
      if (applyControlSpecial(msg)) return;
      const initSeq = msg?.init_seq;
      const np = coerceNowPlaying(msg?.now_playing);
      if (typeof initSeq === "number" && np) {
        // interstitial / late-binding update for an already-playing track:
        // server tags it with the *current* init_seq so we apply it now.
        if (lastAppliedInit !== null && initSeq <= lastAppliedInit) {
          // only apply immediately when this is a metadata refresh for the
          // same song. if song_id changes here, applying early would make
          // the playerbar jump to the next track before its init chunk is
          // actually rendered.
          const currentSongId = nowPlaying()?.song_id ?? null;
          const incomingSongId = np.song_id ?? null;
          if (
            !currentSongId ||
            !incomingSongId ||
            incomingSongId === currentSongId
          ) {
            setNowPlaying(np);
            const rawArt = rawArtMetaFrom(msg.now_playing);
            swapArtUrl(artUrlFromRaw(msg.now_playing));
            if (typeof msg?.listener_count === "number") {
              setListenerCount(msg.listener_count);
            }
            maybeRecordHistory(np, rawArt, initSeq);
          } else {
            console.info(
              `[radio] deferring early meta for new song_id ${incomingSongId} (current ${currentSongId})`,
            );
          }
        } else {
          pendingMeta.set(initSeq, {
            now_playing: np,
            art_url: artUrlFromRaw(msg.now_playing),
            raw_art: rawArtMetaFrom(msg.now_playing),
            listener_count: msg.listener_count ?? listenerCount(),
          });
        }
      } else if (np) {
        // protocol drift: no init_seq → apply right away.
        setNowPlaying(np);
        const rawArt = rawArtMetaFrom(msg.now_playing);
        swapArtUrl(artUrlFromRaw(msg.now_playing));
        if (typeof msg?.listener_count === "number") {
          setListenerCount(msg.listener_count);
        }
        maybeRecordHistory(np, rawArt);
      }
    } catch (e) {
      console.warn("[radio] meta parse failed:", e);
    }
  };

  const onChunk = (seq: number, isInit: boolean, bytes: Uint8Array) => {
    if (!isActiveTune()) return;
    const now = Date.now();
    if (lastChunkAtMs !== null) {
      pushChunkGapSample(Math.max(0, now - lastChunkAtMs));
    }
    lastChunkAtMs = now;
    // post-Lag: discard everything until we see the init chunk the
    // broadcaster told us to resync on.
    if (resyncAtSeq !== null) {
      if (!isInit || seq < resyncAtSeq) {
        return;
      }
      resyncAtSeq = null;
    }
    if (isInit && pendingMeta.has(seq)) {
      const m = pendingMeta.get(seq)!;
      pendingMeta.delete(seq);
      setNowPlaying(m.now_playing);
      swapArtUrl(m.art_url ?? null);
      setListenerCount(m.listener_count);
      maybeRecordHistory(m.now_playing, m.raw_art, seq);
      // no-op for elapsed timer: live radio uses listener-session time,
      // not per-track playback position.
    } else if (isInit) {
      // no-op for elapsed timer: live radio uses listener-session time.
    }
    if (isInit) lastAppliedInit = seq;
    queue.push(bytes);
    drain();
  };

  // ---- iroh tune -------------------------------------------------------
  let handle: RadioHandleLike;
  try {
    handle = useLocal
      ? await tuneRadioCharnelLocal(opts.stationId, applyHello, applyMeta, onChunk)
      : useCharnel
        ? await tuneRadioCharnel(peerAddr, applyHello, applyMeta, onChunk)
        : await node!.tune_radio(peerAddr, applyHello, applyMeta, onChunk);
    if (!isActiveTune()) {
      try {
        handle.leave();
      } catch {
        // best effort
      }
      throw new Error("radio tune superseded by a newer attempt");
    }
  } catch (e) {
    if (isActiveTune()) {
      setStatus("error");
      setError(`tune failed: ${e}`);
    }
    URL.revokeObjectURL(audio.src);
    audio.removeAttribute("src");
    audio.load();
    throw e;
  }

  const session: RadioSession = {
    peerAddr,
    stationId: opts.stationId ?? null,
    stationName: opts.stationName ?? null,
    isLocal: useLocal,
    audio,
    leave: () => {
      try {
        handle.leave();
      } catch (e) {
        console.warn("[radio] handle.leave threw:", e);
      }
      try {
        audio.removeEventListener("waiting", onStall);
        audio.removeEventListener("stalled", onStall);
      } catch {
        // best effort
      }
      stopDiagnostics();
      try {
        audio.pause();
        URL.revokeObjectURL(audio.src);
        audio.removeAttribute("src");
        audio.load();
      } catch (e) {
        console.warn("[radio] audio teardown threw:", e);
      }
    },
  };
  activeSession = session;

  // persist the current radio station for resume on page reload
  const stationRef = {
    peer_addr: peerAddr,
    station_id: opts.stationId ?? undefined,
    station_name: opts.stationName ?? "(untitled station)",
    is_local: useLocal,
  };
  void setCurrentRadioStationPersisted(stationRef);

  return audio;
}

/**
 * coerce a meta `now_playing` blob into our `PublicNowPlaying` shape.
 * the wire format from the radio control stream sends the `NowPlaying`
 * struct (with `art: { mime, blob_id, data }`); the http `RadioInfo`
 * endpoint sends `art_blob_id` instead. this picks whichever fields are
 * present so views can render either source uniformly.
 */
function coerceNowPlaying(raw: unknown): PublicNowPlaying | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const np: PublicNowPlaying = {
    song_id: typeof r.song_id === "string" ? r.song_id : "",
    title: typeof r.title === "string" ? r.title : "(untitled)",
    artist: typeof r.artist === "string" ? r.artist : null,
    album: typeof r.album === "string" ? r.album : null,
    art_blob_id:
      typeof r.art_blob_id === "string"
        ? r.art_blob_id
        : isArt(r.art) && typeof r.art.blob_id === "string"
          ? r.art.blob_id
          : null,
    waveform_blob_id:
      typeof r.waveform_blob_id === "string" ? r.waveform_blob_id : null,
    duration_ms: typeof r.duration_ms === "number" ? r.duration_ms : null,
  };
  // best-effort validate via the generated zod schema; ignore on failure
  // so unexpected fields don't blow up playback.
  const parsed = schema.PublicNowPlayingSchema.safeParse(np);
  return parsed.success ? parsed.data : np;
}

function isArt(v: unknown): v is { blob_id?: unknown } {
  return !!v && typeof v === "object";
}

// ---- favorite (broadcasting peer) ------------------------------------
//
// the radio doesn't expose per-listener state, but if the broadcasting
// peer is a registered remote with an authenticated session we can call
// the remote's `music.setFavorite` / `music.querySongs` endpoints
// directly. when no remote is registered for the peer, both calls are
// no-ops and the heart stays disabled.

/** best-effort: read `is_favorite` for the given song from the
 * broadcasting peer's API and update `radioCurrentFavorite`. silently
 * leaves the signal as `null` when no remote is registered or the call
 * fails (e.g. unauthenticated session). */
async function fetchRadioFavorite(
  songId: string,
  peerAddr: string,
): Promise<void> {
  try {
    const remote = await getRemoteByPeerAddr(peerAddr);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const result = await client.music.querySongs({
      q: null,
      search_fields: null,
      filters: { song_ids: [songId] },
      sort_by: null,
      sort_direction: null,
      limit: 1,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });
    if (!result.success || result.data.items.length === 0) return;
    const fav = result.data.items[0].is_favorite;
    if (typeof fav === "boolean") setCurrentFavorite(fav);
  } catch (e) {
    console.warn("[radio] fetch favorite failed:", e);
  }
}

/** toggle the favorite for the currently-playing radio track on the
 * broadcasting peer. optimistically updates `radioCurrentFavorite` and
 * rolls back on failure. throws if no peer/remote is available. */
export async function setRadioFavorite(
  songId: string,
  isFavorite: boolean,
): Promise<void> {
  const peer = currentPeerAddr();
  if (!peer) throw new Error("no active radio session");
  const remote = await getRemoteByPeerAddr(peer);
  if (!remote) {
    throw new Error(
      "broadcasting peer is not a registered remote — cannot favorite",
    );
  }
  const previous = currentFavorite();
  setCurrentFavorite(isFavorite);
  try {
    const client = await getClientForRemote(remote);
    const result = await client.music.setFavorite({
      user_id: null,
      target_type: "song",
      target_id: songId,
      is_favorite: isFavorite,
    });
    if (!result.success) {
      throw new Error(
        "error" in result
          ? JSON.stringify(result.error)
          : "set favorite failed",
      );
    }
    if (!result.data?.success) {
      throw new Error(result.data?.message || "set favorite failed");
    }
  } catch (e) {
    setCurrentFavorite(previous);
    throw e;
  }
}
