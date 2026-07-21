import { describe, expect, it, vi } from "vitest";
import { createMockBlobFetcher } from "./mock-blob-fetch.js";

describe("createMockBlobFetcher", () => {
  it("defaults to instant success, returning the resolver's bytes", async () => {
    const fetcher = createMockBlobFetcher((id) => new Uint8Array([id.length]));
    await expect(fetcher.fetchBlob("abc")).resolves.toEqual(new Uint8Array([3]));
  });

  it("calls onProgress(1) right before resolving", async () => {
    const fetcher = createMockBlobFetcher(() => new Uint8Array([1]));
    const onProgress = vi.fn();
    await fetcher.fetchBlob("id", onProgress);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  it("delayed behaviour waits before resolving", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = createMockBlobFetcher(() => new Uint8Array([1]));
      fetcher.setBehaviour("id", { type: "delayed", ms: 500 });

      let resolved = false;
      const promise = fetcher.fetchBlob("id").then((bytes) => {
        resolved = true;
        return bytes;
      });

      await vi.advanceTimersByTimeAsync(499);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toEqual(new Uint8Array([1]));
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("error behaviour rejects with the configured message", async () => {
    const fetcher = createMockBlobFetcher(() => new Uint8Array([1]));
    fetcher.setBehaviour("id", { type: "error", message: "boom" });
    await expect(fetcher.fetchBlob("id")).rejects.toThrow("boom");
  });

  it("error behaviour without a message still rejects", async () => {
    const fetcher = createMockBlobFetcher(() => new Uint8Array([1]));
    fetcher.setBehaviour("id", { type: "error" });
    await expect(fetcher.fetchBlob("id")).rejects.toThrow(/mock blob error/);
  });

  it("stall behaviour never resolves", async () => {
    const fetcher = createMockBlobFetcher(() => new Uint8Array([1]));
    fetcher.setBehaviour("id", { type: "stall" });

    let settled = false;
    void fetcher.fetchBlob("id").then(() => (settled = true));

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
  });

  it("setBehaviour(id, null) clears an override, reverting to instant", async () => {
    const fetcher = createMockBlobFetcher(() => new Uint8Array([1]));
    fetcher.setBehaviour("id", { type: "error" });
    fetcher.setBehaviour("id", null);
    await expect(fetcher.fetchBlob("id")).resolves.toEqual(new Uint8Array([1]));
  });

  it("behaviour is per-id", async () => {
    const fetcher = createMockBlobFetcher((id) => new Uint8Array([id.charCodeAt(0)]));
    fetcher.setBehaviour("a", { type: "error" });
    await expect(fetcher.fetchBlob("a")).rejects.toThrow();
    await expect(fetcher.fetchBlob("b")).resolves.toEqual(new Uint8Array(["b".charCodeAt(0)]));
  });
});
