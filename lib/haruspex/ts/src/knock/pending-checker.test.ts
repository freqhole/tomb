import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkPendingKnocks } from "./pending-checker.js";
import { sendKnock } from "./requester.js";
import { createIdbKnockStore } from "./store.js";
import type { KnockScope, KnockStore, KnockTransport } from "./types.js";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
});

function makeStore(): KnockStore {
  return createIdbKnockStore({ databaseName: "app-db", storeName: "knocks" });
}

const ACCEPTED_PEER = "ab".repeat(32);
const DENIED_PEER = "cd".repeat(32);
const STILL_PENDING_PEER = "ef".repeat(32);
const UNREACHABLE_PEER = "12".repeat(32);
const browseScope: KnockScope = { kind: "browse" };

describe("checkPendingKnocks", () => {
  it("fires onAccepted for newly-accepted knocks and leaves others alone", async () => {
    const store = makeStore();
    const sendTransport: KnockTransport = {
      sendKnock: vi.fn().mockResolvedValue({ status: "pending" }),
      checkKnockStatus: vi.fn(),
    };
    await sendKnock(store, sendTransport, ACCEPTED_PEER, { scope: browseScope });
    await sendKnock(store, sendTransport, DENIED_PEER, { scope: browseScope });
    await sendKnock(store, sendTransport, STILL_PENDING_PEER, { scope: browseScope });
    await sendKnock(store, sendTransport, UNREACHABLE_PEER, { scope: browseScope });

    const checkTransport: KnockTransport = {
      sendKnock: vi.fn(),
      checkKnockStatus: vi.fn().mockImplementation((nodeId: string) => {
        if (nodeId === ACCEPTED_PEER) {
          return Promise.resolve({ status: "accepted", grantedResourceIds: ["doc-1"] });
        }
        if (nodeId === DENIED_PEER) return Promise.resolve({ status: "denied" });
        if (nodeId === STILL_PENDING_PEER) return Promise.resolve({ status: "pending" });
        return Promise.reject(new Error("peer unreachable"));
      }),
    };

    const onAccepted = vi.fn();
    const onDenied = vi.fn();

    await checkPendingKnocks({ store, transport: checkTransport, onAccepted, onDenied });

    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted.mock.calls[0][0].nodeId).toBe(ACCEPTED_PEER);
    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(onDenied.mock.calls[0][0].nodeId).toBe(DENIED_PEER);

    const remainingPending = (await store.listPending()).map((r) => r.nodeId).sort();
    expect(remainingPending.sort()).toEqual([STILL_PENDING_PEER, UNREACHABLE_PEER].sort());
  });

  it("ignores inbound pending knocks - only sweeps outbound ones", async () => {
    const store = makeStore();
    await store.createKnock({
      nodeId: ACCEPTED_PEER,
      direction: "inbound",
      scope: browseScope,
    });

    const transport: KnockTransport = {
      sendKnock: vi.fn(),
      checkKnockStatus: vi.fn().mockResolvedValue({ status: "accepted" }),
    };
    const onAccepted = vi.fn();

    await checkPendingKnocks({ store, transport, onAccepted });

    expect(onAccepted).not.toHaveBeenCalled();
    expect(transport.checkKnockStatus).not.toHaveBeenCalled();
  });

  it("does nothing when there are no pending knocks", async () => {
    const store = makeStore();
    const transport: KnockTransport = {
      sendKnock: vi.fn(),
      checkKnockStatus: vi.fn(),
    };
    const onAccepted = vi.fn();

    await checkPendingKnocks({ store, transport, onAccepted });

    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("works without an onDenied callback", async () => {
    const store = makeStore();
    const sendTransport: KnockTransport = {
      sendKnock: vi.fn().mockResolvedValue({ status: "pending" }),
      checkKnockStatus: vi.fn(),
    };
    await sendKnock(store, sendTransport, DENIED_PEER, { scope: browseScope });

    const transport: KnockTransport = {
      sendKnock: vi.fn(),
      checkKnockStatus: vi.fn().mockResolvedValue({ status: "denied" }),
    };
    const onAccepted = vi.fn();

    await expect(checkPendingKnocks({ store, transport, onAccepted })).resolves.toBeUndefined();
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
