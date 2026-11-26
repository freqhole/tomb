import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it } from "vitest";
import { closeMusicDB, initMusicDB } from "./db/init";
import { upsertLocalPlaylistWithItems } from "./playlists";
import { STORE_PLAYLIST_ITEMS, STORE_PLAYLISTS } from "./types";

beforeEach(() => {
  closeMusicDB();
  indexedDB = new IDBFactory();
});
afterEach(() => closeMusicDB());

it("re-syncs mixed playlist membership in source order using local ids", async () => {
  const db = await initMusicDB();
  const playlist = { playlist_id: "synced-list", title: "first" };
  await upsertLocalPlaylistWithItems(db, playlist, [
    { entity_type: "song", entity_id: "old-song" },
  ]);
  await upsertLocalPlaylistWithItems(db, { ...playlist, title: "updated" }, [
    { entity_type: "video", entity_id: "local-video" },
    { entity_type: "song", entity_id: "local-song" },
  ]);
  const items = await db.getAllFromIndex(STORE_PLAYLIST_ITEMS, "by_playlist_id", playlist.playlist_id);
  expect(items.sort((a, b) => a.position - b.position).map((item) => [item.entity_type, item.entity_id])).toEqual([
    ["video", "local-video"],
    ["song", "local-song"],
  ]);
  expect((await db.get(STORE_PLAYLISTS, playlist.playlist_id)).title).toBe("updated");
  await upsertLocalPlaylistWithItems(db, playlist, []);
  expect(await db.getAllFromIndex(STORE_PLAYLIST_ITEMS, "by_playlist_id", playlist.playlist_id)).toEqual([]);
});
