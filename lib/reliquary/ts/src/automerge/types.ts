// shared shapes for ./automerge: the structural transport surface this
// subpath needs from a midden-shaped node speaking iroh bidirectional
// streams, plus the adapter's own construction options and ui-facing
// state summaries.
//
// like ./transfer, this subpath never imports midden at runtime - only
// structural types matching its snake_case surface, so any node-shaped
// object (a real wasm node, a worker-backed facade, a test double) works
// the same way.

/**
 * minimal interface for a midden BiStream: a QUIC bidirectional stream
 * exposing automerge-repo's length-delimited message framing, plus raw
 * (unframed) reads/writes for protocols that terminate a stream without
 * a length prefix instead.
 */
export interface BiStreamLike {
  peer_node_id(): string;
  alpn(): string;
  write_message(data: Uint8Array): Promise<void>;
  /** resolves to null when the stream is closed. */
  read_message(): Promise<Uint8Array | null>;
  close(): void;
  /** raw framing (no length prefix) - used by protocols layered on top of
   *  the sync ALPN via `registerAlpnHandler`. optional because not every
   *  BiStream implementation supports it. */
  read_to_end?(max_size: number): Promise<Uint8Array>;
  write_raw_and_finish?(data: Uint8Array): Promise<void>;
}

/**
 * midden node interface exposing the raw bidirectional-stream apis this
 * adapter needs: dialing a peer (`open_bi`) and accepting inbound streams
 * (`accept`).
 */
export interface MiddenStreamNode {
  node_id(): string;
  open_bi(peer_addr: string, alpn: string): Promise<BiStreamLike>;
  accept(): Promise<BiStreamLike | null>;
}

/** the iroh endpoint's lifecycle state, for ui display. */
export type EndpointState = "off" | "starting" | "online" | "error";

/** summary of the adapter's connection state, for ui display. */
export interface ConnectionSummary {
  /** number of peers we're actively connected to (stream is open). */
  connected: number;
  /** number of peers we're trying to reconnect to (in backoff). */
  reconnecting: number;
  /** number of peers where reconnection gave up (max attempts exceeded). */
  failed: number;
}

export interface IrohNetworkAdapterOptions {
  /**
   * factory that returns (or lazily creates) the midden stream node.
   * called at most once; the resolved node is cached.
   */
  getNode: () => Promise<MiddenStreamNode>;

  /**
   * returns the current identity (any truthy value = identity exists).
   * called once at connect() time to decide whether to start transport
   * immediately or defer until onIdentityChange fires.
   */
  getIdentity: () => Promise<unknown | null>;

  /**
   * optional subscription for identity changes. when provided and no
   * identity exists at connect() time, the adapter subscribes and starts
   * transport when the first truthy identity arrives. must return an
   * unsubscribe function.
   */
  onIdentityChange?: (cb: (identity: unknown | null) => void) => () => void;

  /**
   * ALPN string to use for automerge sync streams. defaults to
   * SYNC_ALPN ("iroh/automerge-repo/1").
   */
  syncAlpn?: string;
}
