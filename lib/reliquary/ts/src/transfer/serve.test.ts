import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlobServer, serveBlobRequest } from "./serve.js";
import type { BlobCapableNode } from "./types.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeNode(): BlobCapableNode & {
  import_blob: ReturnType<typeof vi.fn>;
  release_blob: ReturnType<typeof vi.fn>;
} {
  let counter = 0;
  return {
    node_id: () => "me",
    import_blob: vi.fn(async () => `blake3-${++counter}`),
    release_blob: vi.fn(),
  };
}

describe("BlobServer", () => {
  it("imports on first serve and reuses the cached blake3 on a repeat request", async () => {
    const node = makeNode();
    const server = new BlobServer(node);
    const getBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));

    const first = await server.serve("sha-a", async () => ({ bytes: await getBytes(), size: 3 }));
    const second = await server.serve("sha-a", async () => ({ bytes: await getBytes(), size: 3 }));

    expect(first.blake3).toBe(second.blake3);
    expect(node.import_blob).toHaveBeenCalledTimes(1);
    expect(getBytes).toHaveBeenCalledTimes(1);
  });

  it("releases from the node after the release timer elapses", async () => {
    const node = makeNode();
    const server = new BlobServer(node, { releaseAfterMs: 1000 });

    await server.serve("sha-a", async () => ({ bytes: new Uint8Array([1]), size: 1 }));
    expect(server.has("sha-a")).toBe(true);

    vi.advanceTimersByTime(999);
    expect(server.has("sha-a")).toBe(true);
    expect(node.release_blob).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(server.has("sha-a")).toBe(false);
    expect(node.release_blob).toHaveBeenCalledWith("blake3-1");
  });

  it("resets the release timer on every repeat request", async () => {
    const node = makeNode();
    const server = new BlobServer(node, { releaseAfterMs: 1000 });

    await server.serve("sha-a", async () => ({ bytes: new Uint8Array([1]), size: 1 }));
    vi.advanceTimersByTime(700);
    await server.serve("sha-a", async () => ({ bytes: new Uint8Array([1]), size: 1 }));
    vi.advanceTimersByTime(700);

    // 1400ms elapsed total, but the second serve reset the clock at 700ms,
    // so only 700ms have passed since the last touch - still tracked.
    expect(server.has("sha-a")).toBe(true);

    vi.advanceTimersByTime(300);
    expect(server.has("sha-a")).toBe(false);
  });

  it("releases immediately on request, without waiting for the timer", async () => {
    const node = makeNode();
    const server = new BlobServer(node);
    await server.serve("sha-a", async () => ({ bytes: new Uint8Array([1]), size: 1 }));

    server.release("sha-a");

    expect(server.has("sha-a")).toBe(false);
    expect(node.release_blob).toHaveBeenCalledWith("blake3-1");
  });

  it("dispose releases every tracked blob", async () => {
    const node = makeNode();
    const server = new BlobServer(node);
    await server.serve("a", async () => ({ bytes: new Uint8Array([1]), size: 1 }));
    await server.serve("b", async () => ({ bytes: new Uint8Array([2]), size: 1 }));

    server.dispose();

    expect(server.size()).toBe(0);
    expect(node.release_blob).toHaveBeenCalledTimes(2);
  });

  it("rejects when the node has no import_blob", async () => {
    const server = new BlobServer({ node_id: () => "me" });
    await expect(
      server.serve("a", async () => ({ bytes: new Uint8Array([1]), size: 1 }))
    ).rejects.toThrow(/import_blob/);
  });
});

describe("serveBlobRequest", () => {
  it("resolves bytes on a cache miss and stages them via the server", async () => {
    const node = makeNode();
    const server = new BlobServer(node);
    const resolve = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), size: 2, mime: "audio/mpeg" }));

    const result = await serveBlobRequest(server, "sha-a", resolve);

    expect(result).toEqual({ blake3: "blake3-1", size: 2, mime: "audio/mpeg" });
    expect(resolve).toHaveBeenCalledWith("sha-a");
  });

  it("returns null when resolve reports no such blob, without touching the server", async () => {
    const node = makeNode();
    const server = new BlobServer(node);
    const resolve = vi.fn(async () => null);

    const result = await serveBlobRequest(server, "missing", resolve);

    expect(result).toBeNull();
    expect(node.import_blob).not.toHaveBeenCalled();
  });

  it("skips resolve entirely on a cache hit", async () => {
    const node = makeNode();
    const server = new BlobServer(node);
    await server.serve("sha-a", async () => ({ bytes: new Uint8Array([1]), size: 1 }));

    const resolve = vi.fn(async () => ({ bytes: new Uint8Array([9]), size: 9 }));
    const result = await serveBlobRequest(server, "sha-a", resolve);

    expect(resolve).not.toHaveBeenCalled();
    expect(result?.size).toBe(1);
  });
});
