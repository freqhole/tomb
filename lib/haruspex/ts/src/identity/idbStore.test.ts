import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createIdbIdentityStore,
  databaseExists,
  identitySourceAvailable,
  openExistingDatabase,
  readIdentityFrom,
  writeIdentityTo,
} from "./idbStore.js";
import type { P2PIdentity } from "./types.js";

function makeIdentity(nodeId = "node-abc"): P2PIdentity {
  return {
    secret_key: new Uint8Array([1, 2, 3]),
    node_id: nodeId,
    created_at: 1000,
  };
}

beforeEach(() => {
  // fresh, isolated indexedDB per test
  globalThis.indexedDB = new IDBFactory();
});

describe("createIdbIdentityStore", () => {
  it("returns null when nothing has been stored yet", async () => {
    const store = createIdbIdentityStore({
      databaseName: "app-db",
      storeName: "identity",
    });
    expect(await store.get()).toBeNull();
  });

  it("creates the database and store lazily, round-tripping an identity", async () => {
    const store = createIdbIdentityStore({
      databaseName: "app-db",
      storeName: "identity",
    });
    const identity = makeIdentity("node-1");

    await store.set(identity);
    const result = await store.get();

    expect(result).toEqual(identity);
  });

  it("supports a custom record key", async () => {
    const store = createIdbIdentityStore({
      databaseName: "app-db",
      storeName: "identity",
      key: "custom-key",
    });
    const identity = makeIdentity("node-2");

    await store.set(identity);

    expect(await readIdentityFrom({
      databaseName: "app-db",
      storeName: "identity",
      key: "custom-key",
    })).toEqual(identity);
  });

  it("reuses the same database across separate store instances", async () => {
    const first = createIdbIdentityStore({ databaseName: "shared-db", storeName: "identity" });
    await first.set(makeIdentity("node-shared"));

    const second = createIdbIdentityStore({ databaseName: "shared-db", storeName: "identity" });
    expect(await second.get()).toEqual(makeIdentity("node-shared"));
  });
});

describe("databaseExists / openExistingDatabase", () => {
  it("reports false for a database that was never created", async () => {
    expect(await databaseExists("nope")).toBe(false);
    expect(await openExistingDatabase("nope")).toBeNull();
  });

  it("reports true once a database has actually been created", async () => {
    const store = createIdbIdentityStore({ databaseName: "real-db", storeName: "identity" });
    await store.set(makeIdentity());

    expect(await databaseExists("real-db")).toBe(true);
    const db = await openExistingDatabase("real-db");
    expect(db).not.toBeNull();
    db?.close();
  });

  it("never leaves behind a database after a failed existence check", async () => {
    await databaseExists("probed-only");
    expect(await databaseExists("probed-only")).toBe(false);
  });
});

describe("identitySourceAvailable / readIdentityFrom / writeIdentityTo", () => {
  it("is unavailable when the database does not exist", async () => {
    const source = { databaseName: "missing-db", storeName: "identity" };
    expect(await identitySourceAvailable(source)).toBe(false);
    expect(await readIdentityFrom(source)).toBeNull();
  });

  it("is unavailable when the database exists but lacks the store", async () => {
    const store = createIdbIdentityStore({ databaseName: "other-db", storeName: "other-store" });
    await store.set(makeIdentity());

    const source = { databaseName: "other-db", storeName: "identity" };
    expect(await identitySourceAvailable(source)).toBe(false);
    expect(await readIdentityFrom(source)).toBeNull();
  });

  it("reads an identity once the database and store exist", async () => {
    const store = createIdbIdentityStore({ databaseName: "seeded-db", storeName: "identity" });
    const identity = makeIdentity("node-seeded");
    await store.set(identity);

    const source = { databaseName: "seeded-db", storeName: "identity" };
    expect(await identitySourceAvailable(source)).toBe(true);
    expect(await readIdentityFrom(source)).toEqual(identity);
  });

  it("writeIdentityTo refuses to create a missing database", async () => {
    await expect(
      writeIdentityTo({ databaseName: "missing-db", storeName: "identity" }, makeIdentity()),
    ).rejects.toThrow(/does not exist/);
  });

  it("writeIdentityTo updates an existing source in place", async () => {
    const store = createIdbIdentityStore({ databaseName: "writable-db", storeName: "identity" });
    await store.set(makeIdentity("node-original"));

    const source = { databaseName: "writable-db", storeName: "identity" };
    await writeIdentityTo(source, makeIdentity("node-updated"));

    expect((await readIdentityFrom(source))?.node_id).toBe("node-updated");
  });
});
