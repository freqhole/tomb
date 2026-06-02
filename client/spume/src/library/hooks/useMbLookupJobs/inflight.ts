import type { EnrichmentSource, InflightEntry, RemoteRef } from "./types";
import {
  inflight,
  inflightKey,
  setInflight,
  stageByJobId,
} from "./state";
import { ensureWatcherForRemote } from "./watcher";

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
