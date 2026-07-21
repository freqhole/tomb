import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { acceptKnock, denyKnock } from "./responder.js";
import { createIdbKnockStore } from "./store.js";
import type { KnockPolicy, KnockScope, KnockStore } from "./types.js";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

function makeStore(): KnockStore {
  return createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
}

const REQUESTER_NODE_ID = "ab".repeat(32);
const RESPONDER_NODE_ID = "cd".repeat(32);
const browseScope: KnockScope = { kind: "browse" };

describe("acceptKnock", () => {
  it("runs the injected policy and records an accepted decision", async () => {
    const store = makeStore();
    const record = await store.createKnock({
      nodeId: REQUESTER_NODE_ID,
      direction: "inbound",
      scope: browseScope,
      message: "let me in",
    });

    const policy: KnockPolicy = vi.fn().mockResolvedValue({
      grantedRole: "member",
      grantedResourceIds: ["doc-1"],
    });

    const updated = await acceptKnock(store, record.id, policy, RESPONDER_NODE_ID);

    expect(policy).toHaveBeenCalledWith(record);
    expect(updated.status).toBe("accepted");
    expect(updated.processedBy).toBe(RESPONDER_NODE_ID);
    expect(updated.decisions).toEqual([
      {
        byNodeId: RESPONDER_NODE_ID,
        outcome: "accepted",
        grantedRole: "member",
        at: updated.processedAt,
      },
    ]);
    expect(updated.grantedResourceIds).toEqual(["doc-1"]);
  });

  it("supports a synchronous policy callback", async () => {
    const store = makeStore();
    const record = await store.createKnock({
      nodeId: REQUESTER_NODE_ID,
      direction: "inbound",
      scope: browseScope,
    });

    const policy: KnockPolicy = () => ({ grantedRole: "viewer" });
    const updated = await acceptKnock(store, record.id, policy, RESPONDER_NODE_ID);

    expect(updated.status).toBe("accepted");
    expect(updated.decisions[0].grantedRole).toBe("viewer");
  });

  it("throws for an unknown knock id", async () => {
    const store = makeStore();
    const policy: KnockPolicy = () => ({});
    await expect(acceptKnock(store, "nope", policy, RESPONDER_NODE_ID)).rejects.toThrow();
  });

  it("propagates a policy rejection without recording a decision", async () => {
    const store = makeStore();
    const record = await store.createKnock({
      nodeId: REQUESTER_NODE_ID,
      direction: "inbound",
      scope: browseScope,
    });
    const policy: KnockPolicy = vi.fn().mockRejectedValue(new Error("policy declined"));

    await expect(acceptKnock(store, record.id, policy, RESPONDER_NODE_ID)).rejects.toThrow(
      "policy declined",
    );
    expect((await store.getKnock(record.id))?.status).toBe("pending");
  });
});

describe("denyKnock", () => {
  it("records a denied decision with no granted role", async () => {
    const store = makeStore();
    const record = await store.createKnock({
      nodeId: REQUESTER_NODE_ID,
      direction: "inbound",
      scope: browseScope,
    });

    const updated = await denyKnock(store, record.id, RESPONDER_NODE_ID);

    expect(updated.status).toBe("denied");
    expect(updated.decisions).toEqual([
      { byNodeId: RESPONDER_NODE_ID, outcome: "denied", at: updated.processedAt },
    ]);
  });

  it("throws for an unknown knock id", async () => {
    const store = makeStore();
    await expect(denyKnock(store, "nope", RESPONDER_NODE_ID)).rejects.toThrow();
  });
});
