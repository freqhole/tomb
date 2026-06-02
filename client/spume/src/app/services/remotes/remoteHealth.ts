// remoteHealth — single-source surface for "is this remote online?" with
// dedupe, per-remote backoff, and a reactive accessor for ui.
//
// rationale: prior to this module, every caller that wanted to "wake up"
// or check a remote either reached for `checkRemoteHealth` directly (no
// dedupe), or hand-rolled its own offline-detection loop, or relied on
// the implicit auto-mark in `remoteSource`'s `handleFailedRequest` /
// `handleSuccessfulRequest`. that produced redundant pings, no backoff
// for hard-down remotes, and no shared signal for components to react.
//
// see docs/explore-search-and-fixes-plan.md (t-D).

import { createSignal } from "solid-js";
import type { Remote } from "../storage/schemas/remote";
import {
  checkRemoteHealth,
  getAllRemotes,
  onRemoteStatusChange,
} from "./remoteManager";

// ---- backoff schedule -------------------------------------------------------
// after N consecutive failures, wait this many ms before the next probe.
// uncapped attempts past the array length use the final entry. local
// charnel-managed remotes bypass backoff entirely.
const BACKOFF_MS: number[] = [
  0, // first attempt: immediate
  2_000, // 2s
  5_000, // 5s
  15_000, // 15s
  30_000, // 30s
  60_000, // 60s
  300_000, // 5m
];

interface BackoffEntry {
  failures: number;
  // next time (ms epoch) at which a probe is allowed
  nextProbeAt: number;
}

const backoff = new Map<string, BackoffEntry>();
const inFlight = new Map<string, Promise<boolean>>();

function nextDelayFor(failures: number): number {
  if (failures <= 0) return 0;
  const idx = Math.min(failures, BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

function recordSuccess(remoteId: string): void {
  backoff.delete(remoteId);
}

function recordFailure(remoteId: string): void {
  const existing = backoff.get(remoteId);
  const failures = (existing?.failures ?? 0) + 1;
  backoff.set(remoteId, {
    failures,
    nextProbeAt: Date.now() + nextDelayFor(failures),
  });
}

/** how long (ms) until the next probe is allowed; 0 means "now". */
export function timeUntilNextProbe(remoteId: string): number {
  const entry = backoff.get(remoteId);
  if (!entry) return 0;
  return Math.max(0, entry.nextProbeAt - Date.now());
}

// ---- reactive online map ----------------------------------------------------
// updated reactively via `onRemoteStatusChange`. components can read
// `isOnline(remoteId)()` to subscribe.

const [onlineMap, setOnlineMap] = createSignal<Map<string, boolean>>(new Map());

// seed and keep the map fresh from the remote status broadcast.
onRemoteStatusChange((remoteId, isOffline) => {
  setOnlineMap((prev) => {
    const next = new Map(prev);
    next.set(remoteId, !isOffline);
    return next;
  });
});

/**
 * reactive accessor: returns `true` when the remote is known online,
 * `false` when known offline, `undefined` when status is not yet known.
 */
export function isOnline(remoteId: string): () => boolean | undefined {
  return () => onlineMap().get(remoteId);
}

/** non-reactive snapshot. */
export function isOnlineNow(remoteId: string): boolean | undefined {
  return onlineMap().get(remoteId);
}

/**
 * seed the reactive map from `getAllRemotes`. safe to call multiple times;
 * later updates flow in via `onRemoteStatusChange`.
 */
export async function seedOnlineMap(): Promise<void> {
  try {
    const all = await getAllRemotes();
    setOnlineMap(
      new Map(all.map((r) => [r.remote_id, r.is_offline !== true]))
    );
  } catch {
    // best-effort seed; reactive updates still work.
  }
}

// ---- public api -------------------------------------------------------------

/**
 * probe a remote's health with dedupe + backoff.
 *
 * - concurrent callers for the same remote share the same probe promise.
 * - if the remote is in a backoff window, returns the last known state
 *   without probing.
 * - `force` skips the backoff gate (use for explicit "retry now" buttons).
 *
 * returns `true` if online (or just came online), `false` otherwise.
 */
export async function probeRemote(
  remote: Remote,
  options: { force?: boolean } = {}
): Promise<boolean> {
  const id = remote.remote_id;

  // local charnel-managed is always reachable in-process.
  if (remote.is_charnel_managed) {
    setOnlineMap((prev) => {
      if (prev.get(id) === true) return prev;
      const next = new Map(prev);
      next.set(id, true);
      return next;
    });
    return true;
  }

  // dedupe: existing in-flight probe wins.
  const existing = inFlight.get(id);
  if (existing) return existing;

  // backoff gate (skipped when forced).
  if (!options.force && timeUntilNextProbe(id) > 0) {
    return isOnlineNow(id) === true;
  }

  const p = (async () => {
    try {
      const online = await checkRemoteHealth(remote);
      if (online) recordSuccess(id);
      else recordFailure(id);
      return online;
    } catch {
      recordFailure(id);
      return false;
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, p);
  return p;
}

/**
 * fire-and-forget wake-up across every offline remote (skipping any in a
 * backoff window). returns immediately; results flow in via the reactive
 * `isOnline` accessor as each probe resolves.
 *
 * `force` propagates to every probe and bypasses backoff.
 */
export function wakeAllRemotes(options: { force?: boolean } = {}): void {
  void (async () => {
    let all: Remote[];
    try {
      all = await getAllRemotes();
    } catch {
      return;
    }
    for (const r of all) {
      if (r.is_charnel_managed) continue;
      if (r.is_offline !== true) continue;
      // probeRemote handles its own backoff + dedupe.
      void probeRemote(r, options);
    }
  })();
}
