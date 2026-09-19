// regression tests for the by_sha256 unique -> non-unique index migration
// (db/init.ts's v19->v20->v21 blocks) - guards against the exact bug
// reported live: a second locally-imported song with `sha256: ""` throwing
// a ConstraintError that localImport.ts's catch block mistakes for a real
// duplicate, making every import after the first silently fail.
//
// unlike every other db/*.test.ts, these deliberately do NOT start from a
// brand-new db (which always takes the "objectStoreNames doesn't contain
// STORE_SONGS yet" branch in init.ts and creates the non-unique index
// directly, never touching the migration code at all). instead they hand-rol
// an OLD schema shape via the raw `idb` API first, then let `initMusicDB()`
// run the real upgrade path against it - the only way to actually exercise
// the migration logic itself.

import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeMusicDB, initMusicDB } from "./init";
import { createSong, getSongByBlake3, getSongBySha256 } from "./songs";
import { MUSIC_DB_NAME, STORE_SONGS, type NewSong } from "../types";

function newTestSong(overrides: Partial<NewSong> = {}): NewSong {
  return {
    sha256: "",
    title: "test song",
    artist_id: "artist-1",
    album_id: "album-1",
    track_number: 1,
    disc_number: 1,
    duration_seconds: 180,
    year: null,
    bpm: null,
    track_artist: null,
    lyrics: null,
    metadata: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    artist_name: "test artist",
    album_title: "test album",
    album_added_at: Date.now(),
    album_primary_genre_id: null,
    source_type: "local",
    opfs_path: "song.mp3",
    file_name: "song.mp3",
    file_size: 1234,
    last_modified: Date.now(),
    mime_type: "audio/mpeg",
    source_url: null,
    downloaded_at: null,
    remote_server_id: null,
    remote_song_id: null,
    blake3: "b".repeat(64),
    added_at: Date.now(),
    ...overrides,
  };
}

/** seed a database at `version` with just enough of the old schema to
 * exercise the migration: a `songs` store keyed by `id` with a UNIQUE
 * `by_sha256` index - the exact shape every real device had before v20. */
async function seedPreMigrationDb(version: number): Promise<void> {
  const db = await openDB(MUSIC_DB_NAME, version, {
    upgrade(db) {
      const songsStore = db.createObjectStore(STORE_SONGS, { keyPath: "id" });
      songsStore.createIndex("by_sha256", "sha256", { unique: true });
      songsStore.createIndex("by_blake3", "blake3");
      // createSong()'s post-insert syncAlbumFields() looks songs up by
      // this index - needed for createSong() to work at all against this
      // hand-seeded schema.
      songsStore.createIndex("by_album_id", "album_id");
    },
  });
  db.close();
}

describe("by_sha256 index migration (unique -> non-unique)", () => {
  beforeEach(() => {
    closeMusicDB();
    indexedDB = new IDBFactory();
  });

  afterEach(() => {
    closeMusicDB();
  });

  it('a device coming from a real pre-v20 schema can save two locally-imported songs with sha256: ""', async () => {
    await seedPreMigrationDb(19);
    await initMusicDB();

    await createSong(newTestSong({ blake3: "a".repeat(64) }));
    // this is the exact call that used to throw ConstraintError and get
    // mistaken for a duplicate by localImport.ts's catch block.
    await expect(createSong(newTestSong({ blake3: "c".repeat(64) }))).resolves.toBeDefined();
  });

  it("self-heals a tab already stuck on v20 with the unique index still in place", async () => {
    // simulates a dev/user tab that already advanced to v20 (e.g. mid-
    // development, before the fix in this migration existed) - without the
    // v20->v21 widening, this tab would never re-run the upgrade since
    // IndexedDB only fires it when the requested version is greater than
    // what's already stored.
    await seedPreMigrationDb(20);
    await initMusicDB();

    await createSong(newTestSong({ blake3: "a".repeat(64) }));
    await expect(createSong(newTestSong({ blake3: "c".repeat(64) }))).resolves.toBeDefined();
  });

  it('getSongBySha256("") never returns an arbitrary row after the migration', async () => {
    await seedPreMigrationDb(19);
    await initMusicDB();

    await createSong(newTestSong({ blake3: "a".repeat(64) }));
    await createSong(newTestSong({ blake3: "c".repeat(64) }));

    await expect(getSongBySha256("")).resolves.toBeUndefined();
  });

  it('getSongByBlake3 still tells apart two songs that both have sha256 ""', async () => {
    await seedPreMigrationDb(19);
    await initMusicDB();

    const first = await createSong(newTestSong({ blake3: "a".repeat(64) }));
    const second = await createSong(newTestSong({ blake3: "c".repeat(64) }));

    await expect(getSongByBlake3("a".repeat(64))).resolves.toMatchObject({ id: first.id });
    await expect(getSongByBlake3("c".repeat(64))).resolves.toMatchObject({ id: second.id });
  });

  it("a brand-new (never-migrated) db also creates a non-unique by_sha256 index", async () => {
    // no seedPreMigrationDb call here - initMusicDB() takes the "create
    // fresh" branch (STORE_SONGS doesn't exist yet), which must ALSO build
    // the index non-unique, not just the migration path.
    await initMusicDB();

    await createSong(newTestSong({ blake3: "a".repeat(64) }));
    await expect(createSong(newTestSong({ blake3: "c".repeat(64) }))).resolves.toBeDefined();
    await expect(getSongBySha256("")).resolves.toBeUndefined();
  });
});
