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
import { pause as pausePlayerAudio } from "../../../music/services/audio/player";
import { recordHistoryEntry } from "./radioHistory";
import { setCurrentRadioStationPersisted } from "../storage/currentRadioStation";
import { getRemoteByPeerAddr, getTauriManagedRemote } from "../remotes/remoteManager";
import { getClientForRemote } from "../../api/client";
import {
  acknowledgeTimelineUserStart,
  startQueueModeAdapter,
  stopQueueModeAdapter,
} from "./radioQueueAdapter";

const MSE_CODEC = 'audio/mp4; codecs="mp4a.40.2"';

// detect MSE support once at module init. mobile safari and some other
// environments lack MediaSource; those listeners must use timeline/queue mode.
const hasMSE =
  typeof window !== "undefined" &&
  typeof (window as unknown as { MediaSource?: unknown }).MediaSource ===
    "function";

type RadioModeCapability = "chunk_stream" | "timeline_seed";

interface RadioTimelineCurrentItem {
  timeline_item_id: string;
  song_id: string;
  start_at_ms: number;
  duration_ms: number | null;
}

interface RadioTimelineUpcomingItem {
  timeline_item_id: string;
  song_id: string;
  planned_start_at_ms: number;
  duration_ms: number | null;
}

interface RadioTimelineSnapshot {
  station_id: string;
  timeline_seq: number;
  station_epoch_ms: number;
  generated_at_ms: number;
  current: RadioTimelineCurrentItem | null;
  upcoming: RadioTimelineUpcomingItem[];
  lookahead_count: number;
}

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
const [currentIsLocal, setCurrentIsLocal] = createSignal<boolean>(false);
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
const [modeCapabilities, setModeCapabilities] = createSignal<
  RadioModeCapability[]
>([]);
const [timelineSeedActive, setTimelineSeedActive] = createSignal<boolean>(
  false,
);
const [timelineSnapshot, setTimelineSnapshot] =
  createSignal<RadioTimelineSnapshot | null>(null);
// true when this client should use queue/timeline mode rather than MSE chunk
// streaming. auto-set when: MSE is unavailable (mobile safari), the
// broadcaster has forced timeline-only for this station, or the listener
// has experienced too many resyncs indicating a poor network.
const [useTimelineMode, setUseTimelineMode] = createSignal<boolean>(!hasMSE);

// listening elapsed time signal (milliseconds since this listener started
// hearing the current radio session). this is intentionally independent of
// track timing/seek position because live radio is not seekable.
const [elapsedMs, setElapsedMs] = createSignal<number>(0);
let listenStartedAtMs = 0;
let listenedAccumulatedMs = 0;
let elapsedTickHandle: number | null = null;
let lastConfirmedHistoryTrackKey: string | null = null;

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
export const radioCurrentIsLocal = currentIsLocal;
export const radioCurrentRemoteServerId = currentRemoteServerId;
export const radioCurrentFavorite = currentFavorite;
export const radioElapsedMs = elapsedMs;
export const radioStabilityMode = stabilityMode;
export const radioModeCapabilities = modeCapabilities;
export const radioTimelineSeedActive = timelineSeedActive;
export const radioTimelineSnapshot = timelineSnapshot;
export const radioUseTimelineMode = useTimelineMode;

export function recordCurrentRadioTrackHistory(track: {
  songId: string | null;
  title: string;
  artist?: string | null;
  album?: string | null;
  durationMs?: number | null;
  artBlobId?: string | null;
  artThumb?: { mime?: string; data?: string } | null;
  historyKey: string;
}): void {
  const songId = track.songId?.trim() ? track.songId.trim() : null;
  const np = {
    song_id: songId ?? "",
    title: track.title,
    artist: track.artist ?? null,
    album: track.album ?? null,
    art_blob_id: track.artBlobId ?? null,
    waveform_blob_id: null,
    duration_ms: track.durationMs ?? null,
    art_thumb_b64: track.artThumb?.data ?? null,
    art_thumb_mime: track.artThumb?.mime ?? null,
  } satisfies PublicNowPlaying;
  if (!shouldRecordRadioHistoryEntry(np, songId)) return;
  if (track.historyKey === lastConfirmedHistoryTrackKey) return;

  const peerAddr = currentPeerAddr() ?? activeSession?.peerAddr ?? pausedContext?.peerAddr ?? null;
  if (!peerAddr) return;

  lastConfirmedHistoryTrackKey = track.historyKey;
  setCurrentFavorite(null);
  if (songId) {
    void fetchRadioFavorite(songId, peerAddr);
  }

  void recordHistoryEntry({
    station_id: currentStationId(),
    station_name: activeSession?.stationName ?? pausedContext?.stationName ?? null,
    peer_addr: peerAddr,
    song_id: songId,
    title: track.title,
    artist: track.artist ?? null,
    album: track.album ?? null,
    duration_ms: track.durationMs ?? null,
    art_blob_id: track.artBlobId ?? null,
    art_thumb_b64: track.artThumb?.data ?? null,
    art_thumb_mime: track.artThumb?.mime ?? null,
  }).catch((e) => console.warn("[radio] history write failed:", e));
}

// keep radio metadata in sync during timeline-mode transitions even when
// the broadcaster emits sparse meta payloads (e.g. admin skip edges).
export function applyTimelineNowPlaying(track: {
  songId: string | null;
  title: string;
  artist?: string | null;
  album?: string | null;
  durationMs?: number | null;
  artBlobId?: string | null;
  artUrl?: string | null;
  artThumb?: { mime?: string; data?: string } | null;
}): void {
  const songId = track.songId?.trim() ? track.songId.trim() : "";
  const prevSongId = nowPlaying()?.song_id?.trim() || "";
  
  console.info(
    "[radioService] applyTimelineNowPlaying — from:", prevSongId, "to:", songId,
    "title:", track.title
  );
  
  if (track.artUrl !== undefined) {
    swapArtUrl(track.artUrl ?? null);
  } else if (songId && prevSongId && songId !== prevSongId) {
    // inline art may arrive later via broadcaster Meta; clear stale art now.
    swapArtUrl(null);
  }
  setNowPlaying({
    song_id: songId,
    title: track.title,
    artist: track.artist ?? null,
    album: track.album ?? null,
    art_blob_id: track.artBlobId ?? null,
    waveform_blob_id: null,
    duration_ms: track.durationMs ?? null,
    art_thumb_b64: track.artThumb?.data ?? null,
    art_thumb_mime: track.artThumb?.mime ?? null,
  });
}

// timeline mode (no MSE or forced timeline-only) should only be marked
// "playing" after the queue adapter successfully starts local audio.
export function markTimelinePlaybackStarted(): void {
  if (listenStartedAtMs === 0) {
    listenStartedAtMs = Date.now();
  }
  setError(null);
  setStatus("playing");
  startElapsedTicker();
}

export function markTimelinePlaybackBlocked(reason: string): void {
  // only treat this as a hard error while in timeline mode.
  if (!useTimelineMode()) return;
  stopElapsedTicker();
  setStatus("error");
  setError(reason);
}

// iOS Safari can block async audio.play() in timeline mode even after a
// user tuned into a station. when that happens, pause the radio session
// immediately (to avoid background churn) and ask the user to tap play.
export function handleTimelineAutoplayBlocked(): void {
  if (!useTimelineMode()) return;
  // no autoplay UX: when platform blocks implicit play, keep session
  // paused and silent until the user explicitly presses play.
  setError(null);
  if (status() === "playing" || status() === "connecting") {
    radioPause();
    return;
  }
  setStatus("paused");
}

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
  if (useTimelineMode()) {
    try {
      pausePlayerAudio();
    } catch (e) {
      console.warn("[radio] pause: player audio pause threw:", e);
    }
  }
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
  lastConfirmedHistoryTrackKey = null;
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
  setCurrentIsLocal(false);
  setCurrentRemoteServerId(null);
  setCurrentFavorite(null);
  setModeCapabilities([]);
  setTimelineSeedActive(false);
  setTimelineSnapshot(null);
  // reset timeline mode back to the MSE-availability baseline so a
  // subsequent tune to a different station isn't stuck in timeline mode
  // just because the previous one had poor network or forced it.
  setUseTimelineMode(!hasMSE);
  stopQueueModeAdapter();
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

function coerceModeCapabilities(raw: unknown): RadioModeCapability[] {
  if (!Array.isArray(raw)) return [];
  const out: RadioModeCapability[] = [];
  for (const item of raw) {
    if ((item === "chunk_stream" || item === "timeline_seed") && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

function coerceTimelineSnapshot(raw: unknown): RadioTimelineSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as {
    station_id?: unknown;
    timeline_seq?: unknown;
    station_epoch_ms?: unknown;
    generated_at_ms?: unknown;
    current?: unknown;
    upcoming?: unknown;
    lookahead_count?: unknown;
  };

  if (
    typeof x.station_id !== "string" ||
    typeof x.timeline_seq !== "number" ||
    typeof x.station_epoch_ms !== "number" ||
    typeof x.generated_at_ms !== "number"
  ) {
    return null;
  }

  const parseCurrent = (item: unknown): RadioTimelineCurrentItem | null => {
    if (!item || typeof item !== "object") return null;
    const y = item as {
      timeline_item_id?: unknown;
      song_id?: unknown;
      start_at_ms?: unknown;
      duration_ms?: unknown;
    };
    if (
      typeof y.timeline_item_id !== "string" ||
      typeof y.song_id !== "string" ||
      typeof y.start_at_ms !== "number"
    ) {
      return null;
    }
    return {
      timeline_item_id: y.timeline_item_id,
      song_id: y.song_id,
      start_at_ms: y.start_at_ms,
      duration_ms: typeof y.duration_ms === "number" ? y.duration_ms : null,
    };
  };

  const parseUpcoming = (item: unknown): RadioTimelineUpcomingItem | null => {
    if (!item || typeof item !== "object") return null;
    const y = item as {
      timeline_item_id?: unknown;
      song_id?: unknown;
      planned_start_at_ms?: unknown;
      duration_ms?: unknown;
    };
    if (
      typeof y.timeline_item_id !== "string" ||
      typeof y.song_id !== "string" ||
      typeof y.planned_start_at_ms !== "number"
    ) {
      return null;
    }
    return {
      timeline_item_id: y.timeline_item_id,
      song_id: y.song_id,
      planned_start_at_ms: y.planned_start_at_ms,
      duration_ms: typeof y.duration_ms === "number" ? y.duration_ms : null,
    };
  };

  const current = parseCurrent(x.current);
  const upcoming = Array.isArray(x.upcoming)
    ? x.upcoming
        .map(parseUpcoming)
        .filter((u): u is RadioTimelineUpcomingItem => u !== null)
    : [];

  return {
    station_id: x.station_id,
    timeline_seq: x.timeline_seq,
    station_epoch_ms: x.station_epoch_ms,
    generated_at_ms: x.generated_at_ms,
    current,
    upcoming,
    lookahead_count:
      typeof x.lookahead_count === "number" ? x.lookahead_count : upcoming.length,
  };
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
  /** when false, timeline mode waits for a separate explicit play action. */
  userInitiated?: boolean;
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
  console.info("[radio] tuneIntoRadio — hasMSE:", hasMSE, "useTimelineMode:", useTimelineMode(), "peerAddr:", peerAddr);
  const tuneAttemptId = bumpTuneAttemptId();
  const isActiveTune = () => tuneAttemptId === activeTuneAttemptId;

  const guarded = (fn: () => void) => {
    if (!isActiveTune()) return;
    fn();
  };

  const expectedStationId = opts.stationId?.trim() || null;
  if (opts.userInitiated !== false) {
    acknowledgeTimelineUserStart();
  }

  // fallback sequencing when timeline snapshots are missing but
  // now_playing metadata is present (common during mixed-version rollout).
  let fallbackTimelineSeq = 0;
  const synthesizeTimelineFromNowPlaying = (
    np: PublicNowPlaying,
    source: "hello" | "meta",
  ) => {
    if (!isActiveTune() || !useTimelineMode()) return;
    const songId = (np.song_id ?? "").trim();
    if (!songId) return;

    const prev = timelineSnapshot();
    const sameSong = prev?.current?.song_id === songId;
    const now = Date.now();
    fallbackTimelineSeq += 1;

    const snapshot: RadioTimelineSnapshot = {
      station_id: currentStationId() ?? opts.stationId ?? "unknown_station",
      timeline_seq: (prev?.timeline_seq ?? 0) + 1,
      station_epoch_ms: prev?.station_epoch_ms ?? now,
      generated_at_ms: now,
      current: sameSong
        ? {
            timeline_item_id: prev!.current!.timeline_item_id,
            song_id: prev!.current!.song_id,
            start_at_ms: prev!.current!.start_at_ms,
            duration_ms: np.duration_ms ?? prev!.current!.duration_ms,
          }
        : {
            timeline_item_id: `fallback-${songId}-${fallbackTimelineSeq}`,
            song_id: songId,
            start_at_ms: now,
            duration_ms: np.duration_ms ?? null,
          },
      upcoming: [],
      lookahead_count: 0,
    };

    console.info(
      "[radio] synthesized timeline snapshot from",
      source,
      "song_id:",
      songId,
      "sameSong:",
      sameSong,
    );
    setTimelineSnapshot(snapshot);
  };

  // make sure local music isn't competing for the speakers.
  await stopMusicForRadio();
  if (!isActiveTune()) {
    throw new Error("radio tune superseded by a newer attempt");
  }

  setStatus("connecting");
  setCurrentPeerAddr(peerAddr);
  setCurrentStationId(opts.stationId ?? null);

  // pick transport: charnel/tauri uses the native iroh path via
  // `radio_tune` IPC commands (or `radio_tune_local` for self-listen);
  // everywhere else uses midden wasm.
  const useCharnel = isCharnelAvailable();
  const useLocal = !!opts.isLocal && useCharnel;
  setCurrentIsLocal(useLocal);
  if (useLocal) {
    // local self-listen has no peer-address match in remotes table.
    // pin the tauri-managed remote id for blob/waveform lookups.
    void getTauriManagedRemote()
      .then((r) => {
        guarded(() => setCurrentRemoteServerId(r?.remote_id ?? null));
      })
      .catch(() => {
        guarded(() => setCurrentRemoteServerId(null));
      });
  } else {
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
  }
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
  audio.autoplay = false;
  audio.preload = "auto";
  if (ownsAudio) {
    // only override volume on transient elements; the sink owns volume.
    audio.volume = 1.0;
  }

  // on environments without MediaSource (mobile safari, some webviews)
  // ms stays null and we rely entirely on the timeline/queue adapter.
  const ms: MediaSource | null = hasMSE
    ? new (globalThis as unknown as { MediaSource: new () => MediaSource }).MediaSource()
    : null;
  if (ms) {
    audio.src = URL.createObjectURL(ms);
  }

  let sb: SourceBuffer | null = null;
  const queue: Uint8Array[] = [];
  let seekedToLive = false;
  let chunkPlayStarted = false;
  let chunkAutoplayBlocked = false;

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
    if (!useTimelineMode() && sb.buffered.length > 0) {
      tryStartChunkPlayback("buffer ready");
    }
  };

  const tryStartChunkPlayback = (reason: string) => {
    if (!isActiveTune()) return;
    if (useTimelineMode()) return;
    if (chunkPlayStarted || chunkAutoplayBlocked) return;
    console.info(`[radio] attempting chunk playback (${reason})`);
    void audio
      .play()
      .then(() => {
        if (!isActiveTune()) return;
        if (chunkPlayStarted) return;
        chunkPlayStarted = true;
        if (listenStartedAtMs === 0) {
          listenStartedAtMs = Date.now();
        }
        setError(null);
        setStatus("playing");
        startElapsedTicker();
        console.info("[radio] chunk playback started");
      })
      .catch((e) => {
        if (!isActiveTune()) return;
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
          chunkAutoplayBlocked = true;
          stopElapsedTicker();
          setStatus("paused");
          setError("radio playback was blocked by browser autoplay policy; press play to retry");
          console.warn("[radio] chunk playback blocked by autoplay policy");
          return;
        }
        // keep session in connecting state for transient startup failures;
        // next buffered update may successfully start playback.
        console.warn("[radio] chunk playback attempt failed:", e);
      });
  };

  // ---- recovery state ---------------------------------------------------
  if (ms) {
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
  }

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
  if (ms) {
    audio.addEventListener("waiting", onStall);
    audio.addEventListener("stalled", onStall);
    audio.addEventListener("playing", () => {
      console.info("[radio] media element event: playing");
    });
    audio.addEventListener("pause", () => {
      console.info("[radio] media element event: pause");
    });
    audio.addEventListener("error", () => {
      const mediaError = audio.error;
      console.warn(
        "[radio] media element error:",
        mediaError
          ? {
              code: mediaError.code,
              message: mediaError.message,
            }
          : "unknown",
      );
    });
  }

  /** rebuild the SourceBuffer fresh — used after a Lag notice. */
  const resetSourceBuffer = (resyncSeq: number) => {
    if (!isActiveTune() || !ms) return;
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
      // if we have a timeline snapshot, switch to timeline/queue mode so
      // the listener keeps hearing music instead of seeing an error.
      // (poor network → prefer queue mode over repeated resync loops)
      if (timelineSnapshot() !== null && !useTimelineMode()) {
        console.info(
          `[radio] ${recentLags.length} resyncs in the last minute — falling back to timeline/queue mode`,
        );
        setUseTimelineMode(true);
        // don't set error state; the queue adapter will take over.
      } else {
        setStatus("error");
        setError(
          `connection unstable — ${recentLags.length} resyncs in the last minute`,
        );
      }
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
    if (msg.type === "timeline") {
      const snapshot = coerceTimelineSnapshot(msg);
      if (snapshot) {
        if (expectedStationId && snapshot.station_id !== expectedStationId) {
          console.error(
            `[radio] station mismatch: expected ${expectedStationId}, got timeline for ${snapshot.station_id}`,
          );
          leaveRadio();
          guarded(() => {
            setStatus("error");
            setError(
              `station mismatch: expected ${expectedStationId}, got ${snapshot.station_id}`,
            );
          });
          return true;
        }
        if (!currentStationId()) {
          setCurrentStationId(snapshot.station_id);
        }
        console.info("[radio] timeline snapshot received — seq:", snapshot.timeline_seq, "current:", snapshot.current?.song_id ?? "null", "upcoming:", snapshot.upcoming.length);
        setTimelineSnapshot(snapshot);
      } else {
        console.warn("[radio] timeline message failed to parse:", msg);
      }
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
  // track whether we have received real media data on the chunk stream.
  // keeps the player status in "connecting" until bytes actually arrive.
  let sawFirstChunk = false;

  const applyHello = (helloJson: string) => {
    if (!isActiveTune()) return;
    try {
      const msg = JSON.parse(helloJson);
      if (msg?.now_playing) {
        const helloStationId =
          typeof msg.now_playing.station_id === "string" &&
          msg.now_playing.station_id.trim().length > 0
            ? msg.now_playing.station_id.trim()
            : null;
        if (expectedStationId && helloStationId && helloStationId !== expectedStationId) {
          console.error(
            `[radio] station mismatch: expected ${expectedStationId}, got hello for ${helloStationId}`,
          );
          leaveRadio();
          guarded(() => {
            setStatus("error");
            setError(
              `station mismatch: expected ${expectedStationId}, got ${helloStationId}`,
            );
          });
          return;
        }
        if (!currentStationId() && helloStationId) {
          setCurrentStationId(helloStationId);
        }
        const np = coerceNowPlaying(msg.now_playing);
        if (np) {
          setNowPlaying(np);
          synthesizeTimelineFromNowPlaying(np, "hello");
          swapArtUrl(artUrlFromRaw(msg.now_playing));
        }
      }
      if (typeof msg?.listener_count === "number") {
        setListenerCount(msg.listener_count);
      }
      setModeCapabilities(coerceModeCapabilities(msg?.radio_mode_capabilities));
      setTimelineSeedActive(msg?.timeline_seed_active === true);
      // broadcaster-forced timeline-only: server told us not to expect an
      // audio uni stream regardless of our own MSE capability.
      if (msg?.broadcaster_timeline_only === true) {
        if (!useTimelineMode()) {
          console.info("[radio] broadcaster_timeline_only: switching to timeline/queue mode");
          setUseTimelineMode(true);
        }
      }
      // seed the latch from the hello so any interstitial meta (init_seq
      // matching the current track) applies immediately even if it
      // arrives before the next chunk.
      if (typeof msg?.init_seq === "number") {
        lastAppliedInit = msg.init_seq;
      }
      const capabilities = coerceModeCapabilities(msg?.radio_mode_capabilities);
      const timelineModeActive =
        useTimelineMode() || msg?.broadcaster_timeline_only === true;
      console.info(
        "[radio] hello mode handshake:",
        JSON.stringify({
          use_timeline_mode: useTimelineMode(),
          broadcaster_timeline_only: msg?.broadcaster_timeline_only === true,
          capabilities,
          timeline_mode_active: timelineModeActive,
          init_seq:
            typeof msg?.init_seq === "number" ? msg.init_seq : null,
        }),
      );
      if (timelineModeActive) {
        // wait for queue adapter playSong() success before reporting
        // "playing"; this avoids false-playing UI with silent audio.
        stopElapsedTicker();
        setStatus("connecting");
      } else {
        // chunk mode should only flip to "playing" after first media
        // bytes arrive. until then, keep the UI in a truthful connecting
        // state.
        stopElapsedTicker();
        setStatus("connecting");
      }
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
            synthesizeTimelineFromNowPlaying(np, "meta");
            swapArtUrl(artUrlFromRaw(msg.now_playing));
            if (typeof msg?.listener_count === "number") {
              setListenerCount(msg.listener_count);
            }
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
        synthesizeTimelineFromNowPlaying(np, "meta");
        swapArtUrl(artUrlFromRaw(msg.now_playing));
        if (typeof msg?.listener_count === "number") {
          setListenerCount(msg.listener_count);
        }
      }
    } catch (e) {
      console.warn("[radio] meta parse failed:", e);
    }
  };

  const onChunk = (seq: number, isInit: boolean, bytes: Uint8Array) => {
    if (!isActiveTune() || !ms) return;
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      if (!useTimelineMode() && !isInit) {
        tryStartChunkPlayback("first chunk");
      }
      console.info(
        `[radio] first chunk received (seq=${seq}, init=${isInit}, bytes=${bytes.byteLength})`,
      );
    }
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
      if (!useTimelineMode()) {
        recordCurrentRadioTrackHistory({
          songId: m.now_playing.song_id?.trim() || null,
          title: m.now_playing.title,
          artist: m.now_playing.artist ?? null,
          album: m.now_playing.album ?? null,
          durationMs: m.now_playing.duration_ms ?? null,
          artBlobId: m.now_playing.art_blob_id ?? null,
          artThumb: m.raw_art,
          historyKey: `init:${seq}`,
        });
      }
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
  let timelineBootstrapTimer: number | null = null;
  let chunkBootstrapTimer: number | null = null;
  try {
    handle = useLocal
      ? await tuneRadioCharnelLocal(opts.stationId, applyHello, applyMeta, onChunk)
      : useCharnel
        ? await tuneRadioCharnel(peerAddr, opts.stationId, applyHello, applyMeta, onChunk)
        : await node!.tune_radio(peerAddr, opts.stationId, applyHello, applyMeta, onChunk);
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
    if (ms) URL.revokeObjectURL(audio.src);
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
      if (timelineBootstrapTimer !== null) {
        window.clearTimeout(timelineBootstrapTimer);
        timelineBootstrapTimer = null;
      }
      if (chunkBootstrapTimer !== null) {
        window.clearTimeout(chunkBootstrapTimer);
        chunkBootstrapTimer = null;
      }
      try {
        audio.pause();
        if (ms) URL.revokeObjectURL(audio.src);
        audio.removeAttribute("src");
        audio.load();
      } catch (e) {
        console.warn("[radio] audio teardown threw:", e);
      }
    },
  };
  activeSession = session;

  // start the queue-mode adapter; it watches useTimelineMode() + the
  // timeline snapshot reactively and is a no-op when MSE streaming is
  // active. safe to call unconditionally — it only drives playback when
  // radioUseTimelineMode() is true.
  startQueueModeAdapter();

  // in timeline mode, fail fast if we never receive any timeline/metadata
  // signal capable of driving queue playback.
  if (useTimelineMode()) {
    timelineBootstrapTimer = window.setTimeout(() => {
      if (!isActiveTune()) return;
      if (!useTimelineMode()) return;
      if (timelineSnapshot() !== null) return;
      console.warn(
        "[radio] timeline bootstrap timeout: no timeline snapshot received after 12s",
      );
      setStatus("error");
      setError(
        "timeline mode could not start: broadcaster did not provide timeline snapshots",
      );
    }, 12_000);
  } else if (ms) {
    chunkBootstrapTimer = window.setTimeout(() => {
      if (!isActiveTune()) return;
      if (useTimelineMode()) return;
      if (sawFirstChunk) return;
      console.warn(
        "[radio] chunk bootstrap timeout: no audio chunks received after 12s",
      );
      setStatus("error");
      setError(
        "radio audio stream did not start: no chunks received from broadcaster",
      );
    }, 12_000);
  }

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
