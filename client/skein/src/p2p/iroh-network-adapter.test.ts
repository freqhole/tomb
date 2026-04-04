// ---------------------------------------------------------------------------
// unit tests for IrohNetworkAdapter
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// mock: ./identity
// ---------------------------------------------------------------------------

let __storedIdentity: any = null;
let __identityCallback: ((identity: any) => void) | null = null;

vi.mock("./identity", () => ({
  getStoredIdentity: vi.fn(async () => __storedIdentity),
  onIdentityChange: vi.fn((cb: any) => {
    __identityCallback = cb;
    return () => {
      __identityCallback = null;
    };
  }),
}));

function __setStoredIdentity(identity: any) {
  __storedIdentity = identity;
}

function __triggerIdentityChange(identity: any) {
  __identityCallback?.(identity);
}

// ---------------------------------------------------------------------------
// mock helpers: BiStream and MiddenStreamNode
// ---------------------------------------------------------------------------

import type { BiStreamLike, MiddenStreamNode } from "./iroh-network-adapter";

function createMockBiStream(peerId: string, alpn: string = "iroh/automerge-repo/1") {
  const stream = {
    _messageQueue: [] as (Uint8Array | null)[],
    _written: [] as Uint8Array[],
    _closed: false,
    _readResolvers: [] as ((value: Uint8Array | null) => void)[],

    peer_node_id: () => peerId,
    alpn: () => alpn,

    write_message: vi.fn(async (data: Uint8Array) => {
      stream._written.push(data);
    }),

    read_message: vi.fn(async (): Promise<Uint8Array | null> => {
      if (stream._messageQueue.length > 0) {
        return stream._messageQueue.shift()!;
      }
      return new Promise<Uint8Array | null>((resolve) => {
        stream._readResolvers.push(resolve);
      });
    }),

    close: vi.fn(() => {
      stream._closed = true;
      for (const resolve of stream._readResolvers) {
        resolve(null);
      }
      stream._readResolvers = [];
    }),

    pushMessage(data: Uint8Array | null) {
      if (stream._readResolvers.length > 0) {
        stream._readResolvers.shift()!(data);
      } else {
        stream._messageQueue.push(data);
      }
    },
  };
  return stream;
}

type MockBiStream = ReturnType<typeof createMockBiStream>;

function createMockMidden(nodeId: string = "a".repeat(64)) {
  const acceptQueue: (BiStreamLike | null)[] = [];
  const acceptResolvers: ((value: BiStreamLike | null) => void)[] = [];

  const midden = {
    node_id: () => nodeId,

    open_bi: vi.fn(async (_addr: string, _alpn: string) => {
      return createMockBiStream(_addr);
    }),

    accept: vi.fn(async (): Promise<BiStreamLike | null> => {
      if (acceptQueue.length > 0) {
        return acceptQueue.shift()!;
      }
      return new Promise<BiStreamLike | null>((resolve) => {
        acceptResolvers.push(resolve);
      });
    }),

    pushIncoming(stream: BiStreamLike | null) {
      if (acceptResolvers.length > 0) {
        acceptResolvers.shift()!(stream);
      } else {
        acceptQueue.push(stream);
      }
    },
  };

  return midden;
}

type MockMidden = ReturnType<typeof createMockMidden>;

// ---------------------------------------------------------------------------
// helper: flush microtasks + a small real delay
// ---------------------------------------------------------------------------

function flush(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// imports (after mocks are registered)
// ---------------------------------------------------------------------------

import type { Message, PeerId } from "@automerge/automerge-repo";
import { cbor } from "@automerge/automerge-repo";
import { IrohNetworkAdapter, SYNC_ALPN } from "./iroh-network-adapter";

// ---------------------------------------------------------------------------
// identity fixture
// ---------------------------------------------------------------------------

function makeIdentity(nodeId: string = "a".repeat(64)) {
  return {
    node_id: nodeId,
    secret_key: new Uint8Array(32),
    created_at: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("IrohNetworkAdapter", () => {
  let adapter: IrohNetworkAdapter;
  let mockMidden: MockMidden;
  let factory: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMidden = createMockMidden();
    factory = vi.fn(async () => mockMidden as unknown as MiddenStreamNode);
    __setStoredIdentity(null);
    __identityCallback = null;
  });

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
      adapter = new IrohNetworkAdapter(factory);
      expect(adapter.isReady()).toBe(false);
    });

    it("whenReady() resolves after connect()", async () => {
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-peer-id" as PeerId);
      await adapter.whenReady();
      expect(adapter.isReady()).toBe(true);
    });

    it("stores the peerId passed to connect()", () => {
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("some-peer" as PeerId);
      expect(adapter.peerId).toBe("some-peer");
    });

    it("becomes ready after connect() even without identity", async () => {
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-peer-id" as PeerId);
      await flush();
      expect(adapter.isReady()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // deferred initialization
  // -----------------------------------------------------------------------

  describe("deferred initialization", () => {
    it("does not call midden factory when no identity exists", async () => {
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).not.toHaveBeenCalled();
      expect(adapter.isReady()).toBe(true);
    });

    it("calls midden factory immediately when identity exists at connect time", async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("starts midden when identity is created later via onIdentityChange", async () => {
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).not.toHaveBeenCalled();

      // simulate identity creation
      __triggerIdentityChange(makeIdentity());
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("ignores identity change if already disconnected", async () => {
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);

      adapter.disconnect();
      __triggerIdentityChange(makeIdentity());
      await flush(50);

      expect(factory).not.toHaveBeenCalled();
    });

    it("ignores identity change if midden is already initialized", async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);

      // trigger again — should be a no-op because midden is already set
      __triggerIdentityChange(makeIdentity());
      await flush(50);

      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // addPeer()
  // -----------------------------------------------------------------------

  describe("addPeer()", () => {
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    it("calls open_bi with the correct nodeId and ALPN", async () => {
      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);

      expect(mockMidden.open_bi).toHaveBeenCalledWith(peerId, SYNC_ALPN);
    });

    it("emits peer-candidate after connecting", async () => {
      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));

      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);

      expect(peerCandidates).toHaveLength(1);
      expect(peerCandidates[0].peerId).toBe(peerId);
      expect(peerCandidates[0].peerMetadata).toEqual({ isEphemeral: false });
    });

    it("skips if already connected to that peer", async () => {
      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);
      await adapter.addPeer(peerId);

      expect(mockMidden.open_bi).toHaveBeenCalledTimes(1);
    });

    it("throws if adapter is disconnected", async () => {
      adapter.disconnect();

      await expect(adapter.addPeer("b".repeat(64))).rejects.toThrow("adapter is disconnected");
    });

    it("initializes midden lazily if not yet started", async () => {
      // create a fresh adapter without identity (midden not initialized)
      __setStoredIdentity(null);
      const lazyAdapter = new IrohNetworkAdapter(factory);
      lazyAdapter.connect("our-id" as PeerId);
      await flush(50);

      // factory not called yet
      expect(factory).toHaveBeenCalledTimes(1); // from beforeEach adapter
      const callsBefore = factory.mock.calls.length;

      // addPeer forces ensureMidden
      await lazyAdapter.addPeer("c".repeat(64));
      expect(factory.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  // -----------------------------------------------------------------------
  // send()
  // -----------------------------------------------------------------------

  describe("send()", () => {
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    it("CBOR-encodes message and writes to the correct peer stream", async () => {
      const peerId = "b".repeat(64);
      await adapter.addPeer(peerId);

      // grab the stream that open_bi returned
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
      // decode the written bytes to verify CBOR encoding
      const decoded = cbor.decode(written);
      expect(decoded.type).toBe("sync");
      expect(decoded.targetId).toBe(peerId);
      expect(decoded.documentId).toBe("doc-1");
    });

    it("warns but does not throw when no stream exists for the target", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const message: Message = {
        type: "sync",
        senderId: "our-id" as PeerId,
        targetId: "unknown-peer" as PeerId,
      };

      // should not throw
      adapter.send(message);

      consoleSpy.mockRestore();
    });

    it("removes peer on write failure", async () => {
      const peerId = "b".repeat(64);

      // make open_bi return a stream that will fail on write
      const failingStream = createMockBiStream(peerId);
      failingStream.write_message.mockRejectedValueOnce(new Error("write error"));
      mockMidden.open_bi.mockResolvedValueOnce(failingStream as unknown as BiStreamLike);

      await adapter.addPeer(peerId);

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnected.push(payload.peerId));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      adapter.send({
        type: "sync",
        senderId: "our-id" as PeerId,
        targetId: peerId as PeerId,
      });

      await flush(50);

      expect(disconnected).toContain(peerId);
      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // read loop
  // -----------------------------------------------------------------------

  describe("read loop", () => {
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    it("incoming CBOR messages are decoded and emitted as 'message' events", async () => {
      const peerId = "b".repeat(64);

      // create a controllable stream
      const mockStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(mockStream as unknown as BiStreamLike);

      await adapter.addPeer(peerId);
      await flush();

      const receivedMessages: any[] = [];
      adapter.on("message", (msg) => receivedMessages.push(msg));

      // push a CBOR-encoded message into the stream
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
      // senderId is overridden to the peer's node ID
      expect(receivedMessages[0].senderId).toBe(peerId);
      expect(receivedMessages[0].type).toBe("sync");
      expect(receivedMessages[0].documentId).toBe("doc-1");
    });

    it("emits peer-disconnected when read_message returns null (stream close)", async () => {
      const peerId = "b".repeat(64);

      const mockStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(mockStream as unknown as BiStreamLike);

      await adapter.addPeer(peerId);
      await flush();

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnected.push(payload.peerId));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // simulate stream close
      mockStream.pushMessage(null);
      await flush(50);

      expect(disconnected).toContain(peerId);
      consoleSpy.mockRestore();
    });

    it("emits peer-disconnected on read error", async () => {
      const peerId = "b".repeat(64);

      const mockStream = createMockBiStream(peerId);
      // make read_message throw on the first call
      mockStream.read_message.mockRejectedValueOnce(new Error("read failed"));
      mockMidden.open_bi.mockResolvedValueOnce(mockStream as unknown as BiStreamLike);

      const disconnected: string[] = [];
      adapter.on("peer-disconnected", (payload) => disconnected.push(payload.peerId));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // attach listener BEFORE addPeer — the read loop's rejection resolves
      // in microtasks between the await and subsequent synchronous code
      await adapter.addPeer(peerId);
      await flush(50);

      expect(disconnected).toContain(peerId);
      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // accept loop
  // -----------------------------------------------------------------------

  describe("accept loop", () => {
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    it("registers incoming streams with correct ALPN", async () => {
      const peerId = "c".repeat(64);
      const incomingStream = createMockBiStream(peerId, SYNC_ALPN);

      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));

      mockMidden.pushIncoming(incomingStream as unknown as BiStreamLike);
      await flush(50);

      expect(peerCandidates.some((p) => p.peerId === peerId)).toBe(true);
    });

    it("closes streams with wrong ALPN", async () => {
      const peerId = "d".repeat(64);
      const wrongAlpnStream = createMockBiStream(peerId, "some/other/protocol");

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mockMidden.pushIncoming(wrongAlpnStream as unknown as BiStreamLike);
      await flush(50);

      expect(wrongAlpnStream.close).toHaveBeenCalled();
      expect(wrongAlpnStream._closed).toBe(true);
      consoleSpy.mockRestore();
    });

    it("does not emit peer-candidate for wrong ALPN", async () => {
      const wrongAlpnStream = createMockBiStream("d".repeat(64), "wrong/alpn");

      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mockMidden.pushIncoming(wrongAlpnStream as unknown as BiStreamLike);
      await flush(50);

      // only pre-existing peer-candidates (none from the wrong ALPN stream)
      const wrongPeer = peerCandidates.find((p) => p.peerId === "d".repeat(64));
      expect(wrongPeer).toBeUndefined();
      consoleSpy.mockRestore();
    });

    it("stops the accept loop when endpoint returns null", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mockMidden.pushIncoming(null);
      await flush(50);

      // the loop should have exited — push another and nothing should happen
      // (no error, no new peer-candidate)
      const peerCandidates: any[] = [];
      adapter.on("peer-candidate", (payload) => peerCandidates.push(payload));
      // this just goes into the queue, nobody reads it
      mockMidden.pushIncoming(createMockBiStream("e".repeat(64)) as unknown as BiStreamLike);
      await flush(50);

      expect(peerCandidates).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it("reads messages from accepted streams", async () => {
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
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    it("emits peer-disconnected for each connected peer", async () => {
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
      let closed = false;
      adapter.on("close", () => {
        closed = true;
      });

      adapter.disconnect();

      expect(closed).toBe(true);
    });

    it("closes all streams", async () => {
      const peerB = "b".repeat(64);
      const streamB = createMockBiStream(peerB);
      mockMidden.open_bi.mockResolvedValueOnce(streamB as unknown as BiStreamLike);

      await adapter.addPeer(peerB);

      adapter.disconnect();

      expect(streamB.close).toHaveBeenCalled();
    });

    it("is idempotent (second call does not throw)", async () => {
      await adapter.addPeer("b".repeat(64));

      adapter.disconnect();
      // second disconnect should not throw
      expect(() => adapter.disconnect()).not.toThrow();
    });

    it("unsubscribes from identity changes on disconnect", async () => {
      // create fresh adapter WITHOUT identity so it subscribes
      __setStoredIdentity(null);
      const freshAdapter = new IrohNetworkAdapter(factory);
      freshAdapter.connect("our-id" as PeerId);
      await flush(50);

      // __identityCallback should be set from onIdentityChange
      expect(__identityCallback).not.toBeNull();

      freshAdapter.disconnect();

      // after disconnect, the identity listener should be unsubscribed
      // (our mock sets __identityCallback to null on unsub)
      expect(__identityCallback).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // registerStream replacing an existing stream
  // -----------------------------------------------------------------------

  describe("stream replacement", () => {
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    it("closes old stream when a new one for the same peer is registered", async () => {
      const peerId = "b".repeat(64);
      const firstStream = createMockBiStream(peerId);
      const secondStream = createMockBiStream(peerId);

      mockMidden.open_bi
        .mockResolvedValueOnce(firstStream as unknown as BiStreamLike)
        .mockResolvedValueOnce(secondStream as unknown as BiStreamLike);

      await adapter.addPeer(peerId);

      // forcibly "remove" the old entry to allow a second addPeer
      // (since addPeer short-circuits on existing stream, we simulate via incoming)
      mockMidden.pushIncoming(secondStream as unknown as BiStreamLike);
      await flush(50);

      expect(firstStream.close).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // reconnection
  // -----------------------------------------------------------------------

  describe("reconnection", () => {
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("schedules reconnection when an intended peer disconnects", async () => {
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      const consoleSpy = vi.spyOn(console, "log");

      vi.useFakeTimers();
      stream.pushMessage(null); // close the stream -> removePeer -> scheduleReconnect
      await vi.advanceTimersByTimeAsync(0);

      const reconnectCalls = consoleSpy.mock.calls.filter(
        (args) => typeof args[1] === "string" && args[1].includes("scheduling reconnect")
      );
      expect(reconnectCalls).toHaveLength(1);
      expect(reconnectCalls[0][3]).toMatch(/\(attempt 1\/8, delay \d+ms\)/);
      consoleSpy.mockRestore();
    });

    it("does not schedule reconnection for peers connected via accept loop only", async () => {
      // peer connects to us (not via addPeer) — should not be in intendedPeers
      const peerId = "c".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.pushIncoming(stream as unknown as BiStreamLike);
      await flush(50);

      const consoleSpy = vi.spyOn(console, "log");

      vi.useFakeTimers();
      stream.pushMessage(null);
      await vi.advanceTimersByTimeAsync(0);

      const reconnectCalls = consoleSpy.mock.calls.filter(
        (args) => typeof args[1] === "string" && args[1].includes("scheduling reconnect")
      );
      expect(reconnectCalls).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it("reconnects successfully after a transient connection drop", async () => {
      const peerId = "b".repeat(64);
      const firstStream = createMockBiStream(peerId);
      const reconnectedStream = createMockBiStream(peerId);

      mockMidden.open_bi.mockResolvedValueOnce(firstStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      // set up mock for the reconnect attempt
      mockMidden.open_bi.mockResolvedValueOnce(reconnectedStream as unknown as BiStreamLike);

      const peerCandidates: string[] = [];
      adapter.on("peer-candidate", (ev: { peerId: PeerId }) => {
        peerCandidates.push(ev.peerId);
      });

      vi.useFakeTimers();
      firstStream.pushMessage(null); // disconnect
      await vi.advanceTimersByTimeAsync(0); // process microtasks (removePeer + schedule)

      // advance past max first-attempt delay (1000 base + 1000 jitter = 2000ms)
      await vi.advanceTimersByTimeAsync(2100);

      // open_bi called twice: initial addPeer + reconnect
      expect(mockMidden.open_bi).toHaveBeenCalledTimes(2);
      // peer-candidate emitted again for the reconnected stream
      expect(peerCandidates).toContain(peerId);
    });

    it("retries with increasing backoff on repeated failures", async () => {
      const peerId = "b".repeat(64);
      const initialStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(initialStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      // make reconnect attempts fail
      mockMidden.open_bi
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"));

      const warnSpy = vi.spyOn(console, "warn");

      vi.useFakeTimers();
      initialStream.pushMessage(null);
      await vi.advanceTimersByTimeAsync(0);

      // attempt 1: base delay = 1000ms + up to 1000ms jitter
      await vi.advanceTimersByTimeAsync(2100);
      // attempt 1 fires and fails, schedules attempt 2

      // attempt 2: base delay = 2000ms + up to 1000ms jitter
      await vi.advanceTimersByTimeAsync(3100);
      // attempt 2 fires and fails

      const failCalls = warnSpy.mock.calls.filter(
        (args) => typeof args[1] === "string" && args[1].includes("reconnect attempt failed")
      );
      expect(failCalls.length).toBeGreaterThanOrEqual(2);
      warnSpy.mockRestore();
    });

    it("gives up after maximum reconnection attempts", async () => {
      const peerId = "b".repeat(64);
      const initialStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(initialStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      // make all reconnect attempts fail
      for (let i = 0; i < 10; i++) {
        mockMidden.open_bi.mockRejectedValueOnce(new Error(`fail ${i}`));
      }

      const warnSpy = vi.spyOn(console, "warn");

      vi.useFakeTimers();
      initialStream.pushMessage(null);

      // advance through all 8 attempts with generous time:
      // sum of min(1000*2^i, 30000) + 1000 for i=0..7 is ~129s, use 200s
      await vi.advanceTimersByTimeAsync(200_000);

      const gaveUpCalls = warnSpy.mock.calls.filter(
        (args) => typeof args[1] === "string" && args[1].includes("giving up reconnection")
      );
      expect(gaveUpCalls).toHaveLength(1);
      warnSpy.mockRestore();
    });

    it("clears reconnect state when peer reconnects via accept loop", async () => {
      const peerId = "b".repeat(64);
      const firstStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(firstStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      // make outbound reconnect attempts fail so it stays in backoff
      mockMidden.open_bi.mockRejectedValue(new Error("still failing"));

      vi.useFakeTimers();
      firstStream.pushMessage(null);
      await vi.advanceTimersByTimeAsync(0);

      // peer connects to us via accept loop while we're in backoff
      const incomingStream = createMockBiStream(peerId);
      mockMidden.pushIncoming(incomingStream as unknown as BiStreamLike);
      await vi.advanceTimersByTimeAsync(0);

      // advance well past any scheduled reconnect timer
      const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      const openBiCallsAfter = mockMidden.open_bi.mock.calls.length;

      // no additional open_bi calls — the incoming connection satisfied the intent
      expect(openBiCallsAfter).toBe(openBiCallsBefore);
    });

    it("disconnect() cancels all pending reconnection timers", async () => {
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      mockMidden.open_bi.mockResolvedValue(createMockBiStream(peerId) as unknown as BiStreamLike);

      vi.useFakeTimers();
      stream.pushMessage(null); // trigger disconnect -> scheduleReconnect
      await vi.advanceTimersByTimeAsync(0);

      // disconnect before the reconnect timer fires
      adapter.disconnect();

      const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      const openBiCallsAfter = mockMidden.open_bi.mock.calls.length;

      // no reconnect attempt was made
      expect(openBiCallsAfter).toBe(openBiCallsBefore);
    });

    it("addPeer() resets reconnect backoff for that peer", async () => {
      const peerId = "b".repeat(64);
      const firstStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(firstStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      // make the first reconnect attempt fail so backoff count increments
      mockMidden.open_bi.mockRejectedValueOnce(new Error("transient"));

      vi.useFakeTimers();
      firstStream.pushMessage(null);
      await vi.advanceTimersByTimeAsync(2100); // first reconnect fires and fails
      vi.useRealTimers();

      // call addPeer again — this resets backoff and makes a fresh connection
      const freshStream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(freshStream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      // verify open_bi was called with the peerId for the fresh attempt
      const lastCall = mockMidden.open_bi.mock.calls[mockMidden.open_bi.mock.calls.length - 1];
      expect(lastCall[0]).toBe(peerId);
    });
  });

  // -----------------------------------------------------------------------
  // forgetPeer()
  // -----------------------------------------------------------------------

  describe("forgetPeer()", () => {
    beforeEach(async () => {
      __setStoredIdentity(makeIdentity());
      adapter = new IrohNetworkAdapter(factory);
      adapter.connect("our-id" as PeerId);
      await flush(50);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("closes the stream and emits peer-disconnected", async () => {
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
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      const consoleSpy = vi.spyOn(console, "log");

      adapter.forgetPeer(peerId);
      await flush(50);

      const reconnectCalls = consoleSpy.mock.calls.filter(
        (args) => typeof args[1] === "string" && args[1].includes("scheduling reconnect")
      );
      expect(reconnectCalls).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it("cancels a pending reconnection timer", async () => {
      const peerId = "b".repeat(64);
      const stream = createMockBiStream(peerId);
      mockMidden.open_bi.mockResolvedValueOnce(stream as unknown as BiStreamLike);
      await adapter.addPeer(peerId);
      await flush(50);

      mockMidden.open_bi.mockResolvedValue(createMockBiStream(peerId) as unknown as BiStreamLike);

      vi.useFakeTimers();
      stream.pushMessage(null); // disconnect -> scheduleReconnect
      await vi.advanceTimersByTimeAsync(0);

      // forget the peer while a reconnect timer is pending
      adapter.forgetPeer(peerId);

      const openBiCallsBefore = mockMidden.open_bi.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      const openBiCallsAfter = mockMidden.open_bi.mock.calls.length;

      // no reconnect attempts should have been made
      expect(openBiCallsAfter).toBe(openBiCallsBefore);
    });
  });
});
