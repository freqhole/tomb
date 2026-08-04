import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../worker/index.js", () => ({
  hashBlake3: vi.fn(async (bytes: Uint8Array) => `hash-of-${bytes.length}-bytes`),
}));

import { hashBlake3 } from "../worker/index.js";
import {
  discardPausedDownload,
  pauseSnatchDownload,
  pauseSnatchDownloadByBlake3,
  snatchBlob,
  snatchBlobToDisk,
} from "./snatch.js";
import type { BlobCapableNode } from "./types.js";

afterEach(() => {
  vi.clearAllMocks();
});

const BLAKE3 = "abc123";
const SIZE = 12;

function bytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) arr[i] = i % 256;
  return arr;
}

describe("snatchBlob", () => {
  it("returns bytes from strategy 1 (bulk verified download)", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(async (_peer, _hash, _size, onProgress) => {
        onProgress(1);
        return bytes(SIZE);
      }),
    };

    const result = await snatchBlob(node, ["peer-a"], { blake3: BLAKE3, size: SIZE });

    expect(result.bytes.length).toBe(SIZE);
    expect(result.blake3).toBe(BLAKE3);
    expect(node.download_verified_with_ensure_progress).toHaveBeenCalledWith(
      "peer-a",
      BLAKE3,
      SIZE,
      expect.any(Function),
      undefined
    );
  });

  it("falls through to the next peer when one fails", async () => {
    let calls = 0;
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(async (peer: string) => {
        calls++;
        if (peer === "peer-a") throw new Error("offline");
        return bytes(SIZE);
      }),
    };

    const result = await snatchBlob(node, ["peer-a", "peer-b"], { blake3: BLAKE3, size: SIZE });

    expect(calls).toBe(2);
    expect(result.bytes.length).toBe(SIZE);
  });

  it("rethrows a cancelled error immediately without trying the next peer", async () => {
    let calls = 0;
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(async () => {
        calls++;
        throw new DOMException("aborted", "AbortError");
      }),
    };

    await expect(
      snatchBlob(node, ["peer-a", "peer-b"], { blake3: BLAKE3, size: SIZE })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });

  it("throws immediately when the signal is already aborted", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(),
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      snatchBlob(node, ["peer-a"], { blake3: BLAKE3, size: SIZE }, { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(node.download_verified_with_ensure_progress).not.toHaveBeenCalled();
  });

  it("assembles out-of-order chunks via strategy 2 (streaming) at their explicit offsets", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_streaming_with_ensure: vi.fn(
        async (_peer, _hash, _size, onChunk, onProgress) => {
          // deliver out of order to prove offsets (not push order) win.
          onChunk(new Uint8Array([40, 41, 42, 43]), 8);
          onChunk(new Uint8Array([0, 1, 2, 3]), 0);
          onChunk(new Uint8Array([10, 11, 12, 13]), 4);
          onProgress(1);
          return 12;
        }
      ),
    };

    const result = await snatchBlob(node, ["peer-a"], { blake3: BLAKE3, size: 12 });

    expect(Array.from(result.bytes)).toEqual([0, 1, 2, 3, 10, 11, 12, 13, 40, 41, 42, 43]);
  });

  it("rejects when the streamed byte count never reaches the declared total", async () => {
    vi.useFakeTimers();
    try {
      const node: BlobCapableNode = {
        node_id: () => "me",
        download_verified_streaming_with_ensure: vi.fn(async (_peer, _hash, _size, onChunk) => {
          onChunk(new Uint8Array([1, 2, 3]), 0);
          return 12; // declares 12 total but only 3 bytes ever arrive
        }),
      };

      const promise = snatchBlob(node, ["peer-a"], { blake3: BLAKE3, size: 12 });
      const assertion = expect(promise).rejects.toThrow(/chunk stream incomplete/);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an empty payload", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(async () => new Uint8Array(0)),
    };

    await expect(
      snatchBlob(node, ["peer-a"], { blake3: BLAKE3, size: 0 })
    ).rejects.toThrow(/0 bytes/);
  });

  it("uses the base64 proxy fallback when no verified strategy is available, verifying the hash", async () => {
    const payload = bytes(4);
    const b64 = Buffer.from(payload).toString("base64");
    const node: BlobCapableNode = {
      node_id: () => "me",
      proxy_request: vi.fn(async () => ({
        status: 200,
        body: JSON.stringify({ data: b64, mime: "image/png" }),
      })),
    };

    const expectedHash = `hash-of-${payload.length}-bytes`;
    const result = await snatchBlob(node, ["peer-a"], {
      blake3: expectedHash,
      size: payload.length,
      id: "some-app-id",
    }, {
      proxyPath: (id) => `/api/blobs/${id}/data`,
    });

    expect(node.proxy_request).toHaveBeenCalledWith("peer-a", "GET", "/api/blobs/some-app-id/data", null);
    expect(Array.from(result.bytes)).toEqual(Array.from(payload));
    expect(result.mime).toBe("image/png");
    expect(hashBlake3).toHaveBeenCalled();
  });

  it("rejects a proxy-fallback response whose bytes don't match the expected blake3", async () => {
    const payload = bytes(4);
    const b64 = Buffer.from(payload).toString("base64");
    const node: BlobCapableNode = {
      node_id: () => "me",
      proxy_request: vi.fn(async () => ({
        status: 200,
        body: JSON.stringify({ data: b64 }),
      })),
    };

    await expect(
      snatchBlob(
        node,
        ["peer-a"],
        { blake3: "not-the-real-hash", size: payload.length },
        { proxyPath: (id) => `/api/blobs/${id}/data` }
      )
    ).rejects.toThrow(/hash mismatch/);
  });

  it("falls through to the next strategy on the same peer when a verified strategy fails", async () => {
    // a peer whose backend only accepts an app-level rpc alpn makes the
    // verified strategies fail even though the local node has the methods -
    // the proxy fallback must still be attempted against that same peer.
    const payload = bytes(4);
    const b64 = Buffer.from(payload).toString("base64");
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(async () => {
        throw new Error("peer rejected iroh-blobs alpn");
      }),
      download_verified_streaming_with_ensure: vi.fn(async () => {
        throw new Error("peer rejected iroh-blobs alpn");
      }),
      proxy_request: vi.fn(async () => ({
        status: 200,
        body: JSON.stringify({ data: b64, mime: "image/png" }),
      })),
    };

    const result = await snatchBlob(
      node,
      ["peer-a"],
      { blake3: `hash-of-${payload.length}-bytes`, size: payload.length },
      { proxyPath: (id) => `/api/blobs/${id}/data` }
    );

    expect(node.download_verified_with_ensure_progress).toHaveBeenCalledTimes(1);
    expect(node.download_verified_streaming_with_ensure).toHaveBeenCalledTimes(1);
    expect(node.proxy_request).toHaveBeenCalledTimes(1);
    expect(Array.from(result.bytes)).toEqual(Array.from(payload));
  });

  it("does not fall through to another strategy on a cancelled error", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(async () => {
        throw new Error("download cancelled");
      }),
      download_verified_streaming_with_ensure: vi.fn(),
      proxy_request: vi.fn(),
    };

    await expect(
      snatchBlob(
        node,
        ["peer-a", "peer-b"],
        { blake3: BLAKE3, size: SIZE },
        { proxyPath: (id) => `/api/blobs/${id}/data` }
      )
    ).rejects.toThrow(/download cancelled/);
    expect(node.download_verified_streaming_with_ensure).not.toHaveBeenCalled();
    expect(node.proxy_request).not.toHaveBeenCalled();
  });

  it("parses a nested proxy envelope via parseProxyResponse", async () => {
    const payload = bytes(4);
    const b64 = Buffer.from(payload).toString("base64");
    const node: BlobCapableNode = {
      node_id: () => "me",
      proxy_request: vi.fn(async () => ({
        status: 200,
        body: JSON.stringify({ success: true, data: { data: b64, mime: "audio/wav" } }),
      })),
    };

    const result = await snatchBlob(
      node,
      ["peer-a"],
      { blake3: `hash-of-${payload.length}-bytes`, size: payload.length },
      {
        proxyPath: (id) => `/api/blobs/${id}/data`,
        parseProxyResponse: (body) => {
          const parsed = JSON.parse(body) as {
            success?: boolean;
            data?: { data?: string; mime?: string };
          };
          if (!parsed.success || typeof parsed.data?.data !== "string") return null;
          return { data: parsed.data.data, mime: parsed.data.mime };
        },
      }
    );

    expect(Array.from(result.bytes)).toEqual(Array.from(payload));
    expect(result.mime).toBe("audio/wav");
  });

  it("throws when there are no peers to try", async () => {
    const node: BlobCapableNode = { node_id: () => "me" };
    await expect(snatchBlob(node, [], { blake3: BLAKE3, size: SIZE })).rejects.toThrow(/no peers/);
  });
});

class FakeWritable {
  chunks = new Map<number, Uint8Array>();
  closed = false;
  truncated: number[] = [];

  async write(input: Uint8Array | { type: "write"; position: number; data: Uint8Array }): Promise<void> {
    if (input instanceof Uint8Array) {
      this.chunks.set(0, input);
      return;
    }
    this.chunks.set(input.position, input.data);
  }

  async truncate(size: number): Promise<void> {
    this.truncated.push(size);
    this.chunks.clear();
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  assembled(total: number): Uint8Array {
    const buf = new Uint8Array(total);
    for (const [offset, data] of this.chunks) buf.set(data, offset);
    return buf;
  }
}

describe("snatchBlobToDisk", () => {
  it("streams verified chunks straight to the writable and closes it", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_streaming_with_ensure: vi.fn(
        async (_peer, _hash, _size, onChunk, onProgress) => {
          onChunk(new Uint8Array([1, 2, 3, 4]), 0);
          onChunk(new Uint8Array([5, 6, 7, 8]), 4);
          onProgress(1);
          return 8;
        }
      ),
    };
    const writable = new FakeWritable();

    const result = await snatchBlobToDisk(
      node,
      ["peer-a"],
      { blake3: BLAKE3, size: 8 },
      writable as unknown as FileSystemWritableFileStream
    );

    expect(result.size).toBe(8);
    expect(Array.from(writable.assembled(8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(writable.closed).toBe(true);
    expect(writable.truncated).toEqual([]);
  });

  it("truncates and retries the next peer on a mid-stream failure", async () => {
    let attempt = 0;
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_streaming_with_ensure: vi.fn(async (peer: string, _h, _s, onChunk) => {
        attempt++;
        if (peer === "peer-a") {
          onChunk(new Uint8Array([9, 9]), 0);
          throw new Error("connection reset");
        }
        onChunk(new Uint8Array([1, 2, 3, 4]), 0);
        return 4;
      }),
    };
    const writable = new FakeWritable();

    const result = await snatchBlobToDisk(
      node,
      ["peer-a", "peer-b"],
      { blake3: BLAKE3, size: 4 },
      writable as unknown as FileSystemWritableFileStream
    );

    expect(attempt).toBe(2);
    expect(writable.truncated).toEqual([0]);
    expect(Array.from(writable.assembled(4))).toEqual([1, 2, 3, 4]);
    expect(writable.closed).toBe(true);
  });

  it("leaves the writable open (no truncate, no close) on a cancelled download", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_streaming_with_ensure: vi.fn(async () => {
        throw new Error("download cancelled");
      }),
    };
    const writable = new FakeWritable();

    await expect(
      snatchBlobToDisk(
        node,
        ["peer-a"],
        { blake3: BLAKE3, size: 4 },
        writable as unknown as FileSystemWritableFileStream
      )
    ).rejects.toThrow(/download cancelled/);

    expect(writable.truncated).toEqual([]);
    expect(writable.closed).toBe(false);
  });

  it("falls back to a buffered download + single write when streaming is unavailable", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: vi.fn(async () => bytes(6)),
    };
    const writable = new FakeWritable();

    const result = await snatchBlobToDisk(
      node,
      ["peer-a"],
      { blake3: BLAKE3, size: 6 },
      writable as unknown as FileSystemWritableFileStream
    );

    expect(result.size).toBe(6);
    expect(writable.closed).toBe(true);
  });

  it("surfaces a buffered-path disk-write failure directly instead of retrying another peer", async () => {
    const download = vi.fn(async () => bytes(6));
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_verified_with_ensure_progress: download,
    };
    const writable = new FakeWritable();
    writable.write = async () => {
      throw new Error("disk full");
    };

    await expect(
      snatchBlobToDisk(
        node,
        ["peer-a", "peer-b"],
        { blake3: BLAKE3, size: 6 },
        writable as unknown as FileSystemWritableFileStream
      )
    ).rejects.toThrow(/disk full/);
    expect(download).toHaveBeenCalledTimes(1);
  });
});

describe("pauseSnatchDownload / discardPausedDownload", () => {
  it("pauses via download_cancel and reports whether a download was actually flagged", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_cancel: vi.fn(async () => true),
    };
    await expect(pauseSnatchDownload(node, "dl-1")).resolves.toBe(true);
    expect(node.download_cancel).toHaveBeenCalledWith("dl-1");
  });

  it("returns false when the node has no download_cancel", async () => {
    const node: BlobCapableNode = { node_id: () => "me" };
    await expect(pauseSnatchDownload(node, "dl-1")).resolves.toBe(false);
  });

  it("pauseSnatchDownloadByBlake3 pauses via download_cancel_by_blake3 and reports true when at least one was flagged", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_cancel_by_blake3: vi.fn(async () => 2),
    };
    await expect(pauseSnatchDownloadByBlake3(node, BLAKE3)).resolves.toBe(true);
    expect(node.download_cancel_by_blake3).toHaveBeenCalledWith(BLAKE3);
  });

  it("pauseSnatchDownloadByBlake3 returns false when nothing was in flight", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      download_cancel_by_blake3: vi.fn(async () => 0),
    };
    await expect(pauseSnatchDownloadByBlake3(node, BLAKE3)).resolves.toBe(false);
  });

  it("pauseSnatchDownloadByBlake3 returns false when the node has no download_cancel_by_blake3", async () => {
    const node: BlobCapableNode = { node_id: () => "me" };
    await expect(pauseSnatchDownloadByBlake3(node, BLAKE3)).resolves.toBe(false);
  });

  it("discards a paused download via unprotect_blob, swallowing errors", async () => {
    const node: BlobCapableNode = {
      node_id: () => "me",
      unprotect_blob: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    await expect(discardPausedDownload(node, BLAKE3)).resolves.toBeUndefined();
    expect(node.unprotect_blob).toHaveBeenCalledWith(BLAKE3);
  });

  it("is a no-op when the node has no unprotect_blob", async () => {
    const node: BlobCapableNode = { node_id: () => "me" };
    await expect(discardPausedDownload(node, BLAKE3)).resolves.toBeUndefined();
  });
});
