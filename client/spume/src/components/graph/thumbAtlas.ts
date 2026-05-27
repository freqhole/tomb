// thumbAtlas — batched atlas-page thumbnail fetcher for the graph view.
//
// instead of issuing one http request per album thumbnail (thousands on
// cold load), this module coalesces `getAtlasThumb(serverId, blobId,
// size)` calls into batched `POST /api/blobs/atlas` requests. each
// response is a single packed webp page with a manifest mapping each
// requested blob id to its sub-rect; we decode the page once and slice
// every entry into its own small offscreen canvas, which the graph
// canvas then `drawImage`s like any other thumbnail.
//
// wire format (server-side, see `grimoire/src/media_blobz/atlas.rs`):
//   [u32 LE manifest_len][manifest_len bytes JSON][image bytes ...]
//
// capability: this is gated to remotes whose transport is plain http.
// p2p / charnel transports fall through to per-blob fetches because
// the atlas endpoint is currently http-only. capability is also
// auto-disabled per-server on the first 404 / 405 (older server
// versions without the endpoint).

import {
  HttpTransport,
  type AtlasManifest,
  type BuildAtlasRequest,
} from "freqhole-api-client";
import { getTransportForRemote } from "../../app/api/client";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { debug, error as errorLog } from "../../utils/logger";
import { bump, gauge, timing } from "./perfLog";

/** what we hand to `drawImage` — a small offscreen canvas per entry. */
export type AtlasDrawable = HTMLCanvasElement;

/** mirrors `grimoire::media_blobz::atlas::MAX_IDS_PER_ATLAS`. */
const SERVER_MAX_IDS = 256;

/** mirrors `grimoire::media_blobz::atlas::MAX_PAGE_DIM`. used together
 *  with the requested thumb size to derive the per-page id cap (so we
 *  never ask the server to build a page that would exceed its dim cap). */
const SERVER_MAX_PAGE_DIM = 2048;

/** coalesce a frame's worth of `getAtlasThumb` calls into one POST. */
const BATCH_FLUSH_MS = 16;

type CapabilityState = "unknown" | "yes" | "no";

interface ServerState {
  serverId: string;
  capability: CapabilityState;
  /** keyed by `${blobId}|${size}` so the same (blob, size) request
   *  while a flush is pending merges into a single pending entry. */
  pending: Map<string, PendingEntry>;
  flushScheduled: boolean;
}

interface PendingEntry {
  blobId: string;
  size: number;
  /** redraws to fire once the entry resolves (hit, miss, or error).
   *  shared by reference with the cache "loading" entry so adding via
   *  either side stays consistent. */
  listeners: Set<() => void>;
}

type CacheEntry =
  | { state: "loading"; listeners: Set<() => void> }
  | { state: "ready"; canvas: AtlasDrawable }
  | { state: "error" };

const servers = new Map<string, ServerState>();
const cache = new Map<string, CacheEntry>();

function cacheKey(serverId: string, blobId: string, size: number): string {
  return `${serverId}|${blobId}|${size}`;
}

function getServerState(serverId: string): ServerState {
  let s = servers.get(serverId);
  if (!s) {
    s = {
      serverId,
      capability: "unknown",
      pending: new Map(),
      flushScheduled: false,
    };
    servers.set(serverId, s);
  }
  return s;
}

/** pre-seed capability (e.g. from a `/api/info` probe). callers can
 *  optionally call this when they already know the server advertises
 *  (or lacks) the `atlas` capability — otherwise the module discovers
 *  it lazily on the first batch. */
export function setServerAtlasCapability(
  serverId: string,
  has: boolean,
): void {
  getServerState(serverId).capability = has ? "yes" : "no";
}

/** quick check used by external gating (e.g. `imageCache.getImageFor`)
 *  to decide whether to try the atlas path at all. returns true when
 *  capability is "unknown" or "yes" — i.e. when it's still worth
 *  attempting. */
export function isAtlasEligible(serverId: string): boolean {
  return getServerState(serverId).capability !== "no";
}

/** entry-level status. callers that want to fall back to per-blob on
 *  "missing" (server confirmed it doesn't have a thumbnail for this
 *  id) need to distinguish that from "loading" (still in flight). */
export type AtlasEntryStatus = "ready" | "loading" | "missing" | "absent";

export function atlasEntryStatus(
  serverId: string,
  blobId: string,
  size: number,
): AtlasEntryStatus {
  const e = cache.get(cacheKey(serverId, blobId, size));
  if (!e) return "absent";
  if (e.state === "ready") return "ready";
  if (e.state === "loading") return "loading";
  return "missing";
}

/** per-thumb-size effective batch cap, derived from the server's
 *  MAX_PAGE_DIM. at size=200 the page can hold up to floor(2048/200)^2
 *  = 100 cells; at size=50, up to 1600 cells (capped by SERVER_MAX_IDS
 *  to 256). */
function maxIdsPerPage(size: number): number {
  const cellsPerRow = Math.max(1, Math.floor(SERVER_MAX_PAGE_DIM / size));
  return Math.min(SERVER_MAX_IDS, cellsPerRow * cellsPerRow);
}

/**
 * synchronous accessor for an atlas-extracted thumbnail. returns a
 * drawable canvas if already extracted; otherwise null and queues a
 * batched fetch. `onReady` (when supplied) fires once the entry
 * resolves — success, miss, or error — so callers can request a redraw.
 *
 * returns null synchronously when capability has been disabled for
 * the server. callers should fall through to per-blob fetch in that
 * case.
 */
export function getAtlasThumb(
  serverId: string,
  blobId: string,
  size: number,
  onReady?: () => void,
): AtlasDrawable | null {
  const key = cacheKey(serverId, blobId, size);
  const hit = cache.get(key);
  if (hit) {
    if (hit.state === "ready") {
      bump("atlas.cache.hit");
      return hit.canvas;
    }
    if (hit.state === "loading") {
      bump("atlas.cache.pending");
      if (onReady) hit.listeners.add(onReady);
      return null;
    }
    bump("atlas.cache.error");
    return null;
  }

  const s = getServerState(serverId);
  if (s.capability === "no") return null;

  const listeners = new Set<() => void>();
  if (onReady) listeners.add(onReady);
  cache.set(key, { state: "loading", listeners });
  bump("atlas.cache.miss");

  enqueue(s, blobId, size, listeners);
  return null;
}

function enqueue(
  s: ServerState,
  blobId: string,
  size: number,
  listeners: Set<() => void>,
): void {
  const pk = `${blobId}|${size}`;
  const existing = s.pending.get(pk);
  if (existing) {
    for (const fn of listeners) existing.listeners.add(fn);
    return;
  }
  s.pending.set(pk, { blobId, size, listeners });
  gauge("atlas.queue.depth", s.pending.size);
  scheduleFlush(s);
}

function scheduleFlush(s: ServerState): void {
  if (s.flushScheduled) return;
  s.flushScheduled = true;
  setTimeout(() => {
    s.flushScheduled = false;
    void flush(s);
  }, BATCH_FLUSH_MS);
}

async function flush(s: ServerState): Promise<void> {
  if (s.pending.size === 0) return;

  const transport = await resolveHttpTransport(s.serverId);
  if (!transport) {
    // non-http remote (p2p / charnel) — atlas is not supported there
    // yet. mark capability "no" so future calls short-circuit.
    s.capability = "no";
    failAllPending(s);
    return;
  }

  // pull the (private) api key off the remote record; HttpTransport
  // encapsulates it but doesn't expose it, so we go to the source.
  // safe because callers already trust the remote record.
  const remote = await getRemoteById(s.serverId).catch(() => null);
  const apiKey = remote?.api_key;

  // partition pending by size; each size becomes one (or more) POSTs.
  const bySize = new Map<number, PendingEntry[]>();
  for (const entry of s.pending.values()) {
    const arr = bySize.get(entry.size);
    if (arr) arr.push(entry);
    else bySize.set(entry.size, [entry]);
  }
  s.pending.clear();

  for (const [size, entries] of bySize) {
    const max = maxIdsPerPage(size);
    for (let i = 0; i < entries.length; i += max) {
      const slice = entries.slice(i, i + max);
      void postAtlasPage(s, transport.baseUrl, apiKey, size, slice);
    }
  }
}

async function resolveHttpTransport(
  serverId: string,
): Promise<HttpTransport | null> {
  try {
    const remote = await getRemoteById(serverId);
    if (!remote) return null;
    const t = await getTransportForRemote(remote);
    return t instanceof HttpTransport ? t : null;
  } catch (err) {
    errorLog("thumbAtlas", "failed to resolve transport:", err);
    return null;
  }
}

function failAllPending(s: ServerState): void {
  for (const entry of s.pending.values()) {
    const key = cacheKey(s.serverId, entry.blobId, entry.size);
    cache.set(key, { state: "error" });
    fireListeners(entry.listeners);
  }
  s.pending.clear();
}

async function postAtlasPage(
  s: ServerState,
  baseUrl: string,
  apiKey: string | undefined,
  size: number,
  entries: PendingEntry[],
): Promise<void> {
  const ids = entries.map((e) => e.blobId);
  const url = baseUrl + "/api/blobs/atlas";
  const body: BuildAtlasRequest = { ids, size, format: "webp" };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/octet-stream",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const t0 = performance.now();
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      credentials: apiKey ? "omit" : "include",
      body: JSON.stringify(body),
    });
  } catch (err) {
    errorLog("thumbAtlas", "network error:", err);
    bump("atlas.fetch.error");
    failEntries(s, entries);
    return;
  }

  if (resp.status === 404 || resp.status === 405) {
    // server is older than atlas support — disable for this server
    // and fall back to per-blob fetches for everything pending.
    debug(
      "thumbAtlas",
      `server ${s.serverId} lacks atlas endpoint (status ${resp.status})`,
    );
    s.capability = "no";
    bump("atlas.cap.disabled");
    failEntries(s, entries);
    return;
  }
  if (!resp.ok) {
    errorLog(
      "thumbAtlas",
      `http ${resp.status} for size ${size} ids ${ids.length}`,
    );
    bump("atlas.fetch.error");
    failEntries(s, entries);
    return;
  }

  const buf = await resp.arrayBuffer();
  if (buf.byteLength < 4) {
    errorLog("thumbAtlas", "response too small:", buf.byteLength);
    failEntries(s, entries);
    return;
  }

  const dv = new DataView(buf);
  const manifestLen = dv.getUint32(0, true);
  if (4 + manifestLen > buf.byteLength) {
    errorLog(
      "thumbAtlas",
      `manifest length ${manifestLen} exceeds body ${buf.byteLength}`,
    );
    failEntries(s, entries);
    return;
  }

  const manifestBytes = new Uint8Array(buf, 4, manifestLen);
  const manifestJson = new TextDecoder().decode(manifestBytes);
  let manifest: AtlasManifest;
  try {
    manifest = JSON.parse(manifestJson) as AtlasManifest;
  } catch (err) {
    errorLog("thumbAtlas", "manifest parse error:", err);
    failEntries(s, entries);
    return;
  }

  const imageBytes = new Uint8Array(buf, 4 + manifestLen);

  // got a real response — confirm capability if we hadn't yet.
  if (s.capability === "unknown") s.capability = "yes";

  let pageBitmap: ImageBitmap;
  try {
    const blob = new Blob([imageBytes], { type: "image/webp" });
    pageBitmap = await createImageBitmap(blob);
  } catch (err) {
    errorLog("thumbAtlas", "decode error:", err);
    failEntries(s, entries);
    return;
  }

  // slice each entry into its own small offscreen canvas. we deliberately
  // don't keep the page bitmap around — once sliced, each canvas is
  // independently usable and the page bitmap can be released so we don't
  // pin large textures in gpu memory for the cache's lifetime.
  const missingSet = new Set(manifest.missing ?? []);
  for (const entry of entries) {
    const key = cacheKey(s.serverId, entry.blobId, entry.size);
    if (missingSet.has(entry.blobId)) {
      cache.set(key, { state: "error" });
      fireListeners(entry.listeners);
      continue;
    }
    const rect = manifest.entries?.[entry.blobId];
    if (!rect) {
      cache.set(key, { state: "error" });
      fireListeners(entry.listeners);
      continue;
    }
    const canvas = document.createElement("canvas");
    canvas.width = rect.w;
    canvas.height = rect.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      cache.set(key, { state: "error" });
      fireListeners(entry.listeners);
      continue;
    }
    ctx.drawImage(
      pageBitmap,
      rect.u,
      rect.v,
      rect.w,
      rect.h,
      0,
      0,
      rect.w,
      rect.h,
    );
    cache.set(key, { state: "ready", canvas });
    bump("atlas.entry.ready");
    fireListeners(entry.listeners);
  }

  pageBitmap.close();

  timing("atlas.fetch", performance.now() - t0);
  bump("atlas.fetch.done");
  gauge("atlas.cache.size", cache.size);
}

function failEntries(s: ServerState, entries: PendingEntry[]): void {
  for (const entry of entries) {
    const key = cacheKey(s.serverId, entry.blobId, entry.size);
    cache.set(key, { state: "error" });
    fireListeners(entry.listeners);
  }
}

function fireListeners(listeners: Set<() => void>): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // one bad listener shouldn't take down the rest of the batch.
    }
  }
  listeners.clear();
}

/** clear everything — intended for tests / dev reset. */
export function clearAtlasCache(): void {
  cache.clear();
  for (const s of servers.values()) {
    s.pending.clear();
    s.flushScheduled = false;
  }
}
