import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { createIdbKnockStore } from "./store.js";
import { KnockConflictError } from "./types.js";
import type { KnockScope } from "./types.js";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

const NODE_ID = "ab".repeat(32);
const OTHER_NODE_ID = "cd".repeat(32);

const browseScope: KnockScope = { kind: "browse" };

describe("createIdbKnockStore", () => {
  it("creates and round-trips a pending knock", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const record = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
      message: "let me in",
    });

    expect(record.status).toBe("pending");
    expect(record.decisions).toEqual([]);
    expect(await store.getKnock(record.id)).toEqual(record);
  });

  it("has no metadata field when none is supplied - non-breaking for existing callers", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const record = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
      message: "let me in",
    });

    expect(record.metadata).toBeUndefined();
    expect(await store.getKnock(record.id)).toEqual(record);
  });

  it("round-trips an app-populated metadata bag", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const metadata = { name: "alice", avatarColor: "#ff00ff" };
    const record = await store.createKnock({
      nodeId: NODE_ID,
      direction: "inbound",
      scope: browseScope,
      message: "let me in",
      metadata,
    });

    expect(record.metadata).toEqual(metadata);
    expect((await store.getKnock(record.id))?.metadata).toEqual(metadata);
  });

  it("defaults message to an empty string and createdAt to now", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const before = Date.now();
    const record = await store.createKnock({
      nodeId: NODE_ID,
      direction: "inbound",
      scope: browseScope,
    });
    expect(record.message).toBe("");
    expect(record.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("rejects a second pending knock for the same node id + scope", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    await store.createKnock({ nodeId: NODE_ID, direction: "outbound", scope: browseScope });

    await expect(
      store.createKnock({ nodeId: NODE_ID, direction: "outbound", scope: browseScope }),
    ).rejects.toThrow(KnockConflictError);
  });

  it("allows a second pending knock for a different scope on the same node id", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    await store.createKnock({ nodeId: NODE_ID, direction: "outbound", scope: browseScope });

    const resourceKnock = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: { kind: "resource", resourceId: "doc-1" },
    });
    expect(resourceKnock.status).toBe("pending");
  });

  it("allows a new knock once the prior one is no longer pending", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const first = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
    });
    await store.recordDecision(first.id, { byNodeId: NODE_ID, outcome: "denied", at: Date.now() });

    const second = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
    });
    expect(second.status).toBe("pending");
    expect(second.id).not.toBe(first.id);
  });

  it("allows a new knock once the prior one is deleted", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const first = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
    });
    await store.deleteKnock(first.id);

    const second = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
    });
    expect(second.status).toBe("pending");
    expect(await store.getKnock(first.id)).toBeNull();
  });

  it("listPending returns only pending records, newest first", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const a = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
      createdAt: 1000,
    });
    const b = await store.createKnock({
      nodeId: OTHER_NODE_ID,
      direction: "outbound",
      scope: browseScope,
      createdAt: 2000,
    });
    await store.recordDecision(a.id, { byNodeId: NODE_ID, outcome: "accepted", at: 3000 });

    const pending = await store.listPending();
    expect(pending.map((r) => r.id)).toEqual([b.id]);
  });

  it("listAll returns every record, newest first", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const a = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
      createdAt: 1000,
    });
    const b = await store.createKnock({
      nodeId: OTHER_NODE_ID,
      direction: "outbound",
      scope: browseScope,
      createdAt: 2000,
    });
    expect((await store.listAll()).map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("findByNodeId returns the most recent record for that node id", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const first = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
      createdAt: 1000,
    });
    await store.recordDecision(first.id, { byNodeId: NODE_ID, outcome: "denied", at: 1500 });
    const second = await store.createKnock({
      nodeId: NODE_ID,
      direction: "outbound",
      scope: browseScope,
      createdAt: 2000,
    });

    const found = await store.findByNodeId(NODE_ID);
    expect(found?.id).toBe(second.id);
  });

  it("findByNodeId returns null for an unknown node id", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    expect(await store.findByNodeId(NODE_ID)).toBeNull();
  });

  it("recordDecision appends to the audit log and resolves status", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    const record = await store.createKnock({
      nodeId: NODE_ID,
      direction: "inbound",
      scope: browseScope,
    });

    const updated = await store.recordDecision(
      record.id,
      { byNodeId: OTHER_NODE_ID, outcome: "accepted", grantedRole: "member", at: 5000 },
      { grantedResourceIds: ["doc-1", "doc-2"] },
    );

    expect(updated.status).toBe("accepted");
    expect(updated.processedAt).toBe(5000);
    expect(updated.processedBy).toBe(OTHER_NODE_ID);
    expect(updated.decisions).toEqual([
      { byNodeId: OTHER_NODE_ID, outcome: "accepted", grantedRole: "member", at: 5000 },
    ]);
    expect(updated.grantedResourceIds).toEqual(["doc-1", "doc-2"]);
  });

  it("recordDecision throws for an unknown id", async () => {
    const store = createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
    await expect(
      store.recordDecision("nope", { byNodeId: NODE_ID, outcome: "denied", at: 0 }),
    ).rejects.toThrow();
  });

  it("uses parameterized database and store names", async () => {
    const store = createIdbKnockStore({
      databaseName: "playlistz-db",
      storeName: "knocks",
    });
    await store.createKnock({ nodeId: NODE_ID, direction: "inbound", scope: browseScope });

    const otherStore = createIdbKnockStore({
      databaseName: "different-db",
      storeName: "knocks",
    });
    expect(await otherStore.listAll()).toEqual([]);
  });
});
