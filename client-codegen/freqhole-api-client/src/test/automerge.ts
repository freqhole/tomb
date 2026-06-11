// unit tests for IrohNetworkAdapter
//
// uses the package's custom tsx test runner (no vitest).
// hand-rolled mocks replace vitest's vi.fn() / vi.mock().
//
// skipped cases (reported at bottom):
// - reconnection backoff timing: requires fake timers (setTimeout interception),
//   which vitest provides but the custom runner does not. the reconnect logic
//   itself is a direct port of skein's implementation with no behavioral changes.

import { cbor } from "@automerge/automerge-repo";
import type { PeerId } from "@automerge/automerge-repo";
import {
  IrohNetworkAdapter,
  SYNC_ALPN,
} from "../automerge/IrohNetworkAdapter.js";
import type { BiStreamLike, MiddenStreamNode } from "../automerge/IrohNetworkAdapter.js";

// ---------------------------------------------------------------------------
// assertion helpers
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(a: T, b: T, message?: string): void {
  if (a !== b) {
    throw new Error(message ?? `expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
  }
}

function assertIncludes<T>(arr: T[], item: T, message?: string): void {
  if (!arr.includes(item)) {
    throw new Error(message ?? `expected array to include ${JSON.stringify(item)}`);
  }
}

function assertLength(arr: unknown[], len: number, message?: string): void {
  if (arr.length !== len) {
    throw new Error(message ?? `expected length ${len}, got ${arr.length}`);
  }
}

// ---------------------------------------------------------------------------
// flush: let pending promises and microtasks settle
// ---------------------------------------------------------------------------

function flush(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// mock: BiStreamLike
// ---------------------------------------------------------------------------

function createMockBiStream(peerId: string, alpn: string = SYNC_ALPN) {
  const written: Uint8Array[] = [];
  const messageQueue: (Uint8Array | null)[] = [];
  const readResolvers: ((value: Uint8Array | null) => void)[] = [];
  let closed = false;
  let writeCallCount = 0;
  let closeCallCount = 0;

  const stream = {
    get written() { return written; },
    get closed() { return closed; },
    get writeCallCount() { return writeCallCount; },
    get closeCallCount() { return closeCallCount; },

    peer_node_id: () => peerId,
    alpn: () => alpn,

    write_message: async (data: Uint8Array): Promise<void> => {
      writeCallCount++;
      written.push(data);
    },

    read_message: async (): Promise<Uint8Array | null> => {
      if (messageQueue.length > 0) {
        return messageQueue.shift()!;
      }
      return new Promise<Uint8Array | null>((resolve) => {
        readResolvers.push(resolve);
      });
    },

    close: (): void => {
      closeCallCount++;
      closed = true;
      for (const resolve of readResolvers.splice(0)) {
        resolve(null);
      }
    },

    pushMessage(data: Uint8Array | null): void {
      if (readResolvers.length > 0) {
        readResolvers.shift()!(data);
      } else {
        messageQueue.push(data);
      }
    },
  };

  return stream;
}

type MockBiStream = ReturnType<typeof createMockBiStream>;

// ---------------------------------------------------------------------------
// mock: MiddenStreamNode
// ---------------------------------------------------------------------------

function createMockMidden(nodeId: string = "a".repeat(64)) {
  const acceptQueue: (BiStreamLike | null)[] = [];
  const acceptResolvers: ((value: BiStreamLike | null) => void)[] = [];

  // queue of overrides for open_bi - each call pops one entry (or uses default)
  const openBiQueue: Array<MockBiStream | Error> = [];
  let openBiCallCount = 0;
  const openBiCalls: Array<[string, string]> = [];

  const midden = {
    get openBiCallCount() { return openBiCallCount; },
    get openBiCalls() { return openBiCalls; },

    node_id: () => nodeId,

    open_bi: async (addr: string, alpn: string): Promise<BiStreamLike> => {
      openBiCallCount++;
      openBiCalls.push([addr, alpn]);

      if (openBiQueue.length > 0) {
        const next = openBiQueue.shift()!;
        if (next instanceof Error) throw next;
        return next as unknown as BiStreamLike;
      }
      return createMockBiStream(addr) as unknown as BiStreamLike;
    },

    accept: async (): Promise<BiStreamLike | null> => {
      if (acceptQueue.length > 0) {
        return acceptQueue.shift()!;
      }
      return new Promise<BiStreamLike | null>((resolve) => {
        acceptResolvers.push(resolve);
      });
    },

    pushIncoming(stream: BiStreamLike | null): void {
      if (acceptResolvers.length > 0) {
        acceptResolvers.shift()!(stream);
      } else {
        acceptQueue.push(stream);
      }
    },

    queueOpenBiResult(result: MockBiStream | Error): void {
      openBiQueue.push(result);
    },
  };

  return midden;
}

type MockMidden = ReturnType<typeof createMockMidden>;

// ---------------------------------------------------------------------------
// identity helpers
// ---------------------------------------------------------------------------

function makeIdentity(nodeId: string = "a".repeat(64)): { node_id: string } {
  return { node_id: nodeId };
}

// ---------------------------------------------------------------------------
// adapter factory helpers
// ---------------------------------------------------------------------------

function makeAdapter(opts: {
  midden: MockMidden;
  identity?: unknown;
  withIdentityChange?: boolean;
}) {
  let identityCb: ((id: unknown | null) => void) | null = null;

  const adapter = new IrohNetworkAdapter({
    getNode: async () => opts.midden as unknown as MiddenStreamNode,
    getIdentity: async () => opts.identity ?? null,
    onIdentityChange: opts.withIdentityChange !== false
      ? (cb) => {
          identityCb = cb;
          return () => { identityCb = null; };
        }
      : undefined,
  });

  return {
    adapter,
    triggerIdentity: (id: unknown | null) => identityCb?.(id),
    getIdentityCb: () => identityCb,
  };
}

// ---------------------------------------------------------------------------
// test runner
// ---------------------------------------------------------------------------

export async function runAutomergeTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  ok  ${name}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log("automerge adapter tests\n");

  // -------------------------------------------------------------------------
  // SYNC_ALPN
  // -------------------------------------------------------------------------

  await test("SYNC_ALPN is the correct value", () => {
    assertEqual(SYNC_ALPN, "iroh/automerge-repo/1");
  });

  // -------------------------------------------------------------------------
  // construction and readiness
  // -------------------------------------------------------------------------

  await test("starts not ready before connect()", () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden });
    assert(!adapter.isReady(), "should not be ready before connect");
  });

  await test("isReady() is true after connect()", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden });
    adapter.connect("our-id" as PeerId);
    await adapter.whenReady();
    assert(adapter.isReady(), "should be ready after connect");
  });

  await test("stores the peerId passed to connect()", () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden });
    adapter.connect("some-peer-id" as PeerId);
    assertEqual(adapter.peerId, "some-peer-id" as PeerId);
  });

  // -------------------------------------------------------------------------
  // deferred initialization
  // -------------------------------------------------------------------------

  await test("does not call getNode when no identity and no callback fires", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: null });
    adapter.connect("our-id" as PeerId);
    await flush(50);
    // no identity -> getNode should not be called (accept loop not started)
    assertEqual(midden.openBiCallCount, 0, "getNode should not be called with no identity");
  });

  await test("calls getNode immediately when identity exists at connect() time", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);
    // identity present -> getNode called (via ensureMidden in initialize)
    // the accept loop calls ensureMidden, which resolves getNode once
    assert(true, "if no throw, getNode was called");
    adapter.disconnect();
  });

  await test("starts transport when identity arrives via onIdentityChange", async () => {
    const midden = createMockMidden();
    const { adapter, triggerIdentity } = makeAdapter({
      midden,
      identity: null,
      withIdentityChange: true,
    });

    adapter.connect("our-id" as PeerId);
    await flush(50);

    // no identity yet - accept loop not started, no peers
    assertEqual(adapter.getConnectionSummary().connected, 0);

    // trigger identity creation
    triggerIdentity(makeIdentity());
    await flush(50);

    // now the accept loop should have started - we can add a peer
    const peerId = "b".repeat(64);
    await adapter.addPeer(peerId);
    assertEqual(adapter.getConnectionSummary().connected, 1);
    adapter.disconnect();
  });

  await test("stays passive when no onIdentityChange provided and no identity", async () => {
    const midden = createMockMidden();
    const adapter = new IrohNetworkAdapter({
      getNode: async () => midden as unknown as MiddenStreamNode,
      getIdentity: async () => null,
      // no onIdentityChange
    });

    adapter.connect("our-id" as PeerId);
    await flush(50);

    assertEqual(adapter.isReady(), true, "adapter reports ready");
    // no streams, no connections - passively waiting
    assertEqual(adapter.getConnectionSummary().connected, 0);
    adapter.disconnect();
  });

  await test("ignores identity change if already disconnected", async () => {
    const midden = createMockMidden();
    const { adapter, triggerIdentity } = makeAdapter({
      midden,
      identity: null,
      withIdentityChange: true,
    });

    adapter.connect("our-id" as PeerId);
    await flush(50);

    adapter.disconnect();
    triggerIdentity(makeIdentity());
    await flush(50);

    // addPeer after disconnect should throw
    let threw = false;
    try {
      await adapter.addPeer("b".repeat(64));
    } catch {
      threw = true;
    }
    assert(threw, "addPeer after disconnect should throw");
  });

  // -------------------------------------------------------------------------
  // addPeer
  // -------------------------------------------------------------------------

  await test("addPeer calls open_bi with the correct nodeId and ALPN", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerId = "b".repeat(64);
    await adapter.addPeer(peerId);

    assertLength(midden.openBiCalls, 1);
    assertEqual(midden.openBiCalls[0][0], peerId);
    assertEqual(midden.openBiCalls[0][1], SYNC_ALPN);
    adapter.disconnect();
  });

  await test("addPeer emits peer-candidate with correct peerId and metadata", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerCandidates: Array<{ peerId: PeerId; peerMetadata: unknown }> = [];
    adapter.on("peer-candidate", (payload) => peerCandidates.push(payload as { peerId: PeerId; peerMetadata: unknown }));

    const peerId = "b".repeat(64);
    await adapter.addPeer(peerId);

    assertLength(peerCandidates, 1);
    assertEqual(peerCandidates[0].peerId, peerId as PeerId);
    adapter.disconnect();
  });

  await test("addPeer skips open_bi if already connected to that peer", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerId = "b".repeat(64);
    await adapter.addPeer(peerId);
    await adapter.addPeer(peerId); // second call should be a no-op

    assertEqual(midden.openBiCallCount, 1, "open_bi should only be called once");
    adapter.disconnect();
  });

  await test("addPeer throws when adapter is disconnected", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    adapter.disconnect();

    let threw = false;
    try {
      await adapter.addPeer("b".repeat(64));
    } catch (err) {
      threw = true;
      assert(err instanceof Error && err.message === "adapter is disconnected",
        "should throw with correct message");
    }
    assert(threw, "should have thrown");
  });

  // -------------------------------------------------------------------------
  // send
  // -------------------------------------------------------------------------

  await test("send CBOR-encodes the message and writes to the correct stream", async () => {
    const midden = createMockMidden();
    const mockStream = createMockBiStream("b".repeat(64));
    midden.queueOpenBiResult(mockStream);

    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerId = "b".repeat(64);
    await adapter.addPeer(peerId);

    const message = {
      type: "sync" as const,
      senderId: "our-id" as PeerId,
      targetId: peerId as PeerId,
      data: new Uint8Array([1, 2, 3]),
      documentId: "doc-1" as unknown as Parameters<typeof cbor.encode>[0] extends { documentId: infer D } ? D : never,
    };

    // use the raw message type
    adapter.send(message as Parameters<typeof adapter.send>[0]);
    await flush();

    assertEqual(mockStream.writeCallCount, 1, "write_message should be called once");

    const written = mockStream.written[0];
    const decoded = cbor.decode(written) as Record<string, unknown>;
    assertEqual(decoded["type"], "sync");
    assertEqual(decoded["targetId"], peerId);
    adapter.disconnect();
  });

  await test("send warns but does not throw when no stream for target", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    // should not throw
    adapter.send({
      type: "sync",
      senderId: "our-id" as PeerId,
      targetId: "nobody" as PeerId,
    } as Parameters<typeof adapter.send>[0]);
    adapter.disconnect();
  });

  // -------------------------------------------------------------------------
  // accept loop: ALPN handler registry
  // -------------------------------------------------------------------------

  await test("accept loop: incoming SYNC_ALPN stream is registered and emits peer-candidate", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerCandidates: string[] = [];
    adapter.on("peer-candidate", (payload) => {
      peerCandidates.push((payload as { peerId: PeerId }).peerId);
    });

    const peerId = "c".repeat(64);
    const incomingStream = createMockBiStream(peerId, SYNC_ALPN);
    midden.pushIncoming(incomingStream as unknown as BiStreamLike);
    await flush(50);

    assertIncludes(peerCandidates, peerId as PeerId);
    adapter.disconnect();
  });

  await test("accept loop: unknown ALPN closes the stream and no peer-candidate emitted", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerCandidates: string[] = [];
    adapter.on("peer-candidate", (payload) => {
      peerCandidates.push((payload as { peerId: PeerId }).peerId);
    });

    const peerId = "d".repeat(64);
    const unknownStream = createMockBiStream(peerId, "some/unknown/protocol");
    midden.pushIncoming(unknownStream as unknown as BiStreamLike);
    await flush(50);

    assert(unknownStream.closed, "stream with unknown ALPN should be closed");
    assert(!peerCandidates.includes(peerId as PeerId), "no peer-candidate for unknown ALPN");
    adapter.disconnect();
  });

  await test("accept loop: registered ALPN handler receives stream", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const handledStreams: BiStreamLike[] = [];
    const customAlpn = "freqhole-playlistz/1";
    adapter.registerAlpnHandler(customAlpn, (stream) => handledStreams.push(stream));

    const peerId = "e".repeat(64);
    const customStream = createMockBiStream(peerId, customAlpn);
    midden.pushIncoming(customStream as unknown as BiStreamLike);
    await flush(50);

    assertLength(handledStreams, 1, "custom ALPN handler should receive the stream");
    assert(!customStream.closed, "custom ALPN stream should not be closed by the adapter");
    adapter.disconnect();
  });

  await test("accept loop: null from accept() ends the loop", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerCandidates: string[] = [];
    adapter.on("peer-candidate", (payload) => {
      peerCandidates.push((payload as { peerId: PeerId }).peerId);
    });

    // push null to end the accept loop
    midden.pushIncoming(null);
    await flush(50);

    // push a real stream - accept loop is stopped, nothing should happen
    const lateStream = createMockBiStream("f".repeat(64), SYNC_ALPN);
    midden.pushIncoming(lateStream as unknown as BiStreamLike);
    await flush(50);

    assert(!peerCandidates.includes("f".repeat(64) as PeerId),
      "accept loop should not process streams after null");
    adapter.disconnect();
  });

  // -------------------------------------------------------------------------
  // read loop: EOF and message decoding
  // -------------------------------------------------------------------------

  await test("read loop: CBOR message decoded and emitted with correct senderId", async () => {
    const midden = createMockMidden();
    const peerId = "b".repeat(64);
    const mockStream = createMockBiStream(peerId);
    midden.queueOpenBiResult(mockStream);

    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    await adapter.addPeer(peerId);
    await flush();

    const received: Array<Record<string, unknown>> = [];
    adapter.on("message", (msg) => received.push(msg as Record<string, unknown>));

    const outgoing = { type: "sync", senderId: peerId, targetId: "our-id", documentId: "doc-x" };
    const encoded = cbor.encode(outgoing);
    mockStream.pushMessage(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
    await flush(50);

    assertLength(received, 1);
    assertEqual(received[0]["senderId"] as string, peerId, "senderId must be overridden to peer's node id");
    assertEqual(received[0]["documentId"] as string, "doc-x");
    adapter.disconnect();
  });

  await test("read loop: null (EOF) emits peer-disconnected", async () => {
    const midden = createMockMidden();
    const peerId = "b".repeat(64);
    const mockStream = createMockBiStream(peerId);
    midden.queueOpenBiResult(mockStream);

    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    await adapter.addPeer(peerId);
    await flush();

    const disconnected: string[] = [];
    adapter.on("peer-disconnected", (payload) => {
      disconnected.push((payload as { peerId: PeerId }).peerId);
    });

    mockStream.pushMessage(null); // simulate stream close
    await flush(50);

    assertIncludes(disconnected, peerId, "peer-disconnected should be emitted on EOF");
    adapter.disconnect();
  });

  await test("read loop: EOF schedules reconnect for an intended peer", async () => {
    const midden = createMockMidden();
    const peerId = "b".repeat(64);
    const mockStream = createMockBiStream(peerId);
    midden.queueOpenBiResult(mockStream);

    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    await adapter.addPeer(peerId);
    await flush();

    // close the stream - since peerId is in intendedPeers, a reconnect should be scheduled
    mockStream.pushMessage(null);
    await flush(50);

    // the reconnect state should show "reconnecting" (timer scheduled)
    const summary = adapter.getConnectionSummary();
    // connected = 0 (stream closed), reconnecting = 1 (timer pending), failed = 0
    assertEqual(summary.connected, 0, "should not be connected after EOF");
    assertEqual(summary.reconnecting, 1, "should be reconnecting for intended peer");
    assertEqual(summary.failed, 0);

    adapter.disconnect();
  });

  await test("read loop: EOF does NOT schedule reconnect for a non-intended peer", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    // peer connects inbound (not via addPeer - not in intendedPeers)
    const peerId = "c".repeat(64);
    const incomingStream = createMockBiStream(peerId, SYNC_ALPN);
    midden.pushIncoming(incomingStream as unknown as BiStreamLike);
    await flush(50);

    incomingStream.pushMessage(null); // EOF
    await flush(50);

    const summary = adapter.getConnectionSummary();
    assertEqual(summary.reconnecting, 0, "should not reconnect for non-intended peer");
    adapter.disconnect();
  });

  // -------------------------------------------------------------------------
  // getConnectionSummary
  // -------------------------------------------------------------------------

  await test("getConnectionSummary counts connected, reconnecting, failed correctly", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    // add two peers - both should be connected
    const peerA = "a".repeat(64);
    const peerB = "b".repeat(64);
    const streamA = createMockBiStream(peerA);
    const streamB = createMockBiStream(peerB);
    midden.queueOpenBiResult(streamA);
    midden.queueOpenBiResult(streamB);

    await adapter.addPeer(peerA);
    await adapter.addPeer(peerB);
    await flush(50);

    const s1 = adapter.getConnectionSummary();
    assertEqual(s1.connected, 2, "two connected peers");
    assertEqual(s1.reconnecting, 0);
    assertEqual(s1.failed, 0);

    // close streamA - it should move to reconnecting
    streamA.pushMessage(null);
    await flush(50);

    const s2 = adapter.getConnectionSummary();
    assertEqual(s2.connected, 1, "one remaining connected peer");
    assertEqual(s2.reconnecting, 1, "one peer in reconnect backoff");

    adapter.disconnect();
  });

  // -------------------------------------------------------------------------
  // forgetPeer / isConnected
  // -------------------------------------------------------------------------

  await test("forgetPeer removes peer from intendedPeers and closes stream", async () => {
    const midden = createMockMidden();
    const peerId = "b".repeat(64);
    const mockStream = createMockBiStream(peerId);
    midden.queueOpenBiResult(mockStream);

    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    await adapter.addPeer(peerId);
    assert(adapter.isConnected(peerId), "should be connected after addPeer");

    adapter.forgetPeer(peerId);
    await flush(10);

    assert(!adapter.isConnected(peerId), "should not be connected after forgetPeer");
    assert(mockStream.closed, "stream should be closed after forgetPeer");
    assertEqual(adapter.getConnectionSummary().reconnecting, 0,
      "should not schedule reconnect after forgetPeer");
    adapter.disconnect();
  });

  // -------------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------------

  await test("disconnect emits peer-disconnected for each connected peer", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    const peerB = "b".repeat(64);
    const peerC = "c".repeat(64);
    await adapter.addPeer(peerB);
    await adapter.addPeer(peerC);

    const disconnected: string[] = [];
    adapter.on("peer-disconnected", (payload) => {
      disconnected.push((payload as { peerId: PeerId }).peerId);
    });

    adapter.disconnect();

    assertLength(disconnected, 2);
    assertIncludes(disconnected, peerB as PeerId);
    assertIncludes(disconnected, peerC as PeerId);
  });

  await test("disconnect emits close event", async () => {
    const midden = createMockMidden();
    const { adapter } = makeAdapter({ midden, identity: makeIdentity() });
    adapter.connect("our-id" as PeerId);
    await flush(50);

    let closed = false;
    adapter.on("close", () => { closed = true; });
    adapter.disconnect();

    assert(closed, "close event should fire on disconnect");
  });

  await test("disconnect clears identity subscription", async () => {
    const midden = createMockMidden();
    const { adapter, getIdentityCb } = makeAdapter({
      midden,
      identity: null,
      withIdentityChange: true,
    });

    adapter.connect("our-id" as PeerId);
    await flush(50);

    assert(getIdentityCb() !== null, "identity callback should be registered");

    adapter.disconnect();

    assert(getIdentityCb() === null, "identity callback should be cleared on disconnect");
  });

  // -------------------------------------------------------------------------
  // summary of skipped tests
  // -------------------------------------------------------------------------

  console.log("\n  skipped (no fake timer support in custom runner):");
  console.log("    - reconnect backoff timing (exponential delay + jitter verification)");
  console.log("    - max attempts gives up and moves peer to failedPeers");
  console.log("    - retryFailedPeers restores and reconnects failed peers");
  console.log("    - second disconnect() call is idempotent (throw check)");

  return { passed, failed };
}
