// bucket B of docs/transfer-unification-plan.md's phase 2: one generic,
// reusable "queue of N items being sent/imported, with per-item status/
// progress/error, optional pause/cancel, aggregate counts" primitive -
// generalizes `bulkSendJobs.ts`'s already-decent `BulkSendJobState`/
// `runBulkSendLoop` pattern (per-item title/error accumulation, a pause
// gate the loop awaits between items) rather than starting from scratch.
// migrating the five existing bespoke shapes (`UploadJob`+`VideoUploadJob`,
// `SendReviewProgress`, `BulkSendJobState`, `SendProgress`/
// `SendVideoProgress`) onto this is phase 3's job, not this file's.
//
// design decision (explicit, per the plan doc's phase 2 checklist): ONE
// shared reactive registry holds every domain's queues, tagged by `kind`
// - mirrors `downloadState.ts`'s own shared-signal pattern (and bucket A's
// `blobTransferRegistry.ts`) rather than each call site owning a private
// store instance. this gives a caller like AddMediaModal.tsx a trivial
// merge path for free (`getTransferQueuesByKind("music-import")` +
// `getTransferQueuesByKind("video-import")`, or just filter the shared
// map) instead of needing its own `allJobs` merge memo.
//
// item-level pause/resume nuance (same asymmetry as bucket A, read this
// before wiring a real caller): `pauseTransferQueueItem`/
// `resumeTransferQueueItem` only make sense for an item whose `sendOne`
// call populated `blobTransferBlake3` via `reportBlake3()` - i.e. an item
// backed by a real, chunked/interruptible blob transfer. pausing such an
// item calls straight through to bucket A's `pauseBlobTransfer`, which
// (being a real cancel-token flip) will make that item's in-flight
// `sendOne` promise settle - the runner loop treats a paused item as
// "stopped, not truly complete" (see `"paused"` in `TransferQueueItemStatus`)
// and moves on to the next item; nothing in this file automatically
// retries a paused item later. that's an intentional match to bucket A's
// own "resuming just means re-invoking the same call" model, deferred to
// whichever phase-3 caller first needs it (see the plan doc's 3e/3f).

import { createSignal, type Accessor } from "solid-js";
import { pauseBlobTransfer, resumeBlobTransfer } from "./blobTransferRegistry";

export type TransferQueueItemStatus =
  "pending" | "active" | "paused" | "completed" | "failed" | "timeout";

export interface TransferQueueItem<TResult = unknown> {
  id: string;
  label: string;
  status: TransferQueueItemStatus;
  error?: string;
  errorFull?: string;
  /** 0..1, or undefined for indeterminate - populated via the `sendOne`
   *  callback's `reportProgress`, typically mirroring bucket A's own
   *  per-blake3 progress for whatever blob transfer backs this item. */
  progress?: number;
  /** blake3 of the underlying blob transfer, when this item has one - see
   *  the module doc's item-level pause/resume nuance above. */
  blobTransferBlake3?: string;
  result?: TResult;
}

export interface TransferQueue<TResult = unknown> {
  id: string;
  kind: string;
  destName: string;
  items: TransferQueueItem<TResult>[];
  /** queue-level pause: stop STARTING new items; the current item (if
   *  any) still runs to completion unless it's ALSO individually paused
   *  via its own `status`. */
  paused: boolean;
  cancelled: boolean;
  done: boolean;
}

/** what `sendOne` reports back for one item - `error` unset means success. */
export interface TransferQueueSendResult<TResult = unknown> {
  result?: TResult;
  error?: string;
  errorFull?: string;
}

export interface TransferQueueItemContext {
  /** call once the underlying send begins a real blob transfer, so
   *  item-level pause/resume can route to bucket A. */
  reportBlake3(blake3: string): void;
  /** call with a 0..1 fraction as the underlying transfer progresses. */
  reportProgress(progress: number): void;
  /** upgrade this item's display label - for a caller whose real title
   *  is only known after an async lookup (e.g. resolving an album id to
   *  its actual name), not available up front at `itemLabel()` time. */
  reportLabel(label: string): void;
}

export interface CreateTransferQueueOptions<TItem, TResult = unknown> {
  kind: string;
  destName: string;
  items: TItem[];
  itemId(item: TItem): string;
  itemLabel(item: TItem): string;
  /** send one item. throwing is treated the same as returning
   *  `{ error: e.message }` - callers don't need their own try/catch. */
  sendOne(item: TItem, ctx: TransferQueueItemContext): Promise<TransferQueueSendResult<TResult>>;
  /** called once, after the last item settles and the queue is marked
   *  done - lets a caller react to completion (e.g. a toast) without
   *  polling or setting up its own subscription. */
  onDone?(queue: TransferQueue<TResult>): void;
  /** how many items may be in flight (mid-`sendOne`) at once. defaults to
   *  1 (today's sequential behavior, used by e.g. bulkSendJobs.ts, where
   *  processing one album/video at a time keeps a pause boundary clean).
   *  a caller whose items are independent and safe to run concurrently
   *  (e.g. N files uploading in parallel) can raise this - queue-level
   *  pause still applies: no NEW item starts while paused, but every
   *  already-active item (up to `concurrency` of them) runs to
   *  completion first. */
  concurrency?: number;
}

interface QueueControl {
  paused: boolean;
  cancelled: boolean;
  pauseWaiters: Array<() => void>;
}

const [queues, setQueues] = createSignal<ReadonlyMap<string, TransferQueue>>(new Map());
const controls = new Map<string, QueueControl>();

/** reactive accessor over every tracked queue, across every kind. */
export const transferQueues: Accessor<ReadonlyMap<string, TransferQueue>> = queues;

export function getTransferQueue(queueId: string): TransferQueue | undefined {
  return queues().get(queueId);
}

export function getTransferQueuesByKind(kind: string): TransferQueue[] {
  return [...queues().values()].filter((q) => q.kind === kind);
}

function newQueueId(kind: string): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateQueue(queueId: string, patch: Partial<TransferQueue>): void {
  setQueues((prev) => {
    const cur = prev.get(queueId);
    if (!cur) return prev;
    const next = new Map(prev);
    next.set(queueId, { ...cur, ...patch });
    return next;
  });
}

function updateItem(queueId: string, itemId: string, patch: Partial<TransferQueueItem>): void {
  setQueues((prev) => {
    const cur = prev.get(queueId);
    if (!cur) return prev;
    const items = cur.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it));
    const next = new Map(prev);
    next.set(queueId, { ...cur, items });
    return next;
  });
}

async function waitIfPaused(queueId: string): Promise<void> {
  const ctrl = controls.get(queueId);
  if (!ctrl || !ctrl.paused) return;
  await new Promise<void>((resolve) => ctrl.pauseWaiters.push(resolve));
}

/** create a queue for `options.items`, start processing them one at a
 *  time in the background, and return the new queue's id immediately -
 *  same "fires and returns an id" shape as `bulkSendJobs.ts`'s
 *  `startBulkAlbumSend`. */
export function createTransferQueue<TItem, TResult = unknown>(
  options: CreateTransferQueueOptions<TItem, TResult>
): string {
  const queueId = newQueueId(options.kind);
  controls.set(queueId, { paused: false, cancelled: false, pauseWaiters: [] });
  const items: TransferQueueItem<TResult>[] = options.items.map((item) => ({
    id: options.itemId(item),
    label: options.itemLabel(item),
    status: "pending",
  }));
  setQueues((prev) => {
    const next = new Map(prev);
    next.set(queueId, {
      id: queueId,
      kind: options.kind,
      destName: options.destName,
      items,
      paused: false,
      cancelled: false,
      done: false,
    });
    return next;
  });
  void runTransferQueue(queueId, options);
  return queueId;
}

async function runTransferQueue<TItem, TResult>(
  queueId: string,
  options: CreateTransferQueueOptions<TItem, TResult>
): Promise<void> {
  const ctrl = controls.get(queueId)!;
  const concurrency = Math.max(1, options.concurrency ?? 1);
  let nextIndex = 0;

  async function runOneAt(index: number): Promise<void> {
    const item = options.items[index];
    const itemId = options.itemId(item);
    updateItem(queueId, itemId, { status: "active" });
    try {
      const sent = await options.sendOne(item, {
        reportBlake3: (blake3) => updateItem(queueId, itemId, { blobTransferBlake3: blake3 }),
        reportProgress: (progress) => updateItem(queueId, itemId, { progress }),
        reportLabel: (label) => updateItem(queueId, itemId, { label }),
      });
      if (sent.error) {
        updateItem(queueId, itemId, {
          status: "failed",
          error: sent.error,
          errorFull: sent.errorFull ?? sent.error,
        });
      } else {
        updateItem(queueId, itemId, { status: "completed", result: sent.result, progress: 1 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateItem(queueId, itemId, { status: "failed", error: msg, errorFull: msg });
    }
  }

  // worker-pool pattern: each worker pulls the next unclaimed index off a
  // shared counter until none remain - concurrency=1 (the default) reduces
  // to exactly one worker draining items in order, i.e. today's original
  // sequential loop, byte-for-byte the same observable behavior.
  async function worker(): Promise<void> {
    for (;;) {
      if (ctrl.cancelled) return;
      await waitIfPaused(queueId);
      if (ctrl.cancelled) return;
      const index = nextIndex++;
      if (index >= options.items.length) return;
      await runOneAt(index);
    }
  }

  const workerCount = Math.min(concurrency, Math.max(options.items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  updateQueue(queueId, { done: true });
  const finished = getTransferQueue(queueId) as TransferQueue<TResult> | undefined;
  if (finished) options.onDone?.(finished);
}

// ---------------------------------------------------------------------------
// queue-level pause/resume/cancel - stop STARTING new items
// ---------------------------------------------------------------------------

export function pauseTransferQueue(queueId: string): void {
  const ctrl = controls.get(queueId);
  if (!ctrl || ctrl.cancelled) return;
  ctrl.paused = true;
  updateQueue(queueId, { paused: true });
}

export function resumeTransferQueue(queueId: string): void {
  const ctrl = controls.get(queueId);
  if (!ctrl) return;
  ctrl.paused = false;
  updateQueue(queueId, { paused: false });
  const waiters = ctrl.pauseWaiters.splice(0);
  for (const w of waiters) w();
}

export function cancelTransferQueue(queueId: string): void {
  const ctrl = controls.get(queueId);
  if (ctrl) ctrl.cancelled = true;
  updateQueue(queueId, { cancelled: true });
  // unblock a paused loop so it can observe the cancellation and stop.
  resumeTransferQueue(queueId);
}

/** drop a finished queue from the registry. an in-progress queue can't be
 *  cleared - cancel first (mirrors bulkSendJobs.ts's clearBulkSendJob). */
export function clearTransferQueue(queueId: string): void {
  const q = queues().get(queueId);
  if (q && !q.done) return;
  setQueues((prev) => {
    const next = new Map(prev);
    next.delete(queueId);
    return next;
  });
  controls.delete(queueId);
}

/** clear every tracked queue (testing/reset only). */
export function resetTransferQueues(): void {
  setQueues(new Map());
  controls.clear();
}

// ---------------------------------------------------------------------------
// item-level pause/resume - delegates to bucket A, see module doc's nuance
// ---------------------------------------------------------------------------

export async function pauseTransferQueueItem(queueId: string, itemId: string): Promise<boolean> {
  const item = queues()
    .get(queueId)
    ?.items.find((it) => it.id === itemId);
  if (!item?.blobTransferBlake3) return false;
  const paused = await pauseBlobTransfer(item.blobTransferBlake3);
  if (paused) updateItem(queueId, itemId, { status: "paused" });
  return paused;
}

/** flip a paused item's display status back to "active" - does not
 *  itself resume any bytes, see the module doc. */
export function resumeTransferQueueItem(queueId: string, itemId: string): void {
  const item = queues()
    .get(queueId)
    ?.items.find((it) => it.id === itemId);
  if (!item?.blobTransferBlake3) return;
  resumeBlobTransfer(item.blobTransferBlake3);
  updateItem(queueId, itemId, { status: "active" });
}
