import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkKnockStatus, sendKnock } from "./requester.js";
import { createIdbKnockStore } from "./store.js";
import type { KnockScope, KnockStatusReply, KnockStore, KnockTransport } from "./types.js";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

function makeStore(): KnockStore {
  return createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
}

const NODE_ID = "ab".repeat(32);
const browseScope: KnockScope = { kind: "browse" };

function makeTransport(overrides: Partial<KnockTransport> = {}): KnockTransport {
  return {
    sendKnock: vi.fn().mockResolvedValue({ status: "pending" } satisfies KnockStatusReply),
    checkKnockStatus: vi.fn().mockResolvedValue({ status: "pending" } satisfies KnockStatusReply),
    ...overrides,
  };
}

describe("sendKnock", () => {
  it("creates an outbound record and applies the transport's reply", async () => {
    const store = makeStore();
    const transport = makeTransport({
      sendKnock: vi.fn().mockResolvedValue({ status: "accepted", grantedResourceIds: ["doc-1"] }),
    });

    const record = await sendKnock(store, transport, NODE_ID, {
      scope: browseScope,
      message: "hi",
    });

    expect(record.direction).toBe("outbound");
    expect(record.status).toBe("accepted");
    expect(record.grantedResourceIds).toEqual(["doc-1"]);
    expect(transport.sendKnock).toHaveBeenCalledWith(NODE_ID, {
      scope: browseScope,
      message: "hi",
    });
  });

  it("leaves the record pending when the transport reply is still pending", async () => {
    const store = makeStore();
    const transport = makeTransport();

    const record = await sendKnock(store, transport, NODE_ID, { scope: browseScope });
    expect(record.status).toBe("pending");
    expect(record.decisions).toEqual([]);
  });

  it("leaves the record pending when the transport call throws", async () => {
    const store = makeStore();
    const transport = makeTransport({
      sendKnock: vi.fn().mockRejectedValue(new Error("peer unreachable")),
    });

    const record = await sendKnock(store, transport, NODE_ID, { scope: browseScope });
    expect(record.status).toBe("pending");
  });

  it("propagates the dedup conflict when a pending knock already exists", async () => {
    const store = makeStore();
    const transport = makeTransport();
    await sendKnock(store, transport, NODE_ID, { scope: browseScope });

    await expect(sendKnock(store, transport, NODE_ID, { scope: browseScope })).rejects.toThrow();
  });
});

describe("checkKnockStatus", () => {
  it("resolves the record when the transport reports a decision", async () => {
    const store = makeStore();
    const transport = makeTransport();
    const record = await sendKnock(store, transport, NODE_ID, { scope: browseScope });

    transport.checkKnockStatus = vi.fn().mockResolvedValue({ status: "denied" });
    const updated = await checkKnockStatus(store, transport, record.id);

    expect(updated.status).toBe("denied");
    expect(updated.decisions).toHaveLength(1);
  });

  it("throws for an unknown knock id", async () => {
    const store = makeStore();
    const transport = makeTransport();
    await expect(checkKnockStatus(store, transport, "nope")).rejects.toThrow();
  });

  it("retries with backoff and succeeds before exhausting retries", async () => {
    const store = makeStore();
    const transport = makeTransport();
    const record = await sendKnock(store, transport, NODE_ID, { scope: browseScope });

    let calls = 0;
    transport.checkKnockStatus = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error("unreachable"));
      return Promise.resolve({ status: "accepted" });
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const updated = await checkKnockStatus(store, transport, record.id, {
      retries: 3,
      backoffMs: 10,
      sleep,
    });

    expect(updated.status).toBe("accepted");
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("throws the last error once retries are exhausted", async () => {
    const store = makeStore();
    const transport = makeTransport();
    const record = await sendKnock(store, transport, NODE_ID, { scope: browseScope });

    transport.checkKnockStatus = vi.fn().mockRejectedValue(new Error("still unreachable"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      checkKnockStatus(store, transport, record.id, { retries: 2, backoffMs: 5, sleep }),
    ).rejects.toThrow("still unreachable");
    expect(transport.checkKnockStatus).toHaveBeenCalledTimes(3);
  });
});
