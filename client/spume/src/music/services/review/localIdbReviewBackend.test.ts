import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { closeMusicDB } from "../storage/db/init";
import { createAlbum } from "../storage/db/albums";
import { createSong } from "../storage/db/songs";
import { createLocalImportSession, recordLocalImportBlob } from "../storage/db/importReview";
import type { Album, NewSong } from "../storage/types";
import { createLocalIdbReviewBackend } from "./localIdbReviewBackend";

function newTestAlbum(id: string): Album {
  return {
    album_id: id,
    title: "test album",
    artist_id: null,
    album_type: "album",
    release_date: null,
    release_date_precision: null,
    label: null,
    genre_id: null,
    year: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

function newTestSong(albumId: string): NewSong {
  return {
    sha256: "a".repeat(64),
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
  };
}

describe("createLocalIdbReviewBackend", () => {
  beforeEach(() => {
    closeMusicDB();
    indexedDB = new IDBFactory();
  });

  it("reports kind 'local-idb' with a null remote", () => {
    const backend = createLocalIdbReviewBackend();
    expect(backend.kind).toBe("local-idb");
    expect(backend.remote).toBeNull();
  });

  it("listPendingSessions / getSessionTarget / markSessionReviewed round-trip", async () => {
    const backend = createLocalIdbReviewBackend();

    const album = newTestAlbum("album-1");
    await createAlbum(album);
    const song = await createSong(newTestSong(album.album_id));

    const sessionId = await createLocalImportSession({
      remoteId: "remote-1",
      remoteName: "my remote",
    });
    await recordLocalImportBlob(sessionId, song.id);

    const pending = await backend.listPendingSessions();
    expect(pending).toHaveLength(1);
    expect(pending[0].session_id).toBe(sessionId);
    expect(pending[0].target_remote_id).toBe("remote-1");

    const target = await backend.getSessionTarget(sessionId);
    expect(target).toEqual({ id: "remote-1", name: "my remote" });

    await backend.markSessionReviewed(pending[0]);

    const pendingAfter = await backend.listPendingSessions();
    expect(pendingAfter).toHaveLength(0);
    // target survives review completion - same guard as importReview.test.ts,
    // exercised here through the ReviewBackend interface instead of the raw
    // storage functions.
    expect(await backend.getSessionTarget(sessionId)).toEqual({
      id: "remote-1",
      name: "my remote",
    });
  });

  it("getSessionTarget returns null for a session with no target", async () => {
    const backend = createLocalIdbReviewBackend();
    const sessionId = await createLocalImportSession();
    expect(await backend.getSessionTarget(sessionId)).toBeNull();
  });
});
