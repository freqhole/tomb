import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFriendzClient,
  type BiStreamLike,
  type FriendzClient,
} from "./client.js";
import type { FriendzMessage } from "./codec.js";

const ALPN = "freqhole-friendz/1";

/** a minimal async queue backing an in-memory duplex BiStreamLike pair. */
function createQueue<T>() {
  const items: T[] = [];
  const waiters: Array<(value: T | null) => void> = [];
  let closed = false;
  return {
    push(item: T): void {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter(item);
      else items.push(item);
    },
    pop(): Promise<T | null> {
      if (items.length > 0) return Promise.resolve(items.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close(): void {
      closed = true;
      while (waiters.length > 0) waiters.shift()!(null);
    },
  };
}

/** two BiStreamLike ends wired to each other - no real transport involved. */
function createDuplexPair(
  nodeIdA: string,
  nodeIdB: string,
): { streamA: BiStreamLike; streamB: BiStreamLike } {
  const aToB = createQueue<Uint8Array>();
  const bToA = createQueue<Uint8Array>();

  const streamA: BiStreamLike = {
    peer_node_id: () => nodeIdB,
    alpn: () => ALPN,
    write_message: async (data) => {
      aToB.push(data);
    },
    read_message: () => bToA.pop(),
    close: () => {
      aToB.close();
    },
  };

  const streamB: BiStreamLike = {
    peer_node_id: () => nodeIdA,
    alpn: () => ALPN,
    write_message: async (data) => {
      bToA.push(data);
    },
    read_message: () => aToB.pop(),
    close: () => {
      bToA.close();
    },
  };

  return { streamA, streamB };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let clients: FriendzClient[] = [];

function track(client: FriendzClient): FriendzClient {
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const client of clients) client.destroy();
  clients = [];
  vi.useRealTimers();
});

describe("createFriendzClient", () => {
  it("delivers a message sent from an opened stream to the accepting side", async () => {
    const { streamA, streamB } = createDuplexPair("node-a", "node-b");

    const received: Array<{ message: FriendzMessage; fromNodeId: string }> = [];
    const nodeB = track(
      createFriendzClient({
        getNode: async () => {
          throw new Error("node B never opens outbound in this test");
        },
        localNodeId: "node-b",
        localUsername: "bob",
        onMessage: (message, fromNodeId) => received.push({ message, fromNodeId }),
      }),
    );
    nodeB.handleIncomingStream(streamB);

    const nodeA = track(
      createFriendzClient({
        getNode: async () => ({
          node_id: () => "node-a",
          open_bi: async () => streamA,
        }),
        localNodeId: "node-a",
        localUsername: "alice",
      }),
    );

    await nodeA.sendMessage("node-b", {
      kind: "core",
      message: {
        type: "knock-request",
        v: 1,
        knockId: "k1",
        nodeId: "node-a",
        message: "hi",
        scope: { kind: "browse" },
      },
    });
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0]!.fromNodeId).toBe("node-a");
    expect(received[0]!.message).toMatchObject({
      kind: "core",
      message: { type: "knock-request", knockId: "k1" },
    });
  });

  it("reuses an already-open stream instead of opening a new one", async () => {
    const { streamA, streamB } = createDuplexPair("node-a", "node-b");
    const nodeB = track(
      createFriendzClient({
        getNode: async () => {
          throw new Error("unused");
        },
        localNodeId: "node-b",
        localUsername: "bob",
      }),
    );
    nodeB.handleIncomingStream(streamB);

    let opens = 0;
    const nodeA = track(
      createFriendzClient({
        getNode: async () => ({
          node_id: () => "node-a",
          open_bi: async () => {
            opens += 1;
            return streamA;
          },
        }),
        localNodeId: "node-a",
        localUsername: "alice",
      }),
    );

    const msg: FriendzMessage = {
      kind: "core",
      message: { type: "offline-announcement", v: 1, nodeId: "node-a" },
    };
    await nodeA.sendMessage("node-b", msg);
    await nodeA.sendMessage("node-b", msg);
    expect(opens).toBe(1);
  });

  it("marks a peer online on receiving a heartbeat and fires onPeerBecameOnline once", async () => {
    const { streamA, streamB } = createDuplexPair("node-a", "node-b");
    const becameOnline: string[] = [];
    const nodeB = track(
      createFriendzClient({
        getNode: async () => {
          throw new Error("unused");
        },
        localNodeId: "node-b",
        localUsername: "bob",
        onPeerBecameOnline: (nodeId) => becameOnline.push(nodeId),
      }),
    );
    nodeB.handleIncomingStream(streamB);

    const nodeA = track(
      createFriendzClient({
        getNode: async () => ({
          node_id: () => "node-a",
          open_bi: async () => streamA,
        }),
        localNodeId: "node-a",
        localUsername: "alice",
      }),
    );

    expect(nodeB.isOnline("node-a")).toBe(false);
    await nodeA.sendMessage("node-a", {
      kind: "core",
      message: { type: "heartbeat", v: 1, nodeId: "node-a", username: "alice" },
    });
    await flush();

    expect(nodeB.isOnline("node-a")).toBe(true);
    expect(nodeB.getOnlinePeers()).toEqual(["node-a"]);
    expect(becameOnline).toEqual(["node-a"]);
  });

  it("marks a peer offline on an explicit offline-announcement", async () => {
    const { streamA, streamB } = createDuplexPair("node-a", "node-b");
    const wentOffline: string[] = [];
    const nodeB = track(
      createFriendzClient({
        getNode: async () => {
          throw new Error("unused");
        },
        localNodeId: "node-b",
        localUsername: "bob",
        onPeerWentOffline: (nodeId) => wentOffline.push(nodeId),
      }),
    );
    nodeB.handleIncomingStream(streamB);

    const nodeA = track(
      createFriendzClient({
        getNode: async () => ({
          node_id: () => "node-a",
          open_bi: async () => streamA,
        }),
        localNodeId: "node-a",
        localUsername: "alice",
      }),
    );

    await nodeA.sendMessage("node-a", {
      kind: "core",
      message: { type: "heartbeat", v: 1, nodeId: "node-a", username: "alice" },
    });
    await flush();
    expect(nodeB.isOnline("node-a")).toBe(true);

    await nodeA.sendMessage("node-a", {
      kind: "core",
      message: { type: "offline-announcement", v: 1, nodeId: "node-a" },
    });
    await flush();

    expect(nodeB.isOnline("node-a")).toBe(false);
    expect(wentOffline).toEqual(["node-a"]);
  });

  it("calls onDecodeError instead of throwing when a peer sends garbage bytes", async () => {
    const { streamA, streamB } = createDuplexPair("node-a", "node-b");
    const errors: unknown[] = [];
    const nodeB = track(
      createFriendzClient({
        getNode: async () => {
          throw new Error("unused");
        },
        localNodeId: "node-b",
        localUsername: "bob",
        onDecodeError: (error) => errors.push(error),
      }),
    );
    nodeB.handleIncomingStream(streamB);

    await streamA.write_message(new TextEncoder().encode("not json"));
    await flush();

    expect(errors).toHaveLength(1);
  });

  it("startHeartbeat sends an immediate heartbeat and stopHeartbeat halts further ticks", async () => {
    vi.useFakeTimers();
    const { streamA, streamB } = createDuplexPair("node-a", "node-b");
    const received: FriendzMessage[] = [];
    const nodeB = track(
      createFriendzClient({
        getNode: async () => {
          throw new Error("unused");
        },
        localNodeId: "node-b",
        localUsername: "bob",
        onMessage: (message) => received.push(message),
      }),
    );
    nodeB.handleIncomingStream(streamB);

    const nodeA = track(
      createFriendzClient({
        getNode: async () => ({
          node_id: () => "node-a",
          open_bi: async () => streamA,
        }),
        localNodeId: "node-a",
        localUsername: "alice",
        heartbeatIntervalMs: 1000,
      }),
    );

    nodeA.startHeartbeat(() => ["node-b"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toHaveLength(1);

    nodeA.stopHeartbeat();
    await vi.advanceTimersByTimeAsync(5000);
    expect(received).toHaveLength(1);
  });

  it("destroy() closes streams and clears online state without throwing", async () => {
    const { streamA, streamB } = createDuplexPair("node-a", "node-b");
    const nodeB = createFriendzClient({
      getNode: async () => {
        throw new Error("unused");
      },
      localNodeId: "node-b",
      localUsername: "bob",
    });
    nodeB.handleIncomingStream(streamB);

    const nodeA = createFriendzClient({
      getNode: async () => ({
        node_id: () => "node-a",
        open_bi: async () => streamA,
      }),
      localNodeId: "node-a",
      localUsername: "alice",
    });

    await nodeA.sendMessage("node-a", {
      kind: "core",
      message: { type: "heartbeat", v: 1, nodeId: "node-a", username: "alice" },
    });
    await flush();
    expect(nodeB.isOnline("node-a")).toBe(true);

    expect(() => nodeA.destroy()).not.toThrow();
    expect(() => nodeB.destroy()).not.toThrow();
    expect(nodeB.getOnlinePeers()).toEqual([]);
  });
});
