// admin client factory for the freqhole-admin/1 ALPN.
//
// dispatches via:
// - midden `proxy_admin` for browser P2P remotes
// - tauri `admin_dispatch_remote` invoke for charnel desktop builds
//
// HTTP-only remotes are rejected: admin commands are P2P-only by design.
//
// see docs/spume-remote-admin-plan.md.

import {
  AdminClient,
  type AdminTransport,
  type AdminResponse,
} from "freqhole-api-client";
import type { Remote } from "../services/storage/schemas/remote";
import { isP2PRemote } from "../services/storage/schemas/remote";
import { isCharnelMode } from "../services/charnel";
import { getMiddenNode } from "./client";

/** wasm transport: routes through midden's `proxy_admin` */
class WasmAdminTransport implements AdminTransport {
  constructor(private readonly peerAddr: string) {}

  async send(command: string, args: unknown): Promise<AdminResponse<unknown>> {
    const node = await getMiddenNode();
    if (typeof node.proxy_admin !== "function") {
      throw new Error(
        "midden node missing proxy_admin - rebuild midden wasm (cd skein/midden && make build)",
      );
    }
    const argsJson = args === undefined || args === null ? "null" : JSON.stringify(args);
    console.debug("[admin-p2p] wasm send", { peer: this.peerAddr, command, argsJson });
    const raw = await node.proxy_admin(this.peerAddr, command, argsJson);
    console.debug("[admin-p2p] wasm recv", { command, raw });
    return coerceEnvelope(raw, command);
  }
}

/** charnel transport: routes through tauri `admin_dispatch_remote` */
class CharnelAdminTransport implements AdminTransport {
  constructor(private readonly peerAddr: string) {}

  async send(command: string, args: unknown): Promise<AdminResponse<unknown>> {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<unknown>("admin_dispatch_remote", {
      peerAddr: this.peerAddr,
      command,
      args: args ?? null,
    });
    return coerceEnvelope(raw, command);
  }
}

function coerceEnvelope(raw: unknown, command: string): AdminResponse<unknown> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { success?: unknown }).success !== "boolean"
  ) {
    console.error(
      `[admin-p2p] coerceEnvelope: unexpected shape for ${command}`,
      {
        command,
        raw,
        rawType: typeof raw,
        isMap: raw instanceof Map,
        keys:
          raw && typeof raw === "object"
            ? Object.keys(raw as object)
            : undefined,
      },
    );
    throw new Error(
      `admin transport returned unexpected shape for ${command}`,
    );
  }
  return raw as AdminResponse<unknown>;
}

/**
 * build an `AdminClient` for the given remote.
 *
 * throws if the remote is HTTP-only — admin is gated to P2P remotes since
 * the charnel-managed identity backs the federation auth check on the far
 * side.
 */
export async function adminClientFor(remote: Remote): Promise<AdminClient> {
  if (!isP2PRemote(remote)) {
    throw new Error(
      "admin commands require a P2P remote (peer_addr). HTTP-only remotes are not supported.",
    );
  }

  const peerAddr = remote.peer_addr;
  const transport: AdminTransport = isCharnelMode()
    ? new CharnelAdminTransport(peerAddr)
    : new WasmAdminTransport(peerAddr);

  return new AdminClient(transport);
}

/**
 * untyped escape hatch for admin commands not yet in the typed registry
 * (e.g. `users_list`). returns the raw `data` on success, throws an Error
 * with the envelope's message/error_type on failure.
 *
 * prefer `adminClientFor(...).dispatchOrThrow(...)` when the command is
 * registered — only use this when you need a command that hasn't been
 * promoted to the typed surface yet.
 */
export async function adminRawDispatch<T = unknown>(
  remote: Remote,
  command: string,
  args: unknown = null,
): Promise<T> {
  if (!isP2PRemote(remote)) {
    throw new Error(
      "admin commands require a P2P remote (peer_addr). HTTP-only remotes are not supported.",
    );
  }
  const transport: AdminTransport = isCharnelMode()
    ? new CharnelAdminTransport(remote.peer_addr)
    : new WasmAdminTransport(remote.peer_addr);
  const envelope = await transport.send(command, args);
  if (!envelope.success) {
    const detail =
      envelope.errors?.[0]?.detail ??
      envelope.message ??
      `admin ${command} failed`;
    const errType = envelope.errors?.[0]?.error_type;
    throw new Error(errType ? `${errType}: ${detail}` : detail);
  }
  return envelope.data as T;
}
