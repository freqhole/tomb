// ---------------------------------------------------------------------------
// iroh network adapter for automerge-repo
//
// bridges iroh QUIC bidirectional streams (via a midden-shaped node) with
// automerge-repo's sync protocol. messages are CBOR-encoded and
// length-delimited (4-byte BE u32 prefix), matching the framing used by
// the iroh-automerge-repo example.
// ---------------------------------------------------------------------------

import {
  cbor,
  NetworkAdapter,
  type Message,
  type PeerId,
  type PeerMetadata,
} from "@automerge/automerge-repo";

import { log } from "../utils/log.js";
import type {
  BiStreamLike,
  ConnectionSummary,
  EndpointState,
  IrohNetworkAdapterOptions,
  MiddenStreamNode,
} from "./types.js";

export type { BiStreamLike, ConnectionSummary, EndpointState, IrohNetworkAdapterOptions, MiddenStreamNode };

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

/** ALPN protocol identifier for automerge-repo sync over iroh. */
export const SYNC_ALPN = "iroh/automerge-repo/1";

/** console log prefix. */
const TAG = "automerge.iroh-adapter";

// ---------------------------------------------------------------------------
// adapter
// ---------------------------------------------------------------------------

/**
 * automerge-repo NetworkAdapter that uses iroh QUIC streams for transport.
 *
 * usage:
 *   const adapter = new IrohNetworkAdapter({
 *     getNode: () => getMiddenNode(),
 *     getIdentity: () => getStoredIdentity(),
 *     onIdentityChange: (cb) => subscribeToIdentityChanges(cb),
 *   });
 *   const repo = new Repo({ network: [broadcastAdapter, adapter] });
 *   // later, to connect to a peer:
 *   await adapter.addPeer("abc123...def");
 */
export class IrohNetworkAdapter extends NetworkAdapter {
  private readonly opts: IrohNetworkAdapterOptions;
  private readonly syncAlpn: string;
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

  /** listeners for connection state changes. */
  private connectionStateListeners: Array<() => void> = [];

  /** peers that exceeded max reconnection attempts. */
  private failedPeers = new Set<string>();

  /** external handlers registered for non-sync ALPNs via registerAlpnHandler(). */
  private alpnHandlers = new Map<string, (stream: BiStreamLike) => void>();

  /** listeners notified when a peer stream is established. */
  private peerConnectListeners: Array<(peerId: string) => void> = [];

  /** listeners notified when a peer stream is removed. */
  private peerDisconnectListeners: Array<(peerId: string) => void> = [];

  private _stopped = false;
  private _endpointState: EndpointState = "off";
  private endpointStateListeners: Array<(state: EndpointState) => void> = [];

  constructor(opts: IrohNetworkAdapterOptions) {
    super();
    this.opts = opts;
    this.syncAlpn = opts.syncAlpn ?? SYNC_ALPN;
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
   * marks the adapter ready (so automerge-repo can use it immediately)
   * and begins transport setup if an identity already exists.
   */
  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    // the adapter is always "ready" from automerge-repo's perspective -
    // it can participate in the network subsystem even before the node
    // starts. actual p2p only begins once an identity exists.
    this._ready = true;
    this._resolveReady();

    this.checkIdentityAndStart().catch((err) => {
      log.error(TAG, "identity check failed:", err);
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
      log.warn(TAG, "no stream for peer:", targetId.slice(0, 16) + "...");
      return;
    }

    const encoded = cbor.encode(message);
    const bytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);

    stream.write_message(bytes).catch((err) => {
      log.error(TAG, "write failed for peer:", targetId.slice(0, 16) + "...", err);
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

    for (const [, state] of this.reconnectState) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
    }
    this.reconnectState.clear();
    this.connectionStateListeners.length = 0;
    this.peerConnectListeners.length = 0;
    this.peerDisconnectListeners.length = 0;
    this.endpointStateListeners.length = 0;

    if (this.identityUnsub) {
      this.identityUnsub();
      this.identityUnsub = null;
    }

    this.setEndpointState("off");
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

    // clear any pending reconnection state - this is a fresh attempt
    this.clearReconnectState(nodeId);

    // remember the peer but don't connect while stopped
    if (this._stopped) return;

    // skip if already connected
    if (this.streams.has(nodeId)) {
      log.debug(TAG, "already connected to:", nodeId.slice(0, 16) + "...");
      return;
    }

    const midden = await this.ensureMidden();
    const stream = await this.openBiWithRetry(midden, nodeId);

    this.registerStream(nodeId, stream, "outbound");
  }

  /**
   * dial a peer with a short retry loop for the initial connection attempt.
   *
   * discovery (relay-assisted address exchange) can lag a peer's node-id
   * registration by a second or so right after both endpoints come
   * online - dialing during that window fails with "no addressing
   * information available" even though the peer is reachable moments
   * later. retry a handful of times with a short fixed delay before
   * giving up; this is a much tighter loop than the general reconnect
   * backoff below, which is for peers that were connected and then
   * dropped.
   */
  private async openBiWithRetry(
    midden: MiddenStreamNode,
    nodeId: string,
    maxAttempts = 4,
    delayMs = 750
  ): Promise<BiStreamLike> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await midden.open_bi(nodeId, this.syncAlpn);
      } catch (err) {
        lastErr = err;
        log.debug(
          TAG,
          `open_bi attempt ${attempt}/${maxAttempts} failed for`,
          nodeId.slice(0, 16) + "...",
          err
        );
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastErr;
  }

  /**
   * stop maintaining a connection to a peer.
   *
   * removes the peer from intendedPeers, cancels any pending reconnection,
   * and closes any existing stream. use this when you intentionally want
   * to stop connecting to a peer (as opposed to a transient failure).
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

  /** check whether we have an active stream to a peer (transport-level connectivity check). */
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

  /** get the current iroh endpoint state for UI display. */
  getEndpointState(): EndpointState {
    return this._endpointState;
  }

  /** subscribe to endpoint state changes; returns an unsubscribe function. */
  onEndpointStateChange(handler: (state: EndpointState) => void): () => void {
    this.endpointStateListeners.push(handler);
    return () => {
      const idx = this.endpointStateListeners.indexOf(handler);
      if (idx >= 0) this.endpointStateListeners.splice(idx, 1);
    };
  }

  /**
   * stop all P2P transport gracefully.
   * closes all peer streams and cancels reconnections, but preserves
   * intendedPeers so restart() can reconnect them. the node reference is
   * dropped so restart() creates a fresh one via getNode().
   */
  stop(): void {
    if (this._stopped || this._disconnected) return;
    this._stopped = true;

    for (const [peerId, stream] of this.streams) {
      stream.close();
      this.emit("peer-disconnected", { peerId: peerId as PeerId });
    }
    this.streams.clear();
    this.readLoops.clear();
    this.failedPeers.clear();

    for (const [, state] of this.reconnectState) {
      if (state.timer !== null) clearTimeout(state.timer);
    }
    this.reconnectState.clear();

    this.midden = null;

    this.setEndpointState("off");
    this.emitConnectionStateChange();
  }

  /**
   * restart the P2P transport after stop().
   * re-initializes the node and reconnects all remembered peers.
   */
  async restart(): Promise<void> {
    if (!this._stopped || this._disconnected) return;
    this._stopped = false;

    await this.initialize();

    for (const peerId of this.intendedPeers) {
      this.addPeer(peerId).catch((err) => {
        log.warn(TAG, "restart: failed to re-add peer:", peerId.slice(0, 16) + "...", err);
      });
    }
  }

  /**
   * register a handler for incoming streams with a specific ALPN.
   * the accept loop will dispatch matching streams to this handler
   * instead of closing them. used to support additional protocols
   * alongside automerge sync without forking this adapter.
   */
  registerAlpnHandler(alpn: string, handler: (stream: BiStreamLike) => void): void {
    this.alpnHandlers.set(alpn, handler);
  }

  /**
   * get the midden stream node, initializing it lazily if needed.
   * exposed for use by protocol handlers that need to open outbound
   * streams on a different ALPN.
   */
  async getNode(): Promise<MiddenStreamNode> {
    return this.ensureMidden();
  }

  // --- internals ---

  private async checkIdentityAndStart(): Promise<void> {
    const identity = await this.opts.getIdentity();

    if (identity) {
      // an identity already exists - start the node and begin accepting
      // connections right away
      log.debug(TAG, "identity found, starting P2P transport");
      await this.initialize();
    } else if (this.opts.onIdentityChange) {
      // no identity yet - subscribe to identity changes so transport
      // starts once one is created
      log.debug(TAG, "no identity yet, deferring P2P transport");
      this.identityUnsub = this.opts.onIdentityChange((newIdentity) => {
        if (newIdentity && !this.midden && !this._disconnected) {
          log.debug(TAG, "identity created, starting P2P transport");
          this.initialize().catch((err) => {
            log.error(TAG, "deferred initialization failed:", err);
          });
        }
      });
    } else {
      // no identity and no subscription - adapter stays passive
      log.debug(TAG, "no identity and no onIdentityChange provided, adapter is passive");
    }
  }

  private async initialize(): Promise<void> {
    this.setEndpointState("starting");
    try {
      await this.ensureMidden();
      this.startAcceptLoop();
      this.setEndpointState("online");
    } catch (err) {
      log.error(TAG, "failed to initialize node:", err);
      this.setEndpointState("error");
      throw err;
    }
  }

  private async ensureMidden(): Promise<MiddenStreamNode> {
    if (this.midden) return this.midden;
    this.midden = await this.opts.getNode();
    return this.midden;
  }

  private startAcceptLoop(): void {
    if (this._acceptLoopRunning) return;
    this._acceptLoopRunning = true;

    const loop_ = async () => {
      const midden = await this.ensureMidden();

      while (!this._disconnected && !this._stopped) {
        try {
          const stream = await midden.accept();

          if (!stream) {
            // endpoint closed
            log.debug(TAG, "accept loop: endpoint closed");
            break;
          }

          const alpn = stream.alpn();
          const peerId = stream.peer_node_id();

          if (alpn === this.syncAlpn) {
            // automerge-repo sync - handle internally
            log.debug(TAG, "accepted sync connection from:", peerId.slice(0, 16) + "...");
            this.registerStream(peerId, stream, "inbound");
          } else {
            const handler = this.alpnHandlers.get(alpn);
            if (handler) {
              log.debug(TAG, "dispatching", alpn, "stream from:", peerId.slice(0, 16) + "...");
              handler(stream);
            } else {
              // no handler registered - close the stream
              log.warn(
                TAG,
                "dropping inbound stream - no handler registered for ALPN:",
                alpn,
                "registered handlers:",
                Array.from(this.alpnHandlers.keys())
              );
              stream.close();
            }
          }
        } catch (err) {
          if (this._disconnected || this._stopped) break;
          log.error(TAG, "accept loop error:", err);
          // brief pause before retrying to avoid tight error loops
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      this._acceptLoopRunning = false;
    };

    loop_().catch((err) => {
      log.error(TAG, "accept loop crashed:", err);
      this._acceptLoopRunning = false;
    });
  }

  private registerStream(
    peerId: string,
    stream: BiStreamLike,
    direction: "inbound" | "outbound"
  ): void {
    // duplicate-stream handling (simultaneous connect, peer restart): the
    // NEWEST stream always takes over for writes, and the replaced stream
    // is NEVER closed - its read loop keeps draining it until it actually
    // dies (guarded cleanup below ignores non-active streams).
    //
    // why not close the old one? when both peers dial each other at once,
    // "last one wins + close the loser" resolves differently on each side
    // - each side keeps its own dial and closes the stream the other side
    // kept, killing BOTH connections and any in-flight sync requests. and
    // why not a deterministic keep-the-incumbent tiebreak? the incumbent
    // can be a zombie whose death hasn't been detected yet (the peer
    // process was killed and restarted): writes routed to it silently
    // vanish and recovery deadlocks. writing to the newest stream and
    // reading from all of them is correct in every case - sync flows
    // regardless of which stream each side picks for its writes, and dead
    // streams get reaped by their own read-loop errors.
    const existing = this.streams.get(peerId);
    let reannounceDelayMs = 0;
    if (existing) {
      log.debug(
        TAG,
        `duplicate stream for ${peerId.slice(0, 16)}...: new ${direction} stream takes writes; old stream stays open for reads until it dies`
      );
      // cycle the repo-level peer: automerge-repo ignores a repeated
      // peer-candidate for a peer it already considers connected, so a
      // superseding stream (e.g. a restarted peer redialing before we've
      // noticed the old stream died) would otherwise never restart doc
      // sync. an explicit disconnected -> candidate cycle resets the
      // repo's sync state for this peer; the candidate is re-announced a
      // tick later so the repo's own async disconnect cleanup finishes
      // first.
      if (!this._disconnected && !this._stopped) {
        this.emit("peer-disconnected", { peerId: peerId as PeerId });
        reannounceDelayMs = 100;
      }
    }

    this.streams.set(peerId, stream);
    // connection established - clear any reconnection backoff state
    this.clearReconnectState(peerId);
    this.emitConnectionStateChange();

    // notify peer-connect listeners
    for (const h of this.peerConnectListeners) h(peerId);

    // emit peer-candidate so automerge-repo starts syncing. the read loop
    // starts first either way - sync messages can arrive as soon as the
    // candidate is announced.
    this.startReadLoop(peerId, stream);
    const announce = (): void => {
      if (this._disconnected || this._stopped) return;
      if (this.streams.get(peerId) !== stream) return; // superseded already
      this.emit("peer-candidate", {
        peerId: peerId as PeerId,
        peerMetadata: { isEphemeral: false },
      });
    };
    if (reannounceDelayMs > 0) {
      setTimeout(announce, reannounceDelayMs);
    } else {
      announce();
    }
  }

  private startReadLoop(peerId: string, stream: BiStreamLike): void {
    this.readLoops.set(peerId, true);

    const loop_ = async () => {
      while (this.readLoops.get(peerId) && !this._disconnected && !this._stopped) {
        try {
          const data = await stream.read_message();

          if (!data) {
            // stream closed cleanly
            log.debug(TAG, "stream closed by peer:", peerId.slice(0, 16) + "...");
            break;
          }

          // CBOR-decode the message
          const message = cbor.decode(data) as Message;

          // ensure the senderId is set to the peer's node ID
          message.senderId = peerId as PeerId;

          this.emit("message", message);
        } catch (err) {
          if (this._disconnected || this._stopped) break;
          log.error(TAG, "read error from peer:", peerId.slice(0, 16) + "...", err);
          break;
        }
      }

      // only clean up the PEER if this stream is still the active one. if
      // registerStream() superseded us with a newer stream, that one owns
      // the peer now - calling removePeer here would incorrectly kill it.
      // either way, close our own stream so its resources are released.
      if (this.streams.get(peerId) === stream) {
        this.removePeer(peerId);
      } else {
        stream.close();
      }
    };

    loop_().catch((err) => {
      log.error(TAG, "read loop crashed for peer:", peerId.slice(0, 16) + "...", err);
      if (this.streams.get(peerId) === stream) {
        this.removePeer(peerId);
      } else {
        stream.close();
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

    if (!this._disconnected && !this._stopped) {
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
    if (this._disconnected || this._stopped) return;

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
      log.warn(
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

    log.debug(
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
    if (this._disconnected || this._stopped) return;

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
      const stream = await midden.open_bi(peerId, this.syncAlpn);
      log.debug(TAG, "reconnected to peer:", peerId.slice(0, 16) + "...");
      // registerStream calls clearReconnectState, so no need to do it here
      this.registerStream(peerId, stream, "outbound");
    } catch (err) {
      log.warn(TAG, "reconnect attempt failed for peer:", peerId.slice(0, 16) + "...", err);
      // schedule next attempt with increased backoff
      this.scheduleReconnect(peerId);
    }
  }

  /** notify all connection state listeners. */
  private emitConnectionStateChange(): void {
    for (const handler of this.connectionStateListeners) {
      handler();
    }
  }

  private setEndpointState(state: EndpointState): void {
    if (this._endpointState === state) return;
    this._endpointState = state;
    for (const h of this.endpointStateListeners) h(state);
  }

  /** cancel and remove any pending reconnect timer for a peer. */
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
