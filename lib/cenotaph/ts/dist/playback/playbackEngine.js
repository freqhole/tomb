// minimal playback engine (phase 4): owns a single <video> element (used
// for both audio- and video-kind media - a plain audio file plays fine
// through it with no visible video track), a reactive queue, and reactive
// playback status. driven either by the control dispatcher (remote
// commands) or, later, local UI controls.
//
// no OPFS caching yet (media is fetched fresh into memory per play) - a
// follow-up can layer a cache in front of fetchMediaBlob() without
// changing this module's interface.
//
// this is cenotaph's DEFAULT `PlaybackBackend` implementation - a host
// app that already has its own real playback/queue engine (none do, as
// of this writing) could supply its own instead; this one exists so a
// host with nothing of its own (a fresh spume `/player/` route, the
// now-abandoned player.freqhole.net) gets a complete, working backend
// with zero extra code.
import { createSignal } from "solid-js";
import { fetchMediaBlob } from "./mediaFetch";
import { broadcastStatus } from "../control/statusSubscribers";
import { startRadio as startRadioClient, stopRadio as stopRadioClient } from "./radioClient";
const media = document.createElement("video");
media.preload = "auto";
media.playsInline = true;
// pinned to the viewport directly from JS (not CSS %/vw/vh, which proved
// unreliable across mobile browser chrome/pinch-zoom) - see
// applyViewportSize() below. `object-fit: contain` (not `cover`): cover
// crops to fill the whole box on both axes, which for a video whose aspect
// ratio doesn't match the screen means zooming in a lot - looks like the
// video is "too big" even though the box itself never exceeds the
// viewport. contain always shows the whole frame, letterboxed if needed,
// so it can never look oversized.
media.style.position = "fixed";
media.style.top = "0";
media.style.left = "0";
media.style.objectFit = "contain";
function applyViewportSize() {
    // visualViewport (not universally supported - e.g. older webviews) tracks
    // pinch-zoom/on-screen-keyboard changes that innerWidth/innerHeight miss;
    // fall back to those where it's unavailable.
    const vv = window.visualViewport;
    const width = vv ? vv.width : window.innerWidth;
    const height = vv ? vv.height : window.innerHeight;
    media.style.width = `${width}px`;
    media.style.height = `${height}px`;
}
applyViewportSize();
window.addEventListener("resize", applyViewportSize);
window.visualViewport?.addEventListener("resize", applyViewportSize);
const [state, setState] = createSignal("idle");
const [currentItem, setCurrentItem] = createSignal(null);
const [errorMessage, setErrorMessage] = createSignal(null);
const [queueSignal, setQueueSignal] = createSignal([]);
const [downloadFraction, setDownloadFraction] = createSignal(null);
const [positionSec, setPositionSec] = createSignal(0);
const [durationSec, setDurationSec] = createSignal(0);
const [itemStatus, setItemStatus] = createSignal(new Map());
let queue = [];
let currentObjectUrl = null;
// relayed to every subscribed controller via currentStatus() below, so a
// toggle by one controller shows up on every other client sharing this
// player - see control/schema.ts's set_auto_download_enabled command.
let autoDownloadEnabled = false;
// blake3 hashes this player is done with this session (played through,
// manually skipped, or explicitly removed) - most-recent-last, capped at
// RECENTLY_PLAYED_LIMIT. lets a controller that reconnects later (see
// schema.ts's PlayerStatusSchema doc comment) skip re-queueing songs this
// player already dealt with instead of blindly re-appending its whole
// local queue. cleared once the queue fully empties (see stop() below) -
// that's the "session" boundary: a still-running queue keeps its history,
// a fully finished/stopped one starts fresh.
const RECENTLY_PLAYED_LIMIT = 50;
let recentlyPlayed = [];
function recordRecentlyPlayed(hash) {
    if (!hash)
        return;
    recentlyPlayed = recentlyPlayed.filter((h) => h !== hash);
    recentlyPlayed.push(hash);
    if (recentlyPlayed.length > RECENTLY_PLAYED_LIMIT)
        recentlyPlayed.shift();
}
// remembered so the "ended" listener below can auto-advance the queue without
// waiting for a remote "skip" command - the queue plays through on its own
// regardless of whether a controller is currently connected.
let lastNode = null;
// blobs fetched once (either by playItem or the background prefetch below)
// are kept here keyed by blake3 hash, so a queue item already downloaded
// while it was "up next" plays instantly instead of re-fetching.
const blobCache = new Map();
// bumped by every playItem() call - lets a stale, still-in-flight call
// (an old fetch that hasn't resolved/rejected yet) recognize a newer call
// has already superseded it and skip applying its result - see playItem().
let playGeneration = 0;
media.addEventListener("timeupdate", () => setPositionSec(media.currentTime));
media.addEventListener("durationchange", () => setDurationSec(media.duration || 0));
media.addEventListener("ended", () => {
    // not driven by any controller command - push the resulting status
    // directly (dispatcher.ts's broadcast only covers command-driven changes).
    if (lastNode)
        void skip(lastNode).then(() => broadcastStatus(currentStatus()));
});
function syncQueueSignal() {
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
function setStatusFor(hash, value) {
    const next = new Map(itemStatus());
    if (value)
        next.set(hash, value);
    else
        next.delete(hash);
    setItemStatus(next);
}
/** drops cache/status entries for anything no longer in the queue. */
function pruneStaleCacheEntries() {
    const live = new Set(queue.map((i) => i.blake3_hash));
    for (const hash of blobCache.keys()) {
        if (!live.has(hash))
            blobCache.delete(hash);
    }
    let changed = false;
    const next = new Map(itemStatus());
    for (const hash of next.keys()) {
        if (!live.has(hash)) {
            next.delete(hash);
            changed = true;
        }
    }
    if (changed)
        setItemStatus(next);
}
async function ensureCached(node, item) {
    const cached = blobCache.get(item.blake3_hash);
    if (cached)
        return cached;
    setStatusFor(item.blake3_hash, "loading");
    try {
        const blob = await fetchMediaBlob(node, item);
        blobCache.set(item.blake3_hash, blob);
        setStatusFor(item.blake3_hash, "ready");
        return blob;
    }
    catch (err) {
        setStatusFor(item.blake3_hash, undefined);
        throw err;
    }
}
// only one background prefetch walk runs at a time - a fresh queue change
// just gets picked up by the next call once the current one finishes.
let prefetching = false;
// don't prefetch the whole remaining queue - just enough to smooth over
// upcoming transitions. items with an unknown duration_ms count as this
// fallback estimate towards the budget so a long run of them can't prefetch
// forever.
const PREFETCH_WINDOW_MS = 30 * 60 * 1000;
const UNKNOWN_DURATION_FALLBACK_MS = 4 * 60 * 1000;
/** downloads "up next" items in the background, one at a time, so they're
 * already cached (and show an underlined time) once they're due to play.
 * stops once the cumulative duration of the items it has queued up (cached
 * or newly fetched this walk) reaches ~30 minutes - not the whole queue. */
async function prefetchUpcoming(node) {
    if (prefetching)
        return;
    prefetching = true;
    try {
        // skip index 0 - playItem() fetches (and caches) the current item itself.
        let windowMs = 0;
        for (const item of queue.slice(1)) {
            if (windowMs >= PREFETCH_WINDOW_MS)
                break;
            windowMs += item.duration_ms ?? UNKNOWN_DURATION_FALLBACK_MS;
            if (blobCache.has(item.blake3_hash))
                continue;
            if (itemStatus().get(item.blake3_hash) === "loading")
                continue;
            try {
                await ensureCached(node, item);
            }
            catch {
                // leave it uncached - actual playback will retry when it's due.
            }
        }
    }
    finally {
        prefetching = false;
    }
}
function releaseObjectUrl() {
    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    }
}
/** true for the specific "browser blocked autoplay" rejection from `<video>.play()`. */
function isAutoplayBlocked(err) {
    return err instanceof DOMException && err.name === "NotAllowedError";
}
async function playItem(node, item) {
    lastNode = node;
    // guards against out-of-order async resolution: if a NEWER playItem() call
    // supersedes this one (e.g. a second command arrives while this one is
    // still mid-fetch, a slow/large video), this stale call's eventual
    // resolution must not clobber the newer item's state - previously it
    // could, which looked like "the player gets stuck and won't play
    // anything" whenever an old, abandoned fetch finally settled after a
    // newer one had already taken over.
    const myGeneration = ++playGeneration;
    // show what's about to play right away, before the download even starts
    setCurrentItem(item);
    setErrorMessage(null);
    const cached = blobCache.get(item.blake3_hash);
    setState("buffering");
    setDownloadFraction(cached || !item.size_bytes ? null : 0);
    try {
        const blob = cached ??
            (await (async () => {
                setStatusFor(item.blake3_hash, "loading");
                const fetched = await fetchMediaBlob(node, item, (fraction) => {
                    if (myGeneration === playGeneration)
                        setDownloadFraction(fraction);
                });
                blobCache.set(item.blake3_hash, fetched);
                return fetched;
            })());
        setStatusFor(item.blake3_hash, "ready");
        if (myGeneration !== playGeneration)
            return;
        releaseObjectUrl();
        currentObjectUrl = URL.createObjectURL(blob);
        media.src = currentObjectUrl;
        setDownloadFraction(null);
        await media.play();
        if (myGeneration !== playGeneration)
            return;
        setState("playing");
        void prefetchUpcoming(node);
    }
    catch (err) {
        if (myGeneration !== playGeneration)
            return;
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
export async function retryPlayback() {
    if (state() !== "blocked")
        return;
    try {
        await media.play();
        setState("playing");
    }
    catch (err) {
        if (isAutoplayBlocked(err))
            return;
        setState("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
    }
}
export async function play(node, item) {
    queue = [item];
    syncQueueSignal();
    await playItem(node, item);
}
export async function replaceQueue(node, items) {
    queue = [...items];
    syncQueueSignal();
    pruneStaleCacheEntries();
    const first = queue[0];
    if (first)
        await playItem(node, first);
    void prefetchUpcoming(node);
}
export async function appendQueue(node, items) {
    // if the player was genuinely idle (nothing queued/playing yet), an
    // append needs to actually start playback of the newly-arrived first
    // item, same as replaceQueue does for its first item - previously this
    // just grew the queue array and left `state` at "idle" forever, so a
    // player whose very first queued item ever arrived via append_queue
    // (e.g. a video added to an already-selected-but-idle remote target's
    // queue, rather than via a replace_queue hand-off) never played anything
    // until some unrelated later command happened to kick it into gear.
    const wasIdle = queue.length === 0 && (state() === "idle" || state() === "stopped");
    queue.push(...items);
    syncQueueSignal();
    if (wasIdle && queue[0])
        await playItem(node, queue[0]);
    void prefetchUpcoming(node);
}
export function pause() {
    media.pause();
    setState("paused");
}
export function resume() {
    void media.play();
    setState("playing");
}
export function seek(positionMs) {
    media.currentTime = positionMs / 1000;
}
export function setVolume(volume) {
    media.volume = volume;
}
export function stop() {
    media.pause();
    media.removeAttribute("src");
    media.load();
    releaseObjectUrl();
    setCurrentItem(null);
    setState("stopped");
    queue = [];
    syncQueueSignal();
    pruneStaleCacheEntries();
    // session boundary - the queue just fully emptied out, so the history
    // that was only there to stop a *live* session from re-queueing its own
    // recently-finished songs no longer serves a purpose.
    recentlyPlayed = [];
}
export async function skip(node) {
    recordRecentlyPlayed(queue[0]?.blake3_hash);
    queue.shift();
    syncQueueSignal();
    pruneStaleCacheEntries();
    const next = queue[0];
    if (next) {
        await playItem(node, next);
    }
    else {
        stop();
    }
}
/** removes a queue entry by index. removing the currently-playing item
 * (index 0) plays through to the next one, same as skip(). */
export async function removeFromQueue(node, index) {
    if (index < 0 || index >= queue.length)
        return;
    if (index === 0) {
        await skip(node);
        return;
    }
    recordRecentlyPlayed(queue[index]?.blake3_hash);
    queue.splice(index, 1);
    syncQueueSignal();
    pruneStaleCacheEntries();
}
/** moves a not-yet-playing queue entry to a new position. the currently-
 * playing item (index 0) can neither be moved nor be a destination - it
 * stays pinned until it's skipped or removed. */
export function reorderQueue(fromIndex, toIndex) {
    if (fromIndex <= 0 || toIndex <= 0)
        return;
    if (fromIndex >= queue.length || toIndex >= queue.length)
        return;
    if (fromIndex === toIndex)
        return;
    const [item] = queue.splice(fromIndex, 1);
    if (!item)
        return;
    queue.splice(toIndex, 0, item);
    syncQueueSignal();
}
export function setAutoDownloadEnabled(enabled) {
    autoDownloadEnabled = enabled;
}
export function currentStatus() {
    const item = currentItem();
    const currentQueue = [...queue];
    const volume = media.volume;
    const played = [...recentlyPlayed];
    switch (state()) {
        case "playing":
            if (item) {
                return {
                    type: "status",
                    state: "now_playing",
                    item,
                    position_ms: Math.round(media.currentTime * 1000),
                    server_time_ms: Date.now(),
                    queue: currentQueue,
                    auto_download_enabled: autoDownloadEnabled,
                    volume,
                    recently_played: played,
                };
            }
            return {
                type: "status",
                state: "buffering",
                queue: currentQueue,
                auto_download_enabled: autoDownloadEnabled,
                volume,
                recently_played: played,
            };
        case "buffering":
            return {
                type: "status",
                state: "buffering",
                queue: currentQueue,
                auto_download_enabled: autoDownloadEnabled,
                volume,
                recently_played: played,
            };
        case "paused":
        case "blocked":
            return {
                type: "status",
                state: "paused",
                position_ms: Math.round(media.currentTime * 1000),
                queue: currentQueue,
                auto_download_enabled: autoDownloadEnabled,
                volume,
                recently_played: played,
            };
        case "error":
            return {
                type: "status",
                state: "error",
                message: errorMessage() ?? "unknown error",
                queue: currentQueue,
                auto_download_enabled: autoDownloadEnabled,
                volume,
                recently_played: played,
            };
        case "idle":
        case "stopped":
        default:
            return {
                type: "status",
                state: "stopped",
                queue: currentQueue,
                auto_download_enabled: autoDownloadEnabled,
                volume,
                recently_played: played,
            };
    }
}
/** cenotaph's default, complete `PlaybackBackend` - bundles every export
 * above into the shape `control/dispatcher.ts` expects. a host app with no
 * playback engine of its own (spume's `/player/` route, the now-abandoned
 * player.freqhole.net) passes this directly to
 * `createPlayerConnectionHandler({ backend: mediaPlaybackBackend, ... })`
 * with zero extra glue code. */
export const mediaPlaybackBackend = {
    play,
    replaceQueue,
    appendQueue,
    pause,
    resume,
    seek,
    skip,
    removeFromQueue,
    reorderQueue,
    setVolume,
    stop,
    startRadio: startRadioClient,
    stopRadio: stopRadioClient,
    setAutoDownloadEnabled,
    currentStatus,
};
