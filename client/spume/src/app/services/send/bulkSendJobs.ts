// bulk "send to remote" job registry - shared by the albums and videos
// table views' multi-select action bars.
//
// migrated (phase 3a of the transfer-unification plan) onto the shared
// `createTransferQueue` primitive - this file is now a thin adapter that
// derives the public `BulkSendJobState` shape from a generic
// `TransferQueue`, keeping every exported function's signature identical
// so `BulkSendToRemoteModal.tsx`/`VideosTable.tsx`/`AlbumsView.tsx` needed
// no changes at all.
//
// module-level state (not owned by any modal component) so a long-running
// bulk send survives the send modal being closed and reopened: closing the
// modal just stops rendering it, it does NOT cancel/pause the job. if the
// job finishes while the modal is closed, a toast fires instead (see
// `onJobDone` below).
//
// pause/resume works at item boundaries (between albums, or between
// videos) via the shared queue's own pause gate - `sendToRemote`/
// `sendVideosToRemote` themselves are untouched, so an in-flight single
// item always runs to completion before a pause takes effect.
//
// one behavior change from the pre-migration version: an item that fails
// with MULTIPLE error strings (a single video's send can report more than
// one) is now joined into one combined string per item, since
// `TransferQueueItem` carries a single `error`, not an array - the
// aggregate "N failed" list in the UI shows one bullet per failed item
// instead of one bullet per individual error message. not a functional
// regression, just a display granularity change.
//
// NOT implemented (out of scope for this pass): persisting a job across a
// full app reboot/reload - a job only lives for the duration of the
// current session, same as every other in-memory job in this codebase.

import { createSignal } from "solid-js";
import { toast } from "../../../components/feedback/Toast";
import { getDataSource } from "../../../music/data";
import type { RemoteSong } from "../../../music/data/remote/adapters";
import { sendToRemote, type SendAlbumPayload } from "../../../music/services/send/sendToRemote";
import { sortSongsCanonical } from "../../../music/utils/songSort";
import {
  sendVideosToRemote,
  type SendVideoItem,
} from "../../../video/services/send/sendVideoToRemote";
import type { Remote } from "../storage/schemas/remote";
import {
  cancelTransferQueue,
  clearTransferQueue,
  createTransferQueue,
  getTransferQueue,
  pauseTransferQueue,
  resumeTransferQueue,
  transferQueues,
  type TransferQueue,
} from "../transfers/transferQueue";

export type BulkSendKind = "albums" | "videos";

export interface BulkSendJobState {
  id: string;
  kind: BulkSendKind;
  destId: string;
  destName: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  /** title of the item currently being sent, for display - null when
   *  idle/done. mirrors the queue's own item-order-based derivation, see
   *  `currentItemLabel` below. */
  currentItemTitle: string | null;
  paused: boolean;
  cancelled: boolean;
  done: boolean;
  errors: string[];
}

// destId isn't part of the generic TransferQueue shape (it's specific to
// this domain's "which remote" concept) - tracked alongside it here,
// keyed by queue id, cleared in lockstep with clearBulkSendJob.
const destIds = new Map<string, string>();

// the single most-recently-started job - lets a "send to remote" button
// reopen an in-flight job's progress instead of accidentally starting a
// second one for the same selection.
const [latestJobId, setLatestJobId] = createSignal<string | null>(null);

// which job's progress the send modal is currently showing, if any - used
// only to decide whether `onJobDone` should toast (nobody's looking) or
// stay quiet (the modal's own "done" view already says so).
const [openModalJobId, setOpenModalJobId] = createSignal<string | null>(null);

/** the last non-pending item, in array order - "currently being sent" while
 *  active, or "most recently sent" while paused/between items, matching
 *  the pre-migration behavior of only overwriting this on an item start. */
function currentItemLabel(q: TransferQueue): string | null {
  if (q.done) return null;
  for (let i = q.items.length - 1; i >= 0; i--) {
    if (q.items[i].status !== "pending") return q.items[i].label;
  }
  return null;
}

function toBulkSendJobState(q: TransferQueue): BulkSendJobState {
  return {
    id: q.id,
    kind: q.kind as BulkSendKind,
    destId: destIds.get(q.id) ?? "",
    destName: q.destName,
    totalItems: q.items.length,
    completedItems: q.items.filter((i) => i.status === "completed").length,
    failedItems: q.items.filter((i) => i.status === "failed").length,
    currentItemTitle: currentItemLabel(q),
    paused: q.paused,
    cancelled: q.cancelled,
    done: q.done,
    errors: q.items.filter((i) => i.status === "failed" && i.error).map((i) => i.error!),
  };
}

export function getBulkSendJobs(): () => Map<string, BulkSendJobState> {
  return () => {
    const out = new Map<string, BulkSendJobState>();
    for (const q of transferQueues().values()) {
      if (q.kind === "albums" || q.kind === "videos") out.set(q.id, toBulkSendJobState(q));
    }
    return out;
  };
}
export function getBulkSendJob(id: string): BulkSendJobState | null {
  const q = getTransferQueue(id);
  return q && (q.kind === "albums" || q.kind === "videos") ? toBulkSendJobState(q) : null;
}
export function getLatestBulkSendJobId(): () => string | null {
  return latestJobId;
}
export function openBulkSendModalFor(jobId: string): void {
  setOpenModalJobId(jobId);
}
export function closeBulkSendModal(): void {
  setOpenModalJobId(null);
}

export function pauseBulkSendJob(jobId: string): void {
  pauseTransferQueue(jobId);
}

export function resumeBulkSendJob(jobId: string): void {
  resumeTransferQueue(jobId);
}

export function cancelBulkSendJob(jobId: string): void {
  cancelTransferQueue(jobId);
}

/** drop a finished job from the registry (e.g. after the user dismisses
 *  its "done" summary). in-progress jobs can't be cleared - cancel first. */
export function clearBulkSendJob(jobId: string): void {
  clearTransferQueue(jobId);
  destIds.delete(jobId);
  if (latestJobId() === jobId) setLatestJobId(null);
}

function onJobDone(q: TransferQueue): void {
  // toast only if the modal isn't currently showing this job's progress -
  // it already renders its own inline "done" summary in that case.
  if (openModalJobId() === q.id) return;
  const completedItems = q.items.filter((i) => i.status === "completed").length;
  const failedItems = q.items.filter((i) => i.status === "failed").length;
  const parts: string[] = [];
  if (completedItems > 0) parts.push(`${completedItems} sent`);
  if (failedItems > 0) parts.push(`${failedItems} failed`);
  const itemWord = q.kind === "albums" ? "album" : "video";
  const msg = `send to ${q.destName} finished: ${
    parts.length > 0 ? parts.join(", ") : `nothing to send`
  }${parts.length > 0 ? ` (${itemWord}s)` : ""}`;
  if (failedItems > 0) toast.warning(msg);
  else toast.success(msg);
}

export interface StartBulkAlbumSendArgs {
  albumIds: string[];
  source: Remote;
  dest: Remote;
}

/** starts a bulk album send in the background and returns its job id
 *  immediately - each album's song list is fetched fresh (mirrors
 *  AlbumDetailView.tsx's own buildSendPayload) right before it's sent,
 *  one album at a time, so pausing between albums never leaves a
 *  half-sent album. */
export function startBulkAlbumSend(args: StartBulkAlbumSendArgs): string {
  const dataSource = getDataSource();
  const jobId = createTransferQueue<string>({
    kind: "albums",
    destName: args.dest.name ?? args.dest.remote_id,
    items: args.albumIds,
    itemId: (albumId) => albumId,
    // real title isn't known until the fetch below resolves - upgraded
    // via reportLabel() once it does.
    itemLabel: (albumId) => albumId,
    sendOne: async (albumId, ctx) => {
      if (!dataSource.getAlbumSongs) throw new Error("album songs not supported here");
      const response = await dataSource.getAlbumSongs(albumId, { limit: 1000 });
      const songs = sortSongsCanonical(response.items);
      const first = songs[0];
      const title = first?.album_title ?? albumId;
      ctx.reportLabel(title);
      const payload: SendAlbumPayload = {
        kind: "album",
        albumId,
        title,
        artistName: first?.artist_name ?? "unknown artist",
        albumType: first?.album_type ?? null,
        releaseDate: null,
        label: null,
        genres:
          first?.album_taxons
            ?.filter((t) => t.kind_slug === "genre")
            .map((t) => t.label)
            .filter(Boolean) ?? [],
        images: first?.album_images ?? [],
        songs: songs as unknown as RemoteSong[],
      };
      await sendToRemote(payload, args.source, args.dest, {});
      // album path: always counts as completed once sendToRemote resolves,
      // regardless of any per-song failures inside its own progress -
      // matches the pre-migration behavior exactly.
      return {};
    },
    onDone: onJobDone,
  });
  destIds.set(jobId, args.dest.remote_id);
  setLatestJobId(jobId);
  return jobId;
}

export interface StartBulkVideoSendArgs {
  items: SendVideoItem[];
  source: Remote;
  dest: Remote;
}

/** starts a bulk video send in the background and returns its job id
 *  immediately - one video per `sendVideosToRemote` call so pause/resume
 *  has the same per-item granularity as the album path above (at the
 *  cost of one extra `/api/blobz/has` round trip per video, versus a
 *  single batched call - an acceptable trade for real mid-run pausing). */
export function startBulkVideoSend(args: StartBulkVideoSendArgs): string {
  const jobId = createTransferQueue<SendVideoItem>({
    kind: "videos",
    destName: args.dest.name ?? args.dest.remote_id,
    items: args.items,
    itemId: (item) => item.video.id,
    itemLabel: (item) => item.video.title,
    sendOne: async (item) => {
      const result = await sendVideosToRemote([item], args.source, args.dest, {});
      if (result.failedVideos > 0) {
        return { error: result.errors.map((e) => `${item.video.title}: ${e}`).join("; ") };
      }
      return {};
    },
    onDone: onJobDone,
  });
  destIds.set(jobId, args.dest.remote_id);
  setLatestJobId(jobId);
  return jobId;
}
