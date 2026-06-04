import type { FreqholeClient } from "freqhole-api-client";
import { getClientForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";

import type { EnrichmentSource } from "./types";
import { inflight, inflightKey, setInflight, setSession } from "./state";
import { failSession, failSourceSession, startOrExtendSession } from "./session";
import { ensureWatcherForRemote } from "./watcher";

export interface EnrichResult {
  /** per-source job ids that were successfully enqueued. */
  jobIdsBySource: Record<EnrichmentSource, string[]>;
  /** per-source albums that were not enqueued (server skip + transport fail). */
  skippedBySource: Record<EnrichmentSource, string[]>;
}

type EnqueueResp = {
  success: boolean;
  data?: { job_ids: string[]; skipped_album_ids: string[] };
  error?: { message: string };
};

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
