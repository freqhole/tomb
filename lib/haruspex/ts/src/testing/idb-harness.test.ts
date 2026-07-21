import { describe, expect, it } from "vitest";

import { setupFakeIndexedDB, teardownFakeIndexedDB } from "./idb-harness.js";

describe("setupFakeIndexedDB", () => {
  it("installs fake globals", () => {
    setupFakeIndexedDB();
    expect(globalThis.indexedDB).toBeDefined();
    expect(globalThis.IDBKeyRange).toBeDefined();
    teardownFakeIndexedDB();
  });
});

describe("teardownFakeIndexedDB", () => {
  it("clears the fake globals", () => {
    setupFakeIndexedDB();
    teardownFakeIndexedDB();
    expect(globalThis.indexedDB).toBeUndefined();
    expect(globalThis.IDBKeyRange).toBeUndefined();
  });
});
