// unit tests for downloadState.ts's loading-set/progress/reveal-debounce
// tracking - the shared module underlying ~10 hand-rolled call sites
// (libmpvBackend.ts, autoDownload/manager.ts, blobCache.ts, audioAccess.ts,
// blobResolver.ts, syncVideoToLocal.ts, videoBackend.ts) that each
// independently do addToLoadingSet/updateLoadingProgress/
// removeFromLoadingSet.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as logger from "../../../utils/logger";

const isCharnelModeMock = vi.fn(() => false);
vi.mock("../../../app/services/charnel/mode", () => ({
  isCharnelMode: () => isCharnelModeMock(),
}));

import {
  addToLoadingSet,
  clearSyncedTrackingKeys,
  getAllLoadingProgress,
  getLoadingIds,
  getLoadingProgress,
  getVisibleLoadingIds,
  isLoading,
  isSongSyncedLocally,
  markSongSynced,
  removeFromLoadingSet,
  resetLoadingState,
  unmarkSongSynced,
  updateLoadingProgress,
} from "./downloadState";
import { syncTrackingKey } from "../storage/types";

beforeEach(() => {
  resetLoadingState();
  clearSyncedTrackingKeys();
  isCharnelModeMock.mockReturnValue(false);
});

describe("addToLoadingSet / isLoading / removeFromLoadingSet", () => {
  it("tracks an id as loading until removed", () => {
    expect(isLoading("song-1")).toBe(false);
    addToLoadingSet("song-1");
    expect(isLoading("song-1")).toBe(true);
    expect(getLoadingIds().has("song-1")).toBe(true);
    removeFromLoadingSet("song-1");
    expect(isLoading("song-1")).toBe(false);
    expect(getLoadingIds().has("song-1")).toBe(false);
  });

  it("removeFromLoadingSet also clears any recorded progress", () => {
    addToLoadingSet("song-1");
    updateLoadingProgress("song-1", 0.5);
    expect(getLoadingProgress("song-1")).toBe(0.5);
    removeFromLoadingSet("song-1");
    expect(getLoadingProgress("song-1")).toBeUndefined();
  });

  it("adding the same id twice is a no-op (still tracked once)", () => {
    addToLoadingSet("song-1");
    addToLoadingSet("song-1");
    expect(getLoadingIds().size).toBe(1);
  });
});

describe("updateLoadingProgress", () => {
  it("records progress for a tracked id", () => {
    addToLoadingSet("song-1");
    updateLoadingProgress("song-1", 0.25);
    expect(getLoadingProgress("song-1")).toBe(0.25);
    expect(getAllLoadingProgress().get("song-1")).toBe(0.25);
  });

  it("logs a key-mismatch warning for an untracked id, per its own debug log", () => {
    const debugSpy = vi.spyOn(logger, "debug");
    updateLoadingProgress("never-added", 0.5);
    expect(debugSpy).toHaveBeenCalledWith("downloadState", expect.stringContaining("key mismatch"));
    debugSpy.mockRestore();
  });

  it("still records a progress value for an untracked id (map is separate from the set)", () => {
    updateLoadingProgress("never-added", 0.5);
    expect(getLoadingProgress("never-added")).toBe(0.5);
    expect(getLoadingIds().has("never-added")).toBe(false);
  });

  it("accepts null (indeterminate) progress", () => {
    addToLoadingSet("song-1");
    updateLoadingProgress("song-1", null);
    expect(getLoadingProgress("song-1")).toBeNull();
  });
});

describe("visible loading set (reveal debounce)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("does not reveal an id that finishes before the debounce elapses", () => {
    addToLoadingSet("song-1");
    expect(getVisibleLoadingIds().has("song-1")).toBe(false);
    removeFromLoadingSet("song-1");
    vi.advanceTimersByTime(2000);
    expect(getVisibleLoadingIds().has("song-1")).toBe(false);
  });

  it("reveals an id still loading after the debounce window", () => {
    addToLoadingSet("song-1");
    expect(getVisibleLoadingIds().has("song-1")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(getVisibleLoadingIds().has("song-1")).toBe(true);
  });

  it("a real (numeric) progress update reveals immediately, bypassing the debounce", () => {
    addToLoadingSet("song-1");
    expect(getVisibleLoadingIds().has("song-1")).toBe(false);
    updateLoadingProgress("song-1", 0.1);
    expect(getVisibleLoadingIds().has("song-1")).toBe(true);
  });

  it("removeFromLoadingSet clears the visible entry too", () => {
    addToLoadingSet("song-1");
    updateLoadingProgress("song-1", 0.1);
    expect(getVisibleLoadingIds().has("song-1")).toBe(true);
    removeFromLoadingSet("song-1");
    expect(getVisibleLoadingIds().has("song-1")).toBe(false);
  });

  it("null (indeterminate) progress does NOT bypass the debounce", () => {
    addToLoadingSet("song-1");
    updateLoadingProgress("song-1", null);
    expect(getVisibleLoadingIds().has("song-1")).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(getVisibleLoadingIds().has("song-1")).toBe(true);
  });
});

// regression tests for the synced-locally cache: the real, previously-
// shipped bug was a song marked synced under ONE key convention (e.g.
// audioAccess.ts's blake3-preferring key) being checked under a DIFFERENT
// one (raw song.sha256) elsewhere - "already synced, play the local copy"
// silently missed and fell through to re-streaming over the network for
// a file that was already on disk. fixed by routing every caller through
// `syncTrackingKey(song)` (which reads `isCharnelMode()` itself) - these
// tests assert the fixed round-trip, and demonstrate why `syncTrackingKey`
// has to be mode-aware in the first place (a bare blake3-preferring key
// does NOT round-trip against a browser-mode write, which is hard-keyed
// by sha256).
describe("isSongSyncedLocally / markSongSynced / unmarkSongSynced", () => {
  it("returns false for a song that was never marked synced", () => {
    const song = { sha256: "sha-1", blake3: "blake3-1", id: "id-1" };
    expect(isSongSyncedLocally(syncTrackingKey(song))).toBe(false);
  });

  it("charnel mode: a song with both sha256 and blake3 round-trips correctly through syncTrackingKey", () => {
    isCharnelModeMock.mockReturnValue(true);
    const song = { sha256: "sha-1", blake3: "blake3-1", id: "id-1" };
    markSongSynced(syncTrackingKey(song));
    expect(isSongSyncedLocally(syncTrackingKey(song))).toBe(true);
  });

  it("browser mode: a song with both sha256 and blake3 round-trips correctly through syncTrackingKey", () => {
    const song = { sha256: "sha-1", blake3: "blake3-1", id: "id-1" };
    markSongSynced(syncTrackingKey(song));
    expect(isSongSyncedLocally(syncTrackingKey(song))).toBe(true);
  });

  it("the historical bug: marking synced under a blake3-preferring key is invisible to a raw sha256 read", () => {
    const song = { sha256: "sha-1", blake3: "blake3-1", id: "id-1" };
    // this is what the OLD audioAccess.ts call site did (always
    // blake3-preferring, regardless of mode) - demonstrates why that was
    // wrong for a song whose eventual read uses raw sha256.
    markSongSynced(song.blake3);
    expect(isSongSyncedLocally(song.sha256)).toBe(false);
  });

  it("unmarkSongSynced reverses markSongSynced for the same key", () => {
    isCharnelModeMock.mockReturnValue(true);
    const song = { sha256: "sha-1", blake3: "blake3-1", id: "id-1" };
    const key = syncTrackingKey(song);
    markSongSynced(key);
    expect(isSongSyncedLocally(key)).toBe(true);
    unmarkSongSynced(key);
    expect(isSongSyncedLocally(key)).toBe(false);
  });

  it("isSongSyncedLocally is false for null/undefined/empty-string keys", () => {
    expect(isSongSyncedLocally(null)).toBe(false);
    expect(isSongSyncedLocally(undefined)).toBe(false);
    expect(isSongSyncedLocally("")).toBe(false);
  });
});
