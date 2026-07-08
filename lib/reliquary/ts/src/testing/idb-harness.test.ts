import { beforeEach, describe, expect, it } from "vitest";
import { fakeIdbHarness } from "./idb-harness.js";

beforeEach(() => {
  fakeIdbHarness();
});

function openTestDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("things", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putThing(db: IDBDatabase, thing: { id: string; value: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("things", "readwrite");
    tx.objectStore("things").put(thing);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getThing(db: IDBDatabase, id: string): Promise<{ id: string; value: string } | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("things", "readonly");
    const request = tx.objectStore("things").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("fakeIdbHarness", () => {
  it("provides a working indexedDB global", async () => {
    const db = await openTestDb("harness-test-1");
    await putThing(db, { id: "a", value: "hello" });
    await expect(getThing(db, "a")).resolves.toEqual({ id: "a", value: "hello" });
    db.close();
  });

  it("resets to an empty database between calls, even for the same db name", async () => {
    const db1 = await openTestDb("harness-test-2");
    await putThing(db1, { id: "a", value: "leftover" });
    db1.close();

    fakeIdbHarness();

    const db2 = await openTestDb("harness-test-2");
    await expect(getThing(db2, "a")).resolves.toBeUndefined();
    db2.close();
  });
});
