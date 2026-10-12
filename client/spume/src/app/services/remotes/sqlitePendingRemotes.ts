/**
 * sqlite-backed pending-remote registry (tauri only)
 *
 * thin wrapper around the single `pending_remotez_command` tauri command
 * defined in client/charnel/src-tauri/src/pending_remotez_commands.rs - a
 * tagged-enum command (mirrors `video_window_command`'s shape) instead of
 * one tauri command per operation, so this registers as exactly one
 * entry in `lib.rs`'s `invoke_handler!` and the ACL permissions file.
 *
 * mirrors sqliteRemotes.ts's exported shape exactly - see that file's doc
 * comment for the full rationale (shared state between spume and the
 * wizard admin app was the original motivation there; here it's
 * additionally what lets the federation accept loop recognize a peer
 * we're expecting a knock-accepted/device-linked callback from - see
 * grimoire::pending_remotez::is_pending_remote_peer). backed by the same
 * `remotez` sqlite table established remotes use, not a separate one -
 * see grimoire/src/pending_remotez/'s doc comment.
 *
 * pure-web spume builds do NOT call this module - they keep using
 * IndexedDB via storage/db.ts's own pending-remote functions, which branch
 * on `isCharnelMode()` to pick between this and the IDB store directly.
 */

import { isCharnelMode } from "../charnel/mode";
import type { PendingRemote } from "../storage/types";

// dynamically import tauri to allow tree-shaking in browser builds
async function getInvoke() {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

/** shape passed to the `create` sub-command. mirrors `CreatePendingRemoteRequest`. */
export type CreatePendingRemoteRequest = Omit<PendingRemote, "id" | "created_at" | "updated_at">;

/**
 * shape passed to the `update` sub-command. every field is optional -
 * only supplied fields are changed (mirrors `UpsertPendingRemoteRequest`'s
 * COALESCE-on-the-rust-side semantics, same convention `UpsertRemoteRequest`
 * already uses).
 */
export type UpdatePendingRemoteRequest = Partial<Omit<PendingRemote, "id" | "created_at">>;

// mirrors grimoire::pending_remotez::PendingRemoteCommand's `#[serde(tag =
// "kind", rename_all = "snake_case")]` shape exactly - field names here
// are NOT camelCase-converted by tauri the way top-level command
// parameters are, since this is a plain nested enum value (confirmed by
// how video_window_command's own callers pass fields like
// `start_seconds`, not `startSeconds`).
type PendingRemoteCommand =
  | { kind: "list" }
  | { kind: "get"; id: string }
  | { kind: "get_by_peer_addr"; peer_addr: string }
  | { kind: "create"; request: CreatePendingRemoteRequest }
  | { kind: "update"; id: string; request: UpdatePendingRemoteRequest }
  | { kind: "remove"; id: string }
  | { kind: "remove_by_peer_addr"; peer_addr: string };

async function dispatch<T>(command: PendingRemoteCommand): Promise<T> {
  const invoke = await getInvoke();
  return invoke<T>("pending_remotez_command", { command });
}

function ensureTauri(op: string): void {
  if (!isCharnelMode()) {
    throw new Error(`sqlitePendingRemotes.${op} called outside tauri context`);
  }
}

/** list all pending remotes from sqlite, ordered by updated_at desc */
export async function listPendingRemotes(): Promise<PendingRemote[]> {
  ensureTauri("listPendingRemotes");
  return dispatch({ kind: "list" });
}

/** fetch a single pending remote by id */
export async function getPendingRemote(id: string): Promise<PendingRemote | null> {
  ensureTauri("getPendingRemote");
  return dispatch({ kind: "get", id });
}

/** fetch a single pending remote by peer_addr */
export async function getPendingRemoteByPeerAddrSqlite(
  peerAddr: string
): Promise<PendingRemote | null> {
  ensureTauri("getPendingRemoteByPeerAddr");
  return dispatch({ kind: "get_by_peer_addr", peer_addr: peerAddr });
}

/** create a new pending remote with a fresh server-generated id */
export async function createPendingRemoteSqlite(
  request: CreatePendingRemoteRequest
): Promise<PendingRemote> {
  ensureTauri("createPendingRemote");
  return dispatch({ kind: "create", request });
}

/** update a pending remote. only supplied fields are changed. */
export async function updatePendingRemoteSqlite(
  id: string,
  request: UpdatePendingRemoteRequest
): Promise<PendingRemote | null> {
  ensureTauri("updatePendingRemote");
  return dispatch({ kind: "update", id, request });
}

/** delete a pending remote by id. returns true if a row was removed. */
export async function removePendingRemoteSqlite(id: string): Promise<boolean> {
  ensureTauri("removePendingRemote");
  return dispatch({ kind: "remove", id });
}

/** delete a pending remote by peer_addr. returns true if a row was removed. */
export async function removePendingRemoteByPeerAddrSqlite(peerAddr: string): Promise<boolean> {
  ensureTauri("removePendingRemoteByPeerAddr");
  return dispatch({ kind: "remove_by_peer_addr", peer_addr: peerAddr });
}
