// regression test for migrateLegacyCurrentItemKey: a persisted AppState
// record from before the current_sha256 -> current_item_key rename still
// carries the old property name verbatim (indexeddb doesn't schema-check
// against the current type) - without this migration, an existing user's
// "currently playing" position would silently reset to null on their
// first load after the rename, even though the real value was sitting
// right there in the old field.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAppDB, loadAppState, migrateLegacyCurrentItemKey } from "./db";
import { APP_DB_NAME, STORE_APP_STATE, type AppState } from "./types";

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    id: "app_state",
    current_item_key: null,
    queue: [],
    queue_open: false,
    active_remote_id: null,
    last_updated: 1000,
    ...overrides,
  };
}

describe("migrateLegacyCurrentItemKey", () => {
  it("carries over a legacy current_sha256 value when current_item_key is unset", () => {
    const legacy = { ...baseState(), current_sha256: "hash-123" } as unknown as AppState;
    const migrated = migrateLegacyCurrentItemKey(legacy);
    expect(migrated.current_item_key).toBe("hash-123");
    expect(migrated).not.toHaveProperty("current_sha256");
  });

  it("is a no-op when current_item_key is already set", () => {
    const state = baseState({ current_item_key: "already-set" });
    const migrated = migrateLegacyCurrentItemKey(state);
    expect(migrated).toBe(state);
  });

  it("is a no-op when there's no legacy field at all (fresh state)", () => {
    const state = baseState();
    const migrated = migrateLegacyCurrentItemKey(state);
    expect(migrated).toBe(state);
  });

  it("leaves current_item_key null when the legacy value was itself null", () => {
    const legacy = { ...baseState(), current_sha256: null } as unknown as AppState;
    const migrated = migrateLegacyCurrentItemKey(legacy);
    expect(migrated.current_item_key).toBeNull();
  });
});

// integration tests for the actual upgrade-time migration (v13 -> v14):
// mirrors music/services/storage/db/init.migration.test.ts's house style -
// hand-seed a real pre-migration schema via the raw `idb` API, then let
// `initAppDB()`'s real `upgrade()` callback run against it, since that's
// the only way to exercise the migration code path itself rather than
// just the pure helper function above. guards against the regression this
// migration exists to prevent: moving the fixup out of every-load
// `loadAppState()` and into the versioned `upgrade()` callback (so it
// runs once ever, not on every app boot) must not silently stop running
// it at all for an existing user's data.
describe("app_state upgrade-time migration (v13 -> v14)", () => {
  beforeEach(() => {
    closeAppDB();
    indexedDB = new IDBFactory();
  });

  afterEach(() => {
    closeAppDB();
  });

  async function seedPreMigrationDb(appState: Record<string, unknown>): Promise<void> {
    const db = await openDB(APP_DB_NAME, 13, {
      upgrade(db) {
        db.createObjectStore(STORE_APP_STATE, { keyPath: "id" });
      },
    });
    await db.put(STORE_APP_STATE, { id: "app_state", ...appState });
    db.close();
  }

  it("carries a real existing user's current_sha256 over to current_item_key", async () => {
    await seedPreMigrationDb({
      current_sha256: "legacy-hash-abc",
      queue: [],
      queue_open: false,
      active_remote_id: null,
      last_updated: 1000,
    });

    const state = await loadAppState();
    expect(state.current_item_key).toBe("legacy-hash-abc");
    expect(state).not.toHaveProperty("current_sha256");
  });

  it("backfills a legacy pre-kind-discriminant queue item (plain Song, not {kind, song})", async () => {
    const legacySong = { id: "song-1", sha256: "a".repeat(64), title: "old queue shape" };
    await seedPreMigrationDb({
      current_item_key: null,
      queue: [legacySong],
      queue_open: false,
      active_remote_id: null,
      last_updated: 1000,
    });

    const state = await loadAppState();
    expect(state.queue).toEqual([{ kind: "song", song: legacySong }]);
  });

  it("a brand-new install (no pre-existing db at all) just gets default state, no crash", async () => {
    const state = await loadAppState();
    expect(state.current_item_key).toBeNull();
    expect(state.queue).toEqual([]);
  });
});
