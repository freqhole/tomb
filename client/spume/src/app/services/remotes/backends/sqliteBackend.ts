// sqlite-backed remote storage via tauri commands. wraps the thin
// `sqliteRemotes` module and normalizes between sqlite's nullable shape and
// spume's discriminated-union Remote type.

import {
  listRemotes as sqliteListRemotes,
  getRemote as sqliteGetRemote,
  getRemoteByPeerAddr as sqliteGetRemoteByPeerAddr,
  upsertRemote as sqliteUpsertRemote,
  removeRemote as sqliteRemoveRemote,
  markRemoteActive as sqliteMarkRemoteActive,
  type UpsertRemoteRequest,
} from "../sqliteRemotes";
import {
  type Remote,
  type HttpRemote,
  type P2PRemote,
  isP2PRemote,
} from "../../storage/types";
import type { RemoteBackend } from "./types";

// sqlite returns nullable peer_addr/base_url; spume's discriminated union
// uses transport as the tag. normalize a row coming back from sqlite.
function normalize(raw: Record<string, unknown>): Remote {
  const transport = raw.transport as "http" | "wasm" | "app";
  const common = {
    remote_id: raw.remote_id as string,
    name: raw.name as string,
    is_active: !!raw.is_active,
    last_connected_at: (raw.last_connected_at as number | null) ?? null,
    created_at: raw.created_at as number,
    updated_at: raw.updated_at as number,
    description: (raw.description as string | null) ?? null,
    image_url: (raw.image_url as string | null) ?? null,
    image_blob_id: (raw.image_blob_id as string | null) ?? null,
    version: (raw.version as string | null) ?? null,
    last_info_check: (raw.last_info_check as number | null) ?? null,
    api_key: (raw.api_key as string | null) ?? undefined,
    is_charnel_managed: !!raw.is_charnel_managed,
    is_offline: (raw.is_offline as boolean | null) ?? undefined,
    offline_since: (raw.offline_since as number | null) ?? null,
    last_checked: (raw.last_checked as number | null) ?? null,
  };
  if (transport === "http") {
    return {
      ...common,
      transport: "http",
      base_url: (raw.base_url as string | null) ?? undefined,
    } as HttpRemote;
  }
  return {
    ...common,
    transport,
    peer_addr: (raw.peer_addr as string | null) ?? "",
    base_url: (raw.base_url as string | null) ?? undefined,
  } as P2PRemote;
}

// build the upsert request the rust side expects from a full Remote.
function toUpsertRequest(remote: Remote): UpsertRemoteRequest {
  const peerAddr = isP2PRemote(remote) ? remote.peer_addr : null;
  return {
    remote_id: remote.remote_id,
    name: remote.name,
    transport: remote.transport,
    base_url: remote.base_url ?? null,
    peer_addr: peerAddr ?? null,
    api_key: remote.api_key ?? null,
    is_active: remote.is_active,
    is_charnel_managed: remote.is_charnel_managed ?? false,
    last_connected_at: remote.last_connected_at,
    description: remote.description,
    image_url: remote.image_url,
    image_blob_id: remote.image_blob_id,
    version: remote.version,
    last_info_check: remote.last_info_check,
    is_offline: remote.is_offline ?? null,
    offline_since: remote.offline_since ?? null,
    last_checked: remote.last_checked ?? null,
    metadata: null,
  };
}

async function list(): Promise<Remote[]> {
  const rows = (await sqliteListRemotes()) as unknown as Record<
    string,
    unknown
  >[];
  return rows.map(normalize);
}

async function get(remoteId: string): Promise<Remote | undefined> {
  const row = await sqliteGetRemote(remoteId);
  return row
    ? normalize(row as unknown as Record<string, unknown>)
    : undefined;
}

async function getByPeerAddr(peerAddr: string): Promise<Remote | undefined> {
  // try direct lookup first (handles the exact-match case cheaply)
  const direct = await sqliteGetRemoteByPeerAddr(peerAddr);
  if (direct) {
    return normalize(direct as unknown as Record<string, unknown>);
  }
  // fall back to scanning for substring matches between node_id and JSON
  // endpoint forms — same logic the IDB backend uses
  const all = await list();
  for (const remote of all) {
    if (!isP2PRemote(remote)) continue;
    if (remote.peer_addr === peerAddr) return remote;
    if (
      /^[a-f0-9]{64}$/i.test(peerAddr) &&
      remote.peer_addr.includes(peerAddr)
    ) {
      return remote;
    }
    if (
      /^[a-f0-9]{64}$/i.test(remote.peer_addr) &&
      peerAddr.includes(remote.peer_addr)
    ) {
      return remote;
    }
  }
  return undefined;
}

async function put(remote: Remote): Promise<void> {
  await sqliteUpsertRemote(toUpsertRequest(remote));
}

async function remove(remoteId: string): Promise<void> {
  await sqliteRemoveRemote(remoteId);
}

async function markActive(remoteId: string): Promise<void> {
  // sqlite handles the "clear all others" in one shot; bump the active row's
  // last_connected_at to mirror the IDB backend
  await sqliteMarkRemoteActive(remoteId);
  const row = await get(remoteId);
  if (row) {
    await put({
      ...row,
      is_active: true,
      last_connected_at: Date.now(),
      updated_at: Date.now(),
    });
  }
}

export const sqliteBackend: RemoteBackend = {
  list,
  get,
  getByPeerAddr,
  put,
  remove,
  markActive,
};
