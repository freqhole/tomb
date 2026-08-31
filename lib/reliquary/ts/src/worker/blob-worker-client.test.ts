// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  base64Decode,
  base64Encode,
  generateThumbnailDataUrl,
  getBlobWorker,
  hashBlake3,
  hashBlake3Streaming,
  hashSha256,
  processBlobBytes,
  resizeImageToWebpDataUrl,
  shutdownBlobWorker,
  streamFileToOpfs,
  writeBlobToOpfs,
} from "./blob-worker-client.js";
import { resetMiddenBlake3Cache } from "./midden-blake3.js";
import { log } from "../utils/log.js";

// this test environment has no `Worker` global, so every helper below
// exercises its main-thread fallback path - the same path used in
// environments without Worker support (SSR, certain test runners) -
// except the `getBlobWorker` tests below that explicitly stub in a fake
// `Worker` to exercise the real ready-handshake logic instead.

/** minimal fake `Worker`: enough of the `EventTarget`-based message/error
 *  surface for the ready-handshake tests below, without a real thread. */
class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  terminate = vi.fn();
}

class FakeImageBitmap {
  constructor(
    public width: number,
    public height: number,
  ) {}
  close = vi.fn();
}

class FakeOffscreenCanvasContext {
  drawImage = vi.fn();
}

let lastFakeCanvas: FakeOffscreenCanvas | undefined;

class FakeOffscreenCanvas {
  context = new FakeOffscreenCanvasContext();
  constructor(
    public width: number,
    public height: number,
  ) {
    lastFakeCanvas = this;
  }
  getContext(): FakeOffscreenCanvasContext {
    return this.context;
  }
  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    return new Blob(["fake-encoded-bytes"], { type: options?.type ?? "image/webp" });
  }
}

function installCanvasFakes(size = { width: 100, height: 100 }): void {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => new FakeImageBitmap(size.width, size.height)),
  );
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetMiddenBlake3Cache();
  shutdownBlobWorker();
});

describe("getBlobWorker", () => {
  it("returns null when Worker isn't available in this environment", async () => {
    expect(await getBlobWorker()).toBeNull();
  });

  it("resolves once the worker signals ready via a message, without waiting out the timeout", async () => {
    const worker = new FakeWorker();
    vi.stubGlobal("Worker", vi.fn(() => worker) as unknown as typeof Worker);

    const proxyPromise = getBlobWorker();
    worker.dispatchEvent(new MessageEvent("message", { data: "blob-worker-ready" }));

    expect(await proxyPromise).not.toBeNull();
  });

  it("resolves null quickly (not after the full ready-timeout) when the worker script fails to load, and logs a warning", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(log, "warn");
    const worker = new FakeWorker();
    vi.stubGlobal("Worker", vi.fn(() => worker) as unknown as typeof Worker);

    const proxyPromise = getBlobWorker();
    // a worker script that fails to load fires an `error` event, never a
    // `message` - this must resolve right away, not after the 20s
    // ready-timeout (proven by asserting the result WITHOUT advancing
    // fake timers at all).
    worker.dispatchEvent(new Event("error"));

    expect(await proxyPromise).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("hashBlake3", () => {
  it("falls back to an empty string with no worker and no midden module", async () => {
    expect(await hashBlake3(new Uint8Array([1, 2, 3]))).toBe("");
  });
});

describe("hashSha256", () => {
  it("falls back to a real sha-256 digest with no worker", async () => {
    const bytes = new TextEncoder().encode("abc");
    const hash = await hashSha256(bytes.buffer as ArrayBuffer);
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("base64Encode / base64Decode", () => {
  it("round-trips bytes through the fallback path", async () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = await base64Encode(original.buffer as ArrayBuffer);
    const decoded = await base64Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});

describe("processBlobBytes", () => {
  it("hashes without a worker (blake3 empty, sha256 real)", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const result = await processBlobBytes(bytes.buffer as ArrayBuffer, "hello.txt", "text/plain");
    expect(result.blake3).toBe("");
    expect(result.blob_id).toBe("");
    expect(result.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(result.size).toBe(bytes.byteLength);
  });
});

describe("writeBlobToOpfs", () => {
  it("silently no-ops when there's no worker to delegate to", async () => {
    await expect(writeBlobToOpfs("some-hash", new ArrayBuffer(4))).resolves.toBeUndefined();
  });
});

describe("streamFileToOpfs", () => {
  it("throws when no worker is available", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    await expect(streamFileToOpfs(file)).rejects.toThrow(/no blob worker/);
  });
});

describe("hashBlake3Streaming", () => {
  it("falls back to the one-shot hashBlake3 path when no worker is available", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    // no worker, no midden module in this test env - degrades to "",
    // same as the one-shot hashBlake3 fallback.
    expect(await hashBlake3Streaming(file)).toBe("");
  });
});

describe("resizeImageToWebpDataUrl", () => {
  it("uses the main-thread fallback and returns a data url", async () => {
    installCanvasFakes();
    const result = await resizeImageToWebpDataUrl(new Blob(["x"], { type: "image/png" }));
    expect(result).toMatch(/^data:image\/webp;base64,/);
  });

  it("returns null when OffscreenCanvas/createImageBitmap are unavailable", async () => {
    const result = await resizeImageToWebpDataUrl(new Blob(["x"], { type: "image/png" }));
    expect(result).toBeNull();
  });

  it("centers a non-square bitmap without cropping when fitSquare is set", async () => {
    installCanvasFakes({ width: 400, height: 100 });
    const result = await resizeImageToWebpDataUrl(new Blob(["x"], { type: "image/png" }), {
      maxWidth: 200,
      maxHeight: 200,
      fitSquare: true,
    });
    expect(result).toMatch(/^data:image\/webp;base64,/);
    // 400x100 fit into 200x200 scales to 200x50, centered with 75px of
    // padding above and below — the full source width is drawn (no crop).
    expect(lastFakeCanvas?.width).toBe(200);
    expect(lastFakeCanvas?.height).toBe(200);
    expect(lastFakeCanvas?.context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      400,
      100,
      0,
      75,
      200,
      50,
    );
  });
});

describe("generateThumbnailDataUrl", () => {
  it("skips non-image blobs", async () => {
    const result = await generateThumbnailDataUrl(new Blob(["x"], { type: "text/plain" }));
    expect(result).toBeNull();
  });
});
