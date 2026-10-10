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
// `songIdentityKey` deliberately does NOT prefer `blake3` - see this
// file's own doc comment on `songIdentityKey` for why (must stay a
// stable LOCAL identity, distinct from content-hash identity -
// remotePlaybackControl.ts's queue-reconciliation logic relies on that
// separation).

import { describe, expect, it, vi } from "vitest";

const isCharnelModeMock = vi.fn(() => false);
vi.mock("../../../app/services/charnel/mode", () => ({
  isCharnelMode: () => isCharnelModeMock(),
}));

import { songIdentityKey, syncTrackingKey, type Song } from "./types";

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

// regression tests for `syncTrackingKey` - the sync/download-tracking
// subsystem's dedup key (downloadState.ts's synced-locally cache, its
// in-flight registry). the bug this guards against: a song with BOTH a
// real sha256 AND a real blake3 (common - most songs get backfilled with
// both) was marked synced under one key by one call site (e.g. the
// charnel-mode blake3-preferring branch) but checked under a DIFFERENT
// key by another (raw `song.sha256`) - the "already synced, play the
// local copy" check silently missed and fell through to
// re-streaming over the network instead, even though the file was
// already on disk.
describe("syncTrackingKey", () => {
  it("browser mode: prefers sha256 (the local IDB row's own primary key)", () => {
    isCharnelModeMock.mockReturnValue(false);
    expect(syncTrackingKey({ sha256: "sha-1", blake3: "blake3-1", id: "id-1" })).toBe("sha-1");
  });

  it("charnel mode: prefers blake3 (no local IDB row to correlate with)", () => {
    isCharnelModeMock.mockReturnValue(true);
    expect(syncTrackingKey({ sha256: "sha-1", blake3: "blake3-1", id: "id-1" })).toBe("blake3-1");
  });

  it("charnel mode: falls back to blake3 when sha256 is the empty-string sentinel", () => {
    // the deliberate "unknown sha256, verify by blake3 instead" sentinel
    // mediaRefResolve.ts sets when the source peer couldn't be queried -
    // not an error, must resolve to a real, non-colliding key.
    isCharnelModeMock.mockReturnValue(true);
    expect(syncTrackingKey({ sha256: "", blake3: "blake3-1" })).toBe("blake3-1");
  });

  it('browser mode: falls back to id when sha256 is empty (never silently collides on "")', () => {
    isCharnelModeMock.mockReturnValue(false);
    const a = syncTrackingKey({ sha256: "", blake3: "blake3-1", id: "song-a" });
    const b = syncTrackingKey({ sha256: "", blake3: "blake3-2", id: "song-b" });
    expect(a).not.toBe(b);
  });

  it("falls back to media_blob_id for a pre-sync SyncableSong shape (no id field at all)", () => {
    isCharnelModeMock.mockReturnValue(true);
    expect(syncTrackingKey({ sha256: "", blake3: null, media_blob_id: "blob-1" })).toBe("blob-1");
  });

  it("a given song's charnel-mode key and browser-mode key can genuinely differ - callers must pick one mode consistently, not mix them", () => {
    const song = { sha256: "sha-1", blake3: "blake3-1", id: "id-1" };
    isCharnelModeMock.mockReturnValue(true);
    const charnelKey = syncTrackingKey(song);
    isCharnelModeMock.mockReturnValue(false);
    const browserKey = syncTrackingKey(song);
    expect(charnelKey).not.toBe(browserKey);
  });
});
