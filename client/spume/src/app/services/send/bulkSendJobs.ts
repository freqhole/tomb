// bulk "send to remote" job registry - shared by the albums and videos
// table views' multi-select action bars.
//
// module-level state (not owned by any modal component) so a long-running
// bulk send survives the send modal being closed and reopened: closing the
// modal just stops rendering it, it does NOT cancel/pause the job. if the
// job finishes while the modal is closed, a toast fires instead (see
// `finishJob`).
//
// pause/resume works at item boundaries (between albums, or between
// videos) via a simple "pause gate" the loop awaits before starting its
// next item - `sendToRemote`/`sendVideosToRemote` themselves are
// untouched, so an in-flight single item always runs to completion before
// a pause takes effect.
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
   *  idle/paused/done. */
  currentItemTitle: string | null;
  paused: boolean;
  cancelled: boolean;
  done: boolean;
  errors: string[];
}

interface JobControl {
  paused: boolean;
  cancelled: boolean;
  pauseWaiters: Array<() => void>;
}

const [jobs, setJobs] = createSignal<Map<string, BulkSendJobState>>(new Map());
const controls = new Map<string, JobControl>();

// the single most-recently-started job - lets a "send to remote" button
// reopen an in-flight job's progress instead of accidentally starting a
// second one for the same selection.
const [latestJobId, setLatestJobId] = createSignal<string | null>(null);

// which job's progress the send modal is currently showing, if any - used
// only to decide whether `finishJob` should toast (nobody's looking) or
// stay quiet (the modal's own "done" view already says so).
const [openModalJobId, setOpenModalJobId] = createSignal<string | null>(null);

export function getBulkSendJobs(): () => Map<string, BulkSendJobState> {
  return jobs;
}
export function getBulkSendJob(id: string): BulkSendJobState | null {
  return jobs().get(id) ?? null;
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

function newJobId(): string {
  return `bulksend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateJob(id: string, patch: Partial<BulkSendJobState>): void {
  setJobs((prev) => {
    const cur = prev.get(id);
    if (!cur) return prev;
    const next = new Map(prev);
    next.set(id, { ...cur, ...patch });
    return next;
  });
}

async function waitIfPaused(jobId: string): Promise<void> {
  const ctrl = controls.get(jobId);
  if (!ctrl || !ctrl.paused) return;
  await new Promise<void>((resolve) => ctrl.pauseWaiters.push(resolve));
}

export function pauseBulkSendJob(jobId: string): void {
  const ctrl = controls.get(jobId);
  if (!ctrl || ctrl.cancelled) return;
  ctrl.paused = true;
  updateJob(jobId, { paused: true });
}

export function resumeBulkSendJob(jobId: string): void {
  const ctrl = controls.get(jobId);
  if (!ctrl) return;
  ctrl.paused = false;
  updateJob(jobId, { paused: false });
  const waiters = ctrl.pauseWaiters.splice(0);
  for (const w of waiters) w();
}

export function cancelBulkSendJob(jobId: string): void {
  const ctrl = controls.get(jobId);
  if (ctrl) ctrl.cancelled = true;
  updateJob(jobId, { cancelled: true });
  // unblock a paused loop so it can observe the cancellation and stop.
  resumeBulkSendJob(jobId);
}

/** drop a finished job from the registry (e.g. after the user dismisses
 *  its "done" summary). in-progress jobs can't be cleared - cancel first. */
export function clearBulkSendJob(jobId: string): void {
  const job = jobs().get(jobId);
  if (job && !job.done) return;
  setJobs((prev) => {
    const next = new Map(prev);
    next.delete(jobId);
    return next;
  });
  controls.delete(jobId);
  if (latestJobId() === jobId) setLatestJobId(null);
}

function finishJob(jobId: string): void {
  updateJob(jobId, { done: true, currentItemTitle: null });
  const job = getBulkSendJob(jobId);
  if (!job) return;
  // toast only if the modal isn't currently showing this job's progress -
  // it already renders its own inline "done" summary in that case.
  if (openModalJobId() !== jobId) {
    const parts: string[] = [];
    if (job.completedItems > 0) parts.push(`${job.completedItems} sent`);
    if (job.failedItems > 0) parts.push(`${job.failedItems} failed`);
    const itemWord = job.kind === "albums" ? "album" : "video";
    const msg = `send to ${job.destName} finished: ${
      parts.length > 0 ? parts.join(", ") : `nothing to send`
    }${parts.length > 0 ? ` (${itemWord}s)` : ""}`;
    if (job.failedItems > 0) toast.warning(msg);
    else toast.success(msg);
  }
}

function createJob(kind: BulkSendKind, dest: Remote, totalItems: number): string {
  const jobId = newJobId();
  controls.set(jobId, { paused: false, cancelled: false, pauseWaiters: [] });
  setJobs((prev) => {
    const next = new Map(prev);
    next.set(jobId, {
      id: jobId,
      kind,
      destId: dest.remote_id,
      destName: dest.name ?? dest.remote_id,
      totalItems,
      completedItems: 0,
      failedItems: 0,
      currentItemTitle: null,
      paused: false,
      cancelled: false,
      done: false,
      errors: [],
    });
    return next;
  });
  setLatestJobId(jobId);
  return jobId;
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
  const jobId = createJob("albums", args.dest, args.albumIds.length);
  void runBulkAlbumSend(jobId, args);
  return jobId;
}

/** shared per-item loop harness for a bulk send job - checks cancel/pause
 *  between items and applies the job bookkeeping (currentItemTitle,
 *  completed/failed counts, errors) both bulk kinds need identically. each
 *  kind only supplies how to send one item, returning the error messages
 *  that item produced (empty = success) - album and video legitimately
 *  differ in what "success" means for one item (album never inspects its
 *  own per-song failures, video does), so that decision stays with the
 *  caller rather than being baked into this loop. */
async function runBulkSendLoop<T>(
  jobId: string,
  items: T[],
  itemTitle: (item: T) => string,
  sendOne: (item: T) => Promise<string[]>
): Promise<void> {
  const ctrl = controls.get(jobId)!;
  for (const item of items) {
    if (ctrl.cancelled) break;
    await waitIfPaused(jobId);
    if (ctrl.cancelled) break;
    updateJob(jobId, { currentItemTitle: itemTitle(item) });
    try {
      const errors = await sendOne(item);
      const cur = getBulkSendJob(jobId);
      if (errors.length > 0) {
        updateJob(jobId, {
          failedItems: (cur?.failedItems ?? 0) + 1,
          errors: [...(cur?.errors ?? []), ...errors],
        });
      } else {
        updateJob(jobId, { completedItems: (cur?.completedItems ?? 0) + 1 });
      }
    } catch (e) {
      const cur = getBulkSendJob(jobId);
      updateJob(jobId, {
        failedItems: (cur?.failedItems ?? 0) + 1,
        errors: [
          ...(cur?.errors ?? []),
          `${itemTitle(item)}: ${e instanceof Error ? e.message : String(e)}`,
        ],
      });
    }
  }
  finishJob(jobId);
}

async function runBulkAlbumSend(jobId: string, args: StartBulkAlbumSendArgs): Promise<void> {
  const dataSource = getDataSource();
  await runBulkSendLoop(
    jobId,
    args.albumIds,
    (albumId) => albumId,
    async (albumId) => {
      if (!dataSource.getAlbumSongs) throw new Error("album songs not supported here");
      const response = await dataSource.getAlbumSongs(albumId, { limit: 1000 });
      const songs = sortSongsCanonical(response.items);
      const first = songs[0];
      const title = first?.album_title ?? albumId;
      updateJob(jobId, { currentItemTitle: title });
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
      // matches the pre-refactor behavior exactly.
      return [];
    }
  );
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
  const jobId = createJob("videos", args.dest, args.items.length);
  void runBulkVideoSend(jobId, args);
  return jobId;
}

async function runBulkVideoSend(jobId: string, args: StartBulkVideoSendArgs): Promise<void> {
  await runBulkSendLoop(
    jobId,
    args.items,
    (item) => item.video.title,
    async (item) => {
      const result = await sendVideosToRemote([item], args.source, args.dest, {});
      return result.failedVideos > 0 ? result.errors.map((e) => `${item.video.title}: ${e}`) : [];
    }
  );
}
