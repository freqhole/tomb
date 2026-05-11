// in-flight musicbrainz album-search job tracker.
//
// scope: module-level signals so the LibraryView (which owns the lifecycle)
// and the AlbumsTable rows (which show per-row spinners) can share state
// without prop-drilling.
//
// flow:
//   1. caller invokes `enqueueMbLookup(remote, albumIds, opts)` after the
//      user clicks "lookup musicbrainz...".
//   2. the hook posts to `/api/music/albums/mb-search/enqueue`, then
//      registers each returned job_id keyed by album_id.
//   3. a polling loop calls `/api/jobs/status` every `POLL_INTERVAL_MS`
//      until every tracked job reaches a terminal state (Completed,
//      Failed, Cancelled). on completion the album row is removed from the
//      in-flight map and the library-albums query is invalidated so the
//      table picks up the new mb_lookup_status / candidates.

import { createSignal } from "solid-js";
import type { FreqholeClient } from "freqhole-api-client";
import { getClientForRemote } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { toast } from "../../components/feedback/Toast";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["Completed", "Failed", "Cancelled"]);

interface InflightEntry {
  jobId: string;
  remoteId: string;
  startedAt: number;
}

// album_id -> entry (one job per album at a time; latest wins if re-enqueued)
const [inflight, setInflight] = createSignal<Map<string, InflightEntry>>(new Map());

// poll loop is per-remote so we don't fan out per-album api calls
const pollers = new Map<string, ReturnType<typeof setInterval>>();

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

/** enqueue an MB album-search job for each id. requires admin on the remote. */
export async function enqueueMbLookup(
  remote: Remote,
  albumIds: string[],
  opts: { autoConfirmThreshold?: number | null } = {},
): Promise<{ jobIds: string[]; skipped: string[] }> {
  if (albumIds.length === 0) {
    return { jobIds: [], skipped: [] };
  }

  let client: FreqholeClient;
  try {
    client = await getClientForRemote(remote);
  } catch (e) {
    toast.error(`failed to reach remote: ${(e as Error).message}`);
    return { jobIds: [], skipped: albumIds };
  }

  const resp = await client.music.enqueueMbAlbumSearch({
    album_ids: albumIds,
    auto_confirm_threshold: opts.autoConfirmThreshold ?? null,
  });

  if (!resp.success || !resp.data) {
    const msg = resp.success ? "enqueue failed" : resp.error.message;
    toast.error(`musicbrainz lookup: ${msg}`);
    return { jobIds: [], skipped: albumIds };
  }

  const { job_ids, skipped_album_ids } = resp.data;
  // job_ids align positionally with the album_ids that weren't skipped.
  const accepted = albumIds.filter((id) => !skipped_album_ids.includes(id));
  const next = new Map(inflight());
  const now = Date.now();
  accepted.forEach((albumId, i) => {
    const jobId = job_ids[i];
    if (!jobId) return;
    next.set(albumId, { jobId, remoteId: remote.remote_id, startedAt: now });
  });
  setInflight(next);

  ensurePollerForRemote(remote);

  toast.success(
    skipped_album_ids.length === 0
      ? `enqueued musicbrainz lookup for ${accepted.length} album${accepted.length === 1 ? "" : "s"}`
      : `enqueued ${accepted.length}, skipped ${skipped_album_ids.length}`,
  );

  return { jobIds: job_ids, skipped: skipped_album_ids };
}

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
  // any remaining inflight entries for this remote keep the poller alive.
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

  const completed: string[] = []; // album ids
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

  // mutate inflight: drop terminal entries
  const next = new Map(inflight());
  [...completed, ...failed].forEach((id) => next.delete(id));
  setInflight(next);

  // invalidate the library-albums query for this remote so the row's
  // mb_lookup_status / candidates refresh.
  void queryClient.invalidateQueries({
    queryKey: ["library-albums", remote.remote_id],
  });

  if (failed.length > 0) {
    toast.error(`musicbrainz lookup failed for ${failed.length} album${failed.length === 1 ? "" : "s"}`);
  }
  if (completed.length > 0) {
    toast.success(
      `musicbrainz lookup complete for ${completed.length} album${completed.length === 1 ? "" : "s"}`,
    );
  }

  stopPollerIfIdle(remote.remote_id);
}
