// regression test for the local-IDB backend's session -> send-target
// persistence, mirroring grimoire's equivalent test in
// grimoire/src/music/entities/import_review/repository.rs.
//
// unlike grimoire (which originally derived target info from the same
// query as the pending-albums list, and lost it once every blob was
// reviewed), this backend already stores the send target directly on the
// session record (`getLocalImportSession`), independent of
// `listLocalPendingSessions`'s pending-blob derivation - this test exists
// to guard that separation, not to fix a bug found here.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeMusicDB } from "./init";
import { createAlbum } from "./albums";
import { createSong } from "./songs";
import type { Album, NewSong } from "../types";
import {
  createLocalImportSession,
  getLocalImportSession,
  listLocalPendingSessions,
  markLocalAlbumReviewed,
  recordLocalImportBlob,
} from "./importReview";

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

describe("local-idb import review: session send-target survives review completion", () => {
  beforeEach(async () => {
    // fresh indexedDB + fresh module-level db handle per test.
    closeMusicDB();
    indexedDB = new IDBFactory();
  });

  afterEach(() => {
    closeMusicDB();
  });

  it("getLocalImportSession still returns the target after the session's only album is reviewed", async () => {
    const album = newTestAlbum("album-1");
    await createAlbum(album);
    const song = await createSong(newTestSong(album.album_id));

    const sessionId = await createLocalImportSession({
      remoteId: "remote-1",
      remoteName: "my remote",
    });
    await recordLocalImportBlob(sessionId, song.id);

    // sanity check: pending before review.
    const pendingBefore = await listLocalPendingSessions();
    expect(pendingBefore.map((s) => s.session_id)).toContain(sessionId);

    await markLocalAlbumReviewed(sessionId, album.album_id);

    const pendingAfter = await listLocalPendingSessions();
    expect(pendingAfter.map((s) => s.session_id)).not.toContain(sessionId);

    // the actual regression guard: target info survives independent of
    // the pending-sessions derivation.
    const session = await getLocalImportSession(sessionId);
    expect(session?.target_remote_id).toBe("remote-1");
    expect(session?.target_remote_name).toBe("my remote");
  });

  it("a session created with no target reports both fields as null", async () => {
    const sessionId = await createLocalImportSession();
    const session = await getLocalImportSession(sessionId);
    expect(session?.target_remote_id).toBeNull();
    expect(session?.target_remote_name).toBeNull();
  });
});
