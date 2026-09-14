import { describe, expect, it } from "vitest";
import {
  importSessionReducer,
  initialImportSessionState,
  type ImportSessionState,
} from "./importSessionReducer";
import type { SendReviewProgress } from "../../app/services/send/sendReviewProgress";

function progress(overrides: Partial<SendReviewProgress> = {}): SendReviewProgress {
  return {
    targetName: "my remote",
    totalAlbums: 2,
    completedAlbums: 1,
    failedAlbums: 0,
    currentAlbumTitle: "album 2",
    currentSongsDone: 3,
    currentSongsTotal: 5,
    done: false,
    errors: [],
    ...overrides,
  };
}

describe("importSessionReducer", () => {
  it("starts idle", () => {
    expect(initialImportSessionState).toEqual({ kind: "idle" });
  });

  it("opening a session from idle produces a fresh reviewing state", () => {
    const next = importSessionReducer(initialImportSessionState, {
      type: "opened",
      sessionId: "s1",
    });
    expect(next).toEqual({ kind: "reviewing", sessionId: "s1", albumIds: [] });
  });

  it("regression (finding A): opening a new session while the previous one is still 'sending' produces NO stale progress", () => {
    const stalePrevious: ImportSessionState = {
      kind: "sending",
      sessionId: "old-session",
      albumIds: ["a1", "a2"],
      progress: progress({ currentAlbumTitle: "stale album", completedAlbums: 1 }),
    };

    const next = importSessionReducer(stalePrevious, { type: "opened", sessionId: "new-session" });

    expect(next).toEqual({ kind: "reviewing", sessionId: "new-session", albumIds: [] });
    // no leftover progress/albumIds from the old session anywhere in the new state
    expect(next).not.toHaveProperty("progress");
    expect((next as { albumIds: string[] }).albumIds).toEqual([]);
  });

  it("regression (finding A): opening a new session while the previous one is 'done' also produces no stale carryover", () => {
    const stalePrevious: ImportSessionState = {
      kind: "done",
      sessionId: "old-session",
      progress: progress({ done: true }),
    };
    const next = importSessionReducer(stalePrevious, { type: "opened", sessionId: "new-session" });
    expect(next).toEqual({ kind: "reviewing", sessionId: "new-session", albumIds: [] });
  });

  it("accumulates albumsSeen while reviewing, deduping repeats", () => {
    let state = importSessionReducer(initialImportSessionState, {
      type: "opened",
      sessionId: "s1",
    });
    state = importSessionReducer(state, { type: "albumsSeen", albumIds: ["a1", "a2"] });
    state = importSessionReducer(state, { type: "albumsSeen", albumIds: ["a2", "a3"] });
    expect(state).toEqual({
      kind: "reviewing",
      sessionId: "s1",
      albumIds: ["a1", "a2", "a3"],
    });
  });

  it("albumsSeen is a no-op outside the reviewing state", () => {
    const state: ImportSessionState = { kind: "idle" };
    expect(importSessionReducer(state, { type: "albumsSeen", albumIds: ["a1"] })).toBe(state);
  });

  it("albumsDrained with a target and seen albums transitions to sending with fresh progress", () => {
    let state = importSessionReducer(initialImportSessionState, {
      type: "opened",
      sessionId: "s1",
    });
    state = importSessionReducer(state, { type: "albumsSeen", albumIds: ["a1", "a2"] });
    state = importSessionReducer(state, {
      type: "albumsDrained",
      target: { id: "remote-1", name: "my remote" },
    });
    expect(state).toEqual({
      kind: "sending",
      sessionId: "s1",
      albumIds: ["a1", "a2"],
      progress: {
        targetName: "my remote",
        totalAlbums: 2,
        completedAlbums: 0,
        failedAlbums: 0,
        currentAlbumTitle: null,
        currentSongsDone: 0,
        currentSongsTotal: 0,
        done: false,
        errors: [],
      },
    });
  });

  it("albumsDrained with a target but zero seen albums does NOT start a send", () => {
    const state = importSessionReducer(initialImportSessionState, {
      type: "opened",
      sessionId: "s1",
    });
    const next = importSessionReducer(state, {
      type: "albumsDrained",
      target: { id: "remote-1", name: "my remote" },
    });
    expect(next).toEqual({ kind: "done", sessionId: "s1", progress: null });
  });

  it("albumsDrained with no target goes straight to done with null progress", () => {
    let state = importSessionReducer(initialImportSessionState, {
      type: "opened",
      sessionId: "s1",
    });
    state = importSessionReducer(state, { type: "albumsSeen", albumIds: ["a1"] });
    state = importSessionReducer(state, { type: "albumsDrained", target: null });
    expect(state).toEqual({ kind: "done", sessionId: "s1", progress: null });
  });

  it("albumsDrained is a no-op outside the reviewing state", () => {
    const state: ImportSessionState = { kind: "idle" };
    expect(importSessionReducer(state, { type: "albumsDrained", target: null })).toBe(state);
  });

  it("sendProgress only applies while sending, and only updates the progress field", () => {
    const sending: ImportSessionState = {
      kind: "sending",
      sessionId: "s1",
      albumIds: ["a1"],
      progress: progress({ completedAlbums: 0 }),
    };
    const next = importSessionReducer(sending, {
      type: "sendProgress",
      progress: progress({ completedAlbums: 1, done: false }),
    });
    expect(next).toEqual({
      kind: "sending",
      sessionId: "s1",
      albumIds: ["a1"],
      progress: progress({ completedAlbums: 1, done: false }),
    });
  });

  it("sendProgress is a no-op outside the sending state (guards a late callback from a superseded send)", () => {
    const reviewing: ImportSessionState = { kind: "reviewing", sessionId: "s1", albumIds: [] };
    expect(importSessionReducer(reviewing, { type: "sendProgress", progress: progress() })).toBe(
      reviewing
    );

    const done: ImportSessionState = { kind: "done", sessionId: "s1", progress: null };
    expect(importSessionReducer(done, { type: "sendProgress", progress: progress() })).toBe(done);
  });

  it("sendFinished transitions sending -> done, carrying the final progress", () => {
    const finalProgress = progress({ done: true, completedAlbums: 2 });
    const sending: ImportSessionState = {
      kind: "sending",
      sessionId: "s1",
      albumIds: ["a1", "a2"],
      progress: finalProgress,
    };
    const next = importSessionReducer(sending, { type: "sendFinished" });
    expect(next).toEqual({ kind: "done", sessionId: "s1", progress: finalProgress });
  });

  it("sendFinished is a no-op outside the sending state", () => {
    const state: ImportSessionState = { kind: "idle" };
    expect(importSessionReducer(state, { type: "sendFinished" })).toBe(state);
  });

  it("closed always resets to idle regardless of prior state", () => {
    const sending: ImportSessionState = {
      kind: "sending",
      sessionId: "s1",
      albumIds: ["a1"],
      progress: progress(),
    };
    expect(importSessionReducer(sending, { type: "closed" })).toEqual({ kind: "idle" });

    const done: ImportSessionState = { kind: "done", sessionId: "s1", progress: null };
    expect(importSessionReducer(done, { type: "closed" })).toEqual({ kind: "idle" });
  });

  it("switcher regression: two independent target registries never interfere (simulated via two separate reducer chains)", () => {
    // this is what useImportSessionFlow's registry guarantees structurally by
    // keeping one ImportSessionState per target key - simulated here at the
    // pure-reducer level by just running two independent chains and
    // confirming neither one's events affect the other's state value.
    let remoteA = importSessionReducer(initialImportSessionState, {
      type: "opened",
      sessionId: "session-a",
    });
    let remoteB = importSessionReducer(initialImportSessionState, {
      type: "opened",
      sessionId: "session-b",
    });

    remoteA = importSessionReducer(remoteA, { type: "albumsSeen", albumIds: ["a1"] });
    remoteA = importSessionReducer(remoteA, {
      type: "albumsDrained",
      target: { id: "remote-a", name: "remote a" },
    });
    remoteA = importSessionReducer(remoteA, {
      type: "sendProgress",
      progress: progress({ completedAlbums: 1 }),
    });

    // remoteB was never touched by any of the above - must remain in its
    // original, untouched reviewing state.
    expect(remoteB).toEqual({ kind: "reviewing", sessionId: "session-b", albumIds: [] });
    expect(remoteA.kind).toBe("sending");
  });
});
