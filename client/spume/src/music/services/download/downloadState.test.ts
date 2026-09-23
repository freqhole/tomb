// unit tests for downloadState.ts's loading-set/progress/reveal-debounce
// tracking - the shared module underlying ~10 hand-rolled call sites
// (rodioBackend.ts, autoDownload/manager.ts, blobCache.ts, audioAccess.ts,
// blobResolver.ts, syncVideoToLocal.ts, videoBackend.ts) that each
// independently do addToLoadingSet/updateLoadingProgress/
// removeFromLoadingSet.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as logger from "../../../utils/logger";
import {
  addToLoadingSet,
  getAllLoadingProgress,
  getLoadingIds,
  getLoadingProgress,
  getVisibleLoadingIds,
  isLoading,
  removeFromLoadingSet,
  resetLoadingState,
  updateLoadingProgress,
} from "./downloadState";

beforeEach(() => {
  resetLoadingState();
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
