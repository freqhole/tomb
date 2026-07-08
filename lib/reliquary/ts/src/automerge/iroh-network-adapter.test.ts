// ---------------------------------------------------------------------------
// unit tests for IrohNetworkAdapter
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, type Mock } from "vitest";

import type { BiStreamLike, MiddenStreamNode } from "./types.js";
import { createMockBiStream, createMockMidden, type MockMidden } from "../testing/index.js";

// ---------------------------------------------------------------------------
// helper: flush microtasks + a small real delay
// ---------------------------------------------------------------------------

function flush(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// imports
// ---------------------------------------------------------------------------

import type { Message, PeerId } from "@automerge/automerge-repo";
import { cbor } from "@automerge/automerge-repo";
import { IrohNetworkAdapter, SYNC_ALPN } from "./iroh-network-adapter.js";
import type { IrohNetworkAdapterOptions } from "./types.js";

// ---------------------------------------------------------------------------
// identity fixture + a fresh injectable identity double per test
// ---------------------------------------------------------------------------

function makeIdentity(nodeId: string = "a".repeat(64)) {
  return {
    node_id: nodeId,
    secret_key: new Uint8Array(32),
    created_at: Date.now(),
  };
}

/** builds the identity-related half of IrohNetworkAdapterOptions with hooks
 *  the test can drive by hand, mirroring what a real getIdentity/
 *  onIdentityChange pair backed by stored state would do. */
function createIdentityDouble() {
  let stored: unknown = null;
  let callback: ((identity: unknown) => void) | null = null;

  return {
    getIdentity: vi.fn(async () => stored),
    onIdentityChange: vi.fn((cb: (identity: unknown) => void) => {
      callback = cb;
      return () => {
        callback = null;
      };
    }),
    setStoredIdentity(identity: unknown) {
      stored = identity;
    },
    triggerChange(identity: unknown) {
      callback?.(identity);
    },
    get hasCallback() {
      return callback !== null;
    },
  };
}

function makeOpts(
  factory: Mock,
  identity: ReturnType<typeof createIdentityDouble>
): IrohNetworkAdapterOptions {
  return {
    getNode: factory as unknown as () => Promise<MiddenStreamNode>,
    getIdentity: identity.getIdentity,
    onIdentityChange: identity.onIdentityChange,
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("IrohNetworkAdapter", () => {
  function setup() {
    const mockMidden = createMockMidden();
    const factory = vi.fn(async () => mockMidden as unknown as MiddenStreamNode);
    const identity = createIdentityDouble();
    const adapter = new IrohNetworkAdapter(makeOpts(factory, identity));
    return { mockMidden, factory, identity, adapter };
  }

  // -----------------------------------------------------------------------
  // SYNC_ALPN export
  // -----------------------------------------------------------------------

  describe("SYNC_ALPN", () => {
    it("exports the correct ALPN string", () => {
      expect(SYNC_ALPN).toBe("iroh/automerge-repo/1");
    });
  });

  // -----------------------------------------------------------------------
  // construction and readiness
  // -----------------------------------------------------------------------

  describe("construction and readiness", () => {
    it("starts not ready", () => {
      const { adapter } = setup();
      expect(adapter.isReady()).toBe(false);
    });

    it("whenReady() resolves after connect()", async () => {
      const { adapter } = setup();
      adapter.connect("our-peer-id" as PeerId);
      await adapter.whenReady();
      expect(adapter.isReady()).toBe(true);
    });

    it("stores the peerId passed to connect()", () => {
      const { adapter } = setup();
      adapter.connect("some-peer" as PeerId);
      expect(adapter.peerId).toBe("some-peer");
    });

    it("becomes ready after connect() even without identity", async () => {
      const { adapter } = setup();
      adapter.connect("our-peer-id" as PeerId);
      await flush();
      expect(adapter.isReady()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // deferred initialization (identity-getter parameterization)
  // -----------------------------------------------------------------------

  describe("deferred initialization", () => {
    it("does not call getNode when no identity exists", async () => {
      const { adapter, factory } = setup();
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).not.toHaveBeenCalled();
      expect(adapter.isReady()).toBe(true);
    });

    it("calls getNode immediately when identity exists at connect time", async () => {
      const { adapter, factory, identity } = setup();
      identity.setStoredIdentity(makeIdentity());
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("starts the node when identity is created later via onIdentityChange", async () => {
      const { adapter, factory, identity } = setup();
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).not.toHaveBeenCalled();

      identity.triggerChange(makeIdentity());
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("ignores identity change if already disconnected", async () => {
      const { adapter, factory, identity } = setup();
      adapter.connect("our-id" as PeerId);
      await flush(50);

      adapter.disconnect();
      identity.triggerChange(makeIdentity());
      await flush(50);

      expect(factory).not.toHaveBeenCalled();
    });

    it("ignores identity change if the node is already initialized", async () => {
      const { adapter, factory, identity } = setup();
      identity.setStoredIdentity(makeIdentity());
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);

      identity.triggerChange(makeIdentity());
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("stays passive with no onIdentityChange and no identity", async () => {
      const mockMidden = createMockMidden();
      const factory = vi.fn(async () => mockMidden as unknown as MiddenStreamNode);
      const adapter = new IrohNetworkAdapter({
        getNode: factory as unknown as () => Promise<MiddenStreamNode>,
        getIdentity: vi.fn(async () => null),
      });
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // addPeer()
  // -----------------------------------------------------------------------

  describe("addPeer()", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("calls open_bi with the correct nodeId and ALPN", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(peerId, SYNC_ALPN);
    });

    it("emits peer-candidate after connecting", async () => {
      const { adapter } = await setupConnected();
      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));

      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);

      expect(peerCandidates).toHaveLength(1);
      expect(peerCandidates[0].peerId).toBe(peerId);
      expect(peerCandidates[0].peerMetadata).toEqual({ isEphemeral: false });
    });

    it("skips if already connected to that peer", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);
      await adapter.addPeer(peerId);

      expect(mockMidden.open_bi).toHaveBeenCalledTimes(1);
    });

    it("throws if adapter is disconnected", async () => {
      const { adapter } = await setupConnected();
      adapter.disconnect();

      await expect(adapter.addPeer("b".repeat(64))).rejects.toThrow("adapter is disconnected");
    });

    it("initializes the node lazily if not yet started", async () => {
      const s = setup();
      s.adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(s.factory).not.toHaveBeenCalled();

      await s.adapter.addPeer("c".repeat(64));
      expect(s.factory).toHaveBeenCalledTimes(1);
    });

    it("retries the initial dial a few times before giving up", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const goodStream = createMockBiStream(peerId);

      mockMidden.open_bi
        .mockRejectedValueOnce(new Error("no addressing information available"))
        .mockRejectedValueOnce(new Error("no addressing information available"))
        .mockResolvedValueOnce(goodStream as unknown as BiStreamLike);

      const addPeerPromise = adapter.addPeer(peerId);
      // openBiWithRetry sleeps 750ms between attempts - advance real time via flush
      await flush(2000);
      await addPeerPromise;

      expect(mockMidden.open_bi).toHaveBeenCalledTimes(3);
      expect(adapter.isConnected(peerId)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // send()
  // -----------------------------------------------------------------------

  describe("send()", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("CBOR-encodes message and writes to the correct peer stream", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);

      const stream = await mockMidden.open_bi.mock.results[0].value;

      const message: Message = {
        type: "sync",
        senderId: "our-id" as PeerId,
        targetId: peerId as PeerId,
        data: new Uint8Array([1, 2, 3]),
        documentId: "doc-1" as any,
      };

      adapter.send(message);
      await flush();

      expect(stream.write_message).toHaveBeenCalledTimes(1);

      const written = stream.write_message.mock.calls[0][0] as Uint8Array;
      const decoded = cbor.decode(written) as Record<string, unknown>;
      expect(decoded.type).toBe("sync");
      expect(decoded.targetId).toBe(peerId);
      expect(decoded.documentId).toBe("doc-1");
    });

    it("does not throw when no stream exists for the target", async () => {
      const { adapter } = await setupConnected();
      const message: Message = {
        type: "sync",
        senderId: "our-id" as PeerId,
        targetId: "unknown-peer" as PeerId,
      };

      expect(() => adapter.send(message)).not.toThrow();
    });

    it("removes peer on write failure", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);

      const failingStream = createMockBiStream(peerId);
      failingStream.write_message.mockRejectedValueOnce(new Error("write error"));
      mockMidden.open_bi.mockResolvedValueOnce(failingStream as unknown as BiStreamLike);

      await adapter.addPeer(peerId);

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnected.push(payload.peerId));

      adapter.send({
        type: "sync",
        senderId: "our-id" as PeerId,
        targetId: peerId as PeerId,
      });

      await flush(50);

      expect(disconnected).toContain(peerId);
    });
  });

  // -----------------------------------------------------------------------
  // read loop
  // -----------------------------------------------------------------------

  describe("read loop", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("incoming CBOR messages are decoded and emitted as 'message' events", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);

      const mockStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(mockStream as unknown as BiStreamLike);

      await adapter.addPeer(peerId);
      await flush();

      const receivedMessages: any[] = [];
      adapter.on("message", (msg) => receivedMessages.push(msg));

      const outgoing = {
        type: "sync",
        senderId: peerId,
        targetId: "our-id",
        documentId: "doc-1",
        data: new Uint8Array([10, 20, 30]),
      };
      const encoded = cbor.encode(outgoing);
      const bytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
      mockStream.pushMessage(bytes);

      await flush(50);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].senderId).toBe(peerId);
      expect(receivedMessages[0].type).toBe("sync");
      expect(receivedMessages[0].documentId).toBe("doc-1");
    });

    it("emits peer-disconnected when read_message returns null (stream close)", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);

      const mockStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(mockStream as unknown as BiStreamLike);

      await adapter.addPeer(peerId);
      await flush();

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnected.push(payload.peerId));

      mockStream.pushMessage(null);
      await flush(50);

      expect(disconnected).toContain(peerId);
    });

    it("emits peer-disconnected on read error", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);

      const mockStream = createMockBiStream(peerId);
      mockStream.read_message.mockRejectedValueOnce(new Error("read failed"));
      mockMidden.open_bi.mockResolvedValueOnce(mockStream as unknown as BiStreamLike);

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnected.push(payload.peerId));

      await adapter.addPeer(peerId);
      await flush(50);

      expect(disconnected).toContain(peerId);
    });
  });

  // -----------------------------------------------------------------------
  // accept loop
  // -----------------------------------------------------------------------

  describe("accept loop", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("registers incoming streams with correct ALPN", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "c".repeat(64);
      const incomingStream = createMockBiStream(peerId, SYNC_ALPN);

      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));

      mockMidden.pushIncoming(incomingStream as unknown as BiStreamLike);
      await flush(50);

      expect(peerCandidates.some((p) => p.peerId === peerId)).toBe(true);
    });

    it("closes streams with wrong ALPN", async () => {
      const { mockMidden } = await setupConnected();
      const peerId = "d".repeat(64);
      const wrongAlpnStream = createMockBiStream(peerId, "some/other/protocol");

      mockMidden.pushIncoming(wrongAlpnStream as unknown as BiStreamLike);
      await flush(50);

      expect(wrongAlpnStream.close).toHaveBeenCalled();
      expect(wrongAlpnStream._closed).toBe(true);
    });

    it("does not emit peer-candidate for wrong ALPN", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const wrongAlpnStream = createMockBiStream("d".repeat(64), "wrong/alpn");

      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));

      mockMidden.pushIncoming(wrongAlpnStream as unknown as BiStreamLike);
      await flush(50);

      const wrongPeer = peerCandidates.find((p) => p.peerId === "d".repeat(64));
      expect(wrongPeer).toBeUndefined();
    });

    it("dispatches a registered ALPN handler instead of closing the stream", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const alpn = "app-specific/1";
      const handler = vi.fn();
      adapter.registerAlpnHandler(alpn, handler);

      const stream = createMockBiStream("e".repeat(64), alpn);
      mockMidden.pushIncoming(stream as unknown as BiStreamLike);
      await flush(50);

      expect(handler).toHaveBeenCalledWith(stream);
      expect(stream.close).not.toHaveBeenCalled();
    });

    it("stops the accept loop when endpoint returns null", async () => {
      const { adapter, mockMidden } = await setupConnected();

      mockMidden.pushIncoming(null);
      await flush(50);

      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));
      mockMidden.pushIncoming(createMockBiStream("e".repeat(64)) as unknown as BiStreamLike);
      await flush(50);

      expect(peerCandidates).toHaveLength(0);
    });

    it("reads messages from accepted streams", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "f".repeat(64);
      const incomingStream = createMockBiStream(peerId, SYNC_ALPN);

      mockMidden.pushIncoming(incomingStream as unknown as BiStreamLike);
      await flush(50);

      const receivedMessages: any[] = [];
      adapter.on("message", (msg) => receivedMessages.push(msg));

      const outgoing = {
        type: "sync",
        senderId: peerId,
        targetId: "our-id",
        documentId: "doc-accepted",
      };
      const encoded = cbor.encode(outgoing);
      incomingStream.pushMessage(
        new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength)
      );
      await flush(50);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].senderId).toBe(peerId);
      expect(receivedMessages[0].documentId).toBe("doc-accepted");
    });
  });

  // -----------------------------------------------------------------------
  // disconnect()
  // -----------------------------------------------------------------------

  describe("disconnect()", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("emits peer-disconnected for each connected peer", async () => {
      const { adapter } = await setupConnected();
      const peerB = "b".repeat(64);
      const peerC = "c".repeat(64);

      await adapter.addPeer(peerB);
      await adapter.addPeer(peerC);

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnected.push(payload.peerId));

      adapter.disconnect();

      expect(disconnected).toHaveLength(2);
      expect(disconnected).toContain(peerB);
      expect(disconnected).toContain(peerC);
    });

    it("emits close event", async () => {
      const { adapter } = await setupConnected();
      let closed = false;
      adapter.on("close", () => {
        closed = true;
      });

      adapter.disconnect();

      expect(closed).toBe(true);
    });

    it("closes all streams", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerB = "b".repeat(64);
      const streamB = createMockBiStream(peerB);
      mockMidden.open_bi.mockResolvedValueOnce(streamB as unknown as BiStreamLike);

      await adapter.addPeer(peerB);

      adapter.disconnect();

      expect(streamB.close).toHaveBeenCalled();
    });

    it("is idempotent (second call does not throw)", async () => {
      const { adapter } = await setupConnected();
      await adapter.addPeer("b".repeat(64));

      adapter.disconnect();
      expect(() => adapter.disconnect()).not.toThrow();
    });

    it("unsubscribes from identity changes on disconnect", async () => {
      const s = setup();
      s.adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(s.identity.hasCallback).toBe(true);

      s.adapter.disconnect();

      expect(s.identity.hasCallback).toBe(false);
    });

    it("sets endpoint state back to off", async () => {
      const { adapter } = await setupConnected();
      expect(adapter.getEndpointState()).toBe("online");

      adapter.disconnect();

      expect(adapter.getEndpointState()).toBe("off");
    });
  });

  // -----------------------------------------------------------------------
  // registerStream replacing an existing stream (peer supersession rule)
  // -----------------------------------------------------------------------

  describe("stream supersession", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("simultaneous connect: the newest stream takes writes and NEITHER live stream is closed", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const outbound = createMockBiStream(peerId);
      const inbound = createMockBiStream(peerId);

      mockMidden.open_bi.mockResolvedValueOnce(outbound as unknown as BiStreamLike);

      await adapter.addPeer(peerId);

      // peer dialed us at the same time - inbound arrives while our
      // outbound is registered. closing either stream is wrong: with a
      // "close the replaced one" policy, both sides of a simultaneous
      // connect close the stream the OTHER side kept, killing both
      // connections.
      mockMidden.pushIncoming(inbound as unknown as BiStreamLike);
      await flush(50);

      expect(outbound.close).not.toHaveBeenCalled();
      expect(inbound.close).not.toHaveBeenCalled();
      // both streams are being drained
      expect(outbound.read_message).toHaveBeenCalled();
      expect(inbound.read_message).toHaveBeenCalled();
    });

    it("a fresh inbound stream takes over from a zombie incumbent without the zombie's death blocking it (peer restart recovery)", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const zombie = createMockBiStream(peerId);
      const fresh = createMockBiStream(peerId);

      mockMidden.open_bi.mockResolvedValueOnce(zombie as unknown as BiStreamLike);
      await adapter.addPeer(peerId);

      // the peer process restarted and redialed - its fresh inbound must
      // become the write target immediately (writes to the zombie would
      // silently vanish and deadlock recovery)
      mockMidden.pushIncoming(fresh as unknown as BiStreamLike);
      await flush(50);

      expect(fresh.close).not.toHaveBeenCalled();
      expect(fresh.read_message).toHaveBeenCalled();
    });

    it("supersession re-announces peer-candidate after cycling peer-disconnected", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const outbound = createMockBiStream(peerId);
      const inbound = createMockBiStream(peerId);

      mockMidden.open_bi.mockResolvedValueOnce(outbound as unknown as BiStreamLike);
      await adapter.addPeer(peerId);

      const events: string[] = [];
      adapter.on("peer-disconnected", () => events.push("disconnected"));
      adapter.on("peer-candidate", () => events.push("candidate"));

      mockMidden.pushIncoming(inbound as unknown as BiStreamLike);
      await flush(200);

      expect(events).toEqual(["disconnected", "candidate"]);
    });

    it("the superseded stream's own natural death does not remove the peer", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const outbound = createMockBiStream(peerId);
      const inbound = createMockBiStream(peerId);

      mockMidden.open_bi.mockResolvedValueOnce(outbound as unknown as BiStreamLike);
      await adapter.addPeer(peerId);

      mockMidden.pushIncoming(inbound as unknown as BiStreamLike);
      await flush(200);

      const disconnectedAfterSupersede: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnectedAfterSupersede.push(payload.peerId));

      // the OLD (superseded) outbound stream finally dies on its own
      outbound.pushMessage(null);
      await flush(50);

      // the peer is still considered connected via the newer inbound stream
      expect(adapter.isConnected(peerId)).toBe(true);
      expect(disconnectedAfterSupersede).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // stop() / restart()
  // -----------------------------------------------------------------------

  describe("stop() / restart()", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("stop() closes streams, sets endpoint state to off, keeps intended peers", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);

      adapter.stop();

      expect(stream.close).toHaveBeenCalled();
      expect(adapter.getEndpointState()).toBe("off");
      expect(adapter.isConnected(peerId)).toBe(false);
    });

    it("addPeer() while stopped remembers the peer but does not dial", async () => {
      const { adapter, mockMidden } = await setupConnected();
      adapter.stop();

      await adapter.addPeer("b".repeat(64));

      expect(mockMidden.open_bi).not.toHaveBeenCalled();
    });

    it("restart() re-initializes the node and reconnects remembered peers", async () => {
      const { adapter, mockMidden, factory } = await setupConnected();
      const peerId = "b".repeat(64);
      const firstStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(firstStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);

      adapter.stop();
      const callsBeforeRestart = factory.mock.calls.length;

      const reconnectedStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(reconnectedStream as unknown as BiStreamLike);

      await adapter.restart();
      await flush(50);

      expect(factory.mock.calls.length).toBeGreaterThan(callsBeforeRestart);
      expect(adapter.getEndpointState()).toBe("online");
      expect(adapter.isConnected(peerId)).toBe(true);
    });

    it("restart() is a no-op if never stopped", async () => {
      const { adapter, factory } = await setupConnected();
      const callsBefore = factory.mock.calls.length;

      await adapter.restart();

      expect(factory.mock.calls.length).toBe(callsBefore);
    });
  });

  // -----------------------------------------------------------------------
  // reconnection
  // -----------------------------------------------------------------------

  describe("reconnection", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("schedules reconnection when an intended peer disconnects", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      mockMidden.open_bi.mockResolvedValue(createMockBiStream(peerId) as unknown as BiStreamLike);

      vi.useFakeTimers();
      try {
        stream.pushMessage(null); // close the stream -> removePeer -> scheduleReconnect
        await vi.advanceTimersByTimeAsync(2100);

        expect(mockMidden.open_bi).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not schedule reconnection for peers connected via accept loop only", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "c".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.pushIncoming(stream as unknown as BiStreamLike);
      await flush(50);

      const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;

      vi.useFakeTimers();
      try {
        stream.pushMessage(null);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(mockMidden.open_bi.mock.calls.length).toBe(openBiCallsBefore);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reconnects successfully after a transient connection drop", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const firstStream = createMockBiStream(peerId);
      const reconnectedStream = createMockBiStream(peerId);

      mockMidden.open_bi.mockResolvedValueOnce(firstStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      mockMidden.open_bi.mockResolvedValueOnce(reconnectedStream as unknown as BiStreamLike);

      const peerCandidates: string[] = [];
      adapter.on("peer-candidate", (ev: { peerId: PeerId }) => {
        peerCandidates.push(ev.peerId);
      });

      vi.useFakeTimers();
      try {
        firstStream.pushMessage(null);
        await vi.advanceTimersByTimeAsync(2100);

        expect(mockMidden.open_bi).toHaveBeenCalledTimes(2);
        expect(peerCandidates).toContain(peerId);
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives up after maximum reconnection attempts", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const initialStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(initialStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      for (let i = 0; i < 10; i++) {
        mockMidden.open_bi.mockRejectedValueOnce(new Error(`fail ${i}`));
      }

      vi.useFakeTimers();
      try {
        initialStream.pushMessage(null);
        await vi.advanceTimersByTimeAsync(200_000);

        const summary = adapter.getConnectionSummary();
        expect(summary.failed).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears reconnect state when peer reconnects via accept loop", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const firstStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(firstStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      mockMidden.open_bi.mockRejectedValue(new Error("still failing"));

      vi.useFakeTimers();
      try {
        firstStream.pushMessage(null);
        await vi.advanceTimersByTimeAsync(0);

        const incomingStream = createMockBiStream(peerId);
        mockMidden.pushIncoming(incomingStream as unknown as BiStreamLike);
        await vi.advanceTimersByTimeAsync(0);

        const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10_000);
        const openBiCallsAfter = mockMidden.open_bi.mock.calls.length;

        expect(openBiCallsAfter).toBe(openBiCallsBefore);
      } finally {
        vi.useRealTimers();
      }
    });

    it("disconnect() cancels all pending reconnection timers", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      mockMidden.open_bi.mockResolvedValue(createMockBiStream(peerId) as unknown as BiStreamLike);

      vi.useFakeTimers();
      try {
        stream.pushMessage(null);
        await vi.advanceTimersByTimeAsync(0);

        adapter.disconnect();

        const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10_000);
        const openBiCallsAfter = mockMidden.open_bi.mock.calls.length;

        expect(openBiCallsAfter).toBe(openBiCallsBefore);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -----------------------------------------------------------------------
  // forgetPeer()
  // -----------------------------------------------------------------------

  describe("forgetPeer()", () => {
    async function setupConnected() {
      const s = setup();
      s.identity.setStoredIdentity(makeIdentity());
      s.adapter.connect("our-id" as PeerId);
      await flush(50);
      return s;
    }

    it("closes the stream and emits peer-disconnected", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (ev: { peerId: PeerId }) => {
        disconnected.push(ev.peerId);
      });

      adapter.forgetPeer(peerId);

      expect(stream.close).toHaveBeenCalled();
      expect(disconnected).toContain(peerId);
    });

    it("does not schedule reconnection for a forgotten peer", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;

      adapter.forgetPeer(peerId);
      await flush(50);

      expect(mockMidden.open_bi.mock.calls.length).toBe(openBiCallsBefore);
    });

    it("cancels a pending reconnection timer", async () => {
      const { adapter, mockMidden } = await setupConnected();
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      mockMidden.open_bi.mockResolvedValue(createMockBiStream(peerId) as unknown as BiStreamLike);

      vi.useFakeTimers();
      try {
        stream.pushMessage(null); // disconnect -> scheduleReconnect
        await vi.advanceTimersByTimeAsync(0);

        adapter.forgetPeer(peerId);

        const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;
        await vi.advanceTimersByTimeAsync(10_000);
        const openBiCallsAfter = mockMidden.open_bi.mock.calls.length;

        expect(openBiCallsAfter).toBe(openBiCallsBefore);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
