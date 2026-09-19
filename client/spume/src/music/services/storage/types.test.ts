// regression tests for `songIdentityKey` - the canonical "which song is
// this, for queue/currently-playing purposes" key.
//
// the bug this guards against: a fresh local import leaves `Song.sha256`
// as `""` (see fileProcessor.ts's processMusicFile doc comment - part of
// the sha256->blake3 deprecation). every place that used to compare raw
// `song.sha256` (row-highlight "is this playing", queue position lookups,
// load-cancellation guards) silently treated EVERY such song as identical
// to whichever one happened to be playing, because they all share the
// same `""`. reported live as: importing several songs, then playing one,
// made every OTHER unhashed song's row light up with the "currently
// playing" pink border too.
//
// `songIdentityKey` deliberately does NOT prefer `blake3` the way
// audioAccess.ts's `songTrackingKey` does - see this file's own doc
// comment on `songIdentityKey` for why (must stay a stable LOCAL identity,
// distinct from content-hash identity - remotePlaybackControl.ts's queue-
// reconciliation logic relies on that separation).

import { describe, expect, it } from "vitest";
import { songIdentityKey, type Song } from "./types";

function song(overrides: Partial<Pick<Song, "sha256" | "id">>): Pick<Song, "sha256" | "id"> {
  return { sha256: "", id: "fallback-id", ...overrides };
}

describe("songIdentityKey", () => {
  it("prefers sha256 when present", () => {
    expect(songIdentityKey(song({ sha256: "abc123", id: "song-1" }))).toBe("abc123");
  });

  it("falls back to id when sha256 is empty", () => {
    expect(songIdentityKey(song({ sha256: "", id: "song-1" }))).toBe("song-1");
  });

  it('gives two freshly-imported songs (both sha256 "") DIFFERENT keys via their ids', () => {
    // this is the exact collision that caused the reported bug: raw
    // `song.sha256` comparisons treated these two as the same song.
    const a = songIdentityKey(song({ sha256: "", id: "song-a" }));
    const b = songIdentityKey(song({ sha256: "", id: "song-b" }));
    expect(a).not.toBe(b);
  });

  it("never returns an empty string as long as id is set", () => {
    expect(songIdentityKey(song({ sha256: "", id: "song-1" }))).not.toBe("");
  });
});
