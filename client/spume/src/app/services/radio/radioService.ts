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

const MSE_CODEC = 'audio/mp4; codecs="mp4a.40.2"';

export type RadioStatus = "idle" | "connecting" | "playing" | "error";

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
const [listenerCount, setListenerCount] = createSignal<number>(0);
const [currentPeerAddr, setCurrentPeerAddr] = createSignal<string | null>(null);
const [currentStationId, setCurrentStationId] = createSignal<string | null>(
  null,
);

let activeSession: RadioSession | null = null;
// optional persistent <audio> element supplied by RadioBar. when set, new
// tunes attach their MediaSource to it instead of creating a fresh element.
// keeps playback alive across navigation and gives the global player bar a
// stable target for volume + visibility.
let audioSink: HTMLAudioElement | null = null;

export const radioStatus = status;
export const radioError = error;
export const radioNowPlaying = nowPlaying;
export const radioListenerCount = listenerCount;
export const radioCurrentPeerAddr = currentPeerAddr;
export const radioCurrentStationId = currentStationId;

export function currentRadioSession(): RadioSession | null {
  return activeSession;
}

/**
 * register a persistent <audio> element to receive radio playback. pass
 * null to unregister. safe to call before any tune; tuneIntoRadio reads
 * the sink at call time.
 */
export function setRadioAudioSink(el: HTMLAudioElement | null): void {
  audioSink = el;
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
  setListenerCount(0);
  setCurrentPeerAddr(null);
  setCurrentStationId(null);
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
    { now_playing: PublicNowPlaying; listener_count: number }
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
        if (np) setNowPlaying(np);
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
          if (typeof msg?.listener_count === "number") {
            setListenerCount(msg.listener_count);
          }
        } else {
          pendingMeta.set(initSeq, {
            now_playing: np,
            listener_count: msg.listener_count ?? listenerCount(),
          });
        }
      } else if (np) {
        // protocol drift: no init_seq → apply right away.
        setNowPlaying(np);
        if (typeof msg?.listener_count === "number") {
          setListenerCount(msg.listener_count);
        }
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
      setListenerCount(m.listener_count);
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
