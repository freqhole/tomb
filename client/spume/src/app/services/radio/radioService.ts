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
import { tuneRadioCharnel } from "./charnelRadioAdapter";
import {
  registerStopRadio,
  stopMusicForRadio,
} from "../playbackCoordinator";
import { recordHistoryEntry } from "./radioHistory";

const MSE_CODEC = 'audio/mp4; codecs="mp4a.40.2"';

export type RadioStatus = "idle" | "connecting" | "playing" | "paused" | "error";

interface RadioSession {
  peerAddr: string;
  stationId: string | null;
  stationName: string | null;
  audio: HTMLAudioElement;
  leave: () => void;
}

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

// in-track elapsed time signal (milliseconds since the current track's
// init segment latched). consumed by the future unified player bar (2c-iii)
// to drive the scrubber. updated by a 4Hz ticker while a session is active.
// `trackStartAtAudioTime` is the audio.currentTime value captured the
// moment the init segment for the current track was applied; elapsed is
// `audio.currentTime - trackStartAtAudioTime`.
const [elapsedMs, setElapsedMs] = createSignal<number>(0);
let trackStartAtAudioTime = 0;
let elapsedTickHandle: number | null = null;

const startElapsedTicker = () => {
  if (elapsedTickHandle !== null) return;
  elapsedTickHandle = window.setInterval(() => {
    if (!audioSink) return;
    const np = nowPlaying();
    const dur = np?.duration_ms ?? null;
    let ms = Math.max(0, (audioSink.currentTime - trackStartAtAudioTime) * 1000);
    if (dur != null && ms > dur) ms = dur;
    setElapsedMs(ms);
  }, 250);
};
const stopElapsedTicker = () => {
  if (elapsedTickHandle !== null) {
    window.clearInterval(elapsedTickHandle);
    elapsedTickHandle = null;
  }
  setElapsedMs(0);
  trackStartAtAudioTime = 0;
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
export const radioElapsedMs = elapsedMs;

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
 * pause radio playback without tearing down the iroh session. resume with
 * `radioResume()`. used by the unified player bar (2c-iii) so the play
 * button can pause/resume radio just like local music. NOTE: this only
 * pauses *playback*; chunks keep arriving and are buffered — long pauses
 * may overflow MSE’s SourceBuffer; expected use is brief (seconds, not
 * minutes). for true “stop”, call `leaveRadio()`.
 */
export function radioPause(): void {
  if (status() !== "playing") return;
  if (audioSink) {
    try {
      audioSink.pause();
    } catch (e) {
      console.warn("[radio] pause failed:", e);
    }
  }
  setStatus("paused");
}

/** resume radio playback after `radioPause()`. no-op when not paused. */
export function radioResume(): void {
  if (status() !== "paused") return;
  if (audioSink) {
    try {
      void audioSink.play();
    } catch (e) {
      console.warn("[radio] resume failed:", e);
    }
  }
  setStatus("playing");
}

/** stop the current radio session if any. safe to call when idle. */
export function leaveRadio(): void {
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
  stopElapsedTicker();
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

  // make sure local music isn't competing for the speakers.
  await stopMusicForRadio();

  setStatus("connecting");
  setCurrentPeerAddr(peerAddr);
  setCurrentStationId(opts.stationId ?? null);

  // pick transport: charnel/tauri uses the native iroh path via
  // `radio_tune` IPC commands; everywhere else uses midden wasm.
  const useCharnel = isCharnelAvailable();
  let node: { tune_radio: NonNullable<Awaited<ReturnType<typeof getMiddenNode>>["tune_radio"]> } | null = null;
  if (!useCharnel) {
    const middenNode = await getMiddenNode();
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

  // ---- history scope ---------------------------------------------------
  // tracked per-session so we only record one history row per actual
  // (station, song_id) transition. resets on leaveRadio via the new
  // session reset path.
  let lastHistorySongId: string | null = null;
  const sessionPeerAddr = peerAddr;
  const sessionStationName = opts.stationName ?? null;
  const maybeRecordHistory = (np: PublicNowPlaying, rawArt: { mime?: string; data?: string } | null) => {
    const songId = np.song_id ?? null;
    // only record on actual song-id transitions; ignore initial null and
    // duplicate meta updates within the same track.
    if (!songId || songId === lastHistorySongId) return;
    lastHistorySongId = songId;
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
    // in an empty range until we seek forward.
    if (!seekedToLive && sb.buffered.length > 0) {
      const start = sb.buffered.start(0);
      if (audio.currentTime < start) {
        audio.currentTime = start;
      }
      seekedToLive = true;
    }
  };

  await new Promise<void>((resolve) => {
    ms.addEventListener("sourceopen", () => resolve(), { once: true });
  });
  sb = ms.addSourceBuffer(MSE_CODEC);
  // sequence mode rewrites segment timestamps so cross-track + catchup
  // chunks form a single contiguous buffered range.
  sb.mode = "sequence";
  sb.addEventListener("updateend", drain);

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
    try {
      const msg = JSON.parse(helloJson);
      if (msg?.now_playing) {
        const np = coerceNowPlaying(msg.now_playing);
        if (np) {
          setNowPlaying(np);
          const rawArt = rawArtMetaFrom(msg.now_playing);
          swapArtUrl(artUrlFromRaw(msg.now_playing));
          maybeRecordHistory(np, rawArt);
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
      setStatus("playing");
    } catch (e) {
      console.warn("[radio] hello parse failed:", e);
    }
  };

  const applyMeta = (metaJson: string) => {
    try {
      const msg = JSON.parse(metaJson);
      const initSeq = msg?.init_seq;
      const np = coerceNowPlaying(msg?.now_playing);
      if (typeof initSeq === "number" && np) {
        // interstitial / late-binding update for an already-playing track:
        // server tags it with the *current* init_seq so we apply it now.
        if (lastAppliedInit !== null && initSeq <= lastAppliedInit) {
          setNowPlaying(np);
          const rawArt = rawArtMetaFrom(msg.now_playing);
          swapArtUrl(artUrlFromRaw(msg.now_playing));
          if (typeof msg?.listener_count === "number") {
            setListenerCount(msg.listener_count);
          }
          maybeRecordHistory(np, rawArt);
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
    if (isInit && pendingMeta.has(seq)) {
      const m = pendingMeta.get(seq)!;
      pendingMeta.delete(seq);
      setNowPlaying(m.now_playing);
      swapArtUrl(m.art_url ?? null);
      setListenerCount(m.listener_count);
      maybeRecordHistory(m.now_playing, m.raw_art);
      // latch the audio-element timeline at the moment this track's init
      // segment was applied. elapsed = audio.currentTime - this. done
      // after the metadata swap so duration_ms is in scope when the
      // ticker reads it.
      trackStartAtAudioTime = audio.currentTime;
      startElapsedTicker();
    }
    if (isInit) lastAppliedInit = seq;
    queue.push(bytes);
    drain();
  };

  // ---- iroh tune -------------------------------------------------------
  let handle: RadioHandleLike;
  try {
    handle = useCharnel
      ? await tuneRadioCharnel(peerAddr, applyHello, applyMeta, onChunk)
      : await node!.tune_radio(peerAddr, applyHello, applyMeta, onChunk);
  } catch (e) {
    setStatus("error");
    setError(`tune failed: ${e}`);
    URL.revokeObjectURL(audio.src);
    audio.removeAttribute("src");
    audio.load();
    throw e;
  }

  const session: RadioSession = {
    peerAddr,
    stationId: opts.stationId ?? null,
    stationName: opts.stationName ?? null,
    audio,
    leave: () => {
      try {
        handle.leave();
      } catch (e) {
        console.warn("[radio] handle.leave threw:", e);
      }
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
