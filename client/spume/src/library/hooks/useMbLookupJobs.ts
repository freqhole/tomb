// in-flight album-enrichment job tracker.
//
// scope: module-level signals so the LibraryView (header progress strip),
// the AlbumsTable rows (per-row pulse with per-source dots), and the bulk
// action bar can all share state without prop-drilling.
//
// sources: musicbrainz album-search (mb), last.fm album-detail (lastfm),
// theaudiodb album-detail (audiodb). a single click in "lookup all
// matching" or "enrich N selected" fans out to all three endpoints in
// parallel, registers each returned job_id under a `${source}:${album_id}`
// key, and the polling loop walks all in-flight jobs for the remote
// regardless of source. rate limiting is enforced server-side by each
// client's `RateLimiter` (1 req/sec per source) plus the runner's serial
// execution. retry/backoff is handled by the runner's exponential
// schedule (`mark_job_failed` → `2^retry * 60s`, max 2 retries).
//
// ux:
//   - no toasts. progress is shown inline via:
//       * per-row badge (AlbumsTable consumes `useInflightJobs()` and
//         `getInflightSourcesForAlbum()`) showing which sources are
//         currently working on that album.
//       * a header progress strip (LibraryView consumes `useMbSession()`)
//         with per-source totals and a slim aggregate progress bar.
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

export type EnrichmentSource = "mb" | "lastfm" | "audiodb";
export const ENRICHMENT_SOURCES: EnrichmentSource[] = ["mb", "lastfm", "audiodb"];

export interface InflightEntry {
  source: EnrichmentSource;
  jobId: string;
  remoteId: string;
  albumId: string;
  startedAt: number;
}

export interface SourceCounts {
  /** total jobs enqueued for this source across the current burst. */
  enqueued: number;
  /** terminal-Completed count this burst. */
  completed: number;
  /** terminal-Failed/Cancelled count this burst. */
  failed: number;
  /** how many of `enqueued` were skipped at enqueue time. */
  skippedAtEnqueue: number;
}

const EMPTY_COUNTS = (): SourceCounts => ({
  enqueued: 0,
  completed: 0,
  failed: 0,
  skippedAtEnqueue: 0,
});

export interface MbSessionState {
  /** per-source breakdown. */
  bySource: Record<EnrichmentSource, SourceCounts>;
  /** total across all sources (sum of bySource enqueued). */
  enqueued: number;
  /** terminal-Completed across all sources. */
  completed: number;
  /** terminal-Failed/Cancelled across all sources. */
  failed: number;
  /** skipped-at-enqueue across all sources. */
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

const EMPTY_SESSION = (): MbSessionState => ({
  bySource: {
    mb: EMPTY_COUNTS(),
    lastfm: EMPTY_COUNTS(),
    audiodb: EMPTY_COUNTS(),
  },
  enqueued: 0,
  completed: 0,
  failed: 0,
  skippedAtEnqueue: 0,
  isActive: false,
  remoteId: null,
  lastSettledAt: null,
  lastError: null,
});

// inflight key: `${source}:${album_id}` so multiple sources can be
// tracked independently for the same album.
const [inflight, setInflight] = createSignal<Map<string, InflightEntry>>(new Map());
const [session, setSession] = createSignal<MbSessionState>(EMPTY_SESSION());

// poll loop is per-remote so we don't fan out per-album api calls
const pollers = new Map<string, ReturnType<typeof setInterval>>();
// linger timer that resets the session strip after the burst settles
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

function inflightKey(source: EnrichmentSource, albumId: string): string {
  return `${source}:${albumId}`;
}

export function getInflightJobs(): Map<string, InflightEntry> {
  return inflight();
}

/** true if any source is currently looking up the given album. */
export function isAlbumLookupRunning(albumId: string): boolean {
  for (const e of inflight().values()) {
    if (e.albumId === albumId) return true;
  }
  return false;
}

/** which sources are currently in-flight for this album. */
export function getInflightSourcesForAlbum(albumId: string): Set<EnrichmentSource> {
  const out = new Set<EnrichmentSource>();
  for (const e of inflight().values()) {
    if (e.albumId === albumId) out.add(e.source);
  }
  return out;
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
  setSession(EMPTY_SESSION());
}

interface EnrichResult {
  /** per-source job ids that were successfully enqueued. */
  jobIdsBySource: Record<EnrichmentSource, string[]>;
  /** per-source albums that were not enqueued (server skip + transport fail). */
  skippedBySource: Record<EnrichmentSource, string[]>;
}

/**
 * fan out album enrichment to all three sources in parallel:
 * musicbrainz album-search, last.fm album-detail, theaudiodb album-detail.
 *
 * each source has its own server-side rate limiter (1 req/sec) and the
 * runner processes jobs serially per-source. failures are retried with
 * exponential backoff (max 2 retries) by the runner.
 *
 * requires admin on the remote — all three enqueue routes are admin-only.
 */
export async function enqueueAlbumEnrichment(
  remote: Remote,
  albumIds: string[],
  opts: { autoConfirmThreshold?: number | null } = {},
): Promise<EnrichResult> {
  const empty: EnrichResult = {
    jobIdsBySource: { mb: [], lastfm: [], audiodb: [] },
    skippedBySource: { mb: [], lastfm: [], audiodb: [] },
  };

  if (albumIds.length === 0) return empty;

  // tally three * albumIds.length up-front so the strip shows the full
  // expected workload immediately, then we'll subtract skips as the
  // server reports them.
  startOrExtendSession(remote.remote_id, albumIds.length);

  let client: FreqholeClient;
  try {
    client = await getClientForRemote(remote);
  } catch (e) {
    failSession(`failed to reach remote: ${(e as Error).message}`, albumIds.length);
    return {
      jobIdsBySource: { mb: [], lastfm: [], audiodb: [] },
      skippedBySource: { mb: [...albumIds], lastfm: [...albumIds], audiodb: [...albumIds] },
    };
  }

  // fire all three in parallel
  const [mbR, lfR, adR] = await Promise.allSettled([
    client.music.enqueueMbAlbumSearch({
      album_ids: albumIds,
      auto_confirm_threshold: opts.autoConfirmThreshold ?? null,
    }),
    client.music.enqueueLastFmAlbumDetail({ album_ids: albumIds }),
    client.music.enqueueAudioDbAlbumDetail({ album_ids: albumIds }),
  ]);

  const result: EnrichResult = {
    jobIdsBySource: { mb: [], lastfm: [], audiodb: [] },
    skippedBySource: { mb: [], lastfm: [], audiodb: [] },
  };

  registerEnqueueResult("mb", mbR, albumIds, remote, result);
  registerEnqueueResult("lastfm", lfR, albumIds, remote, result);
  registerEnqueueResult("audiodb", adR, albumIds, remote, result);

  ensurePollerForRemote(remote);
  return result;
}

type EnqueueResp = {
  success: boolean;
  data?: { job_ids: string[]; skipped_album_ids: string[] };
  error?: { message: string };
};

function registerEnqueueResult(
  source: EnrichmentSource,
  settled: PromiseSettledResult<unknown>,
  albumIds: string[],
  remote: Remote,
  out: EnrichResult,
): void {
  if (settled.status === "rejected") {
    const msg = (settled.reason as Error)?.message ?? String(settled.reason);
    failSourceSession(source, `${source} enqueue threw: ${msg}`, albumIds.length);
    out.skippedBySource[source].push(...albumIds);
    return;
  }
  const resp = settled.value as EnqueueResp;
  if (!resp.success || !resp.data) {
    const msg = resp.success ? "enqueue failed" : (resp.error?.message ?? "unknown");
    failSourceSession(source, `${source}: ${msg}`, albumIds.length);
    out.skippedBySource[source].push(...albumIds);
    return;
  }

  const { job_ids, skipped_album_ids } = resp.data;
  out.jobIdsBySource[source].push(...job_ids);
  out.skippedBySource[source].push(...skipped_album_ids);

  // server returned: job_ids[i] corresponds to the i-th non-skipped album.
  // build a parallel list of accepted album ids in original order.
  const accepted = albumIds.filter((id) => !skipped_album_ids.includes(id));

  const next = new Map(inflight());
  const now = Date.now();
  accepted.forEach((albumId, i) => {
    const jobId = job_ids[i];
    if (!jobId) return;
    next.set(inflightKey(source, albumId), {
      source,
      jobId,
      remoteId: remote.remote_id,
      albumId,
      startedAt: now,
    });
  });
  setInflight(next);

  if (skipped_album_ids.length > 0) {
    setSession((s) => {
      const bySource = { ...s.bySource };
      bySource[source] = {
        ...bySource[source],
        skippedAtEnqueue: bySource[source].skippedAtEnqueue + skipped_album_ids.length,
      };
      return {
        ...s,
        bySource,
        skippedAtEnqueue: s.skippedAtEnqueue + skipped_album_ids.length,
      };
    });
  }
}

// ---- session helpers ----

/**
 * record a new burst that touches three sources × albumIds.length jobs.
 * the strip will show "0 / N" immediately and fill in as jobs settle.
 */
function startOrExtendSession(remoteId: string, addedAlbumCount: number) {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  const addedTotal = addedAlbumCount * 3;
  setSession((s) => {
    // if a previous burst settled but is still in linger window, start fresh.
    const settled = s.lastSettledAt !== null && !s.isActive;
    const fresh = settled || s.remoteId !== remoteId;
    const base = fresh ? EMPTY_SESSION() : s;
    const bySource = { ...base.bySource };
    for (const src of ENRICHMENT_SOURCES) {
      bySource[src] = {
        ...bySource[src],
        enqueued: bySource[src].enqueued + addedAlbumCount,
      };
    }
    return {
      ...base,
      bySource,
      enqueued: base.enqueued + addedTotal,
      isActive: true,
      remoteId,
    };
  });
}

function failSourceSession(source: EnrichmentSource, message: string, count: number) {
  setSession((s) => {
    const bySource = { ...s.bySource };
    bySource[source] = {
      ...bySource[source],
      failed: bySource[source].failed + count,
    };
    const stillActive = countActive() > 0;
    return {
      ...s,
      bySource,
      failed: s.failed + count,
      lastError: message,
      isActive: stillActive,
      lastSettledAt: stillActive ? null : Date.now(),
    };
  });
  scheduleSessionLinger();
}

function failSession(message: string, count: number) {
  // attribute to all three sources equally (transport-level failure)
  for (const src of ENRICHMENT_SOURCES) {
    failSourceSession(src, message, count);
  }
}

function countActive(): number {
  return inflight().size;
}

function scheduleSessionLinger() {
  if (lingerTimer) clearTimeout(lingerTimer);
  if (countActive() > 0) return;
  lingerTimer = setTimeout(() => {
    setSession(EMPTY_SESSION());
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

  // group settles by source for per-source counter updates
  const completedBySource: Record<EnrichmentSource, number> = { mb: 0, lastfm: 0, audiodb: 0 };
  const failedBySource: Record<EnrichmentSource, number> = { mb: 0, lastfm: 0, audiodb: 0 };
  const settledKeys: string[] = [];
  let lastFailureMsg: string | null = null;

  for (const [key, entry] of entries) {
    const job = resp.data.jobs[entry.jobId];
    if (!job) continue;
    if (!TERMINAL_STATUSES.has(job.status)) continue;
    settledKeys.push(key);
    if (job.status === "Completed") {
      completedBySource[entry.source] += 1;
    } else {
      failedBySource[entry.source] += 1;
      if (job.error_message) {
        lastFailureMsg = `${entry.source}: ${job.error_message}`;
      }
    }
  }

  if (settledKeys.length === 0) return;

  const next = new Map(inflight());
  for (const k of settledKeys) next.delete(k);
  setInflight(next);

  setSession((s) => {
    const bySource = { ...s.bySource };
    let totalCompleted = 0;
    let totalFailed = 0;
    for (const src of ENRICHMENT_SOURCES) {
      bySource[src] = {
        ...bySource[src],
        completed: bySource[src].completed + completedBySource[src],
        failed: bySource[src].failed + failedBySource[src],
      };
      totalCompleted += completedBySource[src];
      totalFailed += failedBySource[src];
    }
    const nowActive = next.size > 0;
    return {
      ...s,
      bySource,
      completed: s.completed + totalCompleted,
      failed: s.failed + totalFailed,
      isActive: nowActive,
      lastSettledAt: nowActive ? null : Date.now(),
      lastError: lastFailureMsg ?? s.lastError,
    };
  });

  void queryClient.invalidateQueries({
    queryKey: ["library-albums", remote.remote_id],
  });

  stopPollerIfIdle(remote.remote_id);
  scheduleSessionLinger();
}
