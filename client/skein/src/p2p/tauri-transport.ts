/**
 * tauri transport bridge for skein P2P.
 *
 * replaces midden WASM in Tauri builds — routes all P2P operations through
 * the single `skein_dispatch` Tauri command. the Rust side manages iroh
 * streams via handle IDs, using the same 4-byte length-delimited framing
 * as midden.
 *
 * usage:
 *   const node = await TauriStreamNode.create();
 *   const stream = await node.open_bi(peerId, "freqhole-friendz/1");
 *   await stream.write_message(data);
 *   const msg = await stream.read_message();
 */

import type { BiStreamLike, MiddenStreamNode } from "./iroh-network-adapter";

const TAG = "[tauri-transport]";

// ---------------------------------------------------------------------------
// tauri bridge helpers
// ---------------------------------------------------------------------------

/** detect if we're running inside a Tauri webview */
export function isTauriMode(): boolean {
  return (
    typeof window !== "undefined" &&
    // @ts-expect-error __TAURI_INTERNALS__ is injected by tauri runtime
    typeof window.__TAURI_INTERNALS__?.invoke === "function"
  );
}

/**
 * invoke the skein_dispatch command on the Rust side.
 * lazily imports @tauri-apps/api/core so the module can be parsed
 * even when Tauri is not present (the stub will throw at runtime).
 */
async function dispatch(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  // dynamic import so the module graph doesn't fail in non-Tauri builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("skein_dispatch", { action, payload });
}

// ---------------------------------------------------------------------------
// base64 helpers (browser-native, no dependencies)
// ---------------------------------------------------------------------------

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// TauriBiStream — replaces midden BiStream
// ---------------------------------------------------------------------------

/**
 * a bidirectional QUIC stream backed by a Rust-side handle.
 * all read/write operations are dispatched through the Tauri IPC bridge.
 */
export class TauriBiStream implements BiStreamLike {
  private handle: number;
  private _peerNodeId: string;
  private _alpn: string;
  private closed = false;

  constructor(handle: number, peerNodeId: string, alpn: string) {
    this.handle = handle;
    this._peerNodeId = peerNodeId;
    this._alpn = alpn;
  }

  peer_node_id(): string {
    return this._peerNodeId;
  }

  alpn(): string {
    return this._alpn;
  }

  async write_message(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("stream closed");
    await dispatch("write_message", {
      handle: this.handle,
      data: toBase64(data),
    });
  }

  async read_message(): Promise<Uint8Array | null> {
    if (this.closed) return null;
    const result = await dispatch("read_message", { handle: this.handle });
    if (result.data === null || result.data === undefined) {
      return null;
    }
    return fromBase64(result.data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // fire-and-forget — don't block the caller
    dispatch("close_stream", { handle: this.handle }).catch((err) => {
      console.warn(TAG, "close_stream error (handle", this.handle, "):", err);
    });
  }
}

// ---------------------------------------------------------------------------
// TauriStreamNode — replaces midden MiddenNode
// ---------------------------------------------------------------------------

/**
 * stream node backed by the Tauri app's iroh endpoint.
 * uses the existing federation endpoint managed by grimoire —
 * no separate keypair or endpoint creation needed.
 */
export class TauriStreamNode implements MiddenStreamNode {
  private _nodeId: string;

  private constructor(nodeId: string) {
    this._nodeId = nodeId;
  }

  /** create a TauriStreamNode using the running iroh endpoint's identity */
  static async create(): Promise<TauriStreamNode> {
    const result = await dispatch("get_node_id");
    console.log(TAG, "node ID:", result.node_id.slice(0, 16) + "...");
    return new TauriStreamNode(result.node_id);
  }

  node_id(): string {
    return this._nodeId;
  }

  async open_bi(peer_addr: string, alpn: string): Promise<TauriBiStream> {
    const result = await dispatch("open_bi", { peer_addr, alpn });
    console.log(
      TAG,
      "opened stream to",
      result.peer_node_id.slice(0, 16) + "...",
      "on",
      alpn,
      "(handle:",
      result.handle,
      ")"
    );
    return new TauriBiStream(result.handle, result.peer_node_id, alpn);
  }

  async accept(): Promise<BiStreamLike | null> {
    try {
      const result = await dispatch("accept_stream");
      if (result.handle === null || result.handle === undefined) {
        // channel closed or not configured — no more incoming streams
        return null;
      }
      console.log(
        TAG,
        "accepted incoming stream from",
        (result.peer_node_id as string).slice(0, 16) + "...",
        "on",
        result.alpn,
        "(handle:",
        result.handle,
        ")"
      );
      return new TauriBiStream(result.handle, result.peer_node_id, result.alpn);
    } catch (err) {
      console.error(TAG, "accept_stream failed:", err);
      return null;
    }
  }
}
