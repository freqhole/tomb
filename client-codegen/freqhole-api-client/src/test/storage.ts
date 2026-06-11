// tests for storage/identity.ts and storage/webLocks.ts
//
// these tests run in node (tsx) which has no real IndexedDB or navigator.locks.
// they stub those globals with minimal in-memory implementations to exercise the
// policy logic without a browser environment.

import type { IdentityStore, P2PIdentity } from "../storage/identity.js";
import {
  resolveIdentity,
  persistIdentity,
} from "../storage/identity.js";
import { acquireNodeLeadership, LOCK_NAME } from "../storage/webLocks.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeIdentity(nodeId = "node-abc"): P2PIdentity {
  return {
    id: "p2p_identity",
    secret_key: new Uint8Array([1, 2, 3]),
    node_id: nodeId,
    created_at: 1000,
  };
}

function makeLocalStore(
  initial: P2PIdentity | null = null,
): IdentityStore & { stored: P2PIdentity | null } {
  let stored: P2PIdentity | null = initial;
  return {
    get stored() {
      return stored;
    },
    async get() {
      return stored;
    },
    async set(identity) {
      stored = identity;
    },
  };
}

type StoreName = string;

/** minimal fake IDB: one database, configurable stores and records */
function stubIndexedDB(opts: {
  databases: Array<{ name: string; version: number }>;
  stores: Record<string, Record<string, unknown>>;
}) {
  const dbData = opts.stores;

  const fakeIDB = {
    databases: async () => opts.databases,
    open: (name: string) => {
      const storeNames = Object.keys(dbData);
      const req: Partial<IDBOpenDBRequest> & {
        onsuccess: ((ev: Event) => void) | null;
        onerror: ((ev: Event) => void) | null;
        onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null;
        transaction: IDBTransaction | null;
        result: IDBDatabase;
      } = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        transaction: null,
        result: undefined as unknown as IDBDatabase,
      };

      const fakeDB: Partial<IDBDatabase> = {
        objectStoreNames: {
          contains: (storeName: StoreName) =>
            storeNames.includes(storeName),
        } as DOMStringList,
        close() {},
        transaction(storeName: string | string[], _mode?: IDBTransactionMode) {
          const sName = Array.isArray(storeName) ? storeName[0] : storeName;
          const store = dbData[sName] ?? {};
          const os: Partial<IDBObjectStore> = {
            get(key: IDBValidKey) {
              const getReq: Partial<IDBRequest> & {
                onsuccess: ((ev: Event) => void) | null;
                onerror: ((ev: Event) => void) | null;
                result: unknown;
                error: DOMException | null;
              } = {
                onsuccess: null,
                onerror: null,
                result: store[key as string] ?? undefined,
                error: null,
              };
              // fire async so caller can set handlers first
              queueMicrotask(() => getReq.onsuccess?.({} as Event));
              return getReq as IDBRequest;
            },
            put(value: unknown, key?: IDBValidKey) {
              if (key !== undefined) store[key as string] = value;
              const putReq: Partial<IDBRequest> & {
                onsuccess: ((ev: Event) => void) | null;
                onerror: ((ev: Event) => void) | null;
                result: unknown;
                error: DOMException | null;
              } = {
                onsuccess: null,
                onerror: null,
                result: key,
                error: null,
              };
              queueMicrotask(() => putReq.onsuccess?.({} as Event));
              return putReq as IDBRequest;
            },
          };
          const tx: Partial<IDBTransaction> = {
            objectStore: () => os as IDBObjectStore,
          };
          return tx as IDBTransaction;
        },
      };

      req.result = fakeDB as IDBDatabase;

      if (!opts.databases.some((d) => d.name === name)) {
        // db does not exist - fire upgradeneeded then let abort handler run
        queueMicrotask(() => {
          if (req.onupgradeneeded) {
            const ev = {
              target: { transaction: null },
            } as unknown as IDBVersionChangeEvent;
            req.onupgradeneeded(ev);
          }
          req.onerror?.({} as Event);
        });
      } else {
        queueMicrotask(() => req.onsuccess?.({} as Event));
      }

      return req as IDBOpenDBRequest;
    },
    deleteDatabase: (_name: string) => ({} as IDBOpenDBRequest),
  };

  return fakeIDB;
}

// ---------------------------------------------------------------------------
// test runner helpers (matches existing test/ conventions)
// ---------------------------------------------------------------------------

export async function runStorageTests(): Promise<{
  passed: number;
  failed: number;
}> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(
        `✗ ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  console.log("running storage tests...\n");

  // ---------------------------------------------------------------------------
  // identity - freqhole_app absent
  // ---------------------------------------------------------------------------

  await test(
    "resolveIdentity - returns local identity when freqhole_app absent",
    async () => {
      const identity = makeIdentity("node-local");
      const local = makeLocalStore(identity);

      // stub indexedDB with no databases
      const fakeIDB = stubIndexedDB({ databases: [], stores: {} });
      const origIDB = (globalThis as Record<string, unknown>).indexedDB;
      (globalThis as Record<string, unknown>).indexedDB = fakeIDB;
      try {
        const result = await resolveIdentity(local);
        assert(result?.node_id === "node-local", "expected local identity");
      } finally {
        (globalThis as Record<string, unknown>).indexedDB = origIDB;
      }
    },
  );

  await test(
    "persistIdentity - writes to local store when freqhole_app absent",
    async () => {
      const identity = makeIdentity("node-new");
      const local = makeLocalStore(null);

      const fakeIDB = stubIndexedDB({ databases: [], stores: {} });
      const origIDB = (globalThis as Record<string, unknown>).indexedDB;
      (globalThis as Record<string, unknown>).indexedDB = fakeIDB;
      try {
        await persistIdentity(identity, local);
        assert(local.stored?.node_id === "node-new", "expected identity in local store");
      } finally {
        (globalThis as Record<string, unknown>).indexedDB = origIDB;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // identity - freqhole_app present
  // ---------------------------------------------------------------------------

  await test(
    "resolveIdentity - prefers spume identity when freqhole_app has one",
    async () => {
      const spumeIdentity = makeIdentity("node-spume");
      const localIdentity = makeIdentity("node-local");
      const local = makeLocalStore(localIdentity);

      const fakeIDB = stubIndexedDB({
        databases: [{ name: "freqhole_app", version: 1 }],
        stores: {
          app_state: { p2p_identity: spumeIdentity },
        },
      });
      const origIDB = (globalThis as Record<string, unknown>).indexedDB;
      (globalThis as Record<string, unknown>).indexedDB = fakeIDB;
      try {
        const result = await resolveIdentity(local);
        assert(result?.node_id === "node-spume", "expected spume identity to win");
      } finally {
        (globalThis as Record<string, unknown>).indexedDB = origIDB;
      }
    },
  );

  await test(
    "resolveIdentity - falls back to local when freqhole_app has no identity",
    async () => {
      const localIdentity = makeIdentity("node-local");
      const local = makeLocalStore(localIdentity);

      const fakeIDB = stubIndexedDB({
        databases: [{ name: "freqhole_app", version: 1 }],
        stores: { app_state: {} }, // store exists but no identity
      });
      const origIDB = (globalThis as Record<string, unknown>).indexedDB;
      (globalThis as Record<string, unknown>).indexedDB = fakeIDB;
      try {
        const result = await resolveIdentity(local);
        assert(result?.node_id === "node-local", "expected local fallback");
      } finally {
        (globalThis as Record<string, unknown>).indexedDB = origIDB;
      }
    },
  );

  await test(
    "persistIdentity - writes to freqhole_app when it exists",
    async () => {
      const identity = makeIdentity("node-new");
      const local = makeLocalStore(null);
      const storeData: Record<string, unknown> = {};

      const fakeIDB = stubIndexedDB({
        databases: [{ name: "freqhole_app", version: 1 }],
        stores: { app_state: storeData },
      });
      const origIDB = (globalThis as Record<string, unknown>).indexedDB;
      (globalThis as Record<string, unknown>).indexedDB = fakeIDB;
      try {
        await persistIdentity(identity, local);
        assert(
          (storeData["p2p_identity"] as P2PIdentity | undefined)?.node_id === "node-new",
          "expected identity written to freqhole_app",
        );
        assert(local.stored === null, "expected local store untouched");
      } finally {
        (globalThis as Record<string, unknown>).indexedDB = origIDB;
      }
    },
  );

// ---------------------------------------------------------------------------
// webLocks - unsupported fallback
// ---------------------------------------------------------------------------

// navigator is read-only on globalThis in Node.js; use defineProperty to stub it
function stubNavigator(value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    } else {
      // was not originally defined - remove our stub
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }
  };
}

  await test(
    "acquireNodeLeadership - calls onAcquired immediately when navigator.locks absent",
    async () => {
      const restore = stubNavigator(undefined);
      try {
        const states: string[] = [];
        let acquired = false;

        const cancel = acquireNodeLeadership({
          onAcquired: () => {
            acquired = true;
          },
          onStateChange: (s) => states.push(s),
        });

        // give the microtask queue a tick
        await Promise.resolve();

        assert(states[0] === "unsupported", "expected unsupported state");
        assert(acquired, "expected onAcquired to be called");
        cancel(); // no-op
      } finally {
        restore();
      }
    },
  );

  await test(
    "acquireNodeLeadership - exports LOCK_NAME constant",
    () => {
      assert(LOCK_NAME === "freqhole-iroh-node", "wrong lock name");
    },
  );

  // ---------------------------------------------------------------------------
  // webLocks - navigator.locks stub (granted immediately via ifAvailable)
  // ---------------------------------------------------------------------------

  await test(
    "acquireNodeLeadership - calls onAcquired when lock granted",
    async () => {
      const states: string[] = [];
      let acquired = false;

      // stub navigator.locks where ifAvailable returns a non-null lock
      const restore = stubNavigator({
        locks: {
          request: async (
            _name: string,
            opts: { ifAvailable?: boolean },
            cb: (lock: Lock | null) => Promise<void>,
          ) => {
            if (opts.ifAvailable) {
              // grant immediately
              await cb({ name: _name, mode: "exclusive" } as Lock);
            }
          },
        },
      });

      try {
        const cancel = acquireNodeLeadership({
          onAcquired: () => {
            acquired = true;
          },
          onStateChange: (s) => states.push(s),
        });

        // the lock request is fire-and-forget; wait a few microtasks
        await new Promise((r) => setTimeout(r, 10));
        cancel();

        assert(states.includes("leader"), "expected leader state");
        assert(acquired, "expected onAcquired to be called");
      } finally {
        restore();
      }
    },
  );

  await test(
    "acquireNodeLeadership - reports waiting when lock not available",
    async () => {
      const states: string[] = [];

      // stub: ifAvailable returns null (lock held elsewhere), queued request never resolves
      const restore = stubNavigator({
        locks: {
          request: async (
            _name: string,
            opts: { ifAvailable?: boolean; signal?: AbortSignal },
            cb: (lock: Lock | null) => Promise<void>,
          ) => {
            if (opts.ifAvailable) {
              // lock held - return null
              await cb(null);
            } else {
              // wait forever (or until signal aborts)
              await new Promise<void>((_, reject) => {
                opts.signal?.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                );
              });
            }
          },
        },
      });

      try {
        const cancel = acquireNodeLeadership({
          onAcquired: () => {},
          onStateChange: (s) => states.push(s),
        });

        await new Promise((r) => setTimeout(r, 10));
        assert(states.includes("waiting"), "expected waiting state");
        cancel(); // trigger abort
        await new Promise((r) => setTimeout(r, 10));
      } finally {
        restore();
      }
    },
  );

  return { passed, failed };
}
