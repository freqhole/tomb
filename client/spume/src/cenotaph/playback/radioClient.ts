// MVP freqhole-radio/1 client (phase 4b, MSE path only).
//
// deliberately simplified vs. spume's production radioService.ts:
// - no init_seq/track-boundary latching (meta applies the instant it
//   arrives, not synced to when the playhead actually crosses into the
//   new track) - can cause the displayed title to change slightly before
//   the audio does.
// - no lag/resync/chunk_ready handling - a broadcaster lag notice is
//   currently ignored rather than triggering a SourceBuffer rebuild.
// - no no-MSE fallback (mobile safari etc.) - falls straight to
//   "unsupported" instead of spume's download-then-play queue adapter,
//   since that fallback needs a grimoire admin/API session this
//   standalone player doesn't have.
// these gaps are tracked in docs/player-remote-site-plan.md phase 4b.

import { createSignal } from "solid-js";
import type { MediaPlaybackNode } from "./types";
import { hasMSE } from "./mseSupport";

const MSE_CODEC = 'audio/mp4; codecs="mp4a.40.2"';

export type RadioState = "idle" | "connecting" | "live" | "error" | "unsupported";

export interface RadioNowPlaying {
  title: string;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
}

const [state, setState] = createSignal<RadioState>("idle");
const [nowPlaying, setNowPlaying] = createSignal<RadioNowPlaying | null>(null);
const [stationId, setStationId] = createSignal<string | null>(null);
const [listenerCount, setListenerCount] = createSignal<number | null>(null);
const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

export const radioState = state;
export const radioNowPlaying = nowPlaying;
export const radioStationId = stationId;
export const radioListenerCount = listenerCount;
export const radioError = errorMessage;

const radioAudio = new Audio();
radioAudio.preload = "auto";
export const radioElement = radioAudio;

let radioHandle: { leave(): void } | null = null;
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let pendingChunks: Uint8Array[] = [];
let appending = false;

function coerceNowPlaying(raw: unknown): RadioNowPlaying | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    title: typeof r.title === "string" ? r.title : "(untitled)",
    artist: typeof r.artist === "string" ? r.artist : null,
    album: typeof r.album === "string" ? r.album : null,
    duration_ms: typeof r.duration_ms === "number" ? r.duration_ms : null,
  };
}

function applyNowPlayingMessage(raw: unknown): void {
  const msg = raw as { now_playing?: unknown; listener_count?: unknown };
  if (msg?.now_playing) {
    const npRaw = msg.now_playing as Record<string, unknown>;
    if (typeof npRaw.station_id === "string" && npRaw.station_id.trim()) {
      setStationId(npRaw.station_id.trim());
    }
    const np = coerceNowPlaying(msg.now_playing);
    if (np) setNowPlaying(np);
  }
  if (typeof msg?.listener_count === "number") {
    setListenerCount(msg.listener_count);
  }
}

function drainQueue(): void {
  if (appending || !sourceBuffer || sourceBuffer.updating) return;
  const next = pendingChunks.shift();
  if (!next) return;
  appending = true;
  try {
    sourceBuffer.appendBuffer(next as BufferSource);
  } catch (e) {
    console.error("[radio] appendBuffer failed:", e);
    appending = false;
  }
}

export async function startRadio<TNode extends MediaPlaybackNode>(
  node: TNode,
  peerAddr: string,
  stationIdArg?: string,
): Promise<void> {
  stopRadio();

  if (!hasMSE) {
    setState("unsupported");
    setErrorMessage("this browser has no MediaSource support - no fallback playback path yet");
    return;
  }

  setState("connecting");
  setErrorMessage(null);
  setNowPlaying(null);
  setListenerCount(null);
  setStationId(stationIdArg ?? null);

  mediaSource = new MediaSource();
  radioAudio.src = URL.createObjectURL(mediaSource);

  await new Promise<void>((resolve) => {
    mediaSource!.addEventListener(
      "sourceopen",
      () => {
        sourceBuffer = mediaSource!.addSourceBuffer(MSE_CODEC);
        sourceBuffer.mode = "sequence";
        sourceBuffer.addEventListener("updateend", () => {
          appending = false;
          drainQueue();
        });
        resolve();
      },
      { once: true },
    );
  });

  const onHello = (json: string) => {
    try {
      applyNowPlayingMessage(JSON.parse(json));
    } catch (e) {
      console.warn("[radio] hello parse failed:", e);
    }
  };
  const onMeta = (json: string) => {
    try {
      applyNowPlayingMessage(JSON.parse(json));
    } catch (e) {
      console.warn("[radio] meta parse failed:", e);
    }
  };
  const onChunk = (_seq: number, _isInit: boolean, bytes: Uint8Array) => {
    pendingChunks.push(bytes);
    if (state() === "connecting") setState("live");
    drainQueue();
  };

  try {
    radioHandle = await node.tune_radio(peerAddr, stationIdArg ?? null, onHello, onMeta, onChunk);
    void radioAudio.play().catch((e) => console.warn("[radio] autoplay failed:", e));
  } catch (err) {
    setState("error");
    setErrorMessage(err instanceof Error ? err.message : String(err));
  }
}

export function stopRadio(): void {
  radioHandle?.leave();
  radioHandle = null;
  pendingChunks = [];
  appending = false;
  sourceBuffer = null;
  mediaSource = null;
  radioAudio.pause();
  radioAudio.removeAttribute("src");
  radioAudio.load();
  setState("idle");
  setNowPlaying(null);
  setStationId(null);
  setListenerCount(null);
}
