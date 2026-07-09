// exercises the metadata layer directly: CRUD + secondary indexes
// (sha256, blake3) that make the record resolver chain possible.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecords,
  deleteRecord,
  getRecord,
  getRecordByBlake3,
  getRecordBySha256,
  putRecord,
} from "./db.js";
import type { BlobRecord } from "./types.js";

const DB_NAME = "blobs-db-test";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function makeRecord(overrides: Partial<BlobRecord> = {}): BlobRecord {
  return {
    blob_id: "blake3-aaa",
    blake3: "blake3-aaa",
    sha256: "sha256-aaa",
    filename: "song.mp3",
    mime: "audio/mpeg",
    size: 1234,
    blob_type: "original",
    parent_blob_id: null,
    created_at: 1_000,
    storage_backend: "opfs",
    ...overrides,
  };
}

describe("putRecord / getRecord", () => {
  it("round-trips a record by its primary key", async () => {
    const record = makeRecord();
    await putRecord(DB_NAME, record);
    expect(await getRecord(DB_NAME, record.blob_id)).toEqual(record);
  });

  it("returns null for a record that was never stored", async () => {
    expect(await getRecord(DB_NAME, "nope")).toBeNull();
  });

  it("overwrites a record stored under the same blob_id", async () => {
    await putRecord(DB_NAME, makeRecord({ filename: "first.mp3" }));
    await putRecord(DB_NAME, makeRecord({ filename: "second.mp3" }));
    const record = await getRecord(DB_NAME, "blake3-aaa");
    expect(record?.filename).toBe("second.mp3");
  });
});

describe("getRecordBySha256 / getRecordByBlake3", () => {
  it("finds a record by its sha256 index", async () => {
    const record = makeRecord();
    await putRecord(DB_NAME, record);
    expect(await getRecordBySha256(DB_NAME, "sha256-aaa")).toEqual(record);
  });

  it("finds a record by its blake3 index", async () => {
    const record = makeRecord();
    await putRecord(DB_NAME, record);
    expect(await getRecordByBlake3(DB_NAME, "blake3-aaa")).toEqual(record);
  });

  it("finds a legacy record whose primary key is a sha256, not its blake3", async () => {
    // simulates a record created before blake3 became canonical: blob_id
    // is the legacy sha256, but blake3 is known and indexed separately.
    const legacy = makeRecord({
      blob_id: "sha256-legacy",
      blake3: "blake3-discovered-later",
      sha256: "sha256-legacy",
    });
    await putRecord(DB_NAME, legacy);
    expect(await getRecordByBlake3(DB_NAME, "blake3-discovered-later")).toEqual(legacy);
    expect(await getRecord(DB_NAME, "sha256-legacy")).toEqual(legacy);
  });

  it("returns null for an empty hash rather than matching everything", async () => {
    await putRecord(DB_NAME, makeRecord());
    expect(await getRecordBySha256(DB_NAME, "")).toBeNull();
    expect(await getRecordByBlake3(DB_NAME, "")).toBeNull();
  });
});

describe("deleteRecord", () => {
  it("removes a record so subsequent lookups miss", async () => {
    await putRecord(DB_NAME, makeRecord());
    await deleteRecord(DB_NAME, "blake3-aaa");
    expect(await getRecord(DB_NAME, "blake3-aaa")).toBeNull();
  });
});

describe("clearRecords", () => {
  it("empties every record in the store", async () => {
    await putRecord(DB_NAME, makeRecord({ blob_id: "a", blake3: "a" }));
    await putRecord(DB_NAME, makeRecord({ blob_id: "b", blake3: "b" }));
    await clearRecords(DB_NAME);
    expect(await getRecord(DB_NAME, "a")).toBeNull();
    expect(await getRecord(DB_NAME, "b")).toBeNull();
  });
});

describe("db name isolation", () => {
  it("keeps records in different-named databases from colliding", async () => {
    await putRecord("db-one", makeRecord());
    expect(await getRecord("db-two", "blake3-aaa")).toBeNull();
    expect(await getRecord("db-one", "blake3-aaa")).not.toBeNull();
  });
});

describe("pre-existing database at a higher version", () => {
  it("still reads and writes when dbName already exists at a version above DB_VERSION", async () => {
    // simulates an app's pre-existing database (this module's whole
    // reason for taking dbName as a parameter) that was already upgraded
    // to a later version by that app's own code before this store ever
    // touched it - indexedDB.open(name, 1) would otherwise fail with a
    // VersionError since 1 is lower than the database's actual version.
    const dbName = "pre-existing-higher-version-db";
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 3);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore("blobs", { keyPath: "blob_id" });
        store.createIndex("sha256", "sha256", { unique: false });
        store.createIndex("blake3", "blake3", { unique: false });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    const record = makeRecord();
    await putRecord(dbName, record);
    expect(await getRecord(dbName, record.blob_id)).toEqual(record);
    expect(await getRecordByBlake3(dbName, record.blake3)).toEqual(record);
  });
});
