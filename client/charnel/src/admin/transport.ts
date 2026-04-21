// admin transport
//
// thin wrapper around the local tauri `admin_dispatch` command and (later,
// slice 5) the remote `freqhole-admin/1` ALPN bridge. exposes a typed
// `dispatch(command, args)` returning the standard grimoire response shape.
//
// see docs/wizard-remote-admin.md.

import { invoke } from "@tauri-apps/api/core";

/** rfc 9457-ish error envelope (mirrors grimoire ErrorDetail). */
export interface AdminErrorDetail {
  error_type: string;
  title: string;
  detail: string;
}

/** standard grimoire response shape returned by every admin command. */
export interface AdminResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: AdminErrorDetail[];
}

/** transport target. `local` calls into the in-process grimoire, `remote`
 * sends over the `freqhole-admin/1` ALPN to the given peer.
 *
 * `peerAddr` is either a plain 64-char node id or an endpoint json blob
 * (matches what `remotez.peer_addr` stores and what the rest of the P2P
 * client surface accepts).
 */
export type AdminTarget =
  | { kind: "local" }
  | { kind: "remote"; peerAddr: string };

/**
 * dispatch an admin command.
 *
 * for `kind: "local"` this calls the tauri `admin_dispatch` invoke handler.
 * for `kind: "remote"` this calls `admin_dispatch_remote` which routes the
 * request over the `freqhole-admin/1` ALPN to the named peer.
 */
export async function dispatch<T = unknown>(
  command: string,
  args: unknown = null,
  target: AdminTarget = { kind: "local" },
): Promise<AdminResponse<T>> {
  const raw =
    target.kind === "remote"
      ? await invoke<unknown>("admin_dispatch_remote", {
          peerAddr: target.peerAddr,
          command,
          args,
        })
      : await invoke<unknown>("admin_dispatch", {
          command,
          args,
        });

  // basic shape check; the rust side always returns this structure.
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as { success?: unknown }).success !== "boolean"
  ) {
    throw new Error(`admin_dispatch returned unexpected shape for ${command}`);
  }

  return raw as AdminResponse<T>;
}

/**
 * convenience: dispatch and unwrap data, throwing on failure with a useful
 * error message. use this when callers don't care about the structured
 * error_type and just want the data or an exception.
 */
export async function dispatchOrThrow<T = unknown>(
  command: string,
  args: unknown = null,
  target: AdminTarget = { kind: "local" },
): Promise<T> {
  const response = await dispatch<T>(command, args, target);
  if (!response.success) {
    const errType = response.errors?.[0]?.error_type;
    const detail = response.errors?.[0]?.detail ?? response.message;
    throw new Error(errType ? `${errType}: ${detail}` : detail);
  }
  if (response.data === undefined) {
    throw new Error(`admin_dispatch ${command} returned no data`);
  }
  return response.data;
}
