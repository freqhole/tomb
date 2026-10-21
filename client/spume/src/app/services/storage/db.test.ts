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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState, closeAppDB, loadAppState, migrateLegacyCurrentItemKey, updateQueueAvailability } from "./db";
import { APP_DB_NAME, STORE_APP_STATE, type AppState } from "./types";
import { refreshQueuedAvailability } from "../../../music/services/queue/refreshAvailability";

const api = vi.hoisted(() => ({ songs: vi.fn(), video: vi.fn() }));
vi.mock("../../api/client", () => ({
  getClientForRemote: async () => ({
    music: { querySongs: api.songs },
    video: { getVideo: api.video },
  }),
}));

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
    vi.clearAllMocks();
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

  it("persists availability without removing/reordering rows or changing local copies and other remotes", async () => {
    const media = (id: string, remote: string, source_type = "remote") => ({
      id, title: id, queue_entry_id: id, source_type, remote_server_id: remote, is_offline: false,
    });
    await seedPreMigrationDb({
      ...baseState(),
      current_item_key: "first",
      queue: [
        { kind: "song", song: media("first", "one") },
        { kind: "video", video: media("film", "one") },
        { kind: "song", song: media("local", "one", "downloaded") },
        { kind: "song", song: media("first", "two") },
      ],
    });
    const original = await loadAppState();
    await updateQueueAvailability("one", new Map([
      ["song:first", true], ["video:film", true], ["song:local", true],
    ]));
    const updated = appState()!;
    expect(updated.current_item_key).toBe("first");
    expect(updated.queue).toHaveLength(4);
    expect(updated.queue[0]).toMatchObject({ song: { id: "first", is_offline: true } });
    expect(updated.queue[1]).toMatchObject({ video: { id: "film", is_offline: true } });
    expect(updated.queue[2]).toBe(original.queue[2]);
    expect(updated.queue[3]).toBe(original.queue[3]);
    expect((await loadAppState()).queue).toEqual(updated.queue);
    await updateQueueAvailability("one", new Map([["song:first", false], ["video:film", false]]));
    expect(appState()?.queue[0]).toMatchObject({ song: { id: "first", is_offline: false } });
  });

  it("refreshes persisted mixed queues with batched songs and rejects probe failures without hiding media", async () => {
    const media = { id: "item", source_type: "remote", remote_server_id: "one", is_offline: false };
    await seedPreMigrationDb({
      ...baseState(),
      queue: [
        { kind: "song", song: media }, { kind: "song", song: media },
        { kind: "video", video: media },
      ],
    });
    await loadAppState();
    api.songs.mockResolvedValue({
      success: true, data: { items: [{ song: { id: "item" }, is_offline: true }] },
    });
    api.video.mockResolvedValue({ success: true, data: { is_offline: true } });
    await refreshQueuedAvailability({ remote_id: "one" });
    expect(api.songs).toHaveBeenCalledWith({
      filters: { song_ids: ["item"] }, limit: 1, offset: 0,
    });
    expect(api.video).toHaveBeenCalledWith({ id: "item" });
    expect(appState()?.queue[0]).toMatchObject({ song: { is_offline: true } });
    expect(appState()?.queue[2]).toMatchObject({ video: { is_offline: true } });
    const current = appState();
    api.songs.mockResolvedValue({ success: false, error: new Error("probe failed") });
    await expect(refreshQueuedAvailability({ remote_id: "one" })).rejects.toThrow("probe failed");
    expect(appState()).toBe(current);
    const cancelled = new AbortController();
    api.songs.mockImplementationOnce(async () => {
      cancelled.abort();
      return { success: true, data: { items: [{ song: { id: "item" }, is_offline: false }] } };
    });
    await expect(
      refreshQueuedAvailability({ remote_id: "one" }, cancelled.signal)
    ).rejects.toThrow();
    expect(appState()).toBe(current);
  });
});
