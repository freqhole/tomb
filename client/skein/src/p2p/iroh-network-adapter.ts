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
// types
// ---------------------------------------------------------------------------

/** ALPN protocol identifier for automerge-repo sync over iroh. */
export const SYNC_ALPN = "iroh/automerge-repo/1";

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

    // skip if already connected
    if (this.streams.has(nodeId)) {
      console.log(TAG, "already connected to:", nodeId.slice(0, 16) + "...");
      return;
    }

    const midden = await this.ensureMidden();
    const stream = await midden.open_bi(nodeId, SYNC_ALPN);

    this.registerStream(nodeId, stream);
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
          if (alpn !== SYNC_ALPN) {
            // not our protocol — close the stream
            console.log(TAG, "ignoring stream with ALPN:", alpn);
            stream.close();
            continue;
          }

          const peerId = stream.peer_node_id();
          console.log(TAG, "accepted connection from:", peerId.slice(0, 16) + "...");

          this.registerStream(peerId, stream);
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
    // if we already have a stream for this peer, close the old one
    const existing = this.streams.get(peerId);
    if (existing) {
      existing.close();
    }

    this.streams.set(peerId, stream);

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

      // clean up
      this.removePeer(peerId);
    };

    loop_().catch((err) => {
      console.error(TAG, "read loop crashed for peer:", peerId.slice(0, 16) + "...", err);
      this.removePeer(peerId);
    });
  }

  private removePeer(peerId: string): void {
    const stream = this.streams.get(peerId);
    if (stream) {
      stream.close();
      this.streams.delete(peerId);
    }

    this.readLoops.delete(peerId);

    if (!this._disconnected) {
      this.emit("peer-disconnected", { peerId: peerId as PeerId });
    }
  }
}
