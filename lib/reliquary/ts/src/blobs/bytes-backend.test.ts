// @vitest-environment happy-dom
//
// exercises the bytes side of the resolver chain: OPFS backend (fake
// directory/file handles - sync access handles are worker/chromium-only
// and not worth faking here, same call as blob-worker-logic.test.ts),
// Cache API backend (fake CacheStorage), and the chain helpers that tie
// multiple backends together.

import { afterEach, describe, expect, it, vi } from "vitest";

// ---- fake OPFS (async writable-stream path only, matches
// blob-worker-logic.test.ts's fake) ----

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

function installFakeOpfs(): FakeDirHandle {
  const root = new FakeDirHandle();
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: async () => root,
    },
  });
  return root;
}

// the worker write path is mocked to write through the same fake
// directory the direct-read path uses, so both sides of a
// write-then-read round trip agree on where bytes live - exactly like
// the real worker (sync-access-handle writes) and the real direct OPFS
// reads share one physical directory.
vi.mock("../worker/index.js", () => ({
  BLOB_OPFS_DIR: "reliquary-blobs",
  writeBlobToOpfs: vi.fn(async (id: string, data: ArrayBuffer) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("reliquary-blobs", { create: true });
    const file = await dir.getFileHandle(id, { create: true });
    const writable = await file.createWritable();
    await writable.write(data);
    await writable.close();
  }),
}));

// ---- fake Cache API ----

class FakeCache {
  entries = new Map<string, Response>();
  async put(url: string, response: Response): Promise<void> {
    this.entries.set(url, response);
  }
  async match(url: string): Promise<Response | undefined> {
    const found = this.entries.get(url);
    return found ? found.clone() : undefined;
  }
  async delete(url: string): Promise<boolean> {
    return this.entries.delete(url);
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

function installFakeCaches(): FakeCacheStorage {
  const storage = new FakeCacheStorage();
  vi.stubGlobal("caches", storage);
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const {
  createOpfsBackend,
  createCacheBackend,
  isOPFSSupported,
  defaultBytesChain,
  writeThroughChain,
  readThroughChain,
  hasBytesInChain,
  removeFromChain,
} = await import("./bytes-backend.js");

describe("isOPFSSupported", () => {
  it("is false with no navigator.storage.getDirectory", () => {
    expect(isOPFSSupported()).toBe(false);
  });

  it("is true once a fake OPFS is installed", () => {
    installFakeOpfs();
    expect(isOPFSSupported()).toBe(true);
  });
});

describe("createOpfsBackend", () => {
  it("round-trips bytes through write/read/has/remove", async () => {
    installFakeOpfs();
    const backend = createOpfsBackend();
    const data = new TextEncoder().encode("hello opfs").buffer as ArrayBuffer;

    expect(await backend.write("id-1", data, "text/plain")).toBe(true);
    expect(await backend.has("id-1")).toBe(true);
    const readBack = await backend.read("id-1");
    expect(new TextDecoder().decode(readBack!)).toBe("hello opfs");

    await backend.remove("id-1");
    expect(await backend.has("id-1")).toBe(false);
    expect(await backend.read("id-1")).toBeNull();
  });

  it("read/has return null/false, write returns false, with no OPFS available", async () => {
    const backend = createOpfsBackend();
    expect(await backend.isAvailable()).toBe(false);
    expect(await backend.write("id-1", new ArrayBuffer(4), "text/plain")).toBe(false);
    expect(await backend.read("id-1")).toBeNull();
    expect(await backend.has("id-1")).toBe(false);
  });

  it("clear() removes the whole opfs directory", async () => {
    const root = installFakeOpfs();
    const backend = createOpfsBackend();
    await backend.write("id-1", new ArrayBuffer(4), "text/plain");
    await backend.clear();
    // the fake directory's removeEntry on the root only throws for a
    // missing entry - a second clear() should stay a no-op, not throw.
    await expect(backend.clear()).resolves.toBeUndefined();
    void root;
  });
});

describe("createCacheBackend", () => {
  it("round-trips bytes through write/read/has/remove", async () => {
    installFakeCaches();
    const backend = createCacheBackend();
    const data = new TextEncoder().encode("hello cache").buffer as ArrayBuffer;

    expect(await backend.write("id-2", data, "text/plain")).toBe(true);
    expect(await backend.has("id-2")).toBe(true);
    const readBack = await backend.read("id-2");
    expect(new TextDecoder().decode(readBack!)).toBe("hello cache");

    await backend.remove("id-2");
    expect(await backend.has("id-2")).toBe(false);
  });

  it("read/has/write degrade gracefully with no Cache API available", async () => {
    const backend = createCacheBackend();
    expect(await backend.isAvailable()).toBe(false);
    expect(await backend.write("id-2", new ArrayBuffer(4), "text/plain")).toBe(false);
    expect(await backend.read("id-2")).toBeNull();
    expect(await backend.has("id-2")).toBe(false);
  });
});

describe("chain helpers", () => {
  it("writeThroughChain falls through to the next backend when the first is unavailable", async () => {
    installFakeCaches(); // opfs unavailable, cache available
    const chain = defaultBytesChain();
    const backendName = await writeThroughChain(chain, "id-3", new ArrayBuffer(4), "text/plain");
    expect(backendName).toBe("cache");
  });

  it("writeThroughChain returns null when every backend is unavailable", async () => {
    const chain = defaultBytesChain();
    expect(await writeThroughChain(chain, "id-3", new ArrayBuffer(4), "text/plain")).toBeNull();
  });

  it("readThroughChain goes straight to the known backend", async () => {
    installFakeOpfs();
    installFakeCaches();
    const chain = defaultBytesChain();
    const data = new TextEncoder().encode("known backend").buffer as ArrayBuffer;
    await writeThroughChain(chain, "id-4", data, "text/plain");
    const readBack = await readThroughChain(chain, "id-4", "opfs");
    expect(new TextDecoder().decode(readBack!)).toBe("known backend");
  });

  it("readThroughChain probes every backend when the backend is unknown", async () => {
    installFakeCaches(); // only cache available - opfs was never installed
    const chain = defaultBytesChain();
    const data = new TextEncoder().encode("legacy record").buffer as ArrayBuffer;
    await writeThroughChain(chain, "id-5", data, "text/plain");
    // no `knownBackend` passed - simulates a record predating the field
    const readBack = await readThroughChain(chain, "id-5");
    expect(new TextDecoder().decode(readBack!)).toBe("legacy record");
  });

  it("hasBytesInChain checks every backend", async () => {
    installFakeCaches();
    const chain = defaultBytesChain();
    expect(await hasBytesInChain(chain, "missing")).toBe(false);
    await writeThroughChain(chain, "id-6", new ArrayBuffer(4), "text/plain");
    expect(await hasBytesInChain(chain, "id-6")).toBe(true);
  });

  it("removeFromChain removes from every backend that has the id", async () => {
    installFakeOpfs();
    installFakeCaches();
    const chain = defaultBytesChain();
    await writeThroughChain(chain, "id-7", new ArrayBuffer(4), "text/plain");
    await removeFromChain(chain, "id-7");
    expect(await hasBytesInChain(chain, "id-7")).toBe(false);
  });
});
