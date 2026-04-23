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
 */
export async function discoverStations(opts: {
  /** extra peer addrs from ?node_id query param, etc. */
  extraPeerAddrs?: string[];
} = {}): Promise<DiscoveredStation[]> {
  const sources: SourceRef[] = [];

  // 1. all configured remotes (active or not — radio is read-only browsing).
  const remotes = await getAllRemotes();
  for (const r of remotes) {
    sources.push(remoteToSource(r));
  }

  // 2. pending remotes (still in setup flow but reachable).
  const pending = await getAllPendingRemotes();
  for (const p of pending) {
    if (sources.some((s) => s.peer_addr === p.peer_addr)) continue;
    sources.push({
      kind: "pending",
      id: p.peer_addr,
      label: p.server_name ?? truncatedAddr(p.peer_addr),
      peer_addr: p.transport === "http" ? undefined : p.peer_addr,
      base_url: p.transport === "http" ? p.peer_addr : undefined,
    });
  }

  // 3. one-shot peer addrs from query string / deep link.
  for (const addr of opts.extraPeerAddrs ?? []) {
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

  // fan out: hit each source in parallel, swallow individual errors.
  const results = await Promise.all(
    sources.map(async (src) => {
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
    }),
  );
  return results.flat();
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
