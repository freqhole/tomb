// bucket A of docs/transfer-unification-plan.md's phase 1: one shared,
// reactive client-side registry for "how many bytes of blob X have moved,
// direction D, peer P" - meant to eventually back every place that
// currently hand-rolls byte progress (downloadState.ts's loadingProgress,
// cenotaph's QueueItemTransferStatus.progress, share-modal send progress,
// etc.). migrating those call sites onto this registry is phase 3's job,
// not this file's - this file only builds the primitive itself.
//
// built on `createTransferProgress<BlobTransfer>()` (@freqhole/reliquary/solid)
// rather than a hand-rolled signal/map - see phase 0's finding in the plan
// doc for why (already a real, tested dependency of this package).
//
// two write paths feed this registry, and they are NOT symmetric - read
// this before wiring a new call site:
//
// - the OUTGOING/upload direction (this node SERVING a blob to a peer) is
//   populated by polling `get_active_transfers()` (wasm) / the
//   `p2p_get_active_transfers` tauri command (charnel, backed by
//   grimoire's `reliquary::gate::TransferRegistry`) via
//   `startUploadTransferPolling()`. callers never call
//   `registerBlobTransfer`/etc. for uploads themselves - iroh-blobs
//   already tracks this for us server-side (from this node's point of
//   view), we just poll and mirror it in here.
// - the INCOMING/download direction has NO equivalent registry anywhere -
//   iroh-blobs' provider-side instrumentation only covers serving, not
//   pulling, and there's no wasm or charnel/tauri "list my active
//   downloads" call.
//   download callers (preCacheP2PBlob, syncSongToLocal, etc.) must call
//   `registerBlobTransfer`/`updateBlobTransferProgress`/
//   `completeBlobTransfer` explicitly, the same shape `downloadState.ts`'s
//   `addToLoadingSet`/`updateLoadingProgress`/`removeFromLoadingSet` already
//   uses today for its own bespoke tracking.
//
// pause/resume (see the plan doc's "pause/resume is foundational" section):
// only the DOWNLOAD direction can be meaningfully paused here - the puller
// controls pacing, not the server. `pauseBlobTransfer` reaches into the
// real transport (`download_cancel_by_blake3`, a genuine blake3-keyed
// cancel token flip - NOT an AbortController, see the plan doc's gotcha
// writeup on why that distinction matters) so the partial genuinely stays
// on disk. there is no equivalent "resume" transport call: resuming a
// paused download just means some caller invokes the same download
// function again with the same blake3 - the transport resumes from the
// persisted partial automatically. `resumeBlobTransfer` here only flips
// this registry's own display state back to "active"; it is the caller's
// job to actually re-invoke the download.

import { createTransferProgress } from "@freqhole/reliquary/solid";
import type { Accessor } from "solid-js";
import { getMiddenNode, isCharnelAvailable } from "../../api/client";
import { getActiveOutgoingTransfers } from "../charnel/commands";
import { debug } from "../../../utils/logger";

export type BlobTransferDirection = "upload" | "download";

export interface BlobTransfer {
  blake3: string;
  direction: BlobTransferDirection;
  /** remote node id / remote_id, when known. */
  peerId?: string;
  bytesTransferred: number;
  /** undefined = indeterminate. */
  bytesTotal?: number;
  startedAt: number;
  /** "active" while bytes are moving (or assumed to be); "paused" when
   *  deliberately halted - distinct from just being absent from the
   *  registry, which means "not tracked" (finished, or never started). */
  state: "active" | "paused";
}

const registry = createTransferProgress<BlobTransfer>();

/** reactive snapshot of every currently-tracked transfer, keyed by blake3. */
export const blobTransfers: Accessor<ReadonlyMap<string, BlobTransfer>> = registry.states;

export function getBlobTransfer(blake3: string): BlobTransfer | undefined {
  return registry.states().get(blake3);
}

export function getAllBlobTransfers(): ReadonlyMap<string, BlobTransfer> {
  return registry.states();
}

/** start tracking a new transfer. overwrites any existing entry for this
 *  blake3 (a fresh registration always wins - e.g. a retried download). */
export function registerBlobTransfer(
  blake3: string,
  direction: BlobTransferDirection,
  opts?: { peerId?: string; bytesTotal?: number }
): void {
  registry.setState(blake3, {
    blake3,
    direction,
    peerId: opts?.peerId,
    bytesTransferred: 0,
    bytesTotal: opts?.bytesTotal,
    startedAt: Date.now(),
    state: "active",
  });
}

/** update progress for an already-registered transfer. a report for an
 *  untracked blake3 is a no-op (mirrors downloadState.ts's own defensive
 *  handling of the same class of caller/producer key mismatch). */
export function updateBlobTransferProgress(
  blake3: string,
  bytesTransferred: number,
  bytesTotal?: number
): void {
  const existing = registry.states().get(blake3);
  if (!existing) {
    debug("blobTransferRegistry", `progress for untracked blake3 ${blake3} - not registered?`);
    return;
  }
  registry.setState(blake3, {
    ...existing,
    bytesTransferred,
    bytesTotal: bytesTotal ?? existing.bytesTotal,
    state: "active",
  });
}

/** stop tracking a transfer (completed, failed, or cancelled for good). */
export function completeBlobTransfer(blake3: string): void {
  registry.setState(blake3, null);
}

/** clear every tracked transfer (testing/reset only). */
export function resetBlobTransfers(): void {
  registry.reset();
}

// ---------------------------------------------------------------------------
// pause/resume control surface (download direction only - see module doc)
// ---------------------------------------------------------------------------

/**
 * pause every in-flight download of this blake3 hash. returns true if at
 * least one download was actually flagged - false when nothing was in
 * flight, or (today) when running under charnel/tauri, where this isn't
 * wired up to any transport yet (see the plan doc's phase 1 checklist -
 * the charnel/tauri leg is a tracked follow-up, not silently dropped).
 */
export async function pauseBlobTransfer(blake3: string): Promise<boolean> {
  if (isCharnelAvailable()) {
    debug("blobTransferRegistry", `pauseBlobTransfer(${blake3}): not wired for charnel yet`);
    return false;
  }
  const node = await getMiddenNode();
  if (!node.download_cancel_by_blake3) return false;
  const cancelledCount = await node.download_cancel_by_blake3(blake3);
  if (cancelledCount > 0) {
    const existing = registry.states().get(blake3);
    if (existing) registry.setState(blake3, { ...existing, state: "paused" });
    return true;
  }
  return false;
}

/**
 * mark a paused transfer as active again in the registry's own display
 * state. does NOT itself resume any bytes - see the module doc for why
 * there's no transport-level "resume" call. call this right before (or
 * right after starting) re-invoking whatever download function originally
 * registered this blake3.
 */
export function resumeBlobTransfer(blake3: string): void {
  const existing = registry.states().get(blake3);
  if (existing) registry.setState(blake3, { ...existing, state: "active" });
}

// ---------------------------------------------------------------------------
// upload-direction polling (this node serving blobs out)
// ---------------------------------------------------------------------------

const UPLOAD_POLL_INTERVAL_MS = 1000;
let uploadPollTimer: ReturnType<typeof setInterval> | null = null;

/** fetch this node's active outgoing transfers from whichever transport is
 *  live - charnel/tauri's `p2p_get_active_transfers` command or wasm's
 *  `get_active_transfers()` binding - normalized to the same shape so the
 *  poller below has one code path, not a branch per platform. */
async function fetchActiveOutgoingTransfers(): Promise<
  Array<{ peerId: string; blake3: string; bytesSent: number; totalSize: number }>
> {
  if (isCharnelAvailable()) {
    return getActiveOutgoingTransfers();
  }
  let node;
  try {
    node = await getMiddenNode();
  } catch {
    return []; // no midden node yet (not initialized, or charnel-only build)
  }
  if (!node.get_active_transfers) return [];
  return node.get_active_transfers();
}

async function pollUploadTransfers(): Promise<void> {
  const active = await fetchActiveOutgoingTransfers();
  const seenBlake3s = new Set<string>();
  for (const transfer of active) {
    seenBlake3s.add(transfer.blake3);
    const existing = registry.states().get(transfer.blake3);
    registry.setState(transfer.blake3, {
      blake3: transfer.blake3,
      direction: "upload",
      peerId: transfer.peerId,
      bytesTransferred: transfer.bytesSent,
      bytesTotal: transfer.totalSize,
      startedAt: existing?.startedAt ?? Date.now(),
      state: "active",
    });
  }
  // an upload entry present before this poll but absent now has finished -
  // drop it (uploads have no separate "complete" signal to call explicitly,
  // unlike downloads, since the caller here is the poller itself, not
  // whatever code path is being served from).
  for (const [blake3, transfer] of registry.states()) {
    if (transfer.direction === "upload" && !seenBlake3s.has(blake3)) {
      registry.setState(blake3, null);
    }
  }
}

/**
 * start polling `get_active_transfers()` and mirroring the result into
 * this registry under the "upload" direction. idempotent - calling this
 * again while already running is a no-op. returns a stop function.
 */
export function startUploadTransferPolling(): () => void {
  if (uploadPollTimer) return () => {};
  void pollUploadTransfers();
  uploadPollTimer = setInterval(() => void pollUploadTransfers(), UPLOAD_POLL_INTERVAL_MS);
  const timer = uploadPollTimer;
  return () => {
    if (uploadPollTimer === timer) {
      clearInterval(uploadPollTimer);
      uploadPollTimer = null;
    }
  };
}
