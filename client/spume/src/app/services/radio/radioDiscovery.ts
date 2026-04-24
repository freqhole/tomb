// radio discovery: find stations available across known remotes + any
// peer addr we got from a query param. used by the /radio root view to
// build the station grid.

import {
  type PublicStation,
  type RadioStationsResponse,
} from "freqhole-api-client";
import { getClientForRemote, isCharnelAvailable } from "../../api/client";
import type { Remote, RemoteRef } from "../../api/client";
import { isP2PRemote, isHttpRemote } from "../../services/storage/types";
import { getAllRemotes } from "../remotes/remoteManager";
import { getAllPendingRemotes } from "../storage/db";

export interface DiscoveredStation extends PublicStation {
  /** the peer addr / base url to tune into. */
  source: SourceRef;
}

export interface SourceRef {
  kind: "remote" | "pending" | "query_param";
  /** remote_id when kind = "remote", peer_addr otherwise. */
  id: string;
  /** display name for grouping (server name when known). */
  label: string;
  /** peer_addr (P2P) or base_url (HTTP). */
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
  } = {},
): Promise<DiscoveredStation[]> {
  const quickTimeoutMs = opts.quickTimeoutMs ?? 1500;
  const deepTimeoutMs = opts.deepTimeoutMs ?? 8000;

  const sources = await collectSources(opts.extraPeerAddrs);

  // accumulator shared across both phases so onPartial sees every result.
  const cumulative: DiscoveredStation[] = [];
  const pushStations = (next: DiscoveredStation[]) => {
    if (next.length === 0) return;
    cumulative.push(...next);
    opts.onPartial?.(cumulative.slice());
  };

  // kick off every source once with the deep timeout. each task either
  // resolves with stations (or []) or rejects on timeout/error.
  const slowPromises = sources.map((src) =>
    runSource(src, deepTimeoutMs).then(
      (stations) => ({ src, stations, error: null as unknown }),
      (error) => ({ src, stations: [] as DiscoveredStation[], error }),
    ),
  );

  // wrap each slow promise with a quick-window race. winners of the
  // race land in the first onPartial call; losers come back later.
  const quickResults = await Promise.all(
    slowPromises.map((p) =>
      Promise.race<
        | { kind: "ready"; stations: DiscoveredStation[] }
        | { kind: "pending"; later: typeof p }
      >([
        p.then((r) => ({ kind: "ready" as const, stations: r.stations })),
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
      if (r.error) {
        console.warn(
          `[radio-discovery] slow source ${r.src.label} failed:`,
          r.error instanceof Error ? r.error.message : r.error,
        );
      }
      pushStations(r.stations);
    }),
  );

  return cumulative;
}

async function collectSources(
  extraPeerAddrs: string[] | undefined,
): Promise<SourceRef[]> {
  const sources: SourceRef[] = [];

  // 1. all configured remotes (active or not — radio is read-only browsing).
  const remotes = await getAllRemotes();
  for (const r of remotes) {
    sources.push(remoteToSource(r));
  }

  // 2. pending remotes (still in setup flow but reachable). includes any
  // ?node_id rows just inserted by the radio view.
  const pending = await getAllPendingRemotes();
  for (const p of pending) {
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

  return sources;
}

async function runSource(
  src: SourceRef,
  timeoutMs: number,
): Promise<DiscoveredStation[]> {
  return await Promise.race<DiscoveredStation[]>([
    (async () => {
      try {
        const stations = await fetchStationsForSource(src);
        return stations.map<DiscoveredStation>((s) => ({ ...s, source: src }));
      } catch (e) {
        console.warn(
          `[radio-discovery] source ${src.label} failed:`,
          e instanceof Error ? e.message : e,
        );
        return [];
      }
    })(),
    new Promise<DiscoveredStation[]>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

async function fetchStationsForSource(
  src: SourceRef,
): Promise<PublicStation[]> {
  // build a RemoteRef the api client can talk to without needing a
  // persisted remote row.
  const ref: RemoteRef = src.base_url
    ? { transport: "http", base_url: src.base_url }
    : {
        transport: isCharnelAvailable() ? "app" : "wasm",
        peer_addr: src.peer_addr ?? src.id,
      };

  const client = await getClientForRemote(ref);
  const resp = await client.app.radioStations();
  if (!resp.success || !resp.data) {
    return [];
  }
  const data = resp.data as RadioStationsResponse;
  return data.enabled ? data.stations : [];
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
