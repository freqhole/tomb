// installs the `fake-indexeddb` global and resets it to a fresh
// `IDBFactory` - call from a test's `beforeEach` so data doesn't leak
// across tests through a shared `indexedDB` instance (a real risk: a
// previous test's records are otherwise still there when the next test's
// store opens the same database name).

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

/**
 * resets `globalThis.indexedDB` to a brand new `IDBFactory`, so every
 * caller starts from an empty database regardless of what earlier tests
 * wrote. the `fake-indexeddb/auto` polyfill import above runs once, at
 * module load time, installing `indexedDB` (and friends) as globals; this
 * function only needs to swap in a fresh factory per test.
 */
export function fakeIdbHarness(): void {
  globalThis.indexedDB = new IDBFactory();
}
