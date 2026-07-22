// helper to set up fake-indexeddb for tests that need idb stores without a
// real browser environment.

import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

/** installs fake-indexeddb's `IDBFactory` and `IDBKeyRange` as globals,
 *  so idb-based code runs in a node test environment. call this in
 *  `beforeEach` for tests that use idb stores. */
export function setupFakeIndexedDB(): void {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
}

/** clears the fake idb instance (useful in `afterEach` if you want a
 *  fresh db for each test, though most tests just call `setupFakeIndexedDB`
 *  in `beforeEach` and let the instance get replaced). */
export function teardownFakeIndexedDB(): void {
  // @ts-expect-error - clearing the global
  globalThis.indexedDB = undefined;
  // @ts-expect-error - clearing the global
  globalThis.IDBKeyRange = undefined;
}
