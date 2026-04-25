// radio discovery: find stations available across known remotes + any
// peer addr we got from a query param. used by the /radio root view to
// build the station grid.

import {
  type PublicStation,
  type RadioStationsResponse,
} from "freqhole-api-client";
import { getClientForRemote, getLocalNodeIdAsync, isCharnelAvailable } from "../../api/client";
import type { Remote, RemoteRef } from "../../api/client";
import { isP2PRemote, isHttpRemote } from "../../services/storage/types";
import { getAllRemotes } from "../remotes/remoteManager";
import { getAllPendingRemotes } from "../storage/db";
import { debug, warn } from "../../../utils/logger";

interface DiscoverySourceState {
  failureCount: number;
  nextProbeAtMs: number;
  lastWarnAtMs: number;
}

interface SourceRunResult {
  stations: DiscoveredStation[];
  failed: boolean;
  reason?: string;
}

const sourceState = new Map<string, DiscoverySourceState>();
let lastDiscoverySnapshot: DiscoveredStation[] = [];
const SUCCESS_REPROBE_MS = 45_000;
const FAILURE_BACKOFF_BASE_MS = 30_000;
const FAILURE_BACKOFF_MAX_MS = 10 * 60_000;
const FAILURE_WARN_THROTTLE_MS = 120_000;

export interface DiscoveredStation extends PublicStation {
  /** the peer addr / base url to tune into. */
  source: SourceRef;
}

export interface SourceRef {
  kind: "remote" | "pending" | "query_param" | "self";
  /** remote_id when kind = "remote", peer_addr otherwise. for "self"
   * this is the local node_id (or "self" if unknown). */
  id: string;
  /** display name for grouping (server name when known). */
  label: string;
  /** peer_addr (P2P) or base_url (HTTP). undefined for "self" — the
   * tune path uses `radio_tune_local` IPC instead of dialing iroh. */
  peer_addr?: string;
  base_url?: string;
}

/**
 * call `/api/radio/stations` against every reachable source we know
 * about and return a flat list of stations with their source attached.
 *
 * silently skips sources that error or have radio disabled — the ui
 * doesn't need to show every failure here, just the stations that work.
 *
 * uses a two-phase sweep: every source races against a short
 * `quickTimeoutMs` deadline; whatever responds inside the window lands
 * in the first pass. sources that miss the window keep running for up
 * to `deepTimeoutMs` and stream their results through `onPartial` as
 * they arrive.
 */
export async function discoverStations(
  opts: {
    /** extra peer addrs from ?node_id query param, etc. */
    extraPeerAddrs?: string[];
    /**
     * fired after the first sweep settles and again every time a slow
     * source finally responds. callers can rebuild their station list
     * from the cumulative array on each call.
     */
    onPartial?: (stations: DiscoveredStation[]) => void;
    /** quick-pass timeout per source (default 1500ms). */
    quickTimeoutMs?: number;
    /** deep-pass timeout per source (default 8000ms). */
    deepTimeoutMs?: number;
    /** bypass per-source cooldown/backoff for this sweep (manual refresh). */
    forceProbeAll?: boolean;
  } = {},
): Promise<DiscoveredStation[]> {
  const quickTimeoutMs = opts.quickTimeoutMs ?? 1500;
  const deepTimeoutMs = opts.deepTimeoutMs ?? 8000;
  const forceProbeAll = opts.forceProbeAll ?? false;

  const sources = await collectSources(opts.extraPeerAddrs);
  const nowMs = Date.now();
  const activeSources: SourceRef[] = [];
  let coolingDownSources = 0;
  for (const src of sources) {
    const state = getSourceState(src);
    if (!forceProbeAll && state.nextProbeAtMs > nowMs) {
      coolingDownSources += 1;
      continue;
    }
    activeSources.push(src);
  }

  if (activeSources.length === 0) {
    debug(
      "radio-discovery",
      `sweep skipped: all ${sources.length} sources cooling down`,
    );
    return lastDiscoverySnapshot.slice();
  }

  if (forceProbeAll) {
    debug(
      "radio-discovery",
      `manual refresh forcing probe of all ${activeSources.length} sources (cooldown bypassed)`,
    );
  }

  // accumulator shared across both phases so onPartial sees every result.
  const cumulative: DiscoveredStation[] = [];
  const pushStations = (next: DiscoveredStation[]) => {
    if (next.length === 0) return;
    cumulative.push(...next);
    opts.onPartial?.(cumulative.slice());
  };

  // kick off every source once with the deep timeout. each task either
  // resolves with stations (or []) or rejects on timeout/error.
  const slowPromises = activeSources.map((src) =>
    runSource(src, deepTimeoutMs).then((result) => {
      const now = Date.now();
      updateSourceState(src, result, now);
      maybeWarnSourceFailure(src, result, now);
      return { src, result };
    }),
  );

  // wrap each slow promise with a quick-window race. winners of the
  // race land in the first onPartial call; losers come back later.
  const quickResults = await Promise.all(
    slowPromises.map((p) =>
      Promise.race<
        | { kind: "ready"; stations: DiscoveredStation[] }
        | { kind: "pending"; later: typeof p }
      >([
        p.then((r) => ({ kind: "ready" as const, stations: r.result.stations })),
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ kind: "pending" as const, later: p }),
            quickTimeoutMs,
          ),
        ),
      ]),
    ),
  );

  // first pass: collect everything that responded inside the quick window.
  const quickStations: DiscoveredStation[] = [];
  const slowOnes: typeof slowPromises = [];
  for (const r of quickResults) {
    if (r.kind === "ready") {
      quickStations.push(...r.stations);
    } else {
      slowOnes.push(r.later);
    }
  }
  pushStations(quickStations);

  if (slowOnes.length === 0) {
    return cumulative;
  }

  // second pass: stream slow ones in as they arrive. wait for all so the
  // returned promise represents "fully done".
  await Promise.all(
    slowOnes.map(async (p) => {
      const r = await p;
      pushStations(r.result.stations);
    }),
  );

  debug(
    "radio-discovery",
    `sweep complete: total=${sources.length} probed=${activeSources.length} cooldown=${coolingDownSources} stations=${cumulative.length}`,
  );
  lastDiscoverySnapshot = cumulative.slice();

  return cumulative;
}

async function collectSources(
  extraPeerAddrs: string[] | undefined,
): Promise<SourceRef[]> {
  const sources: SourceRef[] = [];

  // 0. self source (charnel only). lets the app discover + listen to
  // its own local broadcasters without dialing iroh (iroh refuses to
  // dial yourself). when radio is disabled locally the api call returns
  // enabled:false and the source contributes zero stations.
  if (isCharnelAvailable()) {
    const localNodeId = await getLocalNodeIdAsync().catch(() => null);
    sources.push({
      kind: "self",
      id: localNodeId ?? "self",
      label: "this device",
    });
  }

  // 1. all configured remotes (active or not — radio is read-only browsing).
  const remotes = await getAllRemotes();
  for (const r of remotes) {
    sources.push(remoteToSource(r));
  }

  // 2. pending remotes (still in setup flow but reachable).
  //
  // only scan stages where the peer can actually answer API calls. a
  // pending in `knock_pending` (waiting for approval) or `testing`
  // (mid-handshake) won't authenticate, so hitting it just spams the
  // remote and clogs the discovery log with `!success` noise. once the
  // knock is accepted on the other side the row flips to
  // `knock_accepted` / `connected` and gets picked up on the next pass.
  const pending = await getAllPendingRemotes();
  const allowedStages = new Set(["connected", "knock_accepted"]);
  for (const p of pending) {
    if (!allowedStages.has(p.stage)) continue;
    if (sources.some((s) => s.peer_addr === p.peer_addr || s.base_url === p.peer_addr)) {
      continue;
    }
    sources.push({
      kind: "pending",
      id: p.peer_addr,
      label: p.server_name ?? truncatedAddr(p.peer_addr),
      peer_addr: p.transport === "http" ? undefined : p.peer_addr,
      base_url: p.transport === "http" ? p.peer_addr : undefined,
    });
  }

  // 3. one-shot peer addrs from query string / deep link.
  for (const addr of extraPeerAddrs ?? []) {
    if (!addr) continue;
    if (sources.some((s) => s.peer_addr === addr || s.base_url === addr)) {
      continue;
    }
    sources.push({
      kind: "query_param",
      id: addr,
      label: truncatedAddr(addr),
      peer_addr: addr.startsWith("http") ? undefined : addr,
      base_url: addr.startsWith("http") ? addr : undefined,
    });
  }

  debug("radio-discovery", `collected ${sources.length} sources`);
  return sources;
}

async function runSource(
  src: SourceRef,
  timeoutMs: number,
): Promise<SourceRunResult> {
  return await Promise.race<SourceRunResult>([
    (async () => {
      try {
        const stations = await fetchStationsForSource(src);
        return {
          failed: false,
          stations: stations.map<DiscoveredStation>((s) => ({ ...s, source: src })),
        };
      } catch (e) {
        return {
          failed: true,
          reason: e instanceof Error ? e.message : String(e),
          stations: [],
        };
      }
    })(),
    new Promise<SourceRunResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            failed: true,
            reason: `timeout after ${timeoutMs}ms`,
            stations: [],
          }),
        timeoutMs,
      ),
    ),
  ]);
}

async function fetchStationsForSource(
  src: SourceRef,
): Promise<PublicStation[]> {
  // build a RemoteRef the api client can talk to without needing a
  // persisted remote row. "self" routes through the charnel-local
  // transport (in-process dispatch — no iroh, no http).
  const ref: RemoteRef = src.kind === "self"
    ? { transport: "http", is_charnel_managed: true }
    : src.base_url
    ? { transport: "http", base_url: src.base_url }
    : {
        transport: isCharnelAvailable() ? "app" : "wasm",
        peer_addr: src.peer_addr ?? src.id,
      };

  const client = await getClientForRemote(ref);
  const resp = await client.app.radioStations();
  if (!resp.success) {
    const errs = (resp as { errors?: Array<{ error_type?: string; detail?: string; title?: string }> }).errors;
    const first = errs?.[0];
    const message = first
      ? `error_type=${first.error_type ?? "?"} detail=${first.detail ?? first.title ?? "?"}`
      : `message=${(resp as { message?: string }).message ?? "?"}`;
    throw new Error(`api !success (${message})`);
  }
  if (!resp.data) {
    throw new Error("api returned no data");
  }
  const data = resp.data as RadioStationsResponse;
  return data.enabled ? data.stations : [];
}

function sourceKey(src: SourceRef): string {
  return `${src.kind}:${src.id}:${src.peer_addr ?? src.base_url ?? ""}`;
}

function getSourceState(src: SourceRef): DiscoverySourceState {
  const key = sourceKey(src);
  const existing = sourceState.get(key);
  if (existing) return existing;
  const fresh: DiscoverySourceState = {
    failureCount: 0,
    nextProbeAtMs: 0,
    lastWarnAtMs: 0,
  };
  sourceState.set(key, fresh);
  return fresh;
}

function updateSourceState(
  src: SourceRef,
  result: SourceRunResult,
  nowMs: number,
): void {
  const state = getSourceState(src);
  if (!result.failed) {
    state.failureCount = 0;
    state.nextProbeAtMs = nowMs + SUCCESS_REPROBE_MS;
    return;
  }
  state.failureCount += 1;
  const step = Math.min(state.failureCount - 1, 6);
  const backoff = Math.min(
    FAILURE_BACKOFF_MAX_MS,
    FAILURE_BACKOFF_BASE_MS * Math.pow(2, step),
  );
  state.nextProbeAtMs = nowMs + backoff;
}

function maybeWarnSourceFailure(
  src: SourceRef,
  result: SourceRunResult,
  nowMs: number,
): void {
  if (!result.failed) return;
  const state = getSourceState(src);
  if (nowMs - state.lastWarnAtMs < FAILURE_WARN_THROTTLE_MS) return;
  state.lastWarnAtMs = nowMs;
  warn(
    "radio-discovery",
    `[${src.kind}] ${src.label} failed (${result.reason ?? "unknown"}); retry in ${Math.max(0, state.nextProbeAtMs - nowMs)}ms`,
  );
}

function remoteToSource(r: Remote): SourceRef {
  if (isP2PRemote(r)) {
    return {
      kind: "remote",
      id: r.remote_id,
      label: r.name,
      peer_addr: r.peer_addr,
    };
  }
  if (isHttpRemote(r)) {
    return {
      kind: "remote",
      id: r.remote_id,
      label: r.name,
      base_url: r.base_url,
    };
  }
  // unreachable: Remote is a discriminated union between P2P and HTTP.
  // satisfy ts by treating it as opaque.
  const fallback = r as { remote_id?: string; name?: string };
  return {
    kind: "remote",
    id: fallback.remote_id ?? "unknown",
    label: fallback.name ?? "unknown",
  };
}

function truncatedAddr(addr: string): string {
  if (addr.length <= 18) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
