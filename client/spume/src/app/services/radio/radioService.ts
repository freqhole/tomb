// radio service: tunes into a freqhole-radio/1 broadcaster via midden,
// pumps fMP4/AAC (or, for a video-carrying station, fMP4/AAC+H264) chunks
// into a MediaSource attached to a <video> element, and surfaces meta
// updates as solid signals.
//
// public API:
//   - tuneInto(peerAddr, opts?) → returns { audio, leave } + state signals
//   - currentSession() → currently-tuned session, if any
//   - leave() → tear down current session
//   - radioState() → coarse status signal: 'idle' | 'connecting' | 'playing' | 'error'

import { batch, createSignal } from "solid-js";
import type { PublicNowPlaying } from "@freqhole/api-client";
import type { RadioHandleLike } from "@freqhole/api-client";
import { getMiddenNode, isCharnelAvailable } from "../../api/client";
import { tuneRadioCharnel, tuneRadioCharnelLocal } from "./charnelRadioAdapter";
import { registerStopRadio, registerVolumeMirror, stopMusicForRadio } from "../playbackCoordinator";
import { pause as pausePlayerAudio } from "../../../music/services/audio/player";
import { recordHistoryEntry } from "./radioHistory";
import {
  type RadioModeCapability,
  type RadioTimelineSnapshot,
  rawArtMetaFrom,
  artUrlFromRaw,
  coerceModeCapabilities,
  coerceTimelineSnapshot,
  coerceNowPlaying,
} from "./radioCoercion";
import {
  currentRadioStation,
  setCurrentRadioStationPersisted,
} from "../storage/currentRadioStation";
import {
  getRemoteByPeerAddr,
  getTauriManagedRemote,
  getRemoteById,
} from "../remotes/remoteManager";
import { getClientForRemote } from "../../api/client";
import {
  currentFavorite,
  setCurrentFavorite,
  fetchRadioFavorite,
  setRadioFavoriteForPeer,
} from "./radioFavorite";

// queue-mode adapter api injected at module init via
// `registerQueueAdapter`. avoids a static import cycle
// (radioService imports adapter; adapter imports state/helpers from
// radioService). adapter calls `registerQueueAdapter` once at its
// module load; AppLayout's static import of the adapter ensures it
// loads.
interface QueueAdapterApi {
  acknowledgeTimelineUserStart: () => void;
  startQueueModeAdapter: () => void;
  stopQueueModeAdapter: () => void;
}
let queueAdapter: QueueAdapterApi | null = null;
export function registerQueueAdapter(api: QueueAdapterApi): void {
  queueAdapter = api;
}
function acknowledgeTimelineUserStart(): void {
  queueAdapter?.acknowledgeTimelineUserStart();
}
function startQueueModeAdapter(): void {
  queueAdapter?.startQueueModeAdapter();
}
function stopQueueModeAdapter(): void {
  queueAdapter?.stopQueueModeAdapter();
}

// fallback only - the real codec for a SourceBuffer always comes from
// the station's own Hello.codec (see applyHello), which may differ for
// a video-carrying station. used only if Hello is somehow missing one.
const MSE_CODEC = 'audio/mp4; codecs="mp4a.40.2"';

type ManagedMediaSourceCtor = new () => MediaSource;

// safari (iOS 17.1+) added a separate, power-conscious `ManagedMediaSource`
// API alongside classic `MediaSource` - undetected by a `window.MediaSource`
// check alone, which would wrongly force those devices into timeline/queue
// mode even though they can chunk-stream. attach path is `srcObject` on our
// persistent <video> element (below) - confirmed working on a real iPhone
// (iOS 18.7), but only once `audio.disableRemotePlayback = true` is set
// before the `srcObject` assignment; without it, WebKit never fires
// `sourceopen` at all (see where `disableRemotePlayback` is set, below).
const managedMediaSourceCtor: ManagedMediaSourceCtor | null =
  typeof window !== "undefined" &&
  typeof (window as unknown as { ManagedMediaSource?: unknown }).ManagedMediaSource === "function"
    ? (window as unknown as { ManagedMediaSource: ManagedMediaSourceCtor }).ManagedMediaSource
    : null;

// detect MSE support once at module init. mobile safari and some other
// environments lack both MediaSource and ManagedMediaSource; those
// listeners must use timeline/queue mode.
const hasMSE =
  (typeof window !== "undefined" &&
    typeof (window as unknown as { MediaSource?: unknown }).MediaSource === "function") ||
  managedMediaSourceCtor !== null;

export type RadioStatus = "idle" | "connecting" | "playing" | "paused" | "error";

interface RadioSession {
  peerAddr: string;
  stationId: string | null;
  stationName: string | null;
  isLocal: boolean;
  // a <video> element regardless of station content_mode - an audio-only
  // station just never gets real frames painted to it. see getRadioVideoElement.
  audio: HTMLVideoElement;
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
const [currentStationId, setCurrentStationId] = createSignal<string | null>(null);
const [currentIsLocal, setCurrentIsLocal] = createSignal<boolean>(false);
// resolved remote_server_id for the currently-tuned peer (used by the player
// bar to fetch the waveform blob from the right backend). null while
// resolving or when no matching remote is configured locally.
const [currentRemoteServerId, setCurrentRemoteServerId] = createSignal<string | null>(null);
// human-readable sub-status for the "connecting" phase (player bar shows
// this instead of the listener count while tuning, since a raw "tuning"
// label with no further detail reads as stuck even when it's progressing
// normally - see `drain()`/`tuneIntoRadio` for where this gets updated).
const [connectPhase, setConnectPhase] = createSignal<string>("");
// favorite state for the currently-playing radio track. mirrors the
// remote's `is_favorite` for the broadcasting peer + currently-logged-in
// user; reset on every track transition. null = unknown / not yet
// fetched (also covers "no registered remote for this peer" case where
// we can't talk to a favorites endpoint at all).
// conservative buffering (slower resync triggers, bigger stall-recovery
// baseline — see STALL_RECOVERY_BASELINE_MS et al below) defaults on
// now: nothing ever called setRadioStabilityMode to flip this true, so
// every listener has always run on the smaller/tighter baseline
// regardless of link quality.
const [stabilityMode, setStabilityMode] = createSignal<boolean>(true);
const [modeCapabilities, setModeCapabilities] = createSignal<RadioModeCapability[]>([]);
const [timelineSeedActive, setTimelineSeedActive] = createSignal<boolean>(false);
const [timelineSnapshot, setTimelineSnapshot] = createSignal<RadioTimelineSnapshot | null>(null);
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
    const inFlight = listenStartedAtMs > 0 ? Math.max(0, now - listenStartedAtMs) : 0;
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
// optional persistent <video> element supplied by RadioAudioSink. when set,
// new tunes attach their MediaSource to it instead of creating a fresh
// element. keeps playback alive across navigation and gives the global
// player bar a stable target for volume + visibility, and (for a
// video-carrying station) a real surface to paint video frames onto.
let audioSink: HTMLVideoElement | null = null;

// active radio listen session — created on first playback start, closed on
// leaveRadio. one per active tune. used purely for feed visibility ("user
// tuned into station X"); no per-track tracking.
interface RadioListenSession {
  sessionId: string;
  remoteId: string;
}
let activeRadioListenSession: RadioListenSession | null = null;
// guards against double-create races between chunk-mode and timeline-mode
// playback-start callbacks.
let radioListenSessionCreating = false;

async function ensureRadioListenSession(): Promise<void> {
  if (activeRadioListenSession || radioListenSessionCreating) return;
  const sess = activeSession;
  if (!sess) return;
  const stationId = sess.stationId ?? currentStationId();
  if (!stationId) return;
  const label = sess.stationName?.trim() || "(untitled station)";

  radioListenSessionCreating = true;
  try {
    const remote = sess.isLocal
      ? await getTauriManagedRemote()
      : await getRemoteByPeerAddr(sess.peerAddr);
    if (!remote) {
      console.warn("[radio] ensureRadioListenSession: no remote for tune");
      return;
    }
    const client = await getClientForRemote(remote);
    const result = await client.music.createPlaybackSession({
      session_type: "radio",
      entity_id: stationId,
      label,
      items: [],
      total_items: 0,
      total_duration_ms: 0,
    });
    if (result.success) {
      activeRadioListenSession = {
        sessionId: result.data.id,
        remoteId: remote.remote_id ?? "",
      };
      console.info("[radio] created listen session", result.data.id, "for station", stationId);
    } else {
      console.warn(
        "[radio] createPlaybackSession failed:",
        (result as { success: false; error: unknown }).error
      );
    }
  } catch (e) {
    console.warn("[radio] ensureRadioListenSession threw:", e);
  } finally {
    radioListenSessionCreating = false;
  }
}

async function endRadioListenSession(
  status: "completed" | "abandoned" = "completed"
): Promise<void> {
  const sess = activeRadioListenSession;
  if (!sess) return;
  activeRadioListenSession = null;
  try {
    const remote = await getRemoteById(sess.remoteId);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    await client.music.updatePlaybackSessionStatus(sess.sessionId, status);
  } catch (e) {
    console.warn("[radio] endRadioListenSession threw:", e);
  }
}

export const radioStatus = status;
export const radioError = error;
export const radioNowPlaying = nowPlaying;
export const radioArtUrl = artUrl;
export const radioListenerCount = listenerCount;
export const radioCurrentPeerAddr = currentPeerAddr;
export const radioCurrentStationId = currentStationId;
export const radioCurrentIsLocal = currentIsLocal;
export const radioCurrentRemoteServerId = currentRemoteServerId;
export const radioConnectPhase = connectPhase;
export const radioCurrentFavorite = currentFavorite;
export const radioElapsedMs = elapsedMs;
export const radioStabilityMode = stabilityMode;
export const radioModeCapabilities = modeCapabilities;
export const radioTimelineSeedActive = timelineSeedActive;
export const radioTimelineSnapshot = timelineSnapshot;
export const radioUseTimelineMode = useTimelineMode;

// true whenever the player bar shows radio playback state (connecting,
// playing, paused, or a station queued up) - used by list views to reserve
// bottom space for the player bar even when the regular song queue is empty.
export function isRadioPlayerBarActive(): boolean {
  return status() !== "idle" || !!currentRadioStation();
}

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
    // history recording only handles songs today - see plan doc.
    kind: "song",
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

  console.info(
    "[radioService] applyTimelineNowPlaying — from:",
    nowPlaying()?.song_id?.trim() || "",
    "to:",
    songId,
    "title:",
    track.title
  );

  if (track.artUrl !== undefined) {
    swapArtUrl(track.artUrl ?? null);
  }
  setNowPlaying({
    // timeline/queue mode is song-only today - see plan doc.
    kind: "song",
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
  batch(() => {
    setError(null);
    setStatus("playing");
  });
  startElapsedTicker();
  void ensureRadioListenSession();
}

export function markTimelinePlaybackBlocked(reason: string): void {
  // only treat this as a hard error while in timeline mode.
  if (!useTimelineMode()) return;
  stopElapsedTicker();
  batch(() => {
    setStatus("error");
    setError(reason);
  });
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

const TIMELINE_RECONNECT_BASE_MS = 2_000;
const TIMELINE_RECONNECT_MAX_MS = 30_000;
let timelineReconnectTimer: number | null = null;
let timelineReconnectDelayMs = TIMELINE_RECONNECT_BASE_MS;

function bumpTuneAttemptId(): number {
  activeTuneAttemptId = (activeTuneAttemptId + 1) >>> 0;
  if (activeTuneAttemptId === 0) activeTuneAttemptId = 1;
  return activeTuneAttemptId;
}

function clearTimelineReconnect(): void {
  if (timelineReconnectTimer !== null) {
    window.clearTimeout(timelineReconnectTimer);
    timelineReconnectTimer = null;
  }
  timelineReconnectDelayMs = TIMELINE_RECONNECT_BASE_MS;
}

function scheduleTimelineReconnect(peerAddr: string, opts: TuneOptions, reason: string): void {
  if (!peerAddr || timelineReconnectTimer !== null) return;

  const delayMs = timelineReconnectDelayMs;
  timelineReconnectDelayMs = Math.min(
    TIMELINE_RECONNECT_MAX_MS,
    Math.floor(timelineReconnectDelayMs * 1.8)
  );

  console.info(`[radio] timeline session ended (${reason}); reconnecting in ${delayMs}ms`);

  timelineReconnectTimer = window.setTimeout(() => {
    timelineReconnectTimer = null;
    void tuneIntoRadio(peerAddr, {
      ...opts,
      userInitiated: false,
      preservePlayback: true,
      autoReconnect: true,
    }).catch((e) => {
      console.warn("[radio] timeline reconnect attempt failed:", e);
      // keep trying while this is still the selected station and the
      // user hasn't explicitly gone idle/paused.
      if (currentPeerAddr() !== peerAddr) return;
      if (status() === "idle" || status() === "paused") return;
      batch(() => {
        setStatus("connecting");
        setError(null);
      });
      scheduleTimelineReconnect(peerAddr, opts, "retry failed");
    });
  }, delayMs);
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

// mirror the master volume slider onto the radio sink. the html
// audio backend calls `mirrorVolumeToRadio` from its `setVolume`,
// which dispatches here without a static cycle.
registerVolumeMirror((vol) => setRadioVolume(vol));

/**
 * register a persistent <video> element to receive radio playback. pass
 * null to unregister. safe to call before any tune; tuneIntoRadio reads
 * the sink at call time.
 */
export function setRadioAudioSink(el: HTMLVideoElement | null): void {
  audioSink = el;
}

/**
 * the persistent sink element itself, for UI that wants to mount it
 * somewhere visible (e.g. a video-kind track's real frames) - mirrors
 * `music/services/audio/player.ts`'s `getVideoElement()`. null before
 * `setRadioAudioSink` has registered one (RadioAudioSink mounts at app
 * root, so in practice this is only null pre-mount).
 */
export function getRadioVideoElement(): HTMLVideoElement | null {
  return audioSink;
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
  clearTimelineReconnect();
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
  const session = activeSession;
  activeSession = null;
  stopElapsedTicker();
  // flip status BEFORE tearing down the media element below - session.leave()
  // calls audio.pause()/audio.load(), which fire native media events
  // synchronously; doing that WHILE a Solid reactive update from setStatus
  // is still cascading (interleaving a raw DOM mutation with a Solid update
  // pass) was implicated in a `cleanNode`/`node.owned[i]` reentrant-dispose
  // crash. letting the reactive update settle first, then doing the
  // imperative teardown, avoids the overlap.
  setStatus("paused");
  // drop the iroh session entirely (this signals leave to the
  // broadcaster). we don't call leaveRadio() because that resets the
  // displayed metadata; we want the bar to keep showing the station so
  // the user knows what they paused.
  try {
    session.leave();
  } catch (e) {
    console.warn("[radio] pause: handle.leave threw:", e);
  }
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
  // genuinely no-op when radio was never active - without this guard,
  // every call (e.g. `stopRadioForMusic()` on every plain music/video
  // play/pause toggle, not just actual radio teardown) unconditionally
  // rewrote `current_radio_station` to `null` via `setCurrentRadioStationPersisted`,
  // producing a brand-new `appState()` reference and re-triggering every
  // `appState()`-derived effect (mediaSessionBridge's metadata refetch,
  // etc.) even though nothing radio-related had changed.
  if (!activeSession && !isRadioPlayerBarActive()) return;
  clearTimelineReconnect();
  // invalidate async callbacks from any in-flight/old tune attempt.
  bumpTuneAttemptId();
  lastConfirmedHistoryTrackKey = null;
  pausedContext = null;
  void endRadioListenSession("completed");
  if (activeSession) {
    try {
      activeSession.leave();
    } catch (e) {
      console.warn("[radio] leave threw:", e);
    }
    activeSession = null;
  }
  setStatus("idle");
  batch(() => {
    setError(null);
    setNowPlaying(null);
    swapArtUrl(null);
    setListenerCount(0);
    setCurrentPeerAddr(null);
    setCurrentStationId(null);
    setCurrentIsLocal(false);
    setCurrentRemoteServerId(null);
    setCurrentFavorite(null);
    setConnectPhase("");
    setModeCapabilities([]);
    setTimelineSeedActive(false);
    setTimelineSnapshot(null);
    // reset timeline mode back to the MSE-availability baseline so a
    // subsequent tune to a different station isn't stuck in timeline mode
    // just because the previous one had poor network or forced it.
    setUseTimelineMode(!hasMSE);
  });
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
  /** internal: keep current timeline playback while reconnecting radio control. */
  preservePlayback?: boolean;
  /** internal: mark auto-reconnect retunes for diagnostics. */
  autoReconnect?: boolean;
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

function maybeRecordImmediateMetaHistory(
  np: PublicNowPlaying,
  previousSongId: string | null,
  initSeq: number | null,
  rawNowPlaying: unknown
): void {
  // timeline mode records through the queue adapter; skip here.
  if (useTimelineMode()) return;

  const songId = np.song_id?.trim() || null;
  if (!songId) return;
  if (songId === previousSongId) return;

  const rawArt = rawArtMetaFrom(rawNowPlaying);
  const historyKey =
    typeof initSeq === "number"
      ? `meta-init:${initSeq}:${songId}`
      : `meta-song:${songId}:${Date.now()}`;

  recordCurrentRadioTrackHistory({
    songId,
    title: np.title,
    artist: np.artist ?? null,
    album: np.album ?? null,
    durationMs: np.duration_ms ?? null,
    artBlobId: np.art_blob_id ?? null,
    artThumb: rawArt,
    historyKey,
  });
}

/**
 * connect to a radio broadcaster. returns the <video> element so views
 * can attach it to the dom (or to a layout-level player bar later) - used
 * for its audio output on every station, and for real video frames when
 * the station is currently playing a video-kind track.
 *
 * subsequent calls leave the previous session before starting the new one.
 */
export async function tuneIntoRadio(
  peerAddr: string,
  opts: TuneOptions = {}
): Promise<HTMLVideoElement> {
  clearTimelineReconnect();
  if (opts.preservePlayback) {
    // reconnect control stream without resetting timeline playback state.
    if (activeSession) {
      try {
        activeSession.leave();
      } catch (e) {
        console.warn("[radio] preservePlayback leave threw:", e);
      }
      activeSession = null;
    }
  } else {
    // full user-initiated tune: tear down any prior session.
    leaveRadio();
  }
  console.info(
    "[radio] tuneIntoRadio — hasMSE:",
    hasMSE,
    "useTimelineMode:",
    useTimelineMode(),
    "peerAddr:",
    peerAddr,
    "preservePlayback:",
    opts.preservePlayback === true,
    "autoReconnect:",
    opts.autoReconnect === true
  );
  const tuneAttemptId = bumpTuneAttemptId();
  const isActiveTune = () => tuneAttemptId === activeTuneAttemptId;
  setConnectPhase("connecting to peer\u2026");

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
  const synthesizeTimelineFromNowPlaying = (np: PublicNowPlaying, source: "hello" | "meta") => {
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
      sameSong
    );
    setTimelineSnapshot(snapshot);
  };

  // make sure local music isn't competing for the speakers.
  if (!opts.preservePlayback) {
    await stopMusicForRadio();
    if (!isActiveTune()) {
      throw new Error("radio tune superseded by a newer attempt");
    }
  }

  // pick transport: charnel/tauri uses the iroh path via
  // `radio_tune` IPC commands (or `radio_tune_local` for self-listen);
  // everywhere else uses midden wasm.
  const useCharnel = isCharnelAvailable();
  const useLocal = !!opts.isLocal && useCharnel;
  batch(() => {
    setStatus("connecting");
    setCurrentPeerAddr(peerAddr);
    if (opts.stationId !== undefined) {
      setCurrentStationId(opts.stationId ?? null);
    }
    setCurrentIsLocal(useLocal);
  });
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
  let node: {
    tune_radio: NonNullable<Awaited<ReturnType<typeof getMiddenNode>>["tune_radio"]>;
  } | null = null;
  if (!useCharnel) {
    const middenNode = await getMiddenNode();
    if (!isActiveTune()) {
      throw new Error("radio tune superseded by a newer attempt");
    }
    if (typeof middenNode.tune_radio !== "function") {
      batch(() => {
        setStatus("error");
        setError("midden build missing tune_radio");
      });
      throw new Error("this midden build does not expose tune_radio (rebuild client/midden)");
    }
    node = { tune_radio: middenNode.tune_radio.bind(middenNode) };
  }

  // ---- mse setup -------------------------------------------------------
  // prefer a persistent sink (mounted in the global RadioAudioSink) so
  // navigation doesn't tear down the element. fall back to a transient
  // element for callers without a registered sink. always a <video>
  // element (even for an audio-only station) so a video-carrying station
  // never needs to swap elements mid-stream - see getRadioVideoElement.
  const audio = audioSink ?? document.createElement("video");
  const ownsAudio = audio !== audioSink;
  audio.autoplay = false;
  audio.preload = "auto";
  audio.playsInline = true;
  // a persistent sink could carry a stale mute from a session that ended
  // mid post-skip-mute window; always start a fresh tune unmuted.
  audio.muted = false;
  if (ownsAudio) {
    // only override volume on transient elements; the sink owns volume.
    audio.volume = 1.0;
  }

  // on environments without MediaSource (mobile safari, some webviews)
  // ms stays null and we rely entirely on the timeline/queue adapter.
  // prefer classic MediaSource when present; fall back to
  // ManagedMediaSource (see its doc comment above re: unverified-on-audio
  // caveat) so devices that only expose it aren't wrongly routed to
  // timeline/queue mode.
  const hasClassicMediaSource =
    typeof (window as unknown as { MediaSource?: unknown }).MediaSource === "function";
  const usingManagedMediaSource = !hasClassicMediaSource && managedMediaSourceCtor !== null;
  const ms: MediaSource | null = hasClassicMediaSource
    ? new (globalThis as unknown as { MediaSource: new () => MediaSource }).MediaSource()
    : usingManagedMediaSource
      ? new managedMediaSourceCtor!()
      : null;
  // ManagedMediaSource waits for an explicit `startstreaming` event before
  // it wants chunks pushed; classic MediaSource has no such signal, so it
  // stays permanently "streamable" from the caller's point of view.
  let canStream = !usingManagedMediaSource;
  console.info(
    "[radio] media source mode:",
    ms === null
      ? "none (timeline/queue fallback)"
      : usingManagedMediaSource
        ? "ManagedMediaSource"
        : "MediaSource"
  );
  if (ms) {
    if (usingManagedMediaSource) {
      // WebKit requires remote playback (AirPlay) be disabled - or an
      // AirPlay-compatible alternative source provided - or `sourceopen`
      // never fires at all. must be set before `srcObject` is assigned.
      audio.disableRemotePlayback = true;
      (audio as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject = ms;
      ms.addEventListener("startstreaming", () => {
        canStream = true;
        drain();
      });
      ms.addEventListener("endstreaming", () => {
        canStream = false;
      });
    } else {
      audio.src = URL.createObjectURL(ms);
    }
  }

  let sb: SourceBuffer | null = null;
  // set by applyHello once the real Hello message arrives - the fallback
  // in rebuildSourceBuffer() uses this instead of the hardcoded default
  // so a video station's SourceBuffer never gets recreated with the
  // wrong (audio-only) codec after a lag resync.
  let helloCodec: string | null = null;
  // carries each chunk's own seq/isInit alongside its bytes so drain()
  // can look up `pendingMeta` and compute a track-boundary position at
  // the moment a chunk is ACTUALLY appended, not when it merely arrived
  // (arrival-time can have other not-yet-appended chunks still queued
  // ahead of it - see drain()'s doc comment on this).
  const queue: { bytes: Uint8Array; seq: number; isInit: boolean }[] = [];
  let seekedToLive = false;
  let chunkPlayStarted = false;
  let chunkAutoplayBlocked = false;

  // ---- diagnostics -----------------------------------------------------
  let sourceBufferResetCount = 0;
  // QuotaExceededError specifically, tracked apart from the generic
  // reset counter above - a distinct signal from codec mismatches/other
  // append failures, worth being able to tell apart at a glance in logs
  // now that clients routinely hold onto a much bigger buffered span by
  // design (see docs/radio-buffering-retune-plan.md's MSE quota notes).
  let quotaErrorCount = 0;
  let resyncCount = 0;
  let maxLiveEdgeBufferMs = 0;
  const chunkGapSamplesMs: number[] = [];
  let chunkGapSumMs = 0;
  let lastChunkAtMs: number | null = null;
  // media duration each non-init append actually contributed to
  // `sb.buffered.end()`, vs. the wall-clock gap since the previous chunk
  // (already tracked above). if this consistently runs BELOW the wall-
  // clock gap, each fragment represents less real playback time than
  // the server's pacing assumes (frag_ms) - which would explain the
  // ahead-of-playhead margin eroding over time even while chunks keep
  // arriving right on the server's real-time schedule (confirmed
  // separately via the server's own catchup-depth/warm-up logs) -
  // temporary, for tracking down the "stalls that never recover" report.
  const mediaGrowthSamplesMs: number[] = [];
  let mediaGrowthSumMs = 0;
  let pendingGrowthMeasurement: { bufferedEndBeforeS: number } | null = null;
  let diagnosticsTick: number | null = null;
  const pushChunkGapSample = (gapMs: number) => {
    chunkGapSamplesMs.push(gapMs);
    chunkGapSumMs += gapMs;
    if (chunkGapSamplesMs.length > 240) {
      const dropped = chunkGapSamplesMs.shift();
      if (typeof dropped === "number") chunkGapSumMs -= dropped;
    }
  };
  const pushMediaGrowthSample = (growthMs: number) => {
    mediaGrowthSamplesMs.push(growthMs);
    mediaGrowthSumMs += growthMs;
    if (mediaGrowthSamplesMs.length > 240) {
      const dropped = mediaGrowthSamplesMs.shift();
      if (typeof dropped === "number") mediaGrowthSumMs -= dropped;
    }
  };
  const percentile = (samples: number[], p: number): number => {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
    return sorted[idx];
  };
  const startDiagnostics = () => {
    if (diagnosticsTick !== null) return;
    diagnosticsTick = window.setInterval(() => {
      if (!isActiveTune()) return;
      const samples = chunkGapSamplesMs.length;
      const avgChunkGapMs = samples > 0 ? chunkGapSumMs / samples : 0;
      const p95ChunkGapMs = percentile(chunkGapSamplesMs, 0.95);
      const growthSamples = mediaGrowthSamplesMs.length;
      const avgMediaGrowthMs = growthSamples > 0 ? mediaGrowthSumMs / growthSamples : 0;
      const p95MediaGrowthMs = percentile(mediaGrowthSamplesMs, 0.95);
      // the actual thing this whole retune effort is trying to grow -
      // how far ahead of the playhead the buffered span currently
      // reaches. null when nothing's buffered yet (still connecting).
      const distanceFromLiveEdgeS =
        sb && sb.buffered.length > 0
          ? Math.round(sb.buffered.end(sb.buffered.length - 1) - audio.currentTime)
          : null;
      console.info(
        "[radio] session summary:",
        JSON.stringify({
          // video streams carry a much heavier per-fragment payload
          // (h264 frames vs AAC-only) and a slower/riskier server-side
          // encode - tagging every summary line by kind lets audio vs
          // video buffering behavior be told apart in the logs instead
          // of blending into one set of stats.
          kind: nowPlaying()?.kind ?? "unknown",
          stall_count: stallCount,
          resync_count: resyncCount,
          sourcebuffer_reset_count: sourceBufferResetCount,
          quota_error_count: quotaErrorCount,
          max_live_edge_buffer_ms: maxLiveEdgeBufferMs,
          distance_from_live_edge_s: distanceFromLiveEdgeS,
          avg_chunk_gap_ms: Math.round(avgChunkGapMs),
          p95_chunk_gap_ms: Math.round(p95ChunkGapMs),
          avg_media_growth_per_chunk_ms: Math.round(avgMediaGrowthMs),
          p95_media_growth_per_chunk_ms: Math.round(p95MediaGrowthMs),
          queue_depth: queue.length,
        })
      );
    }, 30_000);
  };
  const stopDiagnostics = () => {
    if (diagnosticsTick !== null) {
      window.clearInterval(diagnosticsTick);
      diagnosticsTick = null;
    }
  };

  // how far behind currentTime we keep buffered media before evicting.
  // bounded so the SourceBuffer doesn't grow unbounded across tracks
  // and eventually trip MSE's per-element quota (which manifests as
  // appendBuffer throwing QuotaExceededError mid-stream).
  const BUFFER_BEHIND_LIMIT_S = 30;
  const BUFFER_BEHIND_TARGET_S = 10;
  const drain = () => {
    if (!isActiveTune()) return;
    if (!canStream) return;
    if (!sb || sb.updating) return;
    // resolve the previous append's actual contribution to buffered
    // media duration - must happen BEFORE popping the next item, since
    // this is the one moment `sb.buffered.end()` reflects exactly what
    // the last append added and nothing else yet.
    if (pendingGrowthMeasurement && sb.buffered.length > 0) {
      const grownS =
        sb.buffered.end(sb.buffered.length - 1) - pendingGrowthMeasurement.bufferedEndBeforeS;
      pushMediaGrowthSample(grownS * 1000);
      // per-chunk (not just 30s-averaged) visibility into a single
      // short fragment - temporary, for tuning docs/radio-buffering-
      // retune-plan.md's chronic-stall investigation. `ASSUMED_FRAG_MS`
      // is the server's DEFAULT `frag_ms` (not fetched from the wire -
      // Hello doesn't carry it), so this is approximate for a station
      // with a non-default frag_ms override, but still meaningful:
      // logged unthrottled like other diagnostic warnings in this file
      // - volume itself is the signal (one short fragment now and then
      // is normal jitter; every fragment running short is the pattern
      // that would explain a margin that never stops eroding).
      const ASSUMED_FRAG_MS = 3000;
      if (grownS * 1000 < ASSUMED_FRAG_MS * 0.8) {
        console.warn(
          `[radio] short fragment: appended chunk only grew buffered media by ` +
            `${(grownS * 1000).toFixed(0)}ms (expected ~${ASSUMED_FRAG_MS}ms)`
        );
      }
      pendingGrowthMeasurement = null;
    }
    const next = queue.shift();
    if (next) {
      // a track-transition init chunk's boundary position must be
      // computed HERE, right before its own appendBuffer call - not at
      // onChunk/arrival time. `sb.buffered.end()` only reflects appends
      // that have already fully completed; since drain() only reaches
      // this point when nothing else is mid-append, it's guaranteed to
      // be exactly where THIS chunk's audio will start once appended
      // (sequence mode places it immediately after the current end).
      // computing it earlier (at arrival) could be wrong by however much
      // backlog was still queued ahead of this chunk at the time -
      // exactly the case a burst of catchup chunks creates.
      if (next.isInit && pendingMeta.has(next.seq)) {
        const m = pendingMeta.get(next.seq)!;
        pendingMeta.delete(next.seq);
        if (useTimelineMode() || sb.buffered.length === 0) {
          applyPendingTrackMeta(m, next.seq);
        } else {
          pendingTrackBoundaries.push({
            seq: next.seq,
            boundaryTime: sb.buffered.end(sb.buffered.length - 1),
            data: m,
          });
        }
      }
      // measure this specific append's real contribution to buffered
      // media duration (resolved at the top of the NEXT drain() call,
      // once this append actually completes) - skip init chunks, they
      // carry no real media duration of their own.
      if (!next.isInit) {
        pendingGrowthMeasurement = {
          bufferedEndBeforeS: sb.buffered.length > 0 ? sb.buffered.end(sb.buffered.length - 1) : 0,
        };
      }
      try {
        sb.appendBuffer(next.bytes as BufferSource);
      } catch (e) {
        // synchronous appendBuffer failure (quota exceeded, codec
        // mismatch on a fresh init, sourcebuffer in an invalid state).
        // the chunk is gone and `updateend` won't fire — without
        // recovery the queue would never drain again and the radio
        // session would silently freeze. trigger a SourceBuffer reset
        // and wait for the next init segment so we can resume cleanly.
        const isQuotaError =
          typeof e === "object" &&
          e !== null &&
          (e as { name?: unknown }).name === "QuotaExceededError";
        if (isQuotaError) {
          quotaErrorCount += 1;
          // log the buffered span size at the moment of failure - the
          // one piece of context a generic catch-all can't tell you,
          // needed to actually tune the proactive trim threshold
          // mentioned in docs/radio-buffering-retune-plan.md instead of
          // guessing at one.
          console.warn(
            "[radio] appendBuffer hit QuotaExceededError; resetting SourceBuffer to recover:",
            {
              bufferedSpanS:
                sb.buffered.length > 0
                  ? sb.buffered.end(sb.buffered.length - 1) - sb.buffered.start(0)
                  : 0,
              chunkBytes: next.bytes.byteLength,
            }
          );
        } else {
          console.warn("[radio] appendBuffer failed; resetting SourceBuffer to recover:", e);
        }
        const nextResync = (lastAppliedInit ?? -1) + 1;
        // resetSourceBuffer rebuilds `sb` and waits for an init >= nextResync.
        resetSourceBuffer(nextResync);
      }
      return;
    }
    // opportunistic eviction: trim media that's well behind the playhead
    // so the buffered range doesn't grow forever across track changes.
    if (
      sb.buffered.length > 0 &&
      audio.currentTime <= sb.buffered.end(sb.buffered.length - 1) &&
      audio.currentTime - sb.buffered.start(0) > BUFFER_BEHIND_LIMIT_S
    ) {
      const removeUpTo = audio.currentTime - BUFFER_BEHIND_TARGET_S;
      if (removeUpTo > sb.buffered.start(0)) {
        try {
          sb.remove(sb.buffered.start(0), removeUpTo);
          // remove triggers updateend → drain reruns naturally.
          return;
        } catch (e) {
          console.warn("[radio] sb.remove failed:", e);
        }
      }
    }
    // start as far from the live edge as whatever's already caught up
    // will allow, instead of anchoring a small fixed distance back from
    // the tail. a tune/lag-resync catchup burst can carry anywhere from
    // "barely anything" (just tuned in as a track started) up to a full
    // `buffer_seconds` worth of already-downloaded, already-decodable
    // media (joined well into a long track) - see "key finding" in
    // docs/radio-buffering-retune-plan.md. seeking to `start` uses
    // whichever of those actually happened, for free, rather than
    // discarding most of it and carving out a small fixed cushion near
    // `end` regardless. `minReadyToStartMs()` still sets a real floor on
    // how much must be buffered before we consider starting at all (see
    // its own doc comment for why that floor can't be trivial) - it
    // just doesn't ALSO dictate where we land once past it.
    //
    // once playing, real-time consumption and real-time chunk emission
    // both advance at 1x, so whatever gap this initial seek establishes
    // holds steady on its own rather than eroding - see the same doc's
    // steady-state argument. seek in either direction so a playhead
    // stranded ahead of a rebuilt (post-lag/post-skip) buffer also
    // re-anchors.
    if (!seekedToLive && sb.buffered.length > 0) {
      const start = sb.buffered.start(0);
      const end = sb.buffered.end(sb.buffered.length - 1);
      const targetS = minReadyToStartMs() / 1000;
      const bufferedS = end - start;
      setConnectPhase(`buffering ${bufferedS.toFixed(1)}s / ${targetS.toFixed(1)}s`);
      const ready = bufferedS >= targetS;
      if (ready) {
        const target = start;
        if (audio.currentTime < target || audio.currentTime > end) {
          audio.currentTime = target;
        }
        seekedToLive = true;
        // this is the SAME readiness gate a post-skip/post-lag rebuffer
        // uses (see flushForAdminSkip/resetSourceBuffer) - unmute here
        // rather than on a separate, smaller threshold.
        if (rebufferMuteActive) {
          audio.muted = false;
          rebufferMuteActive = false;
        }
      }
    }
    if (!useTimelineMode() && seekedToLive) {
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
      .then(() => markChunkPlaybackStarted())
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
        // WebKit can reject this promise with a bogus internal error
        // (`TypeError: null is not an object (evaluating 'node.owned[i]')`)
        // even though playback genuinely started - the media element's own
        // "playing" event still fires right alongside this rejection. don't
        // treat this as a real failure; leave status alone and let that
        // "playing" event listener (below) call markChunkPlaybackStarted()
        // instead, so a spurious rejection here doesn't strand the session
        // in "connecting" forever (which also left the player bar's
        // play/pause control dead, since it has no case for "connecting").
        if (!audio.paused) {
          console.warn(
            "[radio] chunk playback promise rejected but media element isn't paused - treating as started:",
            e
          );
          markChunkPlaybackStarted();
          return;
        }
        // keep session in connecting state for transient startup failures;
        // next buffered update may successfully start playback.
        console.warn("[radio] chunk playback attempt failed:", e);
      });
  };

  /** idempotent - flips status to "playing" + runs first-start bookkeeping.
   * called from the `.play()` success path AND from the media element's
   * own "playing" event (see its listener below) since WebKit can reject
   * the `.play()` promise with a bogus internal error even when playback
   * genuinely started - the "playing" event is the authoritative signal. */
  const markChunkPlaybackStarted = () => {
    if (!isActiveTune()) return;
    if (chunkPlayStarted) return;
    chunkPlayStarted = true;
    if (listenStartedAtMs === 0) {
      listenStartedAtMs = Date.now();
    }
    batch(() => {
      setConnectPhase("");
      if (pendingInitialNowPlaying) {
        setNowPlaying(pendingInitialNowPlaying.now_playing);
        swapArtUrl(pendingInitialNowPlaying.art_url);
        pendingInitialNowPlaying = null;
      }
      setError(null);
      setStatus("playing");
    });
    startElapsedTicker();
    void ensureRadioListenSession();
    console.info("[radio] chunk playback started");
  };

  // ---- recovery state ---------------------------------------------------
  if (ms) {
    const sourceopenStartedAtMs = Date.now();
    setConnectPhase("opening media pipeline\u2026");
    console.info("[radio] waiting for MediaSource sourceopen event...");
    // ManagedMediaSource attached via srcObject firing sourceopen has NOT
    // been confirmed on a real device - a 10s bound turns a silent
    // permanent hang into a clear, diagnosable error instead of a stuck
    // "connecting" spinner with zero further log output.
    const sourceopenFired = await Promise.race([
      new Promise<boolean>((resolve) => {
        ms.addEventListener("sourceopen", () => resolve(true), { once: true });
      }),
      new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), 10_000);
      }),
    ]);
    console.info(
      `[radio] sourceopen ${sourceopenFired ? "fired" : "TIMED OUT waiting"} after ${Date.now() - sourceopenStartedAtMs}ms (usingManagedMediaSource: ${usingManagedMediaSource})`
    );
    if (!sourceopenFired) {
      batch(() => {
        setStatus("error");
        setError("MediaSource never opened (sourceopen timed out) - see console");
      });
      if (usingManagedMediaSource) {
        (audio as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject = null;
      } else {
        URL.revokeObjectURL(audio.src);
        audio.removeAttribute("src");
      }
      audio.load();
      throw new Error("radio tune aborted: MediaSource sourceopen never fired");
    }
    if (!isActiveTune()) {
      if (usingManagedMediaSource) {
        (audio as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject = null;
      } else {
        URL.revokeObjectURL(audio.src);
        audio.removeAttribute("src");
      }
      audio.load();
      throw new Error("radio tune superseded by a newer attempt");
    }
    // NOTE: addSourceBuffer is deliberately NOT called here - it needs the
    // station's actual codec string, which only arrives via Hello (see
    // applyHello below, which creates `sb` the first time it runs).
  }

  // server-driven resync: when the broadcaster sends ControlMessage::Lag
  // we tear down the SourceBuffer + queue and discard chunks until we
  // see `seq >= resyncAtSeq && isInit`. tracks rapid-resync as a UX
  // signal — ≥3 lags in 60s flips status to "error" so the user sees a
  // reconnect prompt instead of silent stuttering.
  let resyncAtSeq: number | null = null;
  // set while waiting for the first init chunk of the track that
  // follows an admin skip (as opposed to a network-lag resync). lets
  // `onChunk` flip the status signal back to "playing" once the cut
  // actually lands, without touching the lag-rate bookkeeping below.
  let awaitingSkipResync = false;
  // muted (not paused) while a buffer is being torn down and re-filled -
  // right after an admin skip OR a lag resync (both now share the exact
  // same "flush, then re-buffer using the standard readiness/anchor
  // logic" path, per explicit user direction: a full stop + genuine
  // re-buffer is fine and expected, not something to race past with a
  // separate smaller/faster cushion). relying on the browser's own
  // stall behavior for "silence" while a SourceBuffer is nearly empty
  // and being rapidly appended to isn't actually clean - in practice it
  // can sound like stutter/glitching rather than true silence. muting
  // guarantees a clean gap regardless of what the decoder does under
  // the hood, independent of the volume-slider-controlled `.volume`
  // property. unmuted the moment `drain()`'s normal `seekedToLive` gate
  // is satisfied again - the SAME gate a fresh tune uses.
  // `REBUFFER_MUTE_MAX_MS` is purely a safety net in case that never
  // happens for some reason.
  let rebufferMuteActive = false;
  let rebufferMuteDeadlineMs = 0;
  const REBUFFER_MUTE_MAX_MS = 8000;
  const recentLags: number[] = [];
  const RAPID_LAG_THRESHOLD = 3;
  const RAPID_LAG_WINDOW_MS = 60_000;
  let lastResyncAtMs = 0;
  let pendingLagResyncSeq: number | null = null;
  const recentLagSignals: number[] = [];
  const LAG_SIGNAL_WINDOW_MS = 8_000;
  const RESYNC_SIGNALS_REQUIRED = stabilityMode() ? 3 : 2;
  const RESYNC_COOLDOWN_MS = stabilityMode() ? 8_000 : 5_000;
  // minimum amount of real buffered media before we start playback at
  // all - decoupled from WHERE we then seek to (see drain()'s anchor
  // logic below), but NOT a trivial number: since drain() seeks to
  // buffered `start` rather than a fixed distance from `end`, this
  // floor IS the actual cushion size in the common shallow-catchup case
  // (tuned in right as a track started, so there's little/no catchup
  // burst to seek deep into yet) - it's not just "have we waited long
  // enough," it's "how much margin does the listener get once playback
  // begins." an earlier version of this shrunk it to a flat 3000ms on
  // the theory that a deep catchup burst arrives fast regardless, which
  // is true for the DEEP case but starves the SHALLOW case of any real
  // margin - confirmed by a real increase in reported stalls,
  // disproportionately for video (heavier per-fragment payload, a
  // slower/riskier server-side encode - see broadcaster.rs's real-time-
  // factor diagnostic - makes video more exposed to a stall when started
  // with too little cushion). when catchup happens to be deep, this
  // floor is still crossed almost instantly by the unpaced burst - it
  // only sets a MINIMUM, it doesn't cap how much cushion is actually
  // used once crossed.
  const minReadyToStartMs = (): number => {
    const kind = pendingInitialNowPlaying?.now_playing.kind ?? nowPlaying()?.kind;
    if (kind === "video") return stabilityMode() ? 20000 : 16000;
    return stabilityMode() ? 16000 : 12000;
  };
  // stall-RECOVERY baseline/ceiling only - NOT the initial anchor
  // anymore (that's now derived from catchup depth via
  // `minReadyToStartMs()` + drain()'s seek-to-`start` logic, not a
  // fixed constant). used by the watchdog to re-anchor after a GENUINE
  // stall (the ahead-of-playhead buffer actually ran dry), and grown
  // per repeated stall via `LIVE_EDGE_BUMP_MS` up to
  // `MAX_LIVE_EDGE_BUFFER_MS`.
  //
  // doubled from an earlier 6-8s/1.5-2s/12-20s baseline per real-world
  // testing feedback (see docs/radio-audio-video-unification-plan.md's
  // buffering section for that history) - kept here since it still
  // governs recovery after a real stall, even though it no longer
  // governs the initial cushion.
  const STALL_RECOVERY_BASELINE_MS = stabilityMode() ? 16000 : 12000;
  let liveEdgeBufferMs = STALL_RECOVERY_BASELINE_MS;
  const LIVE_EDGE_BUMP_MS = stabilityMode() ? 4000 : 3000;
  const MAX_LIVE_EDGE_BUFFER_MS = stabilityMode() ? 30000 : 20000;
  let stallCount = 0;
  const onStall = () => {
    if (!isActiveTune()) return;
    stallCount += 1;
    // buffer state at the EXACT moment of the stall - temporary, for
    // tuning docs/radio-buffering-retune-plan.md's chronic-stall
    // investigation. distinguishes "stalled because the buffer was
    // genuinely thin" (aheadS near 0) from "stalled for some other
    // reason despite plenty being buffered" (aheadS healthy) - the 30s
    // session summary only shows this averaged out, not at the instant
    // it actually happened.
    const aheadS =
      sb && sb.buffered.length > 0
        ? sb.buffered.end(sb.buffered.length - 1) - audio.currentTime
        : null;
    console.info(
      `[radio] stall #${stallCount} at t=${audio.currentTime.toFixed(2)}s, ` +
        `aheadS=${aheadS === null ? "n/a" : aheadS.toFixed(2)}, rebufferMuteActive=${rebufferMuteActive}`
    );
    // stalls during a deliberate rebuffer-mute window (post-skip or
    // post-lag-resync) are expected - the buffer is refilling from
    // empty on purpose - and shouldn't inflate the headroom the way a
    // genuine mid-track network stall does. bumping it here anyway
    // defeats the reset to baseline those paths already do and quickly
    // re-creates the same inflated-headroom problem that reset avoids.
    if (!rebufferMuteActive && liveEdgeBufferMs < MAX_LIVE_EDGE_BUFFER_MS) {
      liveEdgeBufferMs = Math.min(MAX_LIVE_EDGE_BUFFER_MS, liveEdgeBufferMs + LIVE_EDGE_BUMP_MS);
      if (liveEdgeBufferMs > maxLiveEdgeBufferMs) {
        maxLiveEdgeBufferMs = liveEdgeBufferMs;
      }
      console.info(
        `[radio] stall #${stallCount} — bumping live-edge buffer to ${liveEdgeBufferMs}ms`
      );
    }
    // no independent seek here: this handler and the watchdog (which
    // runs every 500ms with properly clamped headroom, see
    // MIN_RESUME_AHEAD_S / the headroomS clamp below) used to both try
    // to recover from the same underflow with different math — this
    // one didn't clamp `end - liveEdgeBufferMs / 1000` at all, so once
    // liveEdgeBufferMs grew close to (or past) the total buffered
    // duration, the computed target landed back near the *start* of the
    // buffer instead of near the live edge, yanking playback backward
    // by several seconds right before the watchdog's next tick jumped
    // it forward again — a visible/audible skip-back-then-skip-forward.
    // leaving recovery solely to the watchdog avoids the conflict.
  };

  // ---- stall watchdog --------------------------------------------------
  // the media element can wedge at the end of a buffered range during a
  // track transition (admin skip, ffmpeg cold start): the playhead reaches
  // the old track's end just before the next track's chunks land, fires
  // `waiting`, and the browser doesn't always auto-resume across the
  // micro-gap once data arrives. this periodic check re-anchors the
  // playhead onto buffered media and re-arms play() in place, recovering
  // without a full re-tune (which would cause an audible dropout).
  let lastWatchdogTime = 0;
  let lastWatchdogProgressMs = Date.now();
  let watchdogTick: number | null = null;
  const STALL_RECOVERY_AFTER_MS = 1000;
  // don't force a corrective seek into a buffer that's barely ahead of the
  // playhead (e.g. right after an admin skip resets the buffer) — landing
  // right on the bleeding edge just re-stalls within a fraction of a
  // second and repeats the seek every watchdog tick, which is audible as
  // a stutter. wait for a small real cushion instead; a moment of silence
  // while the buffer fills is preferable to a string of tiny seeks.
  const MIN_RESUME_AHEAD_S = 1.5;
  const runWatchdog = () => {
    if (!isActiveTune() || useTimelineMode() || !sb) return;
    // apply every boundary the playhead has already reached, in order -
    // not just the first one - so a run of several short tracks (or a
    // burst that queued multiple transitions) doesn't skip straight to
    // the latest one without ever showing/recording the ones in between.
    while (
      pendingTrackBoundaries.length > 0 &&
      audio.currentTime >= pendingTrackBoundaries[0].boundaryTime - 0.05
    ) {
      const boundary = pendingTrackBoundaries.shift()!;
      applyPendingTrackMeta(boundary.data, boundary.seq);
    }
    // primary unmute path is drain()'s `seekedToLive` gate (the same
    // one a fresh tune uses) - this is purely a safety net in case that
    // never fires for some reason.
    if (rebufferMuteActive && Date.now() >= rebufferMuteDeadlineMs) {
      audio.muted = false;
      rebufferMuteActive = false;
    }
    if (!chunkPlayStarted || chunkAutoplayBlocked) return;
    const now = Date.now();
    const t = audio.currentTime;
    if (t > lastWatchdogTime + 0.02) {
      lastWatchdogTime = t;
      lastWatchdogProgressMs = now;
      return;
    }
    if (now - lastWatchdogProgressMs < STALL_RECOVERY_AFTER_MS) return;
    if (sb.buffered.length === 0) {
      if (audio.paused) void audio.play().catch(() => {});
      return;
    }
    const start = sb.buffered.start(0);
    const end = sb.buffered.end(sb.buffered.length - 1);
    let seekTarget: number | null = null;
    if (t > end + 0.05 || t < start - 0.05) {
      // playhead stranded outside the buffered span (e.g. after a buffer
      // rebuild); re-anchor to the trailing live-edge target.
      seekTarget = Math.max(start, end - liveEdgeBufferMs / 1000);
    } else if (end - t > 0.25) {
      // data exists ahead but the playhead is wedged (track-boundary gap);
      // cross to the live-edge target so playback resumes into the new
      // track. clamp the requested headroom to half of what's actually
      // buffered ahead of the playhead rather than blindly subtracting
      // `liveEdgeBufferMs` from `end` — right after a buffer reset (e.g.
      // an admin skip) there may only be a couple seconds buffered while
      // `liveEdgeBufferMs` can still be inflated from earlier stalls, and
      // `end - liveEdgeBufferMs / 1000` landing before `start` used to
      // collapse this to a ~50ms nudge that took dozens of watchdog
      // cycles to converge. this always lands meaningfully ahead of `t`.
      const aheadS = end - t;
      if (aheadS < MIN_RESUME_AHEAD_S) {
        // not enough of a real cushion yet to resume without immediately
        // re-stalling — hold off this tick and let the buffer build.
        return;
      }
      const headroomS = Math.min(liveEdgeBufferMs / 1000, aheadS / 2);
      seekTarget = end - headroomS;
    }
    if (seekTarget !== null && Math.abs(seekTarget - t) > 0.05) {
      // buffered span at the moment of recovery - temporary, for tuning
      // docs/radio-buffering-retune-plan.md's chronic-stall
      // investigation. small `end - t` here (vs. a healthy
      // `liveEdgeBufferMs`) means the ahead-of-playhead buffer had
      // genuinely run thin by the time recovery kicked in, not just
      // that playback itself hiccuped with plenty of data still on hand.
      console.info(
        `[radio] watchdog recovering stall: ${t.toFixed(2)}s -> ${seekTarget.toFixed(2)}s ` +
          `(bufferedEnd=${end.toFixed(2)}s, aheadOfPlayhead=${(end - t).toFixed(2)}s)`
      );
      try {
        audio.currentTime = seekTarget;
      } catch (e) {
        console.warn("[radio] watchdog seek failed:", e);
      }
      lastWatchdogProgressMs = now; // grace period after the seek
    }
    if (audio.paused) void audio.play().catch(() => {});
  };
  const startWatchdog = () => {
    if (watchdogTick !== null) return;
    lastWatchdogTime = audio.currentTime;
    lastWatchdogProgressMs = Date.now();
    watchdogTick = window.setInterval(runWatchdog, 500);
  };
  const stopWatchdog = () => {
    if (watchdogTick !== null) {
      window.clearInterval(watchdogTick);
      watchdogTick = null;
    }
  };

  if (ms) {
    audio.addEventListener("waiting", onStall);
    audio.addEventListener("stalled", onStall);
    startWatchdog();
    audio.addEventListener("playing", () => {
      console.info("[radio] media element event: playing");
      // authoritative signal that playback actually started - see
      // markChunkPlaybackStarted's doc comment for why this can't just
      // rely on the `.play()` promise resolving. deferred a microtask:
      // this native event can fire SYNCHRONOUSLY as a side effect of a
      // solid-driven DOM mutation (e.g. the video mini player's
      // `appendChild` re-parenting an already-playing MediaSource-backed
      // element), which reenters solid's own update loop mid-flight and
      // corrupts its owner-cleanup bookkeeping (`cleanNode`/
      // `node.owned[i]`/"Cannot read properties of null (reading '1')").
      // hopping through a microtask guarantees this signal write always
      // starts a fresh, top-level solid update instead of nesting inside
      // one that's still running.
      queueMicrotask(() => markChunkPlaybackStarted());
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
          : "unknown"
      );
    });
  }

  /** reset `sb` in place: clear whatever media it has buffered and
   * rewind its sequence-mode timeline so the next appended segment
   * starts a fresh group, without ever recreating the SourceBuffer
   * object itself. shared by lag-resync and admin-skip flush — both
   * need a clean slate gated on the next init chunk arriving.
   *
   * deliberately does NOT call `removeSourceBuffer`/`addSourceBuffer`:
   * MediaSource enforces a small hard cap on how many SourceBuffer
   * objects it will ever create over its lifetime, so a long session
   * with repeated lag/skip resyncs eventually throws
   * `QuotaExceededError` on `addSourceBuffer` if we recreate one every
   * time. setting `timestampOffset` is the spec-sanctioned way to
   * restart a "sequence" mode SourceBuffer's timeline in place. */
  const rebuildSourceBuffer = () => {
    // the buffered timeline is being torn down/reset, so every stored
    // boundary position no longer means anything - apply whatever "now
    // playing" swaps were waiting on them now, in order, rather than
    // losing them.
    while (pendingTrackBoundaries.length > 0) {
      const boundary = pendingTrackBoundaries.shift()!;
      applyPendingTrackMeta(boundary.data, boundary.seq);
    }
    if (!ms) return;
    if (!sb) {
      // only reached if the very first addSourceBuffer (during tune
      // bootstrap) never happened — fall back to creating one.
      try {
        sb = ms.addSourceBuffer(helloCodec ?? MSE_CODEC);
        sb.mode = "sequence";
        sb.addEventListener("updateend", drain);
      } catch (e) {
        console.error("[radio] addSourceBuffer fallback failed:", e);
        batch(() => {
          setStatus("error");
          setError("media source rebuild failed; please reconnect");
        });
      }
      return;
    }
    try {
      if (sb.updating) {
        try {
          sb.abort();
        } catch {
          // best effort
        }
      }
      // signal a new coded frame group starting at 0; must happen while
      // not updating (abort() above guarantees that).
      sb.timestampOffset = 0;
      if (sb.buffered.length > 0) {
        sb.remove(0, sb.buffered.end(sb.buffered.length - 1));
      }
      // the buffered timeline just restarted at 0, but the media
      // element's playhead is left wherever the outgoing track's
      // playback was (e.g. 40+ seconds in) — stranding it far outside
      // the fresh (empty) buffered range. left alone, this isn't
      // noticed until the watchdog's stall-recovery timeout fires and
      // has to do a large corrective jump; resetting it immediately
      // means the very first append lands the playhead in-range from
      // the start.
      audio.currentTime = 0;
      // the stall watchdog's progress tracker (`lastWatchdogTime`)
      // otherwise keeps comparing against the OUTGOING track's high
      // playhead value (e.g. 40+ seconds) — since the fresh playhead at
      // 0 will stay below that stale value for a long time, the "did we
      // make progress" check never re-arms, so every tick falls through
      // to the stall-recovery seek logic and re-seeks on every single
      // 500ms tick for as long as `end - t > 0.25` holds true (which is
      // most of the post-skip refill window). that's an unintentional
      // fast-forward through the freshly-buffered cushion — confirmed
      // by the logs showing seeks firing every 1-2 watchdog ticks right
      // after a skip. resetting the tracker here lets it correctly see
      // real (small, steady) progress again from the new position.
      lastWatchdogTime = 0;
      lastWatchdogProgressMs = Date.now();
    } catch (e) {
      console.error("[radio] SourceBuffer reset failed:", e);
      batch(() => {
        setStatus("error");
        setError("media source reset failed; please reconnect");
      });
    }
  };

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
    // same reasoning as flushForAdminSkip: a lag resync tears down and
    // re-fills the buffer from empty too, so it gets the identical
    // quiet-rebuffer treatment (mute now, unmute via drain()'s
    // seekedToLive gate) rather than letting the reset itself glitch
    // audibly, and the same baseline reset (not a separate target).
    if (liveEdgeBufferMs > STALL_RECOVERY_BASELINE_MS) {
      liveEdgeBufferMs = STALL_RECOVERY_BASELINE_MS;
    }
    audio.muted = true;
    rebufferMuteActive = true;
    rebufferMuteDeadlineMs = Date.now() + REBUFFER_MUTE_MAX_MS;
    rebuildSourceBuffer();
    // record + count this resync. when we churn faster than the user's
    // patience, surface as an error so they can take action.
    const now = Date.now();
    recentLags.push(now);
    while (recentLags.length > 0 && now - recentLags[0] > RAPID_LAG_WINDOW_MS) {
      recentLags.shift();
    }
    if (recentLags.length >= RAPID_LAG_THRESHOLD) {
      // if we have a timeline snapshot, switch to timeline/queue mode so
      // the listener keeps hearing music instead of seeing an error.
      // (poor network → prefer queue mode over repeated resync loops)
      if (timelineSnapshot() !== null && !useTimelineMode()) {
        console.info(
          `[radio] ${recentLags.length} resyncs in the last minute — falling back to timeline/queue mode`
        );
        setUseTimelineMode(true);
        // don't set error state; the queue adapter will take over.
      } else {
        batch(() => {
          setStatus("error");
          setError(`connection unstable — ${recentLags.length} resyncs in the last minute`);
        });
      }
    }
  };

  /** flush buffered audio the instant an admin skip is accepted, so the
   * outgoing track's already-buffered tail is silenced instead of
   * playing out. reuses the same teardown/rebuild + resync-gate
   * machinery as a lag resync, but skips the lag-rate bookkeeping (an
   * admin skip is intentional, not a sign of a flaky connection) and
   * surfaces a "connecting" status so the player bar shows a visible
   * transition until the next track's init chunk lands. */
  const flushForAdminSkip = () => {
    if (!isActiveTune() || !ms) return;
    console.info("[radio] admin skip accepted — flushing buffered audio for a silent cut");
    sourceBufferResetCount += 1;
    queue.length = 0;
    seekedToLive = false;
    awaitingSkipResync = true;
    resyncAtSeq = (lastAppliedInit ?? -1) + 1;
    // a fresh (empty) buffer follows this flush, so any inflated headroom
    // demand accumulated from earlier stalls in the outgoing track no
    // longer applies here — carrying it forward asked for more data than
    // the freshly-refilling buffer could possibly have yet, which made
    // the stall watchdog's gap-crossing seek collapse toward a no-op and
    // took many cycles to recover from. resetting to the session's
    // baseline still lets it grow back up if this track's connection is
    // genuinely struggling too. a full stop + genuine re-buffer here is
    // expected and fine (per explicit user direction) - this no longer
    // resets to a SEPARATE, smaller post-skip target, just the same
    // baseline every fresh tune/lag-resync starts from.
    if (liveEdgeBufferMs > STALL_RECOVERY_BASELINE_MS) {
      liveEdgeBufferMs = STALL_RECOVERY_BASELINE_MS;
    }
    // mute rather than pause: keeps the media element's playback state
    // machine (and the browser's own auto-resume-on-data behavior) alone,
    // it just silences whatever it produces until drain()'s normal
    // seekedToLive gate is satisfied again - the SAME gate a fresh tune
    // uses, not a separate faster/smaller one.
    audio.muted = true;
    rebufferMuteActive = true;
    rebufferMuteDeadlineMs = Date.now() + REBUFFER_MUTE_MAX_MS;
    rebuildSourceBuffer();
    guarded(() => {
      batch(() => {
        setStatus("connecting");
        setError(null);
      });
    });
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
        while (recentLagSignals.length > 0 && now - recentLagSignals[0] > LAG_SIGNAL_WINDOW_MS) {
          recentLagSignals.shift();
        }
        if (now - lastResyncAtMs < RESYNC_COOLDOWN_MS) {
          console.info(
            `[radio] lag signal in cooldown (${now - lastResyncAtMs}ms < ${RESYNC_COOLDOWN_MS}ms); deferring resync`
          );
        } else if (recentLagSignals.length >= RESYNC_SIGNALS_REQUIRED) {
          resetSourceBuffer(pendingLagResyncSeq ?? at);
          pendingLagResyncSeq = null;
          recentLagSignals.length = 0;
        } else {
          console.info(
            `[radio] lag signal buffered (${recentLagSignals.length}/${RESYNC_SIGNALS_REQUIRED})`
          );
        }
      }
      return true;
    }
    if (msg.type === "skip") {
      // admin skip accepted server-side, before the next track's init
      // chunk even exists — flush now so the outgoing track's buffered
      // tail doesn't play out instead of going silent.
      flushForAdminSkip();
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

      // timeline mode should keep buffered audio alive and reconnect in
      // the background. full teardown would revoke object urls and cut
      // off playback immediately.
      if (useTimelineMode()) {
        const reconnectPeer = activeSession?.peerAddr ?? currentPeerAddr();
        const reconnectOpts: TuneOptions = {
          stationId: currentStationId() ?? expectedStationId ?? opts.stationId,
          stationName: activeSession?.stationName ?? opts.stationName,
          isLocal: activeSession?.isLocal ?? opts.isLocal,
          userInitiated: false,
          preservePlayback: true,
          autoReconnect: true,
        };

        if (activeSession) {
          try {
            activeSession.leave();
          } catch (e) {
            console.warn("[radio] goodbye leave threw:", e);
          }
          activeSession = null;
        }

        guarded(() => {
          stopElapsedTicker();
          batch(() => {
            setStatus("connecting");
            setError(null);
          });
        });

        if (reconnectPeer) {
          scheduleTimelineReconnect(reconnectPeer, reconnectOpts, reason);
        } else {
          guarded(() => {
            batch(() => {
              setStatus("error");
              setError(reason);
            });
          });
        }
        return true;
      }

      leaveRadio();
      guarded(() => {
        batch(() => {
          setStatus("error");
          setError(reason);
        });
      });
      return true;
    }
    if (msg.type === "timeline") {
      const snapshot = coerceTimelineSnapshot(msg);
      if (snapshot) {
        if (expectedStationId && snapshot.station_id !== expectedStationId) {
          console.error(
            `[radio] station mismatch: expected ${expectedStationId}, got timeline for ${snapshot.station_id}`
          );
          leaveRadio();
          guarded(() => {
            batch(() => {
              setStatus("error");
              setError(
                `station mismatch: expected ${expectedStationId}, got ${snapshot.station_id}`
              );
            });
          });
          return true;
        }
        if (!currentStationId()) {
          setCurrentStationId(snapshot.station_id);
        }
        console.info(
          "[radio] timeline snapshot received — seq:",
          snapshot.timeline_seq,
          "current:",
          snapshot.current?.song_id ?? "null",
          "upcoming:",
          snapshot.upcoming.length
        );
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
  // the init chunk landing over the network says nothing about when the
  // listener actually *hears* that track — the SourceBuffer can still
  // hold many seconds of the outgoing track's tail waiting to play out.
  // `pendingTrackBoundaries` records where in the buffered timeline each
  // new track's audio actually begins, so the visible "now playing" swap
  // can wait for the playhead to really get there instead of jumping the
  // instant the bytes arrive. a QUEUE (not a single slot): two track
  // transitions can land before the playhead reaches the first one (e.g.
  // several short tracks, or a burst of catchup chunks) - a single
  // nullable slot would silently drop every boundary but the last one,
  // which is exactly what "now playing gets off at track start/end"
  // symptoms traced back to.
  let pendingTrackBoundaries: {
    seq: number;
    boundaryTime: number;
    data: {
      now_playing: PublicNowPlaying;
      art_url: string | null;
      raw_art: { mime: string; data: string } | null;
      listener_count: number;
    };
  }[] = [];
  // hello's now_playing reflects whatever the broadcaster considers
  // "current" the instant the listener subscribes — but a new listener
  // still has to drain however much catchup audio the broadcaster sent
  // before its own live-edge seek (see drain()'s seekedToLive) lands on
  // an actual starting position. stash it here and apply it once real
  // chunk playback actually begins instead of the moment the handshake
  // completed, so the UI doesn't show a track the listener won't
  // actually hear first.
  let pendingInitialNowPlaying: {
    now_playing: PublicNowPlaying;
    art_url: string | null;
  } | null = null;

  const applyPendingTrackMeta = (
    data: {
      now_playing: PublicNowPlaying;
      art_url: string | null;
      raw_art: { mime: string; data: string } | null;
      listener_count: number;
    },
    seq: number
  ) => {
    pendingInitialNowPlaying = null;
    setNowPlaying(data.now_playing);
    swapArtUrl(data.art_url ?? null);
    setListenerCount(data.listener_count);
    if (!useTimelineMode()) {
      recordCurrentRadioTrackHistory({
        songId: data.now_playing.song_id?.trim() || null,
        title: data.now_playing.title,
        artist: data.now_playing.artist ?? null,
        album: data.now_playing.album ?? null,
        durationMs: data.now_playing.duration_ms ?? null,
        artBlobId: data.now_playing.art_blob_id ?? null,
        artThumb: data.raw_art,
        historyKey: `init:${seq}`,
      });
    }
  };

  const applyHello = (helloJson: string) => {
    if (!isActiveTune()) return;
    try {
      const msg = JSON.parse(helloJson);
      // the station's real codec only arrives here - addSourceBuffer must
      // use it (a video station's codec differs from the audio-only
      // MSE_CODEC fallback), not the hardcoded constant.
      if (ms && !sb) {
        const codec =
          typeof msg?.codec === "string" && msg.codec.trim() ? msg.codec.trim() : MSE_CODEC;
        helloCodec = codec;
        try {
          sb = ms.addSourceBuffer(codec);
          // sequence mode rewrites segment timestamps so cross-track +
          // catchup chunks form a single contiguous buffered range.
          sb.mode = "sequence";
          sb.addEventListener("updateend", drain);
        } catch (e) {
          console.error(`[radio] addSourceBuffer(${codec}) failed:`, e);
          batch(() => {
            setStatus("error");
            setError(`unsupported codec: ${codec}`);
          });
          return;
        }
      }
      if (msg?.now_playing) {
        const helloStationId =
          typeof msg.now_playing.station_id === "string" &&
          msg.now_playing.station_id.trim().length > 0
            ? msg.now_playing.station_id.trim()
            : null;
        if (expectedStationId && helloStationId && helloStationId !== expectedStationId) {
          console.error(
            `[radio] station mismatch: expected ${expectedStationId}, got hello for ${helloStationId}`
          );
          leaveRadio();
          guarded(() => {
            batch(() => {
              setStatus("error");
              setError(`station mismatch: expected ${expectedStationId}, got ${helloStationId}`);
            });
          });
          return;
        }
        if (!currentStationId() && helloStationId) {
          setCurrentStationId(helloStationId);
        }
        const np = coerceNowPlaying(msg.now_playing);
        if (np) {
          if (useTimelineMode() || msg?.broadcaster_timeline_only === true) {
            // no buffered-timeline / live-edge-seek concept in queue
            // mode — apply right away. (broadcaster_timeline_only is
            // read here since the mode-switch below happens after this
            // block runs.)
            setNowPlaying(np);
            swapArtUrl(artUrlFromRaw(msg.now_playing));
          } else {
            pendingInitialNowPlaying = {
              now_playing: np,
              art_url: artUrlFromRaw(msg.now_playing),
            };
          }
          synthesizeTimelineFromNowPlaying(np, "hello");
        }
      }
      if (typeof msg?.listener_count === "number") {
        setListenerCount(msg.listener_count);
      }
      batch(() => {
        setModeCapabilities(coerceModeCapabilities(msg?.radio_mode_capabilities));
        setTimelineSeedActive(msg?.timeline_seed_active === true);
      });
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
      const timelineModeActive = useTimelineMode() || msg?.broadcaster_timeline_only === true;
      console.info(
        "[radio] hello mode handshake:",
        JSON.stringify({
          use_timeline_mode: useTimelineMode(),
          broadcaster_timeline_only: msg?.broadcaster_timeline_only === true,
          capabilities,
          timeline_mode_active: timelineModeActive,
          init_seq: typeof msg?.init_seq === "number" ? msg.init_seq : null,
        })
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
      // cold-start / fresh-join special case: the very first real meta
      // for a session can carry an init_seq that doesn't line up with
      // the init chunk's own seq number the client actually received
      // (hello's snapshot init_seq vs. this control message's init_seq
      // come from different counters at join time), so the normal
      // init_seq bookkeeping below (pendingMeta / "already applied")
      // never matches it and it would otherwise sit unapplied forever
      // — leaving the hello placeholder ("waiting for listeners…")
      // displayed indefinitely. as long as nothing real has been shown
      // yet this tune-in, any valid now_playing here is strictly better
      // than that placeholder, so apply it immediately and skip the
      // init_seq matching entirely.
      if (pendingInitialNowPlaying && np) {
        pendingInitialNowPlaying = null;
        setNowPlaying(np);
        synthesizeTimelineFromNowPlaying(np, "meta");
        swapArtUrl(artUrlFromRaw(msg.now_playing));
        if (typeof msg?.listener_count === "number") {
          setListenerCount(msg.listener_count);
        }
        if (typeof initSeq === "number") {
          lastAppliedInit = initSeq;
        }
        return;
      }
      if (typeof initSeq === "number" && np) {
        const previousSongId = nowPlaying()?.song_id?.trim() || null;
        // timeline/queue mode has no init-chunk boundary to latch on,
        // so apply metadata updates immediately.
        if (useTimelineMode()) {
          pendingInitialNowPlaying = null;
          setNowPlaying(np);
          synthesizeTimelineFromNowPlaying(np, "meta");
          swapArtUrl(artUrlFromRaw(msg.now_playing));
          if (typeof msg?.listener_count === "number") {
            setListenerCount(msg.listener_count);
          }
          lastAppliedInit = initSeq;
          return;
        }
        // interstitial / late-binding update for an already-playing track:
        // server tags it with the *current* init_seq so we apply it now.
        if (lastAppliedInit !== null && initSeq <= lastAppliedInit) {
          // only apply immediately when this is a metadata refresh for the
          // same song. if song_id changes here, applying early would make
          // the playerbar jump to the next track before its init chunk is
          // actually rendered.
          const currentSongId = nowPlaying()?.song_id ?? null;
          const incomingSongId = np.song_id ?? null;
          if (!currentSongId || !incomingSongId || incomingSongId === currentSongId) {
            pendingInitialNowPlaying = null;
            setNowPlaying(np);
            synthesizeTimelineFromNowPlaying(np, "meta");
            swapArtUrl(artUrlFromRaw(msg.now_playing));
            if (typeof msg?.listener_count === "number") {
              setListenerCount(msg.listener_count);
            }
            maybeRecordImmediateMetaHistory(np, previousSongId, initSeq, msg.now_playing);
          } else {
            console.info(
              `[radio] deferring early meta for new song_id ${incomingSongId} (current ${currentSongId})`
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
        const previousSongId = nowPlaying()?.song_id?.trim() || null;
        // protocol drift: no init_seq → apply right away.
        pendingInitialNowPlaying = null;
        setNowPlaying(np);
        synthesizeTimelineFromNowPlaying(np, "meta");
        swapArtUrl(artUrlFromRaw(msg.now_playing));
        if (typeof msg?.listener_count === "number") {
          setListenerCount(msg.listener_count);
        }
        maybeRecordImmediateMetaHistory(np, previousSongId, null, msg.now_playing);
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
        `[radio] first chunk received (seq=${seq}, init=${isInit}, bytes=${bytes.byteLength})`
      );
    }
    const now = Date.now();
    const chunkGapMs = lastChunkAtMs !== null ? now - lastChunkAtMs : null;
    if (chunkGapMs !== null) {
      pushChunkGapSample(Math.max(0, chunkGapMs));
    }
    lastChunkAtMs = now;
    // post-Lag / post-skip: discard everything until we see the init
    // chunk the broadcaster told us (lag) or that we're waiting for
    // (admin skip) to resync on.
    if (resyncAtSeq !== null) {
      if (!isInit || seq < resyncAtSeq) {
        return;
      }
      resyncAtSeq = null;
      if (awaitingSkipResync) {
        awaitingSkipResync = false;
        guarded(() => {
          batch(() => {
            setStatus("playing");
            setError(null);
          });
        });
      }
    }
    // pendingMeta lookup + track-boundary scheduling now happens in
    // drain(), right before this exact chunk is actually appended - see
    // its doc comment for why that timing matters (arrival-time here can
    // have other not-yet-appended chunks still queued ahead of it).
    if (isInit) lastAppliedInit = seq;
    queue.push({ bytes, seq, isInit });
    drain();
  };

  // ---- iroh tune -------------------------------------------------------
  let handle: RadioHandleLike;
  let timelineBootstrapTimer: number | null = null;
  let chunkBootstrapTimer: number | null = null;
  const tuneCallStartedAtMs = Date.now();
  setConnectPhase("connecting to broadcaster\u2026");
  console.info(
    "[radio] calling tune_radio now — mode:",
    useLocal ? "charnel-local" : useCharnel ? "charnel" : "midden-wasm",
    "peerAddr:",
    peerAddr,
    "stationId:",
    opts.stationId ?? null
  );
  // heartbeat while the tune call is in flight - if this fires more than
  // once, the underlying call (native midden/iroh binding, or charnel IPC)
  // is genuinely hanging rather than erroring quickly, which rules out a
  // fast local failure and points at the network/peer/connection layer.
  const tuneHeartbeat = window.setInterval(() => {
    console.warn(
      `[radio] still waiting on tune_radio after ${Date.now() - tuneCallStartedAtMs}ms — no response yet`
    );
  }, 3000);
  try {
    handle = useLocal
      ? await tuneRadioCharnelLocal(opts.stationId, applyHello, applyMeta, onChunk)
      : useCharnel
        ? await tuneRadioCharnel(peerAddr, opts.stationId, applyHello, applyMeta, onChunk)
        : await node!.tune_radio(peerAddr, opts.stationId, applyHello, applyMeta, onChunk);
    console.info(`[radio] tune_radio resolved after ${Date.now() - tuneCallStartedAtMs}ms`);
    setConnectPhase("waiting for stream data\u2026");
    if (!isActiveTune()) {
      try {
        handle.leave();
      } catch {
        // best effort
      }
      throw new Error("radio tune superseded by a newer attempt");
    }
  } catch (e) {
    console.error(`[radio] tune_radio rejected after ${Date.now() - tuneCallStartedAtMs}ms:`, e);
    if (isActiveTune()) {
      batch(() => {
        setStatus("error");
        setError(`tune failed: ${e}`);
      });
    }
    if (usingManagedMediaSource) {
      (audio as HTMLMediaElement & { srcObject?: MediaProvider | null }).srcObject = null;
    } else if (ms) {
      URL.revokeObjectURL(audio.src);
      audio.removeAttribute("src");
    }
    audio.load();
    throw e;
  } finally {
    window.clearInterval(tuneHeartbeat);
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
      stopWatchdog();
      if (timelineBootstrapTimer !== null) {
        window.clearTimeout(timelineBootstrapTimer);
        timelineBootstrapTimer = null;
      }
      if (chunkBootstrapTimer !== null) {
        window.clearTimeout(chunkBootstrapTimer);
        chunkBootstrapTimer = null;
      }
      try {
        audio.muted = false;
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
  timelineReconnectDelayMs = TIMELINE_RECONNECT_BASE_MS;

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
      console.warn("[radio] timeline bootstrap timeout: no timeline snapshot received after 12s");
      batch(() => {
        setStatus("error");
        setError("timeline mode could not start: broadcaster did not provide timeline snapshots");
      });
    }, 12_000);
  } else if (ms) {
    chunkBootstrapTimer = window.setTimeout(() => {
      if (!isActiveTune()) return;
      if (useTimelineMode()) return;
      if (sawFirstChunk) return;
      console.warn("[radio] chunk bootstrap timeout: no audio chunks received after 12s");
      batch(() => {
        setStatus("error");
        setError("radio audio stream did not start: no chunks received from broadcaster");
      });
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

// favorite (broadcasting peer) toggling lives in radioFavorite.ts; this
// just supplies the currently-tuned peer, since only this module tracks it.
export async function setRadioFavorite(songId: string, isFavorite: boolean): Promise<void> {
  return setRadioFavoriteForPeer(songId, isFavorite, currentPeerAddr());
}
