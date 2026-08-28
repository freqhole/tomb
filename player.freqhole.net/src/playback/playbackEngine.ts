// minimal playback engine (phase 4): owns a single <video> element (used
// for both audio- and video-kind media - a plain audio file plays fine
// through it with no visible video track), a reactive queue, and reactive
// playback status. driven either by the control dispatcher (remote
// commands) or, later, local UI controls.
//
// no OPFS caching yet (media is fetched fresh into memory per play) - a
// follow-up can layer a cache in front of fetchMediaBlob() without
// changing this module's interface.

import { createSignal } from "solid-js";
import type { MiddenNode } from "@freqhole/midden";
import type { MediaRef, PlayerStatus } from "../control/schema";
import { fetchMediaBlob } from "./mediaFetch";

export type EngineState =
  "idle" | "buffering" | "playing" | "paused" | "stopped" | "error" | "blocked";

const media = document.createElement("video");
media.preload = "auto";
media.playsInline = true;

const [state, setState] = createSignal<EngineState>("idle");
const [currentItem, setCurrentItem] = createSignal<MediaRef | null>(null);
const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
const [queueSignal, setQueueSignal] = createSignal<MediaRef[]>([]);
const [downloadFraction, setDownloadFraction] = createSignal<number | null>(null);
const [positionSec, setPositionSec] = createSignal(0);
const [durationSec, setDurationSec] = createSignal(0);
const [itemStatus, setItemStatus] = createSignal<Map<string, "loading" | "ready">>(new Map());

let queue: MediaRef[] = [];
let currentObjectUrl: string | null = null;
// remembered so the "ended" listener below can auto-advance the queue without
// waiting for a remote "skip" command - the queue plays through on its own
// regardless of whether a controller is currently connected.
let lastNode: MiddenNode | null = null;
// blobs fetched once (either by playItem or the background prefetch below)
// are kept here keyed by blake3 hash, so a queue item already downloaded
// while it was "up next" plays instantly instead of re-fetching.
const blobCache = new Map<string, Blob>();

media.addEventListener("timeupdate", () => setPositionSec(media.currentTime));
media.addEventListener("durationchange", () => setDurationSec(media.duration || 0));
media.addEventListener("ended", () => {
  if (lastNode) void skip(lastNode);
});

function syncQueueSignal(): void {
  setQueueSignal([...queue]);
}

export const engineState = state;
export const nowPlaying = currentItem;
export const engineError = errorMessage;
export const upcomingQueue = queueSignal;
export const mediaElement = media;
export const mediaKind = () => currentItem()?.kind ?? "audio";
/** fraction (0-1) of the current item's download, or null when not downloading. */
export const downloadProgress = downloadFraction;
/** current playback position, in seconds. */
export const playbackPosition = positionSec;
/** current item's duration, in seconds (0 until the browser knows it). */
export const playbackDuration = durationSec;
/** per-item (keyed by blake3 hash) background-fetch state for queue rows. */
export const queueItemStatus = itemStatus;

function setStatusFor(hash: string, value: "loading" | "ready" | undefined): void {
  const next = new Map(itemStatus());
  if (value) next.set(hash, value);
  else next.delete(hash);
  setItemStatus(next);
}

/** drops cache/status entries for anything no longer in the queue. */
function pruneStaleCacheEntries(): void {
  const live = new Set(queue.map((i) => i.blake3_hash));
  for (const hash of blobCache.keys()) {
    if (!live.has(hash)) blobCache.delete(hash);
  }
  let changed = false;
  const next = new Map(itemStatus());
  for (const hash of next.keys()) {
    if (!live.has(hash)) {
      next.delete(hash);
      changed = true;
    }
  }
  if (changed) setItemStatus(next);
}

async function ensureCached(node: MiddenNode, item: MediaRef): Promise<Blob> {
  const cached = blobCache.get(item.blake3_hash);
  if (cached) return cached;
  setStatusFor(item.blake3_hash, "loading");
  try {
    const blob = await fetchMediaBlob(node, item);
    blobCache.set(item.blake3_hash, blob);
    setStatusFor(item.blake3_hash, "ready");
    return blob;
  } catch (err) {
    setStatusFor(item.blake3_hash, undefined);
    throw err;
  }
}

// only one background prefetch walk runs at a time - a fresh queue change
// just gets picked up by the next call once the current one finishes.
let prefetching = false;

/** downloads "up next" items in the background, one at a time, so they're
 * already cached (and show an underlined time) once they're due to play. */
async function prefetchUpcoming(node: MiddenNode): Promise<void> {
  if (prefetching) return;
  prefetching = true;
  try {
    // skip index 0 - playItem() fetches (and caches) the current item itself.
    for (const item of queue.slice(1)) {
      if (blobCache.has(item.blake3_hash)) continue;
      if (itemStatus().get(item.blake3_hash) === "loading") continue;
      try {
        await ensureCached(node, item);
      } catch {
        // leave it uncached - actual playback will retry when it's due.
      }
    }
  } finally {
    prefetching = false;
  }
}

function releaseObjectUrl(): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

/** true for the specific "browser blocked autoplay" rejection from `<video>.play()`. */
function isAutoplayBlocked(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

async function playItem(node: MiddenNode, item: MediaRef): Promise<void> {
  lastNode = node;
  // show what's about to play right away, before the download even starts
  setCurrentItem(item);
  setErrorMessage(null);
  const cached = blobCache.get(item.blake3_hash);
  setState("buffering");
  setDownloadFraction(cached || !item.size_bytes ? null : 0);
  try {
    const blob =
      cached ??
      (await (async () => {
        setStatusFor(item.blake3_hash, "loading");
        const fetched = await fetchMediaBlob(node, item, (fraction) =>
          setDownloadFraction(fraction),
        );
        blobCache.set(item.blake3_hash, fetched);
        return fetched;
      })());
    setStatusFor(item.blake3_hash, "ready");
    releaseObjectUrl();
    currentObjectUrl = URL.createObjectURL(blob);
    media.src = currentObjectUrl;
    setDownloadFraction(null);
    await media.play();
    setState("playing");
    void prefetchUpcoming(node);
  } catch (err) {
    setDownloadFraction(null);
    setStatusFor(item.blake3_hash, undefined);
    if (isAutoplayBlocked(err)) {
      // media is loaded and ready - just needs a user gesture to start.
      setState("blocked");
      return;
    }
    setState("error");
    setErrorMessage(err instanceof Error ? err.message : String(err));
  }
}

/** retry playback after a "blocked" state - call from a real user gesture (click/tap). */
export async function retryPlayback(): Promise<void> {
  if (state() !== "blocked") return;
  try {
    await media.play();
    setState("playing");
  } catch (err) {
    if (isAutoplayBlocked(err)) return;
    setState("error");
    setErrorMessage(err instanceof Error ? err.message : String(err));
  }
}

export async function play(node: MiddenNode, item: MediaRef): Promise<void> {
  queue = [item];
  syncQueueSignal();
  await playItem(node, item);
}

export async function replaceQueue(node: MiddenNode, items: MediaRef[]): Promise<void> {
  queue = [...items];
  syncQueueSignal();
  pruneStaleCacheEntries();
  const first = queue[0];
  if (first) await playItem(node, first);
  void prefetchUpcoming(node);
}

export function appendQueue(node: MiddenNode, items: MediaRef[]): void {
  queue.push(...items);
  syncQueueSignal();
  void prefetchUpcoming(node);
}

export function pause(): void {
  media.pause();
  setState("paused");
}

export function resume(): void {
  void media.play();
  setState("playing");
}

export function seek(positionMs: number): void {
  media.currentTime = positionMs / 1000;
}

export function setVolume(volume: number): void {
  media.volume = volume;
}

export function stop(): void {
  media.pause();
  media.removeAttribute("src");
  media.load();
  releaseObjectUrl();
  setCurrentItem(null);
  setState("stopped");
  queue = [];
  syncQueueSignal();
  pruneStaleCacheEntries();
}

export async function skip(node: MiddenNode): Promise<void> {
  queue.shift();
  syncQueueSignal();
  pruneStaleCacheEntries();
  const next = queue[0];
  if (next) {
    await playItem(node, next);
  } else {
    stop();
  }
}

export function currentStatus(): PlayerStatus {
  const item = currentItem();
  const currentQueue = [...queue];
  switch (state()) {
    case "playing":
      if (item) {
        return {
          type: "status",
          state: "now_playing",
          item,
          position_ms: Math.round(media.currentTime * 1000),
          queue: currentQueue,
        };
      }
      return { type: "status", state: "buffering", queue: currentQueue };
    case "buffering":
      return { type: "status", state: "buffering", queue: currentQueue };
    case "paused":
    case "blocked":
      return {
        type: "status",
        state: "paused",
        position_ms: Math.round(media.currentTime * 1000),
        queue: currentQueue,
      };
    case "error":
      return {
        type: "status",
        state: "error",
        message: errorMessage() ?? "unknown error",
        queue: currentQueue,
      };
    case "idle":
    case "stopped":
    default:
      return { type: "status", state: "stopped", queue: currentQueue };
  }
}
