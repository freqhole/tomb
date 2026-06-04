import type { RemoteLike } from "../../../app/api/client";

// any caller-supplied object that exposes a stable remote_id and is
// compatible with the api-client factory. accepts both the full storage
// `Remote` row and the lighter `CurrentRemoteInfo` record used by the
// header/session signals.
export type RemoteRef = RemoteLike & { remote_id: string };

// stream-healthy poll cadence: just a drift-check / safety net. when
// the live subscribe stream is delivering events, the poll loop only
// needs to catch the occasional missed terminal state (e.g. event
// dropped due to broadcast lag and re-snapshot fallback).
export const POLL_INTERVAL_STREAM_MS = 60_000;
// stream-down poll cadence: same shape as the legacy 1.5s loop, slightly
// looser so we don't hammer the server while the iroh/ipc channel is
// reconnecting.
export const POLL_INTERVAL_FALLBACK_MS = 3_000;
export const TERMINAL_STATUSES = new Set(["Completed", "Failed", "Cancelled"]);
// snake_case mirror so we can compare against `StatusChanged.to` /
// snapshot `status` fields which are now serialized snake_case.
export const TERMINAL_STATUSES_WIRE = new Set(["completed", "failed", "cancelled"]);
// reconnect backoff schedule for the subscribe stream. capped at 10s.
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];
// how long the session strip lingers after the last job settles before
// fading out. gives the user a chance to see the final tally.
export const SESSION_SETTLE_LINGER_MS = 6000;

export type EnrichmentSource = "mb" | "lastfm" | "audiodb";
export const ENRICHMENT_SOURCES: EnrichmentSource[] = ["mb", "lastfm", "audiodb"];

// job-event topic -> enrichment source. only these three topics are of
// interest to this hook; any other topic on the broker is ignored.
export const TOPIC_TO_SOURCE: Record<string, EnrichmentSource> = {
  MbAlbumSearch: "mb",
  LastFmAlbumDetail: "lastfm",
  AudioDbAlbumDetail: "audiodb",
};
// keep this literal-typed so the `EventFilter.kinds` array stays a
// narrow union of `JobType` rather than widening to `string[]`.
export const SUBSCRIBED_KINDS = [
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

export const EMPTY_COUNTS = (): SourceCounts => ({
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

export const EMPTY_SESSION = (): MbSessionState => ({
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

// per-remote subscribe state: AbortController to tear down the iterator,
// current backoff index, current health.
export type StreamState = {
  controller: AbortController;
  backoffIdx: number;
  health: "connecting" | "healthy" | "down";
};
