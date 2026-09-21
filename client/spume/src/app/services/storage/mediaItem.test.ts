// regression tests for `mediaItemKey`/`findMediaItemIndex` - the shared
// queue-identity helpers that `appState().current_sha256`, the "currently
// playing" row highlight, and queue-position lookups all funnel through.
//
// the bug this guards against: a fresh local import leaves `Song.sha256`
// as `""` (see fileProcessor.ts's processMusicFile doc comment). before
// `mediaItemKey` fell back to `song.id`, two different unhashed local
// songs in the same queue were indistinguishable - `findMediaItemIndex`
// (and every "is this the currently playing song" comparison built on top
// of it) would match whichever one came first, so importing several songs
// and playing one made every OTHER unhashed song's row light up as
// "currently playing" too.

import { describe, expect, it } from "vitest";
import {
  findMediaItemIndex,
  mediaItemKey,
  songToMediaItem,
  videoToMediaItem,
  type MediaItem,
  type QueuedVideo,
} from "./mediaItem";
import type { Song } from "../../../music/services/storage/types";

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-id",
    sha256: "",
    title: "untitled",
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
    created_at: 0,
    updated_at: 0,
    artist_name: "artist",
    album_title: "album",
    album_added_at: 0,
    album_primary_genre_id: null,
    source_type: "local",
    opfs_path: null,
    file_name: null,
    file_size: null,
    last_modified: null,
    mime_type: null,
    source_url: null,
    downloaded_at: null,
    remote_server_id: null,
    remote_song_id: null,
    blake3: null,
    added_at: 0,
    ...overrides,
  };
}

function video(overrides: Partial<QueuedVideo> = {}): QueuedVideo {
  return {
    id: "video-id",
    title: "untitled",
    source_type: "local",
    ...overrides,
  } as QueuedVideo;
}

describe("mediaItemKey", () => {
  it('gives two freshly-imported songs (both sha256 "") DIFFERENT keys via their ids', () => {
    const a = songToMediaItem(song({ id: "song-a", sha256: "" }));
    const b = songToMediaItem(song({ id: "song-b", sha256: "" }));
    expect(mediaItemKey(a)).not.toBe(mediaItemKey(b));
  });

  it("uses sha256 when present, id when absent", () => {
    const withHash = songToMediaItem(song({ id: "song-a", sha256: "hash-a" }));
    expect(mediaItemKey(withHash)).toBe("hash-a");

    const withoutHash = songToMediaItem(song({ id: "song-b", sha256: "" }));
    expect(mediaItemKey(withoutHash)).toBe("song-b");
  });

  it("uses the video's own id, unaffected by the song sha256 fallback", () => {
    expect(mediaItemKey(videoToMediaItem(video({ id: "video-1" })))).toBe("video-1");
  });
});

describe("findMediaItemIndex (queue position lookup)", () => {
  it("finds the correct index for the currently-playing unhashed song, not just the first match", () => {
    const queue: MediaItem[] = [
      songToMediaItem(song({ id: "song-a", sha256: "" })),
      songToMediaItem(song({ id: "song-b", sha256: "" })),
      songToMediaItem(song({ id: "song-c", sha256: "" })),
    ];

    // "currently playing" is song-b - this is what appState().current_sha256
    // would hold (see htmlAudio.ts's setCurrentSong(songIdentityKey(song))).
    const currentKey = mediaItemKey(queue[1]);
    expect(findMediaItemIndex(queue, currentKey)).toBe(1);
  });

  it("returns -1 (not found) rather than a wrong match for a null/undefined key", () => {
    const queue: MediaItem[] = [songToMediaItem(song({ id: "song-a" }))];
    expect(findMediaItemIndex(queue, null)).toBe(-1);
    expect(findMediaItemIndex(queue, undefined)).toBe(-1);
  });
});
