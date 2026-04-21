/**
 * sqlite-backed remote registry (tauri only)
 *
 * thin wrapper around the `remotez_*` tauri commands defined in
 * client/charnel/src-tauri/src/remotez_commands.rs.
 *
 * the sqlite `remotez` table is shared between the spume player and the
 * wizard admin app. pure-web spume builds do NOT call this module — they
 * keep using IndexedDB via remoteManager.ts.
 *
 * see docs/wizard-remote-admin.md for the full plan.
 */

import { isCharnelMode } from "../charnel/mode";
import type { Remote } from "../storage/schemas/remote";

// dynamically import tauri to allow tree-shaking in browser builds
async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

/**
 * shape passed to remotez_upsert. caller-supplied fields only;
 * created_at / updated_at are managed by the repository.
 */
export interface UpsertRemoteRequest {
  remote_id: string;
  name: string;
  transport: "http" | "wasm" | "app";
  base_url?: string | null;
  peer_addr?: string | null;
  api_key?: string | null;
  is_active?: boolean | null;
  is_charnel_managed?: boolean | null;
  last_connected_at?: number | null;
  description?: string | null;
  image_url?: string | null;
  image_blob_id?: string | null;
  version?: string | null;
  last_info_check?: number | null;
  is_offline?: boolean | null;
  offline_since?: number | null;
  last_checked?: number | null;
  metadata?: string | null;
}

function ensureTauri(op: string): void {
  if (!isCharnelMode()) {
    throw new Error(`sqliteRemotes.${op} called outside tauri context`);
  }
}

/** list all remotes from sqlite, ordered by updated_at desc */
export async function listRemotes(): Promise<Remote[]> {
  ensureTauri("listRemotes");
  const invoke = await getInvoke();
  return (await invoke("remotez_list")) as Remote[];
}

/** fetch a single remote by id */
export async function getRemote(remoteId: string): Promise<Remote | null> {
  ensureTauri("getRemote");
  const invoke = await getInvoke();
  return (await invoke("remotez_get", { remoteId })) as Remote | null;
}

/** fetch a single remote by peer_addr (P2P node id or json endpoint) */
export async function getRemoteByPeerAddr(peerAddr: string): Promise<Remote | null> {
  ensureTauri("getRemoteByPeerAddr");
  const invoke = await getInvoke();
  return (await invoke("remotez_get_by_peer_addr", { peerAddr })) as Remote | null;
}

/** insert or update a remote */
export async function upsertRemote(request: UpsertRemoteRequest): Promise<Remote> {
  ensureTauri("upsertRemote");
  const invoke = await getInvoke();
  return (await invoke("remotez_upsert", { request })) as Remote;
}

/** delete a remote by id. returns true if a row was removed. */
export async function removeRemote(remoteId: string): Promise<boolean> {
  ensureTauri("removeRemote");
  const invoke = await getInvoke();
  return (await invoke("remotez_remove", { remoteId })) as boolean;
}

/**
 * mark a remote as active. clears is_active on all other rows so at most
 * one remote is active at a time.
 */
export async function markRemoteActive(remoteId: string): Promise<void> {
  ensureTauri("markRemoteActive");
  const invoke = await getInvoke();
  await invoke("remotez_mark_active", { remoteId });
}
