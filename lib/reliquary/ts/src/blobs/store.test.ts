// @vitest-environment happy-dom
//
// integration tests for the unified blob store: ties the metadata layer
// (db.ts) and the bytes layer (bytes-backend.ts) together behind
// createBlobStore(). the worker (hashing + the OPFS write path) is mocked
// since no environment here has a real Worker or a bundled midden module -
// the mock computes a deterministic fake "blake3" from the sha256 digest
// (real crypto.subtle is available in happy-dom) and writes bytes through
// the exact same fake OPFS directory the direct-read path uses, so the
// round trip is meaningful.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdbHarness } from "../testing/index.js";

// ---- fake OPFS (same shape as blob-worker-logic.test.ts / bytes-backend.test.ts) ----

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
  async getDirectoryHandle(_name: string, opts?: { create?: boolean }): Promise<FakeDirHandle> {
    void opts;
    return this;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new Error(`not found: ${name}`);
  }
}

let opfsRoot: FakeDirHandle;

function installFakeOpfs(): void {
  opfsRoot = new FakeDirHandle();
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: async () => opfsRoot,
    },
  });
}

async function fakeSha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function writeToFakeOpfs(id: string, data: ArrayBuffer): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("reliquary-blobs", { create: true });
  const file = await dir.getFileHandle(id, { create: true });
  const writable = await file.createWritable();
  await writable.write(data);
  await writable.close();
}

vi.mock("../worker/index.js", () => ({
  BLOB_OPFS_DIR: "reliquary-blobs",
  writeBlobToOpfs: vi.fn(async (id: string, data: ArrayBuffer) => {
    await writeToFakeOpfs(id, data);
  }),
  // a real blake3 digest is unavailable in this test environment (no
  // bundled midden module) - derive a distinct, deterministic stand-in
  // from the sha256 digest so different content still gets different
  // content addresses. neither hasher writes any bytes - matching the
  // real worker client, which only hashes here.
  hashBlake3: vi.fn(async (data: Uint8Array) => {
    const sha256 = await fakeSha256Hex(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    return `b3-${sha256}`;
  }),
  hashSha256: vi.fn(async (data: ArrayBuffer) => fakeSha256Hex(data)),
  streamFileToOpfs: vi.fn(async (file: File) => {
    const buffer = await file.arrayBuffer();
    const sha256 = await fakeSha256Hex(buffer);
    const blake3 = `b3-${sha256}`;
    await writeToFakeOpfs(blake3, buffer);
    return { blake3, size: buffer.byteLength };
  }),
}));

const { createBlobStore, DEFAULT_DB_NAME } = await import("./store.js");
const { putRecord } = await import("./db.js");

beforeEach(() => {
  fakeIdbHarness();
  installFakeOpfs();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:mock-${Math.random()}`),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function textBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("storeBlob / getBlob / getBlobData", () => {
  it("stores bytes and metadata, then reads them back", async () => {
    const store = createBlobStore({ dbName: "store-test-1" });
    const record = await store.storeBlob(textBuffer("hello world"), {
      filename: "hello.txt",
      mime: "text/plain",
    });

    expect(record.blob_id).toBe(record.blake3);
    expect(record.filename).toBe("hello.txt");
    expect(record.blob_type).toBe("original");
    expect(record.storage_backend).toBe("opfs");

    const data = await store.getBlobData(record.blob_id);
    expect(new TextDecoder().decode(data!)).toBe("hello world");

    const blob = await store.getBlob(record.blob_id);
    expect(blob?.type).toBe("text/plain");
    expect(new TextDecoder().decode(await blob!.arrayBuffer())).toBe("hello world");
  });

  it("dedups on content address - storing the same bytes twice returns the same record", async () => {
    const store = createBlobStore({ dbName: "store-test-dedup" });
    const first = await store.storeBlob(textBuffer("same content"), {
      filename: "a.txt",
      mime: "text/plain",
    });
    const second = await store.storeBlob(textBuffer("same content"), {
      filename: "b.txt",
      mime: "text/plain",
    });
    expect(second).toEqual(first);
    expect(second.filename).toBe("a.txt");
  });

  it("keeps two store instances with different db names from seeing each other's records", async () => {
    const storeA = createBlobStore({ dbName: "store-test-iso-a" });
    const storeB = createBlobStore({ dbName: "store-test-iso-b" });
    const record = await storeA.storeBlob(textBuffer("isolated"), {
      filename: "iso.txt",
      mime: "text/plain",
    });
    expect(await storeB.getBlobRecord(record.blob_id)).toBeNull();
    expect(await storeA.getBlobRecord(record.blob_id)).not.toBeNull();
  });

  it("defaults to DEFAULT_DB_NAME when no dbName is given", () => {
    // just confirms the constant is exported and stable, since two default
    // stores would otherwise silently share state across tests.
    expect(DEFAULT_DB_NAME).toBe("reliquary-blobs");
  });

  it("falls back to the cache-api backend when opfs is unavailable, without throwing", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:mock-${Math.random()}`),
      revokeObjectURL: vi.fn(),
    });
    const cacheStorage = new Map<string, Map<string, Response>>();
    vi.stubGlobal("caches", {
      async open(name: string) {
        if (!cacheStorage.has(name)) cacheStorage.set(name, new Map());
        const entries = cacheStorage.get(name)!;
        return {
          async put(url: string, response: Response) {
            entries.set(url, response);
          },
          async match(url: string) {
            const found = entries.get(url);
            return found ? found.clone() : undefined;
          },
        };
      },
    });
    // no navigator.storage installed at all - opfs is unavailable

    const store = createBlobStore({ dbName: "store-test-cache-fallback" });
    const record = await store.storeBlob(textBuffer("opfs-less content"), {
      filename: "no-opfs.txt",
      mime: "text/plain",
    });
    expect(record.storage_backend).toBe("cache");
    const data = await store.getBlobData(record.blob_id);
    expect(new TextDecoder().decode(data!)).toBe("opfs-less content");
  });

  it("throws when neither opfs nor cache-api can accept the write", async () => {
    vi.unstubAllGlobals();
    // no navigator.storage, no caches - every backend in the chain refuses
    const store = createBlobStore({ dbName: "store-test-no-backend" });
    await expect(
      store.storeBlob(textBuffer("nowhere to go"), { filename: "x.txt", mime: "text/plain" })
    ).rejects.toThrow(/no bytes backend accepted/);
  });
});

describe("storeBlobFromFile", () => {
  it("uses the buffered path for small files", async () => {
    const store = createBlobStore({ dbName: "store-test-file-small" });
    const file = new File([textBuffer("small file contents")], "small.txt", { type: "text/plain" });
    const record = await store.storeBlobFromFile(file);
    expect(record.filename).toBe("small.txt");
    expect(record.sha256).toBeTruthy();
    const data = await store.getBlobData(record.blob_id);
    expect(new TextDecoder().decode(data!)).toBe("small file contents");
  });

  it("streams large files and omits sha256 (legacy-only, never computed for streamed uploads)", async () => {
    const store = createBlobStore({ dbName: "store-test-file-large" });
    const bigBytes = new Uint8Array(8 * 1024 * 1024 + 10).fill(7);
    const file = new File([bigBytes], "large.bin", { type: "application/octet-stream" });
    const record = await store.storeBlobFromFile(file);
    expect(record.size).toBe(bigBytes.byteLength);
    expect(record.sha256).toBeUndefined();
    const data = await store.getBlobData(record.blob_id);
    expect(data?.byteLength).toBe(bigBytes.byteLength);
  });

  it("propagates an AbortError from a cancelled streamed upload without falling back", async () => {
    const store = createBlobStore({ dbName: "store-test-file-abort" });
    const worker = await import("../worker/index.js");
    vi.mocked(worker.streamFileToOpfs).mockRejectedValueOnce(new DOMException("upload cancelled", "AbortError"));
    const bigBytes = new Uint8Array(8 * 1024 * 1024 + 1);
    const file = new File([bigBytes], "large.bin");
    await expect(store.storeBlobFromFile(file)).rejects.toThrow(/upload cancelled/);
  });
});

describe("resolveBlob", () => {
  it("resolves a legacy sha256-primary-keyed record by its blake3 index", async () => {
    await putRecord("store-test-resolve", {
      blob_id: "legacy-sha256-key",
      blake3: "blake3-known-later",
      sha256: "legacy-sha256-key",
      filename: "legacy.txt",
      mime: "text/plain",
      size: 4,
      blob_type: "original",
      parent_blob_id: null,
      created_at: 1,
      storage_backend: "opfs",
    });
    const store = createBlobStore({ dbName: "store-test-resolve" });
    expect(await store.resolveBlob("blake3-known-later")).not.toBeNull();
    expect(await store.resolveBlob("legacy-sha256-key")).not.toBeNull();
    expect(await store.resolveBlob("anything", "blake3-known-later")).not.toBeNull();
    expect(await store.resolveBlob("nothing-matches")).toBeNull();
  });

  it("getBlobMetadata is an alias for resolveBlob", async () => {
    const store = createBlobStore({ dbName: "store-test-metadata-alias" });
    const record = await store.storeBlob(textBuffer("meta"), { filename: "m.txt", mime: "text/plain" });
    expect(await store.getBlobMetadata(record.blob_id)).toEqual(record);
  });
});

describe("getBlobObjectURL", () => {
  it("returns and caches an object url for a stored blob", async () => {
    const store = createBlobStore({ dbName: "store-test-url" });
    const record = await store.storeBlob(textBuffer("url content"), {
      filename: "u.txt",
      mime: "text/plain",
    });
    const url1 = await store.getBlobObjectURL(record.blob_id);
    const url2 = await store.getBlobObjectURL(record.blob_id);
    expect(url1).toBe(url2);
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledTimes(1);
  });

  it("returns null for a blob that doesn't exist", async () => {
    const store = createBlobStore({ dbName: "store-test-url-missing" });
    expect(await store.getBlobObjectURL("nope")).toBeNull();
  });

  it("clearBlobUrlCache revokes every cached url", async () => {
    const store = createBlobStore({ dbName: "store-test-url-clear" });
    const record = await store.storeBlob(textBuffer("clear me"), {
      filename: "c.txt",
      mime: "text/plain",
    });
    await store.getBlobObjectURL(record.blob_id);
    store.clearBlobUrlCache();
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(1);
  });
});

describe("hasBlobBytes / checkBlobLocality", () => {
  it("reports local for a record with bytes present", async () => {
    const store = createBlobStore({ dbName: "store-test-locality-local" });
    const record = await store.storeBlob(textBuffer("local content"), {
      filename: "l.txt",
      mime: "text/plain",
    });
    expect(await store.hasBlobBytes(record.blob_id)).toBe(true);
    const info = await store.checkBlobLocality(record.blob_id);
    expect(info.locality).toBe("local");
    expect(info.metadata?.id).toBe(record.blob_id);
  });

  it("reports remote for a blobId with no record at all", async () => {
    const store = createBlobStore({ dbName: "store-test-locality-remote" });
    expect(await store.hasBlobBytes("nothing")).toBe(false);
    expect((await store.checkBlobLocality("nothing")).locality).toBe("remote");
  });

  it("reports remote for a stranded record whose bytes are missing (not stuck local forever)", async () => {
    const store = createBlobStore({ dbName: "store-test-locality-stranded" });
    // simulate a record whose write silently failed to persist bytes:
    // metadata exists, but no backend actually has the bytes.
    await putRecord("store-test-locality-stranded", {
      blob_id: "stranded-blake3",
      blake3: "stranded-blake3",
      filename: "stranded.txt",
      mime: "text/plain",
      size: 10,
      blob_type: "original",
      parent_blob_id: null,
      created_at: 1,
      storage_backend: "opfs",
    });
    expect(await store.hasBlobBytes("stranded-blake3")).toBe(false);
    const info = await store.checkBlobLocality("stranded-blake3");
    expect(info.locality).toBe("remote");
  });

  it("checkBlobLocality on an empty blobId is unknown, not remote", async () => {
    const store = createBlobStore({ dbName: "store-test-locality-empty" });
    expect((await store.checkBlobLocality("")).locality).toBe("unknown");
  });
});

describe("deleteBlob / clearAll", () => {
  it("removes both the record and the bytes", async () => {
    const store = createBlobStore({ dbName: "store-test-delete" });
    const record = await store.storeBlob(textBuffer("delete me"), {
      filename: "d.txt",
      mime: "text/plain",
    });
    await store.deleteBlob(record.blob_id);
    expect(await store.getBlobRecord(record.blob_id)).toBeNull();
    expect(await store.hasBlobBytes(record.blob_id)).toBe(false);
  });

  it("clearAll wipes every record and every backend's bytes", async () => {
    const store = createBlobStore({ dbName: "store-test-clear-all" });
    const a = await store.storeBlob(textBuffer("clear-all-a"), { filename: "a.txt", mime: "text/plain" });
    const b = await store.storeBlob(textBuffer("clear-all-b"), { filename: "b.txt", mime: "text/plain" });
    await store.clearAll();
    expect(await store.getBlobRecord(a.blob_id)).toBeNull();
    expect(await store.getBlobRecord(b.blob_id)).toBeNull();
    expect(await store.hasBlobBytes(a.blob_id)).toBe(false);
  });
});
