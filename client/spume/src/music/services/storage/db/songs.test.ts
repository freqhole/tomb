// regression test for syncAlbumFields: genre lives on the album row, not
// per-song (`Song` has no `genre_id` field). a prior version of this
// function tried to "vote" for the most common `song.genre_id` across an
// album's songs via an `as any` cast - that field never existed, so the
// vote always degenerated to a single `null` bucket and every song's
// `album_primary_genre_id` was silently stuck at `null` regardless of the
// album's real genre.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeMusicDB } from "./init";
import { createAlbum } from "./albums";
import { createSong, findExistingSongByContentHash, getSongsByAlbumId } from "./songs";
import type { Album, NewSong } from "../types";

function newTestAlbum(id: string, genreId: string | null): Album {
  return {
    album_id: id,
    title: "test album",
    artist_id: null,
    album_type: "album",
    release_date: null,
    release_date_precision: null,
    label: null,
    genre_id: genreId,
    year: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

function newTestSong(albumId: string, addedAt: number): NewSong {
  return {
    sha256: "",
    title: "test song",
    artist_id: "artist-1",
    album_id: albumId,
    track_number: 1,
    disc_number: 1,
    duration_seconds: 180,
    year: null,
    bpm: null,
    track_artist: null,
    lyrics: null,
    metadata: null,
    created_at: addedAt,
    updated_at: addedAt,
    artist_name: "test artist",
    album_title: "test album",
    album_added_at: addedAt,
    album_primary_genre_id: null,
    source_type: "local",
    opfs_path: "song.mp3",
    file_name: "song.mp3",
    file_size: 1234,
    last_modified: addedAt,
    mime_type: "audio/mpeg",
    source_url: null,
    downloaded_at: null,
    remote_server_id: null,
    remote_song_id: null,
    blake3: null,
    added_at: addedAt,
  };
}

describe("syncAlbumFields (via createSong's post-insert hook)", () => {
  beforeEach(() => {
    closeMusicDB();
    indexedDB = new IDBFactory();
  });

  afterEach(() => {
    closeMusicDB();
  });

  it("stamps every song in the album with the album's own genre_id", async () => {
    const album = newTestAlbum("album-1", "genre-rock");
    await createAlbum(album);

    await createSong(newTestSong(album.album_id, 100));
    await createSong(newTestSong(album.album_id, 200));

    const songs = await getSongsByAlbumId(album.album_id);
    expect(songs).toHaveLength(2);
    for (const song of songs) {
      expect(song.album_primary_genre_id).toBe("genre-rock");
    }
  });

  it("re-syncs every song's genre when another song is added later", async () => {
    const album = newTestAlbum("album-2", null);
    await createAlbum(album);
    const first = await createSong(newTestSong(album.album_id, 100));
    expect(first.album_primary_genre_id).toBeNull();

    // album didn't have a genre yet at insert time, but gets one assigned
    // afterwards (e.g. user edits it) - the next song added should re-sync
    // every existing sibling's stored genre, not just stamp the new one.
    await createAlbum({ ...album, genre_id: "genre-jazz" });
    await createSong(newTestSong(album.album_id, 200));

    const songs = await getSongsByAlbumId(album.album_id);
    expect(songs).toHaveLength(2);
    for (const song of songs) {
      expect(song.album_primary_genre_id).toBe("genre-jazz");
    }
  });

  it("computes album_added_at as the earliest added_at across the album's songs", async () => {
    const album = newTestAlbum("album-3", null);
    await createAlbum(album);
    await createSong(newTestSong(album.album_id, 500));
    await createSong(newTestSong(album.album_id, 100));

    const songs = await getSongsByAlbumId(album.album_id);
    for (const song of songs) {
      expect(song.album_added_at).toBe(100);
    }
  });
});

// regression coverage for the blake3-preferring content-hash dedup lookup
// shared by syncSongToLocal.ts, destinationProbe.ts's local-presence
// probe, and media_blobz/service.ts's blob route - all three used to (or,
// for destinationProbe.ts, actually did) call `getSongBySha256` directly,
// which silently misses a local-only import (real blake3, sha256 "").
describe("findExistingSongByContentHash", () => {
  beforeEach(() => {
    closeMusicDB();
    indexedDB = new IDBFactory();
  });

  afterEach(() => {
    closeMusicDB();
  });

  it("finds a local-only import (real blake3, empty sha256) by blake3", async () => {
    const album = newTestAlbum("album-local", null);
    await createAlbum(album);
    const song = await createSong({
      ...newTestSong(album.album_id, 100),
      sha256: "",
      blake3: "blake3-hash-1",
    });

    const found = await findExistingSongByContentHash({
      blake3: "blake3-hash-1",
      sha256: "",
    });
    expect(found?.id).toBe(song.id);
  });

  it("falls back to sha256 for a legacy song with no blake3 stored", async () => {
    const album = newTestAlbum("album-legacy", null);
    await createAlbum(album);
    const song = await createSong({
      ...newTestSong(album.album_id, 100),
      sha256: "legacy-sha256-hash",
      blake3: null,
    });

    const found = await findExistingSongByContentHash({
      blake3: null,
      sha256: "legacy-sha256-hash",
    });
    expect(found?.id).toBe(song.id);
  });

  it("prefers blake3 over sha256 when both are provided and only one matches a row", async () => {
    const album = newTestAlbum("album-both", null);
    await createAlbum(album);
    const song = await createSong({
      ...newTestSong(album.album_id, 100),
      sha256: "",
      blake3: "blake3-hash-2",
    });

    // mirrors media_blobz/service.ts's `findExistingSongByContentHash({
    // blake3: id, sha256: id })` call, where the same wire id is tried
    // against both fields since the caller doesn't know which hash type
    // it is.
    const found = await findExistingSongByContentHash({
      blake3: "blake3-hash-2",
      sha256: "blake3-hash-2",
    });
    expect(found?.id).toBe(song.id);
  });

  it("returns undefined when neither hash matches any row", async () => {
    const found = await findExistingSongByContentHash({
      blake3: "no-such-hash",
      sha256: "no-such-hash",
    });
    expect(found).toBeUndefined();
  });
});
