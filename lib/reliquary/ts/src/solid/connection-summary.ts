// a small reactive summary over a connection/transfer source's live state,
// refreshed on a fixed poll interval.
//
// the "source" is any object exposing a synchronous `getConnectionSummary()`
// - typically a network adapter - so this module has no dependency on any
// particular adapter implementation or transport.

import { createSignal, onCleanup, type Accessor } from "solid-js";

/** counts describing a network adapter's current peer connections. */
export interface ConnectionSummaryLike {
  /** number of peers actively connected. */
  connected: number;
  /** number of peers currently reconnecting (in backoff). */
  reconnecting: number;
  /** number of peers whose reconnection attempts gave up. */
  failed: number;
}

const EMPTY_SUMMARY: ConnectionSummaryLike = { connected: 0, reconnecting: 0, failed: 0 };

export interface CreateConnectionSummaryOptions {
  /** how often to re-read the source, in ms. default 2000. */
  pollIntervalMs?: number;
}

/**
 * polls `getSource()` on an interval and exposes the result as a reactive
 * signal. `getSource` may return `null` (adapter not constructed/ready
 * yet) - the summary then stays at its last known value. the poll is
 * cleared automatically via `onCleanup` when the owning computation is
 * disposed.
 */
export function createConnectionSummary(
  getSource: () => { getConnectionSummary(): ConnectionSummaryLike } | null,
  options: CreateConnectionSummaryOptions = {}
): Accessor<ConnectionSummaryLike> {
  const [summary, setSummary] = createSignal<ConnectionSummaryLike>(EMPTY_SUMMARY);
  const pollIntervalMs = options.pollIntervalMs ?? 2000;

  function refresh(): void {
    const source = getSource();
    if (!source) return;
    setSummary(source.getConnectionSummary());
  }

  refresh();
  const timer = setInterval(refresh, pollIntervalMs);
  onCleanup(() => clearInterval(timer));

  return summary;
}
