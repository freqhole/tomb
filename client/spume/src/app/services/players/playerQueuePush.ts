// pushes local songs and videos to a paired
// freqhole-player device.
//
// "controller itself holds the blob" pattern: this
// device imports the media's bytes into its own local blob store (making
// them fetchable by iroh-blobs verified streaming), then tells the player
// to pull from *this* node by blake3 hash. two transports, selected via
// isCharnelMode() (see importMediaBytes() below): wasm (browser midden
// node's own store) or charnel/tauri (`p2p_import_blob_bytes`/
// `p2p_get_node_id`, the same iroh-blobs FsStore + pull model
// `CharnelTransport.ts` already uses for music/video uploads).
//
// `getAudioURL()`/`getVideoURL()` already resolve every storage backend
// (local opfs, remote p2p, remote http, blob-cached) into a fetchable url,
// so fetching that url + importing the bytes works regardless of where the
// media actually lives - no per-backend branching needed here.
//
// deliberately simple: no dedupe/hash-cache (import is idempotent per
// content anyway), no release_blob/GC of imported blobs.
//
// "optimistic, reactive-only networking":
// songToMediaRef()/videoToMediaRef() do at most ONE cheap, local, no-
// network lookup (getRemoteById) before returning a ref - the queue
// command is sent with this device's best-guess declared source and
// nothing more. no admin bridge grant, no local-file check, no fetch/
// import happens proactively, not even in the background - the player is
// trusted to resolve the ref itself first (see mediaRefResolve.ts),
// exactly like every other MediaRef it's ever told about. only once the
// player's own status genuinely reports it couldn't reach the declared
// source (`RemoteStatus.unresolved_items`, wired into
// `handleUnresolvedItems` below via remotePlaybackControl.ts's
// applyRemoteStatus) does this device do any real networking at all: a
// "cross-remote forwarding" admin bridge grant (tryBridgeToSourceRemote -
// if this device is already an admin on the item's source remote C, it
// grants the player A direct read-trust there via C's admin `peers_allow`
// command, so A can pull the blob straight from C), or, failing that, a
// genuine fetch+import relay through this device (the actual "controller
// proxies media blob data" moment - see the loud CONTROLLER_BLOB_PROXY
// log lines throughout this file for exactly where that happens).
// video is a partial exception: a video with no locally-known blake3 (the
// common case - see QueuedVideo.blake3's own doc comment) genuinely has no
// hash to declare at all without SOME network round trip, so
// videoToMediaRef still blocks on a bridged metadata lookup (cheap) or, as
// a last resort, a full fetch+hash (heavy) - that's required work to send
// anything, not optional "just in case" work, so it's unaffected by the
// above.

import { getClientForRemote, getLocalNodeIdAsync, getMiddenNode } from "../../api/client";
import { adminClientFor } from "../../api/adminClient";
import { isCharnelMode } from "../charnel/mode";
import {
  fetchLocalNodeId,
  importBlobByPath,
  beginChunkedBlobImport,
  appendChunkedBlobImport,
  finishChunkedBlobImport,
  abortChunkedBlobImport,
} from "../charnel/commands";
import { resolveCharnelLocalBlobPath } from "../media/resolveCharnelLocalBlobPath";
import { getAudioURL } from "../../../music/services/storage/audioAccess";
import type { Song } from "../../../music/services/storage/types";

/** bounded-concurrency counterpart to `Promise.all(items.map(fn))` - runs
 * at most `limit` calls to `fn` at once instead of firing all of them
 * simultaneously. found live: blasting a whole album's worth of
 * `songToMediaRef`/`videoToMediaRef` calls (each doing a tauri IPC
 * fetch+chunked-import round trip) via a plain `Promise.all` saturated
 * something in the tauri IPC bridge badly enough that a 16-song queue
 * push's resolve step alone took ~11 SECONDS all at once (vs. a few
 * hundred ms per item run with only a handful in flight) - everything
 * queued up and released in a single burst rather than actually running
 * in parallel. order-preserving: `result[i]` corresponds to `items[i]`
 * regardless of finish order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// tauri IPC (and the underlying fetch()es for artwork/audio bytes) don't
// scale with unbounded concurrency - see mapWithConcurrency's own doc
// comment for the real, measured regression this fixes.
const QUEUE_PUSH_CONCURRENCY = 3;
import { createSignal } from "solid-js";
import { getRemoteById, getRemoteByPeerAddr } from "../remotes/remoteManager";
import { isP2PRemote, type P2PRemote } from "../storage/schemas/remote";
import { sendPlayerCommand } from "./playerPairingClient";
import { debug, warn } from "../../../utils/logger";
import { CENOTAPH_QUEUE_TRACE } from "../../../cenotaph/queueTrace";
import {
  applyRemoteStatusFromAck,
  pruneLocalQueueAfterSuccessfulPush,
  registerUnresolvedItemsHandler,
  reportCommandAckFailure,
  type PushedQueueItem,
  type RemoteMediaRef,
  type RemoteStatus,
  type RenditionRef,
  type UnresolvedItemRef,
} from "./remotePlaybackControl";
import { getVideoURL } from "../../../video/services/videoBlobAccess";
import { resolveLocalVideoPath } from "../../../video/services/localVideo";
import { mediaItemKey, songToMediaItem, videoToMediaItem } from "../storage/mediaItem";
import type { MediaItem, QueuedVideo } from "../storage/mediaItem";

// registers this module's reactive handler with remotePlaybackControl.ts
// - see that file's own doc comment on `registerUnresolvedItemsHandler`
// for why this is a registration call rather than remotePlaybackControl.ts
// importing `handleUnresolvedItems` directly (avoids a circular import
// that broke that file's own unit tests by pulling the wasm midden
// package into their module graph). `handleUnresolvedItems` is a hoisted
// function declaration, so referencing it here (before its own textual
// definition further down this file) is safe.
registerUnresolvedItemsHandler((peerAddr, items) => {
  void handleUnresolvedItems(peerAddr, items);
});

/** live transfer state for a queue row genuinely being proxied through
 * this device right now (the CONTROLLER_BLOB_PROXY moments elsewhere in
 * this file) - `undefined` the rest of the time (the vastly more common
 * case, an item the player resolves entirely on its own). keyed the same
 * way `RemoteQueueRow` already identifies a row: the item's
 * `blake3_hash` - which, for a video still being hashed for the very
 * first time (see `videoToMediaRef`'s last-resort branch below), IS the
 * `pending:${video.id}` placeholder `remoteQueueMirror.ts`'s optimistic
 * overlay already uses for an unconfirmed row, so the UI needs no extra
 * plumbing to find the right entry either way. */
export interface QueueItemTransferStatus {
  phase: "fetching" | "sending" | "awaiting_ack";
  /** source being fetched from (fetching phase) - undefined if unknown. */
  fromRemoteName?: string;
  /** player being served (sending/awaiting_ack phase) - undefined if
   * unknown. */
  toPlayerName?: string;
  /** 0..1 if known (content-length/total size was available), else
   * undefined - UI shows an indeterminate spinner in that case. always
   * undefined for `awaiting_ack` - there's no fraction to report while
   * waiting on the player's append_queue response, only elapsed time. */
  progress?: number;
}

const [transferStatusByKey, setTransferStatusByKey] = createSignal<
  Map<string, QueueItemTransferStatus>
>(new Map());

/** read by RemoteQueueRow.tsx to show "fetching from X"/"sending to Y". */
export function queueItemTransferStatus(key: string): QueueItemTransferStatus | undefined {
  return transferStatusByKey().get(key);
}

function setTransferStatus(key: string, status: QueueItemTransferStatus | null): void {
  setTransferStatusByKey((prev) => {
    const next = new Map(prev);
    if (status) next.set(key, status);
    else next.delete(key);
    return next;
  });
}

async function resolveRemoteName(remoteId: string | null | undefined): Promise<string | undefined> {
  if (!remoteId) return undefined;
  return (await getRemoteById(remoteId))?.name;
}

async function resolvePlayerName(peerAddr: string): Promise<string | undefined> {
  return (await getRemoteByPeerAddr(peerAddr))?.name;
}

function bytesToBase64(bytes: Uint8Array): string {
  // chunked to avoid maximum-call-stack on String.fromCharCode for big arrays.
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

// ~4MB raw per chunk, matching CharnelLocalTransport.uploadChunked/
// CharnelTransport.uploadMediaViaBytes's own chunk size - keeps peak
// per-IPC-call payload bounded regardless of the source file's size.
const IMPORT_CHUNK_SIZE = 4 * 1024 * 1024;

/** charnel-mode fallback used by importMediaBytes below, only once the
 * local-path fast path (importLocalFileByPath, always tried first by
 * songToMediaRef/videoToMediaRef) comes up empty - i.e. genuinely
 * remote-only content this device has to relay through JS. streams bytes
 * into the p2p blob store in bounded chunks instead of base64-ing the
 * whole file into one JS string/IPC call (the now-deprecated, 1MB-gated
 * `importBlobBytes` in charnel/commands.ts). `onProgress` (0..1), if
 * given, is called after every chunk - the "sending to $player" progress
 * shown on a proxied queue row. */
async function importBytesChunked(
  bytes: Uint8Array,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const uploadId = await beginChunkedBlobImport();
  try {
    let sent = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += IMPORT_CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, Math.min(offset + IMPORT_CHUNK_SIZE, bytes.byteLength));
      await appendChunkedBlobImport(uploadId, bytesToBase64(chunk));
      sent += chunk.byteLength;
      onProgress?.(sent / bytes.byteLength);
    }
    return await finishChunkedBlobImport(uploadId);
  } catch (err) {
    await abortChunkedBlobImport(uploadId).catch(() => {});
    throw err;
  }
}

/** imports media bytes (song or video) into this device's local blob store
 * (charnel: iroh-blobs FsStore via tauri, streamed in bounded
 * chunks - see importBytesChunked; browser: the wasm midden node's own
 * store, a single in-memory call since there's no IPC/JSON boundary to
 * protect there) and returns this device's own node id + the resulting
 * blake3 hash, so the player can be told to pull the bytes from us by
 * hash. only reached when the content isn't already resolvable to a local
 * file path (see importLocalFileByPath below, always tried first) - i.e.
 * genuinely remote-only content this device has to relay through JS.
 * `onProgress` only fires in charnel mode (the wasm midden import is one
 * single in-memory call with nothing to chunk/report between). */
async function importMediaBytes(
  bytes: Uint8Array,
  onProgress?: (fraction: number) => void
): Promise<{ sourcePeerAddr: string; blake3Hash: string }> {
  if (isCharnelMode()) {
    const [nodeId, blake3Hash] = await Promise.all([
      fetchLocalNodeId(),
      importBytesChunked(bytes, onProgress),
    ]);
    if (!nodeId) throw new Error("charnel p2p node id unavailable - is federation enabled?");
    debug(
      "playerQueuePush",
      `importMediaBytes (charnel, chunked) ${bytes.byteLength}b -> blake3=${blake3Hash}, sourcePeerAddr=${nodeId}`
    );
    return { sourcePeerAddr: nodeId, blake3Hash };
  }
  const node = await getMiddenNode();
  if (!node.import_blob) {
    throw new Error("this transport cannot make blobs available to a paired player");
  }
  const blake3Hash = await node.import_blob(bytes);
  debug(
    "playerQueuePush",
    `importMediaBytes (wasm) ${bytes.byteLength}b -> blake3=${blake3Hash}, sourcePeerAddr=${node.node_id()}`
  );
  return { sourcePeerAddr: node.node_id(), blake3Hash };
}

/** `fetch(url)` that reports download progress (0..1) as bytes stream in,
 * via `onProgress` - the "fetching from $remote" progress shown on a
 * proxied queue row. falls back to a plain, progress-less
 * `res.arrayBuffer()` if the runtime doesn't support streaming response
 * bodies (`res.body` missing) or the total size can't be determined
 * (no `content-length` header and no `sizeHint`) - progress just stays
 * unreported (UI shows an indeterminate spinner) in either case. also
 * returns the response's `content-type` (mirrors what `res.blob().type`
 * would have given a caller that used the non-streaming blob API instead). */
async function fetchBytesWithProgress(
  url: string,
  sizeHint: number | undefined,
  onProgress?: (fraction: number) => void
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const res = await fetch(url);
  const contentType = res.headers.get("content-type");
  const total = Number(res.headers.get("content-length")) || sizeHint || 0;
  if (!res.body || typeof res.body.getReader !== "function" || total <= 0) {
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, contentType };
}

/** fetches `url` and imports the bytes into this device's blob store in a
 * single streaming pass - the real fix for the "controller media blob
 * proxy" relay path (`ensureSongServableInBackground`/
 * `ensureVideoServableInBackground`/`videoToMediaRef`'s last-resort
 * branch), which used to always fetch the WHOLE file into one buffer
 * (`fetchBytesWithProgress`) and THEN hand that whole buffer to
 * `import_blob` - two full in-memory copies, neither streamed past the
 * network-read stage.
 *
 * browser/wasm: pushes each network chunk straight into midden's
 * `ImportSession` (`node.start_import()` - see WasmTransport.ts's
 * `MiddenNodeLike.start_import` doc comment) as it arrives. the wasm
 * boundary never sees the whole payload at once; iroh-blobs computes the
 * bao tree incrementally. this is the SAME chunked-import primitive
 * `@freqhole/reliquary`'s worker-hosted midden client already wraps
 * (`WorkerImportSession`) - spume runs midden on the main thread, not in
 * a worker, so it's called directly here instead of through reliquary's
 * comlink wrapper, but it's the identical underlying api, not a new one.
 * falls back to the old fetch-then-import-whole-buffer path (on the SAME
 * response, never re-fetching) only if this node build predates
 * `start_import` or the response body isn't stream-capable.
 *
 * charnel/tauri mode is unaffected - it already streams in bounded chunks
 * via its own tauri IPC session (`importBytesChunked`/`importMediaBytes`'s
 * charnel branch), which has nothing to do with wasm's `ImportSession`.
 *
 * `onProgress` is phase-tagged so callers can keep showing the queue
 * row's real "fetching from X"/"sending to Y" distinction (RemoteQueueRow.
 * tsx) instead of collapsing both into one misleading label: the wasm
 * streaming branch reports "fetching" throughout (network read is the
 * real bottleneck; each chunk's `session.push()` is a fast local step
 * riding along with it, not a separate wait), while charnel/the
 * whole-buffer fallback genuinely have two sequential phases and report
 * "fetching" then "sending" accordingly. */
async function fetchAndImportStreaming(
  url: string,
  sizeHint: number | undefined,
  onProgress?: (phase: "fetching" | "sending", fraction: number) => void
): Promise<{ sourcePeerAddr: string; blake3Hash: string; contentType: string | null }> {
  if (isCharnelMode()) {
    const { bytes, contentType } = await fetchBytesWithProgress(url, sizeHint, (fraction) =>
      onProgress?.("fetching", fraction)
    );
    const imported = await importMediaBytes(bytes, (fraction) => onProgress?.("sending", fraction));
    return { ...imported, contentType };
  }

  const node = await getMiddenNode();
  const res = await fetch(url);
  const contentType = res.headers.get("content-type");
  const total = Number(res.headers.get("content-length")) || sizeHint || 0;

  if (!node.start_import || !res.body || typeof res.body.getReader !== "function") {
    // no chunked-import support (older node build, or a non-streamable
    // response body) - fall back to the whole-buffer path on the SAME
    // response, never re-fetching. genuinely two sequential phases here
    // too (the whole file must finish downloading before import_blob can
    // start), same reporting as the charnel branch above.
    const bytes = new Uint8Array(await res.arrayBuffer());
    const imported = await importMediaBytes(bytes, (fraction) => onProgress?.("sending", fraction));
    return { ...imported, contentType };
  }

  const session = node.start_import();
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await session.push(value);
      received += value.byteLength;
      if (total > 0) onProgress?.("fetching", Math.min(1, received / total));
    }
    const blake3Hash = await session.finish();
    debug(
      "playerQueuePush",
      `fetchAndImportStreaming (wasm, chunked) ${received}b -> blake3=${blake3Hash}, sourcePeerAddr=${node.node_id()}`
    );
    return { sourcePeerAddr: node.node_id(), blake3Hash, contentType };
  } catch (err) {
    session.abort();
    throw err;
  }
}

/** charnel-only fast path: if the content is already a real file on this
 * device's own disk (resolveCharnelLocalBlobPath for songs,
 * resolveLocalVideoPath for video - both tried before ever falling back to
 * fetch+importMediaBytes), import it directly by path. zero bytes ever
 * cross into JS memory: no fetch, no base64, no chunking, no IPC payload
 * proportional to file size at all. mirrors CharnelTransport.ts's own
 * `uploadByPath` use of the same `p2p_import_blob` command. */
async function importLocalFileByPath(
  filePath: string
): Promise<{ sourcePeerAddr: string; blake3Hash: string }> {
  const [nodeId, blake3Hash] = await Promise.all([fetchLocalNodeId(), importBlobByPath(filePath)]);
  if (!nodeId) throw new Error("charnel p2p node id unavailable - is federation enabled?");
  return { sourcePeerAddr: nodeId, blake3Hash };
}

// step 8 (cross-remote forwarding): remote_id -> the P2P remote to point
// the player at directly, once bridged, shared across a single push/append
// call so a queue of many items from the same remote only attempts the
// admin bridge once, not once per item.
type BridgeCache = Map<string, Promise<P2PRemote | null>>;

// session-scoped record of "the blake3 hash this device most recently
// declared on the wire for a given local media item, and the item
// itself" - populated by songToMediaRef/videoToMediaRef every time they
// build a ref, so handleUnresolvedItems (below) can look the original
// Song/QueuedVideo back up purely from the hash a player reports back on
// `RemoteStatus.unresolved_items`. nothing else persists this mapping
// anywhere - it only needs to survive long enough for a player's next
// status update to arrive, not across app restarts.
const pushedItemsByHash = new Map<string, MediaItem>();

/** this device's own p2p node id, charnel or browser alike - the only
 * correct "declared source" fallback when a local item has no P2P remote
 * of its own. `fetchLocalNodeId() ?? playerNodeId` used to be used for
 * this instead - `fetchLocalNodeId()` is charnel/tauri-only and resolves
 * to `null` in plain browser mode, silently falling back to
 * `playerNodeId` (the DESTINATION player's own address, not a source at
 * all). that made every locally-owned item pushed from a plain browser
 * controller declare itself as its own source, which the player's
 * `isSelfPeerAddr` check correctly refuses to dial - resolution failed
 * every time, `handleUnresolvedItems` retried with the exact same broken
 * fallback, forever (a real, reported infinite append_queue retry loop). */
async function ownNodeIdOrThrow(): Promise<string> {
  const id = await getLocalNodeIdAsync();
  if (!id) throw new Error("no local p2p node id available (p2p not initialized)");
  return id;
}

function rememberPushedItem(hash: string, item: MediaItem): void {
  pushedItemsByHash.set(hash, item);
}

/** injected by remoteQueueMirror.ts, which registers itself at module
 * load (mirrors registerUnresolvedItemsHandler in remotePlaybackControl.ts
 * - avoids a circular import, since remoteQueueMirror.ts already imports
 * FROM this file). lets `handleUnresolvedItems` below show a placeholder
 * queue row, keyed by the exact hash the player reported as unresolved,
 * for the duration of the CONTROLLER_BLOB_PROXY retry - without it,
 * `optimisticRemoteQueue()` has no row at that hash at all (the player
 * never added it to its own queue, since failing to resolve it is the
 * whole reason it's being retried), so `RemoteQueueRow`'s transfer-status
 * lookup had nothing to attach to and the progress bar never rendered. */
let registerPendingRetryOp: ((hash: string, item: MediaItem) => () => void) | null = null;
export function registerPendingRetryHook(fn: (hash: string, item: MediaItem) => () => void): void {
  registerPendingRetryOp = fn;
}

/** step 8 (cross-remote forwarding, node A=player, B=this device, C=source
 * remote): if this device already has admin rights on the item's source
 * remote (C), grants the player (A) direct read-trust there via C's admin
 * `peers_allow` command, so A can pull the blob straight from C. called
 * fire-and-forget (not awaited) by songToMediaRef/videoToMediaRef - see
 * their own header comments: the queue command already declares C as the
 * source before this grant finishes, optimistically betting the player
 * either already has access or will by the time it gets around to
 * dialing C. returns null on any failure - not a P2P remote, not admin
 * on C, remote_admin disabled there, offline, etc. */
async function tryBridgeToSourceRemote(
  remoteId: string,
  playerNodeId: string,
  cache: BridgeCache
): Promise<P2PRemote | null> {
  let pending = cache.get(remoteId);
  if (!pending) {
    pending = (async () => {
      try {
        const remote = await getRemoteById(remoteId);
        if (!remote || !isP2PRemote(remote)) return null;
        const client = await adminClientFor(remote);
        await client.dispatchOrThrow("peers_allow", { node_id: playerNodeId });
        return remote;
      } catch {
        return null;
      }
    })();
    cache.set(remoteId, pending);
  }
  return pending;
}

async function songToMediaRef(song: Song): Promise<RemoteMediaRef> {
  const t0 = Date.now();
  const hash = song.blake3 ?? song.sha256;

  // be optimistic: this device already knows everything needed to send
  // the command RIGHT NOW - the real content hash, and (one cheap, local,
  // no-network lookup) the actual peer this content lives on. no admin
  // trust grant, no local-file check, no fetch, no import happens before
  // returning, and NONE is even kicked off in the background - all of
  // that is real networking, and the player can (and should) do it for
  // itself first, exactly the way it resolves anything else it's told
  // about (see mediaRefResolve.ts). this device only does any networking
  // at all once the player actually reports (via `unresolved_items` on
  // its status) that it couldn't reach the declared source - see
  // `handleUnresolvedItems` below, which is the ONLY caller of
  // `tryBridgeToSourceRemote`/`ensureSongServableInBackground` now.
  const remote = song.remote_server_id ? await getRemoteById(song.remote_server_id) : null;
  const sourcePeerAddr =
    remote && isP2PRemote(remote) ? remote.peer_addr : await ownNodeIdOrThrow();
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} songToMediaRef(${song.title}): sending immediately, source_peer_addr=${sourcePeerAddr.slice(0, 8)}..., total ${Date.now() - t0}ms`
  );
  const ref = buildSongRef(song, sourcePeerAddr, hash);
  rememberPushedItem(hash, songToMediaItem(song));
  return ref;
}

/** shared field-builder for a song's `RemoteMediaRef`, used both by the
 * optimistic `songToMediaRef` above and by `handleUnresolvedItems`'s
 * reactive retry - identical fields either way, only `sourcePeerAddr`
 * (and, implicitly, whether real networking already happened to make it
 * true) differs. artwork is deliberately never included - it's real
 * blob-ish work (a fetch + canvas downscale) and must never block a queue
 * command; an item just renders with no artwork (the player has a
 * fallback icon for that). */
function buildSongRef(song: Song, sourcePeerAddr: string, blake3Hash: string): RemoteMediaRef {
  return {
    source_peer_addr: sourcePeerAddr,
    blake3_hash: blake3Hash,
    size_bytes: song.file_size ?? undefined,
    duration_ms: song.duration_seconds ? Math.round(song.duration_seconds * 1000) : undefined,
    mime_type: song.mime_type ?? "audio/mpeg",
    kind: "audio",
    title: song.title,
    artist: song.artist_name,
  };
}

/** makes sure `song`'s bytes are actually servable from this device
 * (declared as `nodeId` in the ref already sent) - entirely AFTER the
 * queue command has gone out, never blocking it. checks the cheap,
 * already-on-disk case first (charnel: a real file, no js-memory bytes
 * at all); only fetches+imports through JS as a LAST RESORT for content
 * this device doesn't already have a local copy of - that fetch+import is
 * the actual "controller proxies media blob data" moment (as opposed to
 * merely declaring itself the source, which may still resolve to the
 * cheap on-disk path below and move zero bytes) - logged loudly (warn,
 * not debug) so it's easy to spot happening more than expected.
 * `playerNodeId` is only used to resolve a display name for the
 * "sending to $player" transfer status - see `QueueItemTransferStatus`. */
async function ensureSongServableInBackground(
  song: Song,
  nodeId: string,
  playerNodeId: string,
  hash: string
): Promise<void> {
  const t0 = Date.now();
  const localPath = await resolveCharnelLocalBlobPath(song.blake3);
  if (localPath) {
    await importLocalFileByPath(localPath);
    debug(
      "playerQueuePush",
      `${CENOTAPH_QUEUE_TRACE} ensureSongServableInBackground(${song.title}): already on disk, imported by path in ${Date.now() - t0}ms`
    );
    return;
  }
  warn(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} CONTROLLER_BLOB_PROXY: relaying "${song.title}" (blake3=${hash.slice(0, 8)}..., remote_server_id=${song.remote_server_id ?? "(none)"}) through THIS device as a last resort - no known P2P source remote and nothing already on disk. if this fires often, something is misclassifying a song's remote_server_id.`
  );
  const [fromRemoteName, toPlayerName] = await Promise.all([
    resolveRemoteName(song.remote_server_id),
    resolvePlayerName(playerNodeId),
  ]);
  try {
    setTransferStatus(hash, { phase: "fetching", fromRemoteName });
    const url = await getAudioURL(song);
    const { blake3Hash } = await fetchAndImportStreaming(
      url,
      song.file_size ?? undefined,
      (phase, fraction) =>
        setTransferStatus(
          hash,
          phase === "fetching"
            ? { phase: "fetching", fromRemoteName, progress: fraction }
            : { phase: "sending", toPlayerName, progress: fraction }
        )
    );
    warn(
      "playerQueuePush",
      `${CENOTAPH_QUEUE_TRACE} CONTROLLER_BLOB_PROXY: fetched+imported "${song.title}" (blake3=${blake3Hash.slice(0, 8)}...) in ${Date.now() - t0}ms (command was already sent before this started), sourcePeerAddr=${nodeId}`
    );
  } finally {
    setTransferStatus(hash, null);
  }
}

/** looks up already-transcoded renditions for a video's source media blob
 * (via the existing `get_video_renditions` route) so the receiving player
 * can pull a smaller/already-compatible file instead of the original -
 * see `RemoteMediaRef.available_renditions`'s doc comment. best-effort:
 * returns `[]` on any failure (unreachable remote, no renditions
 * configured, etc.) rather than failing the whole queue push over what's
 * purely a bandwidth optimization. sorted smallest-width-first so the
 * receiver's own "prefer the smallest" choice is a plain array scan. */
async function fetchAvailableRenditions(
  client: Awaited<ReturnType<typeof getClientForRemote>>,
  mediaBlobId: string
): Promise<RenditionRef[]> {
  try {
    const result = await client.video.getVideoRenditions({ media_blob_id: mediaBlobId });
    if (!result.success || !result.data) return [];
    return result.data
      .filter((r) => !r.skipped && r.blake3)
      .map((r) => ({
        blake3_hash: r.blake3 as string,
        label: r.label,
        mime_type: r.mime ?? undefined,
        width: r.width ?? undefined,
        height: r.height ?? undefined,
      }))
      .sort((a, b) => (a.width ?? Infinity) - (b.width ?? Infinity));
  } catch {
    return [];
  }
}

/** video equivalent of songToMediaRef() above. `QueuedVideo` (the generated
 * `Video` type) has no stable mime-type field of its own (unlike `Song`) -
 * `res.blob().type`, read off the actual fetched bytes, is what
 * `syncVideoToLocal.ts`/`localImport.ts` already use for this same reason.
 * artwork is deliberately never resolved here either - see
 * songToMediaRef's header comment for why. */
async function videoToMediaRef(
  video: QueuedVideo,
  playerNodeId: string,
  bridgeCache: BridgeCache
): Promise<RemoteMediaRef> {
  const t0 = Date.now();

  // be optimistic, same as songToMediaRef above - if this video already
  // carries its own blake3, this device already knows everything needed
  // to send the command right now: one cheap local remote lookup for the
  // real source peer, no admin grant / fetch / import, not even kicked
  // off in the background - see songToMediaRef's doc comment for why.
  // `handleUnresolvedItems` is the only place that still does this
  // networking, and only once the player actually reports it needs help.
  if (video.blake3) {
    const remote = video.remote_server_id ? await getRemoteById(video.remote_server_id) : null;
    const sourcePeerAddr =
      remote && isP2PRemote(remote) ? remote.peer_addr : await ownNodeIdOrThrow();
    debug(
      "playerQueuePush",
      `${CENOTAPH_QUEUE_TRACE} videoToMediaRef(${video.title}): sending immediately, source_peer_addr=${sourcePeerAddr.slice(0, 8)}..., total ${Date.now() - t0}ms`
    );
    const ref = buildVideoRef(video, sourcePeerAddr, video.blake3);
    rememberPushedItem(video.blake3, videoToMediaItem(video));
    return ref;
  }

  // video has no blake3 of its own - as of migration 084 this is now the
  // RARE case (grimoire's wire Video carries blake3 directly for any
  // synced/backfilled row; see QueuedVideo.blake3's doc comment for the
  // cases that still land here: a local-only OPFS video, or a blob whose
  // blake3 hasn't been computed yet). the only way to learn one without
  // fetching+hashing the whole file ourselves is a bridged metadata
  // lookup (a tiny hash+size read, not a blob transfer) - worth keeping,
  // since without it there'd be nothing to send at all.
  if (video.remote_server_id && video.media_blob_id) {
    const bridged = await tryBridgeToSourceRemote(
      video.remote_server_id,
      playerNodeId,
      bridgeCache
    );
    debug(
      "playerQueuePush",
      `${CENOTAPH_QUEUE_TRACE} videoToMediaRef(${video.title}): tryBridgeToSourceRemote took ${Date.now() - t0}ms, bridged=${!!bridged}`
    );
    if (bridged) {
      try {
        const client = await getClientForRemote(bridged);
        const metadata = await client.music.blobMetadata({ id: video.media_blob_id });
        if (metadata.success && metadata.data?.blake3) {
          const available_renditions = await fetchAvailableRenditions(client, video.media_blob_id);
          const ref = buildVideoRef(video, bridged.peer_addr, metadata.data.blake3, {
            size_bytes: metadata.data.size ?? undefined,
            mime_type: metadata.data.mime ?? "video/mp4",
            available_renditions:
              available_renditions.length > 0 ? available_renditions : undefined,
          });
          rememberPushedItem(metadata.data.blake3, videoToMediaItem(video));
          return ref;
        }
      } catch {
        // fall through to fetch-and-relay below
      }
    }
  }
  // last resort - genuinely can't declare a hash without fetching bytes
  // and computing it ourselves. this DOES block (unlike the background
  // relay path below) since there's no hash to send at all otherwise -
  // still the real "controller proxies media blob data" moment, logged
  // loudly so it's easy to spot happening more than expected. keyed by
  // the same `pending:${video.id}` placeholder remoteQueueMirror.ts's
  // optimistic overlay already uses for this row (the real blake3_hash
  // isn't known until this finishes), so RemoteQueueRow's lookup by
  // `item.blake3_hash` finds this transfer status without extra plumbing.
  warn(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} CONTROLLER_BLOB_PROXY: fetching+importing "${video.title}" through THIS device - no known blake3, no bridge, nothing already on disk. if this fires often, something is misclassifying a video's remote_server_id/media_blob_id.`
  );
  const transferKey = `pending:${video.id}`;
  const [fromRemoteName, toPlayerName] = await Promise.all([
    resolveRemoteName(video.remote_server_id),
    resolvePlayerName(playerNodeId),
  ]);
  try {
    setTransferStatus(transferKey, { phase: "fetching", fromRemoteName });
    const fetchStart = Date.now();
    const url = await getVideoURL(video);
    const { sourcePeerAddr, blake3Hash, contentType } = await fetchAndImportStreaming(
      url,
      undefined,
      (phase, fraction) =>
        setTransferStatus(
          transferKey,
          phase === "fetching"
            ? { phase: "fetching", fromRemoteName, progress: fraction }
            : { phase: "sending", toPlayerName, progress: fraction }
        )
    );
    debug(
      "playerQueuePush",
      `${CENOTAPH_QUEUE_TRACE} videoToMediaRef(${video.title}): fetchAndImportStreaming (relay path, no known blake3) took ${Date.now() - fetchStart}ms`
    );
    const ref = buildVideoRef(video, sourcePeerAddr, blake3Hash, {
      mime_type: contentType || "video/mp4",
    });
    rememberPushedItem(blake3Hash, videoToMediaItem(video));
    return ref;
  } finally {
    setTransferStatus(transferKey, null);
  }
}

/** shared field-builder for a video's `RemoteMediaRef` - see
 * `buildSongRef`'s doc comment above, same rationale. */
function buildVideoRef(
  video: QueuedVideo,
  sourcePeerAddr: string,
  blake3Hash: string,
  extra?: Partial<RemoteMediaRef>
): RemoteMediaRef {
  return {
    source_peer_addr: sourcePeerAddr,
    blake3_hash: blake3Hash,
    duration_ms: video.duration_seconds ? Math.round(video.duration_seconds * 1000) : undefined,
    mime_type: "video/mp4",
    kind: "video",
    title: video.title,
    ...extra,
  };
}

/** video counterpart of ensureSongServableInBackground() above. `hash` is
 * the already-known content hash (a video's `.blake3` is often unset - see
 * `QueuedVideo.blake3`'s doc comment - so the caller passes the real hash
 * it already has rather than this function trying to re-derive one).
 * `playerNodeId` resolves the "sending to $player" display name. */
async function ensureVideoServableInBackground(
  video: QueuedVideo,
  nodeId: string,
  playerNodeId: string,
  hash: string
): Promise<void> {
  const t0 = Date.now();
  const localPath = await resolveLocalVideoPath(video);
  if (localPath) {
    await importLocalFileByPath(localPath);
    debug(
      "playerQueuePush",
      `${CENOTAPH_QUEUE_TRACE} ensureVideoServableInBackground(${video.title}): already on disk, imported by path in ${Date.now() - t0}ms`
    );
    return;
  }
  warn(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} CONTROLLER_BLOB_PROXY: relaying "${video.title}" (blake3=${video.blake3?.slice(0, 8) ?? "(none)"}..., remote_server_id=${video.remote_server_id ?? "(none)"}) through THIS device as a last resort - no known P2P source remote and nothing already on disk. if this fires often, something is misclassifying a video's remote_server_id.`
  );
  const [fromRemoteName, toPlayerName] = await Promise.all([
    resolveRemoteName(video.remote_server_id),
    resolvePlayerName(playerNodeId),
  ]);
  try {
    setTransferStatus(hash, { phase: "fetching", fromRemoteName });
    const url = await getVideoURL(video);
    const { blake3Hash } = await fetchAndImportStreaming(url, undefined, (phase, fraction) =>
      setTransferStatus(
        hash,
        phase === "fetching"
          ? { phase: "fetching", fromRemoteName, progress: fraction }
          : { phase: "sending", toPlayerName, progress: fraction }
      )
    );
    warn(
      "playerQueuePush",
      `${CENOTAPH_QUEUE_TRACE} CONTROLLER_BLOB_PROXY: fetched+imported "${video.title}" (blake3=${blake3Hash.slice(0, 8)}...) in ${Date.now() - t0}ms (command was already sent before this started), sourcePeerAddr=${nodeId}`
    );
  } finally {
    setTransferStatus(hash, null);
  }
}

/** does the actual reactive work (bridge grant, or fetch+import) for one
 * item a player reported it couldn't resolve, then returns a fresh
 * `RemoteMediaRef` for it - `hash` (the map key `mediaItem` was cached
 * under in `pushedItemsByHash`) is used directly rather than re-derived
 * from the song/video object, since a video resolved via the bridged-
 * metadata or fetch-and-hash path never had its own `.blake3` set to
 * begin with (see `QueuedVideo.blake3`'s doc comment) - the cache key IS
 * the only place that hash is recorded. */
async function forceServeMediaItem(
  hash: string,
  mediaItem: MediaItem,
  playerNodeId: string,
  bridgeCache: BridgeCache
): Promise<RemoteMediaRef> {
  if (mediaItem.kind === "song") {
    const song = mediaItem.song;
    const remote = song.remote_server_id ? await getRemoteById(song.remote_server_id) : null;
    if (remote && isP2PRemote(remote)) {
      const bridged = await tryBridgeToSourceRemote(
        song.remote_server_id!,
        playerNodeId,
        bridgeCache
      );
      if (bridged) return buildSongRef(song, remote.peer_addr, hash);
    }
    const nodeId = await ownNodeIdOrThrow();
    await ensureSongServableInBackground(song, nodeId, playerNodeId, hash);
    return buildSongRef(song, nodeId, hash);
  }
  const video = mediaItem.video;
  const remote = video.remote_server_id ? await getRemoteById(video.remote_server_id) : null;
  if (remote && isP2PRemote(remote)) {
    const bridged = await tryBridgeToSourceRemote(
      video.remote_server_id!,
      playerNodeId,
      bridgeCache
    );
    if (bridged) return buildVideoRef(video, remote.peer_addr, hash);
  }
  const nodeId = await ownNodeIdOrThrow();
  await ensureVideoServableInBackground(video, nodeId, playerNodeId, hash);
  return buildVideoRef(video, nodeId, hash);
}

/** reactive counterpart to songToMediaRef/videoToMediaRef's now-purely-
 * local ref building: called whenever a player's status reports non-empty
 * `unresolved_items` (wired in remotePlaybackControl.ts's
 * applyRemoteStatus), i.e. only once the player has ACTUALLY tried and
 * failed to reach an item's declared source itself. this - and
 * everything it calls (`tryBridgeToSourceRemote`, `ensureSong/
 * VideoServableInBackground`) - is now the ONLY place in this file that
 * does proactive networking on a controller's behalf; by the time this
 * runs it's confirmed necessary, not "just in case". best-effort per
 * item (one failing to resolve doesn't stop the others); re-sends a
 * small append_queue with just the successfully-helped item(s). */
export async function handleUnresolvedItems(
  peerAddr: string,
  unresolvedItems: UnresolvedItemRef[]
): Promise<void> {
  if (unresolvedItems.length === 0) return;
  const bridgeCache: BridgeCache = new Map();
  const retried: RemoteMediaRef[] = [];
  const clearPending: Array<() => void> = [];
  try {
    for (const unresolved of unresolvedItems) {
      const mediaItem = pushedItemsByHash.get(unresolved.blake3_hash);
      if (!mediaItem) {
        warn(
          "playerQueuePush",
          `${CENOTAPH_QUEUE_TRACE} handleUnresolvedItems: player ${peerAddr} reported it can't resolve blake3=${unresolved.blake3_hash.slice(0, 8)}... (declared source ${unresolved.source_peer_addr.slice(0, 8)}...) but this device has no record of pushing it this session - can't help.`
        );
        continue;
      }
      const title = mediaItem.kind === "song" ? mediaItem.song.title : mediaItem.video.title;
      warn(
        "playerQueuePush",
        `${CENOTAPH_QUEUE_TRACE} CONTROLLER_BLOB_PROXY: player ${peerAddr} couldn't resolve "${title}" from declared source ${unresolved.source_peer_addr.slice(0, 8)}... - helping reactively now (the only time this device does networking for a queue item it didn't already have to).`
      );
      const clear = registerPendingRetryOp?.(unresolved.blake3_hash, mediaItem);
      if (clear) clearPending.push(clear);
      try {
        retried.push(
          await forceServeMediaItem(unresolved.blake3_hash, mediaItem, peerAddr, bridgeCache)
        );
      } catch (err) {
        warn("playerQueuePush", `handleUnresolvedItems: failed to help resolve "${title}":`, err);
      }
    }
    if (retried.length === 0) return;
    // the append_queue round-trip itself can take far longer than the
    // blob transfer it followed (seconds, sometimes 10+, under relay
    // rate-limiting - see the WARN logs this session) with NOTHING
    // shown for it otherwise, since fetchAndImportStreaming's own
    // "fetching"/"sending" phases already finished by this point. mark
    // every retried item as "awaiting_ack" for the duration of this one
    // wait so the row shows *something* instead of a generic, timeless
    // "queueing..." the whole time.
    const toPlayerName = await resolvePlayerName(peerAddr);
    for (const ref of retried) {
      setTransferStatus(ref.blake3_hash, { phase: "awaiting_ack", toPlayerName });
    }
    let ack: CommandAckLike | undefined;
    try {
      ack = (await sendPlayerCommand(peerAddr, {
        type: "control",
        command: "append_queue",
        items: retried,
      })) as CommandAckLike;
    } catch (err) {
      warn("playerQueuePush", `handleUnresolvedItems: re-send to ${peerAddr} failed:`, err);
      return;
    } finally {
      for (const ref of retried) setTransferStatus(ref.blake3_hash, null);
    }
    reportCommandAckFailure(ack, peerAddr);
    if (ack?.status) applyRemoteStatusFromAck(ack.status);
  } finally {
    for (const clear of clearPending) clear();
  }
}

interface CommandAckLike {
  ok?: boolean;
  reason?: string;
  status?: RemoteStatus;
}

/** once an item has been successfully handed to the active remote target,
 * the controller shouldn't keep a shadow copy of it in its own local
 * queue - see `pruneLocalQueueAfterSuccessfulPush`'s own doc comment for
 * the full rationale (this is what fixes "switching back to local then
 * back to a player re-queues everything"). called from every push/append
 * function below, gated on a genuinely successful ack - never on
 * `ok: false`/a thrown command, since the items are still only locally
 * known in that case. `isReplace` must be `true` only for the 3
 * `replace_queue` senders (a real handoff of "now playing") - the 3
 * `append_queue` senders pass `false`, since appending never changes what
 * the remote is currently playing, so there's no handoff to confirm and
 * gating on one would hold the item back forever (found live: appending
 * a song to an already-playing remote left it stuck in the local queue
 * permanently). `pushed`'s `blake3Hash` must be the REAL hash that ended
 * up on the wire for each item (i.e. read off the `RemoteMediaRef` that
 * was actually sent), never re-derived from the local song/video object
 * afterward - a video commonly has no local `blake3` at all (see
 * `QueuedVideo.blake3`'s own doc comment), and re-deriving from it instead
 * of using the real sent hash silently produced a `null` that never
 * matched anything, so the video just never drained (a real bug found
 * live: "i can't queue videos" - the push itself worked, only the local
 * drain step silently never fired). */
function drainAfterAck(ack: CommandAckLike, pushed: PushedQueueItem[], isReplace: boolean): void {
  if (!ack?.ok) return;
  if (pushed.length > 0) pruneLocalQueueAfterSuccessfulPush(pushed, isReplace);
}

/** zips local `MediaItem`s with the `RemoteMediaRef`s that were actually
 * built for them (same order, from the same `Promise.all` call) into the
 * `{key, blake3Hash}` pairs `drainAfterAck` needs - see its own doc
 * comment for why the wire hash (not a locally re-derived one) matters. */
function toPushedQueueItems(mediaItems: MediaItem[], refs: RemoteMediaRef[]): PushedQueueItem[] {
  return mediaItems.map((item, i) => ({
    key: mediaItemKey(item),
    blake3Hash: refs[i].blake3_hash,
  }));
}

/** push a full queue of songs to a paired player, replacing whatever it
 * was playing. the first song starts playing immediately. */
export async function pushSongsToPlayer(peerAddr: string, songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const t0 = Date.now();
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushSongsToPlayer(${peerAddr}): building ${songs.length} item(s)`
  );
  const items = await mapWithConcurrency(songs, QUEUE_PUSH_CONCURRENCY, (song) =>
    songToMediaRef(song)
  );
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushSongsToPlayer(${peerAddr}): built ${items.length} item(s) in ${Date.now() - t0}ms, sending replace_queue`
  );
  const sendStart = Date.now();
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "replace_queue",
    items,
  })) as CommandAckLike;
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushSongsToPlayer(${peerAddr}): sendPlayerCommand took ${Date.now() - sendStart}ms, total ${Date.now() - t0}ms`
  );
  debug("playerQueuePush", `pushSongsToPlayer(${peerAddr}) ack:`, ack);
  reportCommandAckFailure(ack, peerAddr);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
  drainAfterAck(ack, toPushedQueueItems(songs.map(songToMediaItem), items), true);
}

/** append songs to a paired player's existing queue, without disturbing
 * whatever it's currently playing. */
export async function appendSongsToPlayer(peerAddr: string, songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const t0 = Date.now();
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendSongsToPlayer(${peerAddr}): building ${songs.length} item(s)`
  );
  const items = await mapWithConcurrency(songs, QUEUE_PUSH_CONCURRENCY, (song) =>
    songToMediaRef(song)
  );
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendSongsToPlayer(${peerAddr}): built ${items.length} item(s) in ${Date.now() - t0}ms, sending append_queue`
  );
  const sendStart = Date.now();
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "append_queue",
    items,
  })) as CommandAckLike;
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendSongsToPlayer(${peerAddr}): sendPlayerCommand took ${Date.now() - sendStart}ms, total ${Date.now() - t0}ms`
  );
  debug("playerQueuePush", `appendSongsToPlayer(${peerAddr}) ack:`, ack);
  reportCommandAckFailure(ack, peerAddr);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
  drainAfterAck(ack, toPushedQueueItems(songs.map(songToMediaItem), items), false);
}

/** push a full queue of videos to a paired player, replacing whatever it
 * was playing. */
export async function pushVideosToPlayer(peerAddr: string, videos: QueuedVideo[]): Promise<void> {
  if (videos.length === 0) return;
  const t0 = Date.now();
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushVideosToPlayer(${peerAddr}): building ${videos.length} item(s)`
  );
  const bridgeCache: BridgeCache = new Map();
  const items = await mapWithConcurrency(videos, QUEUE_PUSH_CONCURRENCY, (video) =>
    videoToMediaRef(video, peerAddr, bridgeCache)
  );
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushVideosToPlayer(${peerAddr}): built ${items.length} item(s) in ${Date.now() - t0}ms, sending replace_queue`
  );
  const sendStart = Date.now();
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "replace_queue",
    items,
  })) as CommandAckLike;
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushVideosToPlayer(${peerAddr}): sendPlayerCommand took ${Date.now() - sendStart}ms, total ${Date.now() - t0}ms`
  );
  debug("playerQueuePush", `pushVideosToPlayer(${peerAddr}) ack:`, ack);
  reportCommandAckFailure(ack, peerAddr);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
  drainAfterAck(ack, toPushedQueueItems(videos.map(videoToMediaItem), items), true);
}

/** append videos to a paired player's existing queue, without disturbing
 * whatever it's currently playing. */
export async function appendVideosToPlayer(peerAddr: string, videos: QueuedVideo[]): Promise<void> {
  if (videos.length === 0) return;
  const t0 = Date.now();
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendVideosToPlayer(${peerAddr}): building ${videos.length} item(s)`
  );
  const bridgeCache: BridgeCache = new Map();
  const items = await mapWithConcurrency(videos, QUEUE_PUSH_CONCURRENCY, (video) =>
    videoToMediaRef(video, peerAddr, bridgeCache)
  );
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendVideosToPlayer(${peerAddr}): built ${items.length} item(s) in ${Date.now() - t0}ms, sending append_queue`
  );
  const sendStart = Date.now();
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "append_queue",
    items,
  })) as CommandAckLike;
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendVideosToPlayer(${peerAddr}): sendPlayerCommand took ${Date.now() - sendStart}ms, total ${Date.now() - t0}ms`
  );
  debug("playerQueuePush", `appendVideosToPlayer(${peerAddr}) ack:`, ack);
  reportCommandAckFailure(ack, peerAddr);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
  drainAfterAck(ack, toPushedQueueItems(videos.map(videoToMediaItem), items), false);
}

/** kind-agnostic equivalent of songToMediaRef()/videoToMediaRef() above -
 * used by pushMediaToPlayer/appendMediaToPlayer for a mixed-kind queue. */
async function mediaItemToRef(
  item: MediaItem,
  playerNodeId: string,
  bridgeCache: BridgeCache
): Promise<RemoteMediaRef> {
  return item.kind === "song"
    ? songToMediaRef(item.song)
    : videoToMediaRef(item.video, playerNodeId, bridgeCache);
}

/** push a full queue of songs and/or videos (mixed-kind, order-preserving)
 * to a paired player, replacing whatever it was playing - used for the
 * initial "select this player as my playback target" hand-off, where the
 * local queue may be video-only, song-only, or a genuine mix (unlike
 * pushSongsToPlayer/pushVideosToPlayer above, which only ever send one
 * kind and so silently sent nothing at all for a video-only queue). */
export async function pushMediaToPlayer(peerAddr: string, items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;
  const t0 = Date.now();
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushMediaToPlayer(${peerAddr}): building ${items.length} item(s)`
  );
  const bridgeCache: BridgeCache = new Map();
  const refs = await mapWithConcurrency(items, QUEUE_PUSH_CONCURRENCY, (item) =>
    mediaItemToRef(item, peerAddr, bridgeCache)
  );
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushMediaToPlayer(${peerAddr}): built ${refs.length} item(s) in ${Date.now() - t0}ms, sending replace_queue`
  );
  const sendStart = Date.now();
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "replace_queue",
    items: refs,
  })) as CommandAckLike;
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} pushMediaToPlayer(${peerAddr}): sendPlayerCommand took ${Date.now() - sendStart}ms, total ${Date.now() - t0}ms`
  );
  debug("playerQueuePush", `pushMediaToPlayer(${peerAddr}) ack:`, ack);
  reportCommandAckFailure(ack, peerAddr);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
  drainAfterAck(ack, toPushedQueueItems(items, refs), true);
}

/** append equivalent of pushMediaToPlayer() above. */
export async function appendMediaToPlayer(peerAddr: string, items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;
  const t0 = Date.now();
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendMediaToPlayer(${peerAddr}): building ${items.length} item(s)`
  );
  const bridgeCache: BridgeCache = new Map();
  const refs = await mapWithConcurrency(items, QUEUE_PUSH_CONCURRENCY, (item) =>
    mediaItemToRef(item, peerAddr, bridgeCache)
  );
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendMediaToPlayer(${peerAddr}): built ${refs.length} item(s) in ${Date.now() - t0}ms, sending append_queue`
  );
  const sendStart = Date.now();
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "append_queue",
    items: refs,
  })) as CommandAckLike;
  debug(
    "playerQueuePush",
    `${CENOTAPH_QUEUE_TRACE} appendMediaToPlayer(${peerAddr}): sendPlayerCommand took ${Date.now() - sendStart}ms, total ${Date.now() - t0}ms`
  );
  debug("playerQueuePush", `appendMediaToPlayer(${peerAddr}) ack:`, ack);
  reportCommandAckFailure(ack, peerAddr);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
  drainAfterAck(ack, toPushedQueueItems(items, refs), false);
}
