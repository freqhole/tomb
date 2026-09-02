// tests for the blob cache policy.
//
// the transports back their blob fetches with the Cache API and, before
// `BlobFetchOptions` existed, wrote every blob they fetched unconditionally.
// that made the sync-to-local path store the same audio twice: once in the
// api cache (as a side effect of getting the bytes) and once in the library.
//
// `cache: "skip"` must suppress the write on *every* branch of the
// fallback chain, since which branch runs depends on what the peer supports.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { WasmTransport, type MiddenNodeLike } from "./WasmTransport.js";

// minimal in-memory Cache API double. only the three methods the transports
// use (`open`, `match`, `put`) are implemented.
class FakeCache {
  readonly entries = new Map<string, Response>();

  async match(key: string): Promise<Response | undefined> {
    return this.entries.get(key);
  }

  async put(key: string, response: Response): Promise<void> {
    this.entries.set(key, response);
  }
}

let fakeCache: FakeCache;

beforeEach(() => {
  fakeCache = new FakeCache();
  vi.stubGlobal("caches", {
    open: async () => fakeCache,
  });
  // jsdom/node have no URL.createObjectURL
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
});

const BYTES = new Uint8Array([1, 2, 3, 4]);
const BLAKE3 = "a".repeat(64);

/** a node whose only working download path is the one named. lets each test
 * force a specific branch of the fallback chain. */
function nodeWith(branch: "verified" | "api_request" | "by_id" | "legacy"): MiddenNodeLike {
  const node: Partial<MiddenNodeLike> = {
    node_id: () => "test-node",
    api_request: async () => {
      if (branch !== "api_request") throw new Error("api_request unavailable");
      return {
        status: 200,
        body: JSON.stringify({
          success: true,
          data: { data: btoa(String.fromCharCode(...BYTES)), mime: "audio/mpeg" },
        }),
      };
    },
  };

  if (branch === "verified") {
    node.download_verified_with_ensure = async () => BYTES;
  }
  if (branch === "by_id") {
    node.download_verified_by_id = async () => [BYTES, BLAKE3];
  }
  if (branch === "legacy") {
    node.fetch_blob = async () => ({
      data: () => BYTES,
      content_type: () => "audio/mpeg",
      size: () => BYTES.length,
    });
  }
  return node as MiddenNodeLike;
}

const BRANCHES = ["verified", "api_request", "by_id", "legacy"] as const;

describe("WasmTransport.fetchBlob cache policy", () => {
  describe("default (no options) still writes to the Cache API", () => {
    for (const branch of BRANCHES) {
      it(`writes on the ${branch} branch`, async () => {
        const transport = new WasmTransport(nodeWith(branch), "peer");
        // the verified branch is only tried when a blake3 is supplied, and
        // by_id/legacy are only reached when it is not.
        await transport.fetchBlob("blob-1", branch === "verified" ? BLAKE3 : undefined);
        expect(fakeCache.entries.size).toBe(1);
      });
    }
  });

  describe('cache: "skip" suppresses the write', () => {
    for (const branch of BRANCHES) {
      it(`does not write on the ${branch} branch`, async () => {
        const transport = new WasmTransport(nodeWith(branch), "peer");
        await transport.fetchBlob("blob-1", branch === "verified" ? BLAKE3 : undefined, {
          cache: "skip",
        });
        expect(fakeCache.entries.size).toBe(0);
      });
    }
  });

  it("still returns the bytes when the write is skipped", async () => {
    const transport = new WasmTransport(nodeWith("verified"), "peer");
    const result = await transport.fetchBlob("blob-1", BLAKE3, { cache: "skip" });
    expect(Array.from(result.data)).toEqual(Array.from(BYTES));
  });

  it('reads an existing cache entry even with cache: "skip"', async () => {
    // "skip" suppresses writes only - bytes already cached are still served,
    // so a sync does not re-fetch something already sitting in the cache.
    await fakeCache.put(
      "https://blob.local/blob-1",
      new Response(BYTES, { headers: { "Content-Type": "audio/mpeg" } }),
    );
    const node = nodeWith("verified");
    const spy = vi.fn(async () => BYTES);
    node.download_verified_with_ensure = spy;

    const transport = new WasmTransport(node, "peer");
    const result = await transport.fetchBlob("blob-1", BLAKE3, { cache: "skip" });

    expect(Array.from(result.data)).toEqual(Array.from(BYTES));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("WasmTransport.fetchBlobWithProgress cache policy", () => {
  describe("default (no options) still writes to the Cache API", () => {
    for (const branch of BRANCHES) {
      it(`writes on the ${branch} branch`, async () => {
        const transport = new WasmTransport(nodeWith(branch), "peer");
        await transport.fetchBlobWithProgress(
          "blob-1",
          () => {},
          branch === "verified" ? BLAKE3 : undefined,
        );
        expect(fakeCache.entries.size).toBe(1);
      });
    }
  });

  describe('cache: "skip" suppresses the write', () => {
    for (const branch of BRANCHES) {
      it(`does not write on the ${branch} branch`, async () => {
        const transport = new WasmTransport(nodeWith(branch), "peer");
        await transport.fetchBlobWithProgress(
          "blob-1",
          () => {},
          branch === "verified" ? BLAKE3 : undefined,
          undefined,
          undefined,
          { cache: "skip" },
        );
        expect(fakeCache.entries.size).toBe(0);
      });
    }
  });

  it("still reports progress when the write is skipped", async () => {
    const transport = new WasmTransport(nodeWith("verified"), "peer");
    const onProgress = vi.fn();
    await transport.fetchBlobWithProgress("blob-1", onProgress, BLAKE3, undefined, undefined, {
      cache: "skip",
    });
    expect(onProgress).toHaveBeenCalled();
  });
});

describe("WasmTransport.getBlobUrl* cache policy", () => {
  it('getBlobUrl with cache: "skip" does not write', async () => {
    const transport = new WasmTransport(nodeWith("verified"), "peer");
    await transport.getBlobUrl("blob-1", BLAKE3, { cache: "skip" });
    expect(fakeCache.entries.size).toBe(0);
  });

  it("getBlobUrl writes by default", async () => {
    const transport = new WasmTransport(nodeWith("verified"), "peer");
    await transport.getBlobUrl("blob-1", BLAKE3);
    expect(fakeCache.entries.size).toBe(1);
  });

  it('getBlobUrlWithProgress with cache: "skip" does not write', async () => {
    const transport = new WasmTransport(nodeWith("verified"), "peer");
    await transport.getBlobUrlWithProgress("blob-1", () => {}, BLAKE3, undefined, undefined, {
      cache: "skip",
    });
    expect(fakeCache.entries.size).toBe(0);
  });

  it("getBlobUrlWithProgress writes by default", async () => {
    const transport = new WasmTransport(nodeWith("verified"), "peer");
    await transport.getBlobUrlWithProgress("blob-1", () => {}, BLAKE3);
    expect(fakeCache.entries.size).toBe(1);
  });
});
