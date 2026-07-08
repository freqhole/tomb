// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  base64Decode,
  base64Encode,
  generateThumbnailDataUrl,
  hashBlake3,
  hashSha256,
  opfsStoreSelftest,
  opfsStoreSelftestPersistence,
  processBlobBytes,
  readBlobFromOpfs,
  resizeImageToWebpDataUrl,
  uploadBegin,
  writeBlobToOpfs,
} from "./blob-worker-logic.js";
import { resetMiddenBlake3Cache } from "./midden-blake3.js";

// ---- fake OPFS (async writable-stream fallback path only - sync access
// handles are worker/chromium-specific and not worth faking here; the
// fallback path exercises the same directory/file-handle logic). ----

class FakeWritable {
  constructor(private readonly file: FakeFileHandle) {}
  async write(data: ArrayBuffer | ArrayBufferView): Promise<void> {
    this.file.bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer as ArrayBuffer);
  }
  async close(): Promise<void> {}
}

class FakeFileHandle {
  bytes = new Uint8Array(0);
  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    const bytes = this.bytes;
    return { arrayBuffer: async () => bytes.buffer as ArrayBuffer };
  }
  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this);
  }
}

class FakeDirHandle {
  files = new Map<string, FakeFileHandle>();
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFileHandle> {
    let handle = this.files.get(name);
    if (!handle) {
      if (!opts?.create) throw new Error(`not found: ${name}`);
      handle = new FakeFileHandle();
      this.files.set(name, handle);
    }
    return handle;
  }
  async getDirectoryHandle(): Promise<FakeDirHandle> {
    return this;
  }
}

function installFakeOpfs(): FakeDirHandle {
  const root = new FakeDirHandle();
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: async () => root,
    },
  });
  return root;
}

// ---- fake canvas pipeline (same approach as utils/image-utils.test.ts) ----

class FakeImageBitmap {
  constructor(
    public width: number,
    public height: number
  ) {}
  close = vi.fn();
}

class FakeOffscreenCanvasContext {
  drawImage = vi.fn();
}

class FakeOffscreenCanvas {
  context = new FakeOffscreenCanvasContext();
  constructor(
    public width: number,
    public height: number
  ) {}
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
    vi.fn(async () => new FakeImageBitmap(size.width, size.height))
  );
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetMiddenBlake3Cache();
});

describe("hashSha256", () => {
  it("hashes a known buffer to its well-known sha-256 digest", async () => {
    const bytes = new TextEncoder().encode("abc");
    const hash = await hashSha256(bytes.buffer as ArrayBuffer);
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("hashBlake3", () => {
  it("degrades to an empty string when no midden module is bundled", async () => {
    const hash = await hashBlake3(new Uint8Array([1, 2, 3]));
    expect(hash).toBe("");
  });
});

describe("base64Encode / base64Decode", () => {
  it("round-trips arbitrary bytes", async () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255, 42]);
    const encoded = await base64Encode(original.buffer as ArrayBuffer);
    const decoded = await base64Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it("handles buffers larger than the chunk size", async () => {
    const original = new Uint8Array(0x8000 * 3 + 17).map((_, i) => i % 256);
    const encoded = await base64Encode(original.buffer as ArrayBuffer);
    const decoded = await base64Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});

describe("writeBlobToOpfs / readBlobFromOpfs", () => {
  it("round-trips bytes through the fake opfs directory", async () => {
    installFakeOpfs();
    const data = new Uint8Array([9, 8, 7, 6]).buffer as ArrayBuffer;
    await writeBlobToOpfs("blake3-hex", data);
    const readBack = await readBlobFromOpfs("blake3-hex");
    expect(readBack).not.toBeNull();
    expect(Array.from(new Uint8Array(readBack!))).toEqual([9, 8, 7, 6]);
  });

  it("readBlobFromOpfs returns null for a file that was never written", async () => {
    installFakeOpfs();
    const result = await readBlobFromOpfs("never-written");
    expect(result).toBeNull();
  });

  it("readBlobFromOpfs returns null when OPFS is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const result = await readBlobFromOpfs("anything");
    expect(result).toBeNull();
  });

  it("writeBlobToOpfs silently no-ops when OPFS is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(writeBlobToOpfs("anything", new ArrayBuffer(4))).resolves.toBeUndefined();
  });
});

describe("processBlobBytes", () => {
  it("hashes and writes to opfs, returning blake3 as the canonical blob_id", async () => {
    installFakeOpfs();
    const bytes = new TextEncoder().encode("hello world");
    const result = await processBlobBytes(bytes.buffer as ArrayBuffer, "hello.txt", "text/plain");

    expect(result.filename).toBe("hello.txt");
    expect(result.mime).toBe("text/plain");
    expect(result.size).toBe(bytes.byteLength);
    // no midden module bundled in this test environment - blake3 degrades
    // to an empty string, and blob_id mirrors it (documented behavior).
    expect(result.blake3).toBe("");
    expect(result.blob_id).toBe(result.blake3);
    expect(result.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});

describe("uploadBegin", () => {
  it("throws a clear error when no midden Blake3Hasher is bundled", async () => {
    installFakeOpfs();
    await expect(uploadBegin()).rejects.toThrow(/Blake3Hasher/);
  });
});

describe("opfsStoreSelftest / opfsStoreSelftestPersistence", () => {
  it("opfsStoreSelftest throws when no midden module is bundled", async () => {
    await expect(opfsStoreSelftest()).rejects.toThrow(/opfs_store_selftest/);
  });

  it("opfsStoreSelftestPersistence throws when no midden module is bundled", async () => {
    await expect(opfsStoreSelftestPersistence()).rejects.toThrow(/opfs_store_selftest_persistence/);
  });
});

describe("resizeImageToWebpDataUrl", () => {
  it("returns a data url with the requested mime type", async () => {
    installCanvasFakes();
    const result = await resizeImageToWebpDataUrl(new Blob(["x"], { type: "image/png" }));
    expect(result).toMatch(/^data:image\/webp;base64,/);
  });

  it("returns null when OffscreenCanvas/createImageBitmap are unavailable", async () => {
    const result = await resizeImageToWebpDataUrl(new Blob(["x"], { type: "image/png" }));
    expect(result).toBeNull();
  });
});

describe("generateThumbnailDataUrl", () => {
  it("skips non-image blobs", async () => {
    installCanvasFakes();
    const result = await generateThumbnailDataUrl(new Blob(["x"], { type: "text/plain" }));
    expect(result).toBeNull();
  });

  it("resizes image blobs to a webp data url", async () => {
    installCanvasFakes();
    const result = await generateThumbnailDataUrl(new Blob(["x"], { type: "image/png" }));
    expect(result).toMatch(/^data:image\/webp;base64,/);
  });
});
