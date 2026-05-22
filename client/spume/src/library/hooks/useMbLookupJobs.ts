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
import { JobEventsStreamClosed } from "freqhole-api-client";
import type { EventFilter, JobEvent } from "freqhole-api-client";
import { getClientForRemote, type RemoteLike } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import type { Remote } from "../../app/services/storage/schemas/remote";

// any caller-supplied object that exposes a stable remote_id and is
// compatible with the api-client factory. accepts both the full storage
// `Remote` row and the lighter `CurrentRemoteInfo` record used by the
// header/session signals.
type RemoteRef = RemoteLike & { remote_id: string };

// stream-healthy poll cadence: just a drift-check / safety net. when
// the live subscribe stream is delivering events, the poll loop only
// needs to catch the occasional missed terminal state (e.g. event
// dropped due to broadcast lag and re-snapshot fallback).
const POLL_INTERVAL_STREAM_MS = 60_000;
// stream-down poll cadence: same shape as the legacy 1.5s loop, slightly
// looser so we don't hammer the server while the iroh/ipc channel is
// reconnecting.
const POLL_INTERVAL_FALLBACK_MS = 3_000;
const TERMINAL_STATUSES = new Set(["Completed", "Failed", "Cancelled"]);
// snake_case mirror so we can compare against `StatusChanged.to` /
// snapshot `status` fields which are now serialized snake_case.
const TERMINAL_STATUSES_WIRE = new Set(["completed", "failed", "cancelled"]);
// reconnect backoff schedule for the subscribe stream. capped at 10s.
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];
// how long the session strip lingers after the last job settles before
// fading out. gives the user a chance to see the final tally.
const SESSION_SETTLE_LINGER_MS = 6000;

export type EnrichmentSource = "mb" | "lastfm" | "audiodb";
export const ENRICHMENT_SOURCES: EnrichmentSource[] = ["mb", "lastfm", "audiodb"];

// job-event topic -> enrichment source. only these three topics are of
// interest to this hook; any other topic on the broker is ignored.
const TOPIC_TO_SOURCE: Record<string, EnrichmentSource> = {
  MbAlbumSearch: "mb",
  LastFmAlbumDetail: "lastfm",
  AudioDbAlbumDetail: "audiodb",
};
// keep this literal-typed so the `EventFilter.kinds` array stays a
// narrow union of `JobType` rather than widening to `string[]`.
const SUBSCRIBED_KINDS = [
  "MbAlbumSearch",
  "LastFmAlbumDetail",
  "AudioDbAlbumDetail",
] as const satisfies ReadonlyArray<keyof typeof TOPIC_TO_SOURCE>;

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

// per-job latest `Stage` event payload, for inline progress captions
// (consumed by AlbumRow / bulk review). cleared when the job settles.
const [stageByJobId, setStageByJobId] = createSignal<
  Map<string, { stage: string; message: string | null }>
>(new Map());

// adaptive polling interval per remote: setInterval handles whichever
// cadence is current, swapped out when stream health flips.
const pollers = new Map<string, ReturnType<typeof setInterval>>();
// reverse lookup so a health-flip can recreate the interval without
// requiring callers to pass the remote again.
const remoteByRemoteId = new Map<string, RemoteRef>();
// per-remote subscribe state: AbortController to tear down the iterator,
// current backoff index, current health.
type StreamState = {
  controller: AbortController;
  backoffIdx: number;
  health: "connecting" | "healthy" | "down";
};
const streams = new Map<string, StreamState>();
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

/** the in-flight entry (if any) for (album, source). useful for pulling
 *  the live stage caption via `getJobProgressMessage(entry.jobId)`. */
export function getInflightJobForAlbum(
  albumId: string,
  source: EnrichmentSource,
): InflightEntry | null {
  return inflight().get(inflightKey(source, albumId)) ?? null;
}

/** read-only accessor for components that need to react to changes. */
export function useInflightJobs() {
  return inflight;
}

/** read-only accessor for the burst-level progress session. */
export function useMbSession() {
  return session;
}

/**
 * latest live `Stage.message` (or stage name when no message) for a
 * given job id. backed by the broker `Stage` events streamed in via
 * `client.jobs.events.subscribe`. returns null if the job hasn't
 * emitted a stage yet, or has already settled.
 *
 * reactive: callers should invoke `stageByJobId()` first to subscribe
 * if they need fine-grained reactivity, then call this. for one-shot
 * reads (e.g. inside a `<Show>`), just `getJobProgressMessage(id)` is
 * fine.
 */
export function getJobProgressMessage(jobId: string): string | null {
  const entry = stageByJobId().get(jobId);
  if (!entry) return null;
  return entry.message ?? entry.stage;
}

/** reactive accessor for the per-job stage map (rare; use the
 *  one-shot `getJobProgressMessage` in most call sites). */
export function useJobProgressMessages() {
  return stageByJobId;
}

/** dismiss the session strip (e.g. user clicked the close button). */
export function dismissMbSession(): void {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  setSession(EMPTY_SESSION());
}

/**
 * register a single in-flight job (e.g. from a single-album requery
 * triggered by the bulk-review panel). makes the job visible to the
 * row-level "in flight" indicators and the polling loop, so its
 * terminal status auto-clears the entry. callers are responsible for
 * not double-registering — if a job is already in flight for this
 * (source, album) the existing entry is replaced.
 */
export function registerInflightJob(
  remote: RemoteRef,
  source: EnrichmentSource,
  albumId: string,
  jobId: string,
): void {
  const next = new Map(inflight());
  next.set(inflightKey(source, albumId), {
    source,
    jobId,
    remoteId: remote.remote_id,
    albumId,
    startedAt: Date.now(),
  });
  setInflight(next);
  ensureWatcherForRemote(remote);
}

/**
 * p8: page-reload rehydration entry point. call this on view-mount /
 * remote-switch to reconnect to any in-flight enrichment jobs the
 * server is currently running for this caller. opens the subscribe
 * stream (which snapshots first, seeding `inflight` + `stageByJobId`
 * from the server state) without needing to know which specific jobs
 * are running ahead of time.
 *
 * idempotent: calling it again for the same remote while a watcher is
 * already running is a no-op (the underlying `ensureWatcherForRemote`
 * de-dupes by `remote_id`).
 */
export function rehydrateInflightForRemote(remote: RemoteRef): void {
  ensureWatcherForRemote(remote);
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

  ensureWatcherForRemote(remote);
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

// ---- watcher (stream + adaptive poll) ----
//
// each remote has both a live subscribe stream and a setInterval poll.
// the stream delivers terminal status / stage events with sub-second
// latency. the poll is a drift-check / safety net:
//   - while the stream is healthy, poll every 60s.
//   - if the stream errors out (Lagged, transport drop, etc.), the poll
//     interval flips to 3s and a reconnect is scheduled with exponential
//     backoff (1s, 2s, 5s, 10s cap). once reconnected + a snapshot has
//     rehydrated state, the poll relaxes back to 60s.
//
// the stream uses the generic `client.jobs.events.subscribe(...)` api,
// so transports that don't natively stream (http) automatically fall
// back to the polling iterator in `transport.ts` — this hook still
// gets per-event handling, just with whatever latency the underlying
// transport's fallback provides.

function ensureWatcherForRemote(remote: RemoteRef) {
  console.log(
    "[job-events] watcher armed for remote",
    remote.remote_id,
  );
  remoteByRemoteId.set(remote.remote_id, remote);
  ensurePollerWithInterval(remote, POLL_INTERVAL_FALLBACK_MS);
  ensureStreamForRemote(remote);
}

function ensurePollerWithInterval(remote: RemoteRef, ms: number) {
  const existing = pollers.get(remote.remote_id);
  if (existing) clearInterval(existing);
  const handle = setInterval(() => {
    void pollOnce(remote).catch(() => {
      // swallow poll errors; next tick will retry. transient network
      // blips shouldn't kill the loop.
    });
  }, ms);
  pollers.set(remote.remote_id, handle);
}

function setStreamHealth(
  remoteId: string,
  health: StreamState["health"],
): void {
  const state = streams.get(remoteId);
  if (state) state.health = health;
  const remote = remoteByRemoteId.get(remoteId);
  if (!remote) return;
  // adaptive poll: healthy => slow drift-check; otherwise => fast
  // fallback that picks up jobs the (down) stream would have missed.
  const targetMs = health === "healthy"
    ? POLL_INTERVAL_STREAM_MS
    : POLL_INTERVAL_FALLBACK_MS;
  ensurePollerWithInterval(remote, targetMs);
}

function ensureStreamForRemote(remote: RemoteRef) {
  if (streams.has(remote.remote_id)) return;
  const controller = new AbortController();
  streams.set(remote.remote_id, {
    controller,
    backoffIdx: 0,
    health: "connecting",
  });
  void runStreamLoop(remote, controller).catch(() => {
    // top-level: runStreamLoop handles its own errors + reconnect. any
    // throw here is bug-shaped — just leave the stream marked down so
    // the fast poll takes over.
    setStreamHealth(remote.remote_id, "down");
  });
}

async function runStreamLoop(
  remote: RemoteRef,
  controller: AbortController,
): Promise<void> {
  while (!controller.signal.aborted) {
    let client: FreqholeClient;
    try {
      client = await getClientForRemote(remote);
    } catch {
      await scheduleReconnect(remote);
      continue;
    }
    const filter: EventFilter = { kinds: [...SUBSCRIBED_KINDS] };

    // rehydrate: snapshot first so any jobs that settled while we were
    // disconnected get reflected before we start consuming live events.
    try {
      const snaps = await client.jobs.events.snapshot(filter);
      rehydrateFromSnapshot(remote.remote_id, snaps);
    } catch {
      // snapshot failure is non-fatal — fall through to subscribe.
    }

    let iterator: AsyncIterable<JobEvent>;
    try {
      iterator = client.jobs.events.subscribe(filter, controller.signal);
      console.log(
        "[job-events] subscribe iterator opened for",
        remote.remote_id,
        "kinds=",
        filter.kinds,
      );
    } catch {
      await scheduleReconnect(remote);
      continue;
    }

    // success: mark healthy + reset backoff.
    const state = streams.get(remote.remote_id);
    if (state) state.backoffIdx = 0;
    setStreamHealth(remote.remote_id, "healthy");

    try {
      for await (const evt of iterator) {
        if (controller.signal.aborted) return;
        handleStreamEvent(remote, evt);
      }
      // iterator ended cleanly (broker closed the subscription). treat
      // as a transient drop and reconnect.
      console.log(
        "[job-events] subscribe iterator ended cleanly for",
        remote.remote_id,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof JobEventsStreamClosed) {
        console.log(
          "[job-events] stream closed for",
          remote.remote_id,
          "reason=",
          (err as { reason?: string }).reason ?? "unknown",
        );
        // lagged / unauthorized / internal — re-snapshot + reconnect on
        // the next loop iteration.
      } else {
        console.log(
          "[job-events] stream errored for",
          remote.remote_id,
          "err=",
          err,
        );
      }
      // other errors: also fall through to reconnect.
    }
    if (controller.signal.aborted) return;
    await scheduleReconnect(remote);
  }
}

async function scheduleReconnect(remote: RemoteRef): Promise<void> {
  setStreamHealth(remote.remote_id, "down");
  const state = streams.get(remote.remote_id);
  if (!state) return;
  const idx = Math.min(state.backoffIdx, RECONNECT_BACKOFF_MS.length - 1);
  const wait = RECONNECT_BACKOFF_MS[idx];
  state.backoffIdx = idx + 1;
  console.log(
    "[job-events] reconnect scheduled for",
    remote.remote_id,
    "delay_ms=",
    wait,
    "attempt=",
    state.backoffIdx,
  );
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, wait);
    state.controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function rehydrateFromSnapshot(remoteId: string, snaps: unknown[]): void {
  console.log(
    "[job-events] snapshot received for",
    remoteId,
    "count=",
    snaps.length,
  );
  // snaps is JobStateSnapshot[]; treat loosely to avoid an additional
  // zod parse here (the api client doesn't re-validate event payloads).
  type SnapLike = {
    job_id: string;
    session_id?: string | null;
    status: string;
    job_type: string;
    entity_ref?: { kind: string; id: string } | null;
    last_stage?: string | null;
    last_message?: string | null;
  };
  const snapsT = snaps as SnapLike[];

  // index inflight by job_id (instead of `${source}:${album_id}`) for
  // O(snap) lookup of jobs we're already tracking locally.
  const byJobId = new Map<string, { key: string; source: EnrichmentSource }>();
  for (const [key, entry] of inflight().entries()) {
    if (entry.remoteId !== remoteId) continue;
    byJobId.set(entry.jobId, { key, source: entry.source });
  }

  // settle any tracked job whose snapshot says it's terminal already.
  for (const s of snapsT) {
    if (!TERMINAL_STATUSES_WIRE.has(s.status)) continue;
    const hit = byJobId.get(s.job_id);
    if (!hit) continue;
    settleJob(
      remoteId,
      hit.key,
      hit.source,
      s.status === "completed" ? "completed" : "failed",
      s.last_message ?? null,
    );
  }

  // p8: seed `inflight` from non-terminal snapshot jobs that we don't
  // already track. this is what makes refresh-while-jobs-running just
  // work: a fresh page load with no local `inflight` entries learns
  // about currently-running jobs straight from the server snapshot,
  // populates the same map enqueue would have, and the per-row pulse +
  // stream-driven `Stage`/`StatusChanged`/`Failed` handlers take over.
  const newInflight = new Map(inflight());
  let added = false;
  for (const s of snapsT) {
    if (TERMINAL_STATUSES_WIRE.has(s.status)) continue;
    if (newInflight.has(s.job_id)) continue; // shouldn't happen — keys are source:album
    const source = TOPIC_TO_SOURCE[s.job_type];
    if (!source) continue;
    // wire format: entity_ref kind is lowercase (`#[serde(rename_all = "snake_case")]`).
    if (!s.entity_ref || s.entity_ref.kind !== "album") continue;
    const key = inflightKey(source, s.entity_ref.id);
    if (newInflight.has(key)) continue;
    newInflight.set(key, {
      source,
      jobId: s.job_id,
      remoteId,
      albumId: s.entity_ref.id,
      startedAt: Date.now(),
    });
    added = true;
  }
  if (added) setInflight(newInflight);

  // refresh live stage captions from the snapshot so the UI doesn't
  // start blank after reconnect / reload.
  setStageByJobId((m) => {
    const next = new Map(m);
    for (const s of snapsT) {
      if (TERMINAL_STATUSES_WIRE.has(s.status)) continue;
      // only seed for jobs we either already tracked or just enrolled.
      const trackedFromBefore = byJobId.has(s.job_id);
      const trackedNow = (() => {
        const source = TOPIC_TO_SOURCE[s.job_type];
        if (!source) return false;
        if (!s.entity_ref || s.entity_ref.kind !== "album") return false;
        return newInflight.has(inflightKey(source, s.entity_ref.id));
      })();
      if (!trackedFromBefore && !trackedNow) continue;
      if (s.last_stage) {
        next.set(s.job_id, { stage: s.last_stage, message: s.last_message ?? null });
      }
    }
    return next;
  });
}

function handleStreamEvent(remote: RemoteRef, evt: JobEvent): void {
  // narrow on `kind` (snake_case, fixed in p6 codegen patch).
  const kind = (evt as { kind: string }).kind;
  const e0 = evt as {
    kind: string;
    job_id?: string;
    topic?: string;
    entity_ref?: { kind: string; id: string } | null;
  };
  console.log(
    "[job-events] event",
    kind,
    "job_id=",
    e0.job_id,
    "topic=",
    e0.topic,
    "entity_ref=",
    e0.entity_ref ?? null,
  );
  switch (kind) {
    case "stage": {
      const e = evt as {
        kind: "stage";
        job_id: string;
        stage: string;
        message: string | null;
        topic: string;
        entity_ref?: { kind: string; id: string } | null;
      };
      // p9: auto-enroll peer / late jobs. if a `stage` event arrives
      // for a topic we care about + an album entity_ref we don't yet
      // track locally, enrol it so the per-row pulse + caption surface
      // for jobs triggered by other users (or by this user before the
      // current subscribe stream opened).
      maybeEnrollFromEvent(remote, e.job_id, e.topic, e.entity_ref ?? null);
      setStageByJobId((m) => {
        const next = new Map(m);
        next.set(e.job_id, { stage: e.stage, message: e.message ?? null });
        return next;
      });
      return;
    }
    case "status_changed": {
      const e = evt as {
        kind: "status_changed";
        job_id: string;
        to: string;
        topic: string;
        entity_ref?: { kind: string; id: string } | null;
      };
      // non-terminal transitions (e.g. pending -> running) also enrol
      // peer / late jobs so the row pulse appears immediately.
      if (!TERMINAL_STATUSES_WIRE.has(e.to)) {
        maybeEnrollFromEvent(remote, e.job_id, e.topic, e.entity_ref ?? null);
        return;
      }
      const tracked = findTrackedByJobId(remote.remote_id, e.job_id);
      if (!tracked) return;
      settleJob(
        remote.remote_id,
        tracked.key,
        tracked.source,
        e.to === "completed" ? "completed" : "failed",
        null,
      );
      return;
    }
    case "failed": {
      const e = evt as {
        kind: "failed";
        job_id: string;
        message: string;
        topic: string;
      };
      const tracked = findTrackedByJobId(remote.remote_id, e.job_id);
      if (!tracked) return;
      settleJob(remote.remote_id, tracked.key, tracked.source, "failed", e.message);
      return;
    }
    default:
      // progress / completed (session-level) currently unused.
      return;
  }
}

/**
 * p9: enroll an in-flight job into the local `inflight` map purely
 * from a stream event. used for peer-user-triggered jobs and for
 * jobs that started after our snapshot but before we settle them.
 * no-op when the topic isn't one we care about, the entity_ref isn't
 * an album, or we already track this (source, album).
 */
function maybeEnrollFromEvent(
  remote: RemoteRef,
  jobId: string,
  topic: string,
  entityRef: { kind: string; id: string } | null,
): void {
  const source = TOPIC_TO_SOURCE[topic];
  if (!source) return;
  if (!entityRef || entityRef.kind !== "album") return;
  const key = inflightKey(source, entityRef.id);
  const current = inflight();
  const existing = current.get(key);
  if (existing && existing.jobId === jobId) return;
  const next = new Map(current);
  next.set(key, {
    source,
    jobId,
    remoteId: remote.remote_id,
    albumId: entityRef.id,
    startedAt: Date.now(),
  });
  setInflight(next);
}

function findTrackedByJobId(
  remoteId: string,
  jobId: string,
): { key: string; source: EnrichmentSource } | null {
  for (const [key, entry] of inflight().entries()) {
    if (entry.remoteId === remoteId && entry.jobId === jobId) {
      return { key, source: entry.source };
    }
  }
  return null;
}

// batches query-invalidations per microtask so a burst of stream events
// only fires one invalidate per remote.
const pendingInvalidates = new Set<string>();
function scheduleInvalidate(remoteId: string) {
  if (pendingInvalidates.has(remoteId)) return;
  pendingInvalidates.add(remoteId);
  queueMicrotask(() => {
    for (const r of pendingInvalidates) {
      void queryClient.invalidateQueries({ queryKey: ["library-albums", r] });
    }
    pendingInvalidates.clear();
  });
}

function settleJob(
  remoteId: string,
  key: string,
  source: EnrichmentSource,
  outcome: "completed" | "failed",
  errorMessage: string | null,
): void {
  if (!inflight().has(key)) return; // already settled by a peer event
  const entry = inflight().get(key)!;
  console.log(
    "[job-events] settling job",
    entry.jobId,
    "outcome=",
    outcome,
    "remote=",
    remoteId,
  );
  const next = new Map(inflight());
  next.delete(key);
  setInflight(next);
  setStageByJobId((m) => {
    if (!m.has(entry.jobId)) return m;
    const n = new Map(m);
    n.delete(entry.jobId);
    return n;
  });

  setSession((s) => {
    const bySource = { ...s.bySource };
    bySource[source] = {
      ...bySource[source],
      completed: bySource[source].completed + (outcome === "completed" ? 1 : 0),
      failed: bySource[source].failed + (outcome === "failed" ? 1 : 0),
    };
    const nowActive = next.size > 0;
    return {
      ...s,
      bySource,
      completed: s.completed + (outcome === "completed" ? 1 : 0),
      failed: s.failed + (outcome === "failed" ? 1 : 0),
      isActive: nowActive,
      lastSettledAt: nowActive ? null : Date.now(),
      lastError:
        outcome === "failed" && errorMessage
          ? `${source}: ${errorMessage}`
          : s.lastError,
    };
  });

  scheduleInvalidate(remoteId);
  stopWatcherIfIdle(remoteId);
  scheduleSessionLinger();
}

function stopWatcherIfIdle(remoteId: string) {
  const stillRunning = [...inflight().values()].some((e) => e.remoteId === remoteId);
  if (stillRunning) return;
  const handle = pollers.get(remoteId);
  if (handle) {
    clearInterval(handle);
    pollers.delete(remoteId);
  }
  const stream = streams.get(remoteId);
  if (stream) {
    stream.controller.abort();
    streams.delete(remoteId);
  }
  remoteByRemoteId.delete(remoteId);
}

async function pollOnce(remote: RemoteRef): Promise<void> {
  const entries = [...inflight().entries()].filter(
    ([, e]) => e.remoteId === remote.remote_id,
  );
  if (entries.length === 0) {
    stopWatcherIfIdle(remote.remote_id);
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

  stopWatcherIfIdle(remote.remote_id);
  scheduleSessionLinger();
}
