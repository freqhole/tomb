// pushable test doubles for the automerge/transfer transport surface: a
// `BiStreamLike` whose reads and writes a test can drive by hand, and a
// `MiddenStreamNode`-shaped node that opens/accepts those streams.
//
// every method is a `vi.fn()` so a consuming test can assert on call
// counts/arguments or override a single call's behavior (`mockResolvedValueOnce`,
// `mockRejectedValueOnce`, ...) without replacing the whole double.
//
// dialing (`open_bi`) on the mock node always succeeds and hands back a
// fresh mock stream addressed to whatever peer id was dialed - a test
// wanting to simulate a dial failure overrides `open_bi` for one call via
// `mockRejectedValueOnce` instead.

import { vi } from "vitest";

import type { BiStreamLike, MiddenStreamNode } from "../automerge/types.js";

/** a `BiStreamLike` double whose queued/pushed messages a test controls
 *  directly, plus introspection fields (`_written`, `_closed`) for
 *  asserting on what was sent and whether the stream was closed. */
export interface MockBiStream extends BiStreamLike {
  _messageQueue: (Uint8Array | null)[];
  _written: Uint8Array[];
  _closed: boolean;
  _readResolvers: ((value: Uint8Array | null) => void)[];
  write_message: ReturnType<typeof vi.fn>;
  read_message: ReturnType<typeof vi.fn>;
  read_to_end?: ReturnType<typeof vi.fn>;
  write_raw_and_finish?: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  /** push a message (or `null` to simulate the peer closing the stream)
   *  for the next pending/future `read_message()` call to resolve with. */
  pushMessage(data: Uint8Array | null): void;
}

/** creates a mock bidirectional stream addressed to `peerId`. reads block
 *  until a message is pushed via `pushMessage`; writes are recorded in
 *  `_written` for assertions. */
export function createMockBiStream(peerId: string, alpn: string = "iroh/automerge-repo/1"): MockBiStream {
  const stream: MockBiStream = {
    _messageQueue: [],
    _written: [],
    _closed: false,
    _readResolvers: [],

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

    read_to_end: vi.fn(async (max_size: number): Promise<Uint8Array> => {
      if (stream._messageQueue.length > 0) {
        const data = stream._messageQueue.shift()!;
        return data ?? new Uint8Array(0);
      }
      return new Promise<Uint8Array>((resolve) => {
        const originalResolver = (value: Uint8Array | null) => {
          resolve(value ?? new Uint8Array(0));
        };
        stream._readResolvers.push(originalResolver);
      });
    }),

    write_raw_and_finish: vi.fn(async (data: Uint8Array): Promise<void> => {
      stream._written.push(data);
      stream._closed = true;
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

/** a `MiddenStreamNode` double whose inbound streams (`accept()`) a test
 *  pushes by hand, alongside dialing (`open_bi()`) that always succeeds
 *  with a fresh mock stream. */
export interface MockMidden extends MiddenStreamNode {
  open_bi: ReturnType<typeof vi.fn>;
  accept: ReturnType<typeof vi.fn>;
  /** push a stream (or `null` to simulate no more inbound connections)
   *  for the next pending/future `accept()` call to resolve with. */
  pushIncoming(stream: BiStreamLike | null): void;
}

/** creates a mock midden node identified by `nodeId`. */
export function createMockMidden(nodeId: string = "a".repeat(64)): MockMidden {
  const acceptQueue: (BiStreamLike | null)[] = [];
  const acceptResolvers: ((value: BiStreamLike | null) => void)[] = [];

  const midden: MockMidden = {
    node_id: () => nodeId,

    open_bi: vi.fn(async (addr: string): Promise<BiStreamLike> => {
      return createMockBiStream(addr);
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

