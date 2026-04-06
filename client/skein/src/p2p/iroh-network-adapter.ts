// ---------------------------------------------------------------------------
// iroh network adapter for automerge-repo
//
// bridges iroh QUIC bidirectional streams (via midden WASM) with
// automerge-repo's sync protocol. messages are CBOR-encoded and
// length-delimited (4-byte BE u32 prefix), matching the framing used
// by the iroh-automerge-repo example.
//
// this adapter requires midden to be built with the raw stream APIs
// (BiStream, open_bi, accept). those midden APIs are being added as
// part of phase B of the skein P2P plan. the adapter won't work until
// midden is rebuilt with `make build` in `client/midden/`.
// ---------------------------------------------------------------------------

import {
  cbor,
  NetworkAdapter,
  type Message,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo";

import { getStoredIdentity, onIdentityChange } from "./identity";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** base delay for reconnection backoff (ms). */
const RECONNECT_BASE_DELAY_MS = 1000;

/** maximum delay between reconnection attempts (ms). */
const RECONNECT_MAX_DELAY_MS = 30_000;

/** maximum number of reconnection attempts before giving up. */
const RECONNECT_MAX_ATTEMPTS = 8;

/** upper bound of random jitter added to each reconnect delay (ms). */
const RECONNECT_JITTER_MS = 1000;

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** ALPN protocol identifier for automerge-repo sync over iroh. */
export const SYNC_ALPN = "iroh/automerge-repo/1";

/** ALPN protocol identifier for friend requests, profile sharing, and presence heartbeat. */
export const FRIENDZ_ALPN = "freqhole-friendz/1";

/** summary of the adapter's connection state for UI display */
export interface ConnectionSummary {
  /** number of peers we're actively connected to (stream is open) */
  connected: number;
  /** number of peers we're trying to reconnect to (in backoff) */
  reconnecting: number;
  /** number of peers where reconnection gave up (max attempts exceeded) */
  failed: number;
}

/** console log prefix. */
const TAG = "[skein:iroh-adapter]";

/**
 * minimal interface for a midden BiStream.
 * matches the WASM-exported BiStream struct.
 */
export interface BiStreamLike {
  peer_node_id(): string;
  alpn(): string;
  write_message(data: Uint8Array): Promise<void>;
  read_message(): Promise<Uint8Array | null>; // null = stream closed
  close(): void;
  // raw framing (no length prefix) — used by freqhole/1 protocol.
  // grimoire and midden both send raw JSON terminated by finish(),
  // NOT length-delimited. these methods are optional because only
  // midden BiStream implements them; TauriBiStream does not need them.
  read_to_end?(max_size: number): Promise<Uint8Array>;
  write_raw_and_finish?(data: Uint8Array): Promise<void>;
}

/**
 * extended midden node interface with raw stream APIs.
 * the standard MiddenNodeLike (from identity.ts) only has node_id() and
 * secret_key(). this adds the bidirectional stream methods needed for
 * the network adapter.
 */
export interface MiddenStreamNode {
  node_id(): string;
  open_bi(peer_addr: string, alpn: string): Promise<BiStreamLike>;
  accept(): Promise<BiStreamLike | null>;
}

// ---------------------------------------------------------------------------
// adapter
// ---------------------------------------------------------------------------

/**
 * automerge-repo NetworkAdapter that uses iroh QUIC streams for transport.
 *
 * usage:
 *   const adapter = new IrohNetworkAdapter(() => getMiddenNode());
 *   const repo = new Repo({ network: [broadcastAdapter, adapter] });
 *   // later, to connect to a peer:
 *   await adapter.addPeer("abc123...def");
 */
export class IrohNetworkAdapter extends NetworkAdapter {
  private getMidden: () => Promise<MiddenStreamNode>;
  private midden: MiddenStreamNode | null = null;
  private streams = new Map<string, BiStreamLike>();
  private readLoops = new Map<string, boolean>(); // peerId -> active flag
  private _ready = false;
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;
  private _disconnected = false;
  private _acceptLoopRunning = false;
  private identityUnsub: (() => void) | null = null;

  /** peers explicitly added via addPeer() that we should stay connected to. */
  private intendedPeers = new Set<string>();

  /** per-peer reconnection state tracking attempt count and pending timer. */
  private reconnectState = new Map<
    string,
    { attempt: number; timer: ReturnType<typeof setTimeout> | null }
  >();

  /** listeners for connection state changes */
  private connectionStateListeners: Array<() => void> = [];

  /** peers that exceeded max reconnection attempts */
  private failedPeers = new Set<string>();

  /** external handlers registered for non-sync ALPNs via registerAlpnHandler(). */
  private alpnHandlers = new Map<string, (stream: BiStreamLike) => void>();

  /** listeners notified when a peer stream is established */
  private peerConnectListeners: Array<(peerId: string) => void> = [];

  /** listeners notified when a peer stream is removed */
  private peerDisconnectListeners: Array<(peerId: string) => void> = [];

  constructor(getMidden: () => Promise<MiddenStreamNode>) {
    super();
    this.getMidden = getMidden;
    this._readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  // --- NetworkAdapter interface ---

  isReady(): boolean {
    return this._ready;
  }

  whenReady(): Promise<void> {
    return this._readyPromise;
  }

  /**
   * called by the Repo to start the adapter.
   *
   * initializes the midden node (lazily starting WASM if needed) and
   * begins accepting incoming connections.
   */
  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    // the adapter is always "ready" from automerge-repo's perspective —
    // it can participate in the network subsystem even before midden starts.
    // actual P2P only begins when an identity exists.
    this._ready = true;
    this._resolveReady();

    // check if user already has a P2P identity, and if so, start midden
    this.checkIdentityAndStart().catch((err) => {
      console.error(TAG, "identity check failed:", err);
    });
  }

  /**
   * send a message to a peer.
   *
   * CBOR-encodes the message and writes it as a length-delimited frame
   * to the peer's QUIC stream.
   */
  send(message: Message): void {
    const targetId = message.targetId as string;
    const stream = this.streams.get(targetId);

    if (!stream) {
      console.warn(TAG, "no stream for peer:", targetId.slice(0, 16) + "...");
      return;
    }

    const encoded = cbor.encode(message);
    const bytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);

    stream.write_message(bytes).catch((err) => {
      console.error(TAG, "write failed for peer:", targetId.slice(0, 16) + "...", err);
      this.removePeer(targetId);
    });
  }

  /**
   * disconnect from all peers and stop accepting connections.
   */
  disconnect(): void {
    this._disconnected = true;

    for (const [peerId, stream] of this.streams) {
      stream.close();
      this.emit("peer-disconnected", { peerId: peerId as PeerId });
    }

    this.streams.clear();
    this.readLoops.clear();
    this.intendedPeers.clear();
    this.failedPeers.clear();
    this.alpnHandlers.clear();

    // cancel all pending reconnection timers
    for (const [, state] of this.reconnectState) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
    }
    this.reconnectState.clear();
    this.connectionStateListeners.length = 0;
    this.peerConnectListeners.length = 0;
    this.peerDisconnectListeners.length = 0;

    if (this.identityUnsub) {
      this.identityUnsub();
      this.identityUnsub = null;
    }

    this.emit("close");
  }

  // --- public API (beyond NetworkAdapter) ---

  /**
   * connect to a peer by node ID.
   *
   * opens a bidirectional QUIC stream to the peer on the automerge sync
   * ALPN, starts a read loop, and emits a peer-candidate event so
   * automerge-repo begins syncing with this peer.
   */
  async addPeer(nodeId: string): Promise<void> {
    if (this._disconnected) {
      throw new Error("adapter is disconnected");
    }

    // track this peer as one we intend to stay connected to
    this.intendedPeers.add(nodeId);
    this.failedPeers.delete(nodeId);
    this.emitConnectionStateChange();

    // clear any pending reconnection state — this is a fresh attempt
    this.clearReconnectState(nodeId);

    // skip if already connected
    if (this.streams.has(nodeId)) {
      console.log(TAG, "already connected to:", nodeId.slice(0, 16) + "...");
      return;
    }

    const midden = await this.ensureMidden();
    const stream = await midden.open_bi(nodeId, SYNC_ALPN);

    this.registerStream(nodeId, stream);
  }

  /**
   * stop maintaining a connection to a peer.
   *
   * removes the peer from intendedPeers, cancels any pending reconnection,
   * and closes any existing stream. use this when you intentionally want to
   * stop connecting to a peer (as opposed to a transient failure).
   */
  forgetPeer(nodeId: string): void {
    // remove from intended set first so removePeer() won't schedule a reconnect
    this.intendedPeers.delete(nodeId);
    this.failedPeers.delete(nodeId);
    this.clearReconnectState(nodeId);
    // delegate stream cleanup and peer-disconnected emission to removePeer
    this.removePeer(nodeId);
    this.emitConnectionStateChange();
  }

  /** check whether we have an active stream to a peer (transport-level connectivity check) */
  isConnected(nodeId: string): boolean {
    return this.streams.has(nodeId);
  }

  /**
   * get a summary of the current connection state.
   * used by the UI to show stoplight-style indicators.
   */
  getConnectionSummary(): ConnectionSummary {
    let connected = 0;
    let reconnecting = 0;

    for (const peerId of this.intendedPeers) {
      if (this.streams.has(peerId)) {
        connected++;
      } else if (this.reconnectState.has(peerId)) {
        reconnecting++;
      }
    }

    return { connected, reconnecting, failed: this.failedPeers.size };
  }

  /**
   * subscribe to connection state changes.
   * fires whenever a peer connects, disconnects, starts reconnecting,
   * or gives up. returns an unsubscribe function.
   */
  onConnectionStateChange(handler: () => void): () => void {
    this.connectionStateListeners.push(handler);
    return () => {
      const idx = this.connectionStateListeners.indexOf(handler);
      if (idx >= 0) this.connectionStateListeners.splice(idx, 1);
    };
  }

  /**
   * subscribe to peer connect events. fires when a stream is
   * successfully established with a peer. returns an unsubscribe function.
   */
  onPeerConnect(handler: (peerId: string) => void): () => void {
    this.peerConnectListeners.push(handler);
    return () => {
      const idx = this.peerConnectListeners.indexOf(handler);
      if (idx >= 0) this.peerConnectListeners.splice(idx, 1);
    };
  }

  /**
   * subscribe to peer disconnect events. fires when a peer's stream
   * is removed (closed or errored). returns an unsubscribe function.
   */
  onPeerDisconnect(handler: (peerId: string) => void): () => void {
    this.peerDisconnectListeners.push(handler);
    return () => {
      const idx = this.peerDisconnectListeners.indexOf(handler);
      if (idx >= 0) this.peerDisconnectListeners.splice(idx, 1);
    };
  }

  /**
   * retry connection to all failed peers.
   * re-adds them to intendedPeers and starts fresh reconnection attempts.
   */
  retryFailedPeers(): void {
    if (this._disconnected) return;
    const failed = [...this.failedPeers];
    this.failedPeers.clear();
    for (const peerId of failed) {
      this.intendedPeers.add(peerId);
      this.scheduleReconnect(peerId);
    }
    this.emitConnectionStateChange();
  }

  /**
   * register a handler for incoming streams with a specific ALPN.
   * the accept loop will dispatch matching streams to this handler
   * instead of closing them. used to support additional protocols
   * (e.g. freqhole-friendz/1) alongside automerge sync.
   */
  registerAlpnHandler(alpn: string, handler: (stream: BiStreamLike) => void): void {
    this.alpnHandlers.set(alpn, handler);
  }

  /**
   * get the midden stream node, initializing it lazily if needed.
   * exposed for use by protocol handlers that need to open outbound
   * streams (e.g. friends protocol handler calling open_bi with FRIENDZ_ALPN).
   */
  async getNode(): Promise<MiddenStreamNode> {
    return this.ensureMidden();
  }

  // --- internals ---

  private async checkIdentityAndStart(): Promise<void> {
    const identity = await getStoredIdentity();

    if (identity) {
      // user has an identity — start midden and begin accepting connections
      console.log(TAG, "identity found, starting P2P transport");
      await this.initialize();
    } else {
      // no identity yet — subscribe to identity changes so we start
      // when the user generates one (e.g. clicks "generate" in profile widget)
      console.log(TAG, "no identity yet, deferring P2P transport");
      this.identityUnsub = onIdentityChange((newIdentity) => {
        if (newIdentity && !this.midden && !this._disconnected) {
          console.log(TAG, "identity created, starting P2P transport");
          this.initialize().catch((err) => {
            console.error(TAG, "deferred initialization failed:", err);
          });
        }
      });
    }
  }

  private async initialize(): Promise<void> {
    try {
      await this.ensureMidden();
      // start accepting incoming connections
      this.startAcceptLoop();
    } catch (err) {
      console.error(TAG, "failed to initialize midden:", err);
      throw err;
    }
  }

  private async ensureMidden(): Promise<MiddenStreamNode> {
    if (this.midden) return this.midden;
    this.midden = await this.getMidden();
    return this.midden;
  }

  private startAcceptLoop(): void {
    if (this._acceptLoopRunning) return;
    this._acceptLoopRunning = true;

    const loop_ = async () => {
      const midden = await this.ensureMidden();

      while (!this._disconnected) {
        try {
          const stream = await midden.accept();

          if (!stream) {
            // endpoint closed
            console.log(TAG, "accept loop: endpoint closed");
            break;
          }

          const alpn = stream.alpn();
          const peerId = stream.peer_node_id();

          if (alpn === SYNC_ALPN) {
            // automerge-repo sync — handle internally
            console.log(TAG, "accepted sync connection from:", peerId.slice(0, 16) + "...");
            this.registerStream(peerId, stream);
          } else {
            const handler = this.alpnHandlers.get(alpn);
            if (handler) {
              console.log(TAG, "dispatching", alpn, "stream from:", peerId.slice(0, 16) + "...");
              handler(stream);
            } else {
              // no handler registered — close the stream
              console.log(TAG, "ignoring stream with ALPN:", alpn);
              stream.close();
            }
          }
        } catch (err) {
          if (this._disconnected) break;
          console.error(TAG, "accept loop error:", err);
          // brief pause before retrying to avoid tight error loops
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      this._acceptLoopRunning = false;
    };

    loop_().catch((err) => {
      console.error(TAG, "accept loop crashed:", err);
      this._acceptLoopRunning = false;
    });
  }

  private registerStream(peerId: string, stream: BiStreamLike): void {
    // if we already have a stream for this peer, close the old one.
    // the old read loop will detect the closed stream and exit, but
    // won't call removePeer() because the stream reference won't match.
    const existing = this.streams.get(peerId);
    if (existing) {
      console.log(TAG, "replacing existing stream for peer:", peerId.slice(0, 16) + "...");
      existing.close();
    }

    this.streams.set(peerId, stream);

    // connection established — clear any reconnection backoff state
    this.clearReconnectState(peerId);
    this.emitConnectionStateChange();

    // notify peer-connect listeners
    for (const h of this.peerConnectListeners) h(peerId);

    // emit peer-candidate so automerge-repo starts syncing
    this.emit("peer-candidate", {
      peerId: peerId as PeerId,
      peerMetadata: { isEphemeral: false },
    });

    // start read loop for this peer
    this.startReadLoop(peerId, stream);
  }

  private startReadLoop(peerId: string, stream: BiStreamLike): void {
    this.readLoops.set(peerId, true);

    const loop_ = async () => {
      while (this.readLoops.get(peerId) && !this._disconnected) {
        try {
          const data = await stream.read_message();

          if (!data) {
            // stream closed cleanly
            console.log(TAG, "stream closed by peer:", peerId.slice(0, 16) + "...");
            break;
          }

          // CBOR-decode the message
          const message = cbor.decode(data) as Message;

          // ensure the senderId is set to the peer's node ID
          message.senderId = peerId as PeerId;

          this.emit("message", message);
        } catch (err) {
          if (this._disconnected) break;
          console.error(TAG, "read error from peer:", peerId.slice(0, 16) + "...", err);
          break;
        }
      }

      // only clean up if this stream is still the active one for this peer.
      // if registerStream() replaced our stream with a newer one, the replacement
      // already closed us and started its own read loop — calling removePeer here
      // would incorrectly kill the new stream.
      if (this.streams.get(peerId) === stream) {
        this.removePeer(peerId);
      }
    };

    loop_().catch((err) => {
      console.error(TAG, "read loop crashed for peer:", peerId.slice(0, 16) + "...", err);
      if (this.streams.get(peerId) === stream) {
        this.removePeer(peerId);
      }
    });
  }

  private removePeer(peerId: string): void {
    const stream = this.streams.get(peerId);
    if (stream) {
      stream.close();
      this.streams.delete(peerId);
      this.emitConnectionStateChange();

      // notify peer-disconnect listeners
      for (const h of this.peerDisconnectListeners) h(peerId);
    }

    this.readLoops.delete(peerId);

    if (!this._disconnected) {
      this.emit("peer-disconnected", { peerId: peerId as PeerId });

      // if this was an intended peer, schedule a reconnection attempt
      if (this.intendedPeers.has(peerId)) {
        this.scheduleReconnect(peerId);
      }
    }
  }

  // --- reconnection logic ---

  /**
   * schedule a reconnection attempt for a peer using exponential backoff
   * with random jitter.
   */
  private scheduleReconnect(peerId: string): void {
    if (this._disconnected) return;

    // already reconnected while we were setting up
    if (this.streams.has(peerId)) return;

    // get or create reconnect state for this peer
    let state = this.reconnectState.get(peerId);
    if (!state) {
      state = { attempt: 0, timer: null };
      this.reconnectState.set(peerId, state);
    }

    // give up after max attempts
    if (state.attempt >= RECONNECT_MAX_ATTEMPTS) {
      console.warn(
        TAG,
        "giving up reconnection to peer after",
        RECONNECT_MAX_ATTEMPTS,
        "attempts:",
        peerId.slice(0, 16) + "..."
      );
      this.intendedPeers.delete(peerId);
      this.failedPeers.add(peerId);
      this.clearReconnectState(peerId);
      this.emitConnectionStateChange();
      return;
    }

    // exponential backoff: baseDelay * 2^attempt, capped at maxDelay
    const exponentialDelay = RECONNECT_BASE_DELAY_MS * Math.pow(2, state.attempt);
    const cappedDelay = Math.min(exponentialDelay, RECONNECT_MAX_DELAY_MS);
    // add random jitter to avoid simultaneous-open races
    const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
    const delay = cappedDelay + jitter;

    console.log(
      TAG,
      "scheduling reconnect to peer:",
      peerId.slice(0, 16) + "...",
      `(attempt ${state.attempt + 1}/${RECONNECT_MAX_ATTEMPTS}, delay ${delay}ms)`
    );

    // clear any existing timer (shouldn't happen, but be safe)
    if (state.timer !== null) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      state!.timer = null;
      this.attemptReconnect(peerId);
    }, delay);
  }

  /**
   * attempt to reconnect to a peer. called by the scheduled timer from
   * scheduleReconnect(). on failure, schedules the next attempt.
   */
  private async attemptReconnect(peerId: string): Promise<void> {
    if (this._disconnected) return;

    // already reconnected (e.g. peer connected to us via accept loop)
    if (this.streams.has(peerId)) {
      this.clearReconnectState(peerId);
      return;
    }

    // peer was removed from intended set while we were waiting
    if (!this.intendedPeers.has(peerId)) return;

    const state = this.reconnectState.get(peerId);
    if (state) {
      state.attempt += 1;
    }

    try {
      const midden = await this.ensureMidden();
      const stream = await midden.open_bi(peerId, SYNC_ALPN);
      console.log(TAG, "reconnected to peer:", peerId.slice(0, 16) + "...");
      this.registerStream(peerId, stream);
      // registerStream calls clearReconnectState, so no need to do it here
    } catch (err) {
      console.warn(TAG, "reconnect attempt failed for peer:", peerId.slice(0, 16) + "...", err);
      // schedule next attempt with increased backoff
      this.scheduleReconnect(peerId);
    }
  }

  /**
   * clear reconnection state and cancel any pending timer for a peer.
   */
  /** notify all connection state listeners */
  private emitConnectionStateChange(): void {
    for (const handler of this.connectionStateListeners) {
      handler();
    }
  }

  private clearReconnectState(peerId: string): void {
    const state = this.reconnectState.get(peerId);
    if (state) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
      this.reconnectState.delete(peerId);
    }
  }
}
