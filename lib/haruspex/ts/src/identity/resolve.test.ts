import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { createIdbIdentityStore } from "./idbStore.js";
import { persistIdentity, resolveIdentity } from "./resolve.js";
import type { IdentityStore, P2PIdentity } from "./types.js";

function makeIdentity(nodeId = "node-abc"): P2PIdentity {
  return {
    secret_key: new Uint8Array([1, 2, 3]),
    node_id: nodeId,
    created_at: 1000,
  };
}

function makeLocalStore(initial: P2PIdentity | null = null): IdentityStore & { stored: P2PIdentity | null } {
  let stored: P2PIdentity | null = initial;
  return {
    get stored() {
      return stored;
    },
    async get() {
      return stored;
    },
    async set(identity: P2PIdentity) {
      stored = identity;
    },
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("resolveIdentity", () => {
  it("returns the local identity when there are no fallback sources", async () => {
    const local = makeLocalStore(makeIdentity("node-local"));
    expect((await resolveIdentity(local))?.node_id).toBe("node-local");
  });

  it("returns the local identity when configured fallback sources don't exist", async () => {
    const local = makeLocalStore(makeIdentity("node-local"));
    const result = await resolveIdentity(local, {
      fallbackSources: [{ databaseName: "sibling-app", storeName: "app_state" }],
    });
    expect(result?.node_id).toBe("node-local");
  });

  it("prefers a fallback source's identity over the local one", async () => {
    const siblingStore = createIdbIdentityStore({
      databaseName: "sibling-app",
      storeName: "app_state",
    });
    await siblingStore.set(makeIdentity("node-sibling"));

    const local = makeLocalStore(makeIdentity("node-local"));
    const result = await resolveIdentity(local, {
      fallbackSources: [{ databaseName: "sibling-app", storeName: "app_state" }],
    });

    expect(result?.node_id).toBe("node-sibling");
  });

  it("falls back to local when the fallback source exists but has no identity yet", async () => {
    // create the sibling db/store without writing an identity into it
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("sibling-app", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("app_state");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    const local = makeLocalStore(makeIdentity("node-local"));
    const result = await resolveIdentity(local, {
      fallbackSources: [{ databaseName: "sibling-app", storeName: "app_state" }],
    });

    expect(result?.node_id).toBe("node-local");
  });

  it("checks fallback sources in order, taking the first hit", async () => {
    const second = createIdbIdentityStore({ databaseName: "second-app", storeName: "app_state" });
    await second.set(makeIdentity("node-second"));

    const local = makeLocalStore(makeIdentity("node-local"));
    const result = await resolveIdentity(local, {
      fallbackSources: [
        { databaseName: "first-app", storeName: "app_state" },
        { databaseName: "second-app", storeName: "app_state" },
      ],
    });

    expect(result?.node_id).toBe("node-second");
  });
});

describe("persistIdentity", () => {
  it("writes to the local store when there are no fallback sources", async () => {
    const local = makeLocalStore(null);
    await persistIdentity(makeIdentity("node-new"), local);
    expect(local.stored?.node_id).toBe("node-new");
  });

  it("writes to the local store when configured fallback sources don't exist", async () => {
    const local = makeLocalStore(null);
    await persistIdentity(makeIdentity("node-new"), local, {
      fallbackSources: [{ databaseName: "sibling-app", storeName: "app_state" }],
    });
    expect(local.stored?.node_id).toBe("node-new");
  });

  it("writes to an existing fallback source instead of local", async () => {
    const sibling = createIdbIdentityStore({ databaseName: "sibling-app", storeName: "app_state" });
    // seed the sibling db/store so it "exists" from persistIdentity's perspective
    await sibling.set(makeIdentity("node-placeholder"));

    const local = makeLocalStore(null);
    await persistIdentity(makeIdentity("node-new"), local, {
      fallbackSources: [{ databaseName: "sibling-app", storeName: "app_state" }],
    });

    expect(local.stored).toBeNull();
    expect((await sibling.get())?.node_id).toBe("node-new");
  });
});
