// in-flight musicbrainz album-search job tracker.
//
// scope: module-level signals so the LibraryView (header progress strip),
// the AlbumsTable rows (per-row pulse), and the bulk action bar can all
// share state without prop-drilling.
//
// flow:
//   1. caller invokes `enqueueMbLookup(remote, albumIds, opts)` after the
//      user clicks "lookup musicbrainz...".
//   2. the hook posts to `enqueueMbAlbumSearch`, then registers each
//      returned job_id keyed by album_id.
//   3. a polling loop calls `getJobStatus` every `POLL_INTERVAL_MS` until
//      every tracked job reaches a terminal state. on completion the
//      album row is removed from the in-flight map and the library-albums
//      query is invalidated so the table picks up the new
//      mb_lookup_status / candidates.
//
// ux:
//   - no toasts. progress is shown inline via:
//       * per-row status pulse (AlbumsTable consumes `useInflightJobs()`)
//       * a header progress strip (LibraryView consumes `useMbSession()`)
//   - the session signal tracks per-burst totals + a brief settle window
//     so the strip can flash a final tally before fading out.

import { createSignal } from "solid-js";
import type { FreqholeClient } from "freqhole-api-client";
import { getClientForRemote } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import type { Remote } from "../../app/services/storage/schemas/remote";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["Completed", "Failed", "Cancelled"]);
// how long the session strip lingers after the last job settles before
// fading out. gives the user a chance to see the final tally.
const SESSION_SETTLE_LINGER_MS = 6000;

interface InflightEntry {
  jobId: string;
  remoteId: string;
  startedAt: number;
}

export interface MbSessionState {
  /** total albums enqueued across the current burst. */
  enqueued: number;
  /** terminal-Completed count this burst. */
  completed: number;
  /** terminal-Failed/Cancelled count this burst. */
  failed: number;
  /** how many of `enqueued` were skipped at enqueue time (e.g. invalid id). */
  skippedAtEnqueue: number;
  /** true while at least one job is in flight. */
  isActive: boolean;
  /** remote_id this session is associated with (last enqueue's remote). */
  remoteId: string | null;
  /** epoch ms of last terminal settle (used to hide strip after linger). */
  lastSettledAt: number | null;
  /** human label of the most recent failure, for inline surfacing. */
  lastError: string | null;
}

const EMPTY_SESSION: MbSessionState = {
  enqueued: 0,
  completed: 0,
  failed: 0,
  skippedAtEnqueue: 0,
  isActive: false,
  remoteId: null,
  lastSettledAt: null,
  lastError: null,
};

// album_id -> entry (one job per album at a time; latest wins if re-enqueued)
const [inflight, setInflight] = createSignal<Map<string, InflightEntry>>(new Map());
const [session, setSession] = createSignal<MbSessionState>(EMPTY_SESSION);

// poll loop is per-remote so we don't fan out per-album api calls
const pollers = new Map<string, ReturnType<typeof setInterval>>();
// linger timer that resets the session strip after the burst settles
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

export function getInflightJobs(): Map<string, InflightEntry> {
  return inflight();
}

export function isAlbumLookupRunning(albumId: string): boolean {
  return inflight().has(albumId);
}

/** read-only accessor for components that need to react to changes. */
export function useInflightJobs() {
  return inflight;
}

/** read-only accessor for the burst-level progress session. */
export function useMbSession() {
  return session;
}

/** dismiss the session strip (e.g. user clicked the close button). */
export function dismissMbSession(): void {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  setSession(EMPTY_SESSION);
}

/** enqueue an MB album-search job for each id. requires admin on the remote. */
export async function enqueueMbLookup(
  remote: Remote,
  albumIds: string[],
  opts: { autoConfirmThreshold?: number | null } = {},
): Promise<{ jobIds: string[]; skipped: string[] }> {
  if (albumIds.length === 0) {
    return { jobIds: [], skipped: [] };
  }

  startOrExtendSession(remote.remote_id, albumIds.length);

  let client: FreqholeClient;
  try {
    client = await getClientForRemote(remote);
  } catch (e) {
    failSession(`failed to reach remote: ${(e as Error).message}`, albumIds.length);
    return { jobIds: [], skipped: albumIds };
  }

  const resp = await client.music.enqueueMbAlbumSearch({
    album_ids: albumIds,
    auto_confirm_threshold: opts.autoConfirmThreshold ?? null,
  });

  if (!resp.success || !resp.data) {
    const msg = resp.success ? "enqueue failed" : resp.error.message;
    failSession(msg, albumIds.length);
    return { jobIds: [], skipped: albumIds };
  }

  const { job_ids, skipped_album_ids } = resp.data;
  const accepted = albumIds.filter((id) => !skipped_album_ids.includes(id));
  const next = new Map(inflight());
  const now = Date.now();
  accepted.forEach((albumId, i) => {
    const jobId = job_ids[i];
    if (!jobId) return;
    next.set(albumId, { jobId, remoteId: remote.remote_id, startedAt: now });
  });
  setInflight(next);

  if (skipped_album_ids.length > 0) {
    setSession((s) => ({
      ...s,
      skippedAtEnqueue: s.skippedAtEnqueue + skipped_album_ids.length,
    }));
  }

  ensurePollerForRemote(remote);
  return { jobIds: job_ids, skipped: skipped_album_ids };
}

// ---- session helpers ----

function startOrExtendSession(remoteId: string, addedCount: number) {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  setSession((s) => {
    // if a previous burst settled but is still in linger window, start fresh.
    const settled = s.lastSettledAt !== null && !s.isActive;
    if (settled || s.remoteId !== remoteId) {
      return {
        ...EMPTY_SESSION,
        enqueued: addedCount,
        isActive: true,
        remoteId,
      };
    }
    return {
      ...s,
      enqueued: s.enqueued + addedCount,
      isActive: true,
      remoteId,
    };
  });
}

function failSession(message: string, count: number) {
  setSession((s) => ({
    ...s,
    failed: s.failed + count,
    lastError: message,
    isActive: countActive() > 0,
    lastSettledAt: countActive() > 0 ? null : Date.now(),
  }));
  scheduleSessionLinger();
}

function countActive(): number {
  return inflight().size;
}

function scheduleSessionLinger() {
  if (lingerTimer) clearTimeout(lingerTimer);
  if (countActive() > 0) return;
  lingerTimer = setTimeout(() => {
    setSession(EMPTY_SESSION);
    lingerTimer = null;
  }, SESSION_SETTLE_LINGER_MS);
}

// ---- polling ----
//
// poll-based for now because the http transport doesn't yet have a
// server-push channel. when the p2p bidi event channel lands this can be
// replaced by an event subscription without changing the public api.

function ensurePollerForRemote(remote: Remote) {
  if (pollers.has(remote.remote_id)) return;
  const handle = setInterval(() => {
    void pollOnce(remote).catch(() => {
      // swallow poll errors; next tick will retry. transient network blips
      // shouldn't kill the loop.
    });
  }, POLL_INTERVAL_MS);
  pollers.set(remote.remote_id, handle);
}

function stopPollerIfIdle(remoteId: string) {
  const stillRunning = [...inflight().values()].some((e) => e.remoteId === remoteId);
  if (stillRunning) return;
  const handle = pollers.get(remoteId);
  if (handle) {
    clearInterval(handle);
    pollers.delete(remoteId);
  }
}

async function pollOnce(remote: Remote): Promise<void> {
  const entries = [...inflight().entries()].filter(
    ([, e]) => e.remoteId === remote.remote_id,
  );
  if (entries.length === 0) {
    stopPollerIfIdle(remote.remote_id);
    return;
  }

  const client = await getClientForRemote(remote);
  const resp = await client.music.getJobStatus({
    job_ids: entries.map(([, e]) => e.jobId),
  });
  if (!resp.success || !resp.data) {
    return;
  }

  const completed: string[] = [];
  const failed: string[] = [];
  for (const [albumId, entry] of entries) {
    const status = resp.data.jobs[entry.jobId]?.status;
    if (!status) continue;
    if (TERMINAL_STATUSES.has(status)) {
      if (status === "Completed") completed.push(albumId);
      else failed.push(albumId);
    }
  }

  if (completed.length === 0 && failed.length === 0) return;

  const next = new Map(inflight());
  [...completed, ...failed].forEach((id) => next.delete(id));
  setInflight(next);

  setSession((s) => {
    const nowActive = next.size > 0;
    return {
      ...s,
      completed: s.completed + completed.length,
      failed: s.failed + failed.length,
      isActive: nowActive,
      lastSettledAt: nowActive ? null : Date.now(),
      lastError:
        failed.length > 0
          ? `${failed.length} lookup${failed.length === 1 ? "" : "s"} failed`
          : s.lastError,
    };
  });

  void queryClient.invalidateQueries({
    queryKey: ["library-albums", remote.remote_id],
  });

  stopPollerIfIdle(remote.remote_id);
  scheduleSessionLinger();
}
