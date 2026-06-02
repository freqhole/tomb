import type { FreqholeClient } from "freqhole-api-client";
import { JobEventsStreamClosed } from "freqhole-api-client";
import type { EventFilter, JobEvent } from "freqhole-api-client";
import { getClientForRemote } from "../../../app/api/client";
import { queryClient } from "../../../queryClient";
import { debug } from "../../../utils/logger";

import {
  ENRICHMENT_SOURCES,
  POLL_INTERVAL_FALLBACK_MS,
  POLL_INTERVAL_STREAM_MS,
  RECONNECT_BACKOFF_MS,
  SUBSCRIBED_KINDS,
  TERMINAL_STATUSES,
  TERMINAL_STATUSES_WIRE,
  TOPIC_TO_SOURCE,
  type EnrichmentSource,
  type RemoteRef,
  type StreamState,
} from "./types";
import {
  inflight,
  inflightKey,
  pollers,
  remoteByRemoteId,
  setInflight,
  setStageByJobId,
  setSession,
  streams,
} from "./state";
import { scheduleSessionLinger } from "./session";

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

export function ensureWatcherForRemote(remote: RemoteRef) {
  debug(
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
      debug(
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
      debug(
        "[job-events] subscribe iterator ended cleanly for",
        remote.remote_id,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof JobEventsStreamClosed) {
        debug(
          "[job-events] stream closed for",
          remote.remote_id,
          "reason=",
          (err as { reason?: string }).reason ?? "unknown",
        );
        // lagged / unauthorized / internal — re-snapshot + reconnect on
        // the next loop iteration.
      } else {
        debug(
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
  debug(
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
  debug(
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
  debug(
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
  debug(
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
