import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dispatchImportSession,
  importSessionState,
  LOCAL_TARGET_KEY,
  resetImportSessionRegistryForTests,
} from "./useImportSessionFlow";

describe("useImportSessionFlow registry", () => {
  beforeEach(() => {
    resetImportSessionRegistryForTests();
  });

  it("an untouched target key reports idle", () => {
    createRoot((dispose) => {
      expect(importSessionState("remote-1")).toEqual({ kind: "idle" });
      dispose();
    });
  });

  it("dispatching for one target never affects a different target's state (switcher regression)", () => {
    createRoot((dispose) => {
      dispatchImportSession("remote-1", { type: "opened", sessionId: "s1" });
      dispatchImportSession("remote-1", { type: "albumsSeen", albumIds: ["a1"] });

      expect(importSessionState("remote-1")).toEqual({
        kind: "reviewing",
        sessionId: "s1",
        albumIds: ["a1"],
      });
      // a different target (including the local sentinel) is untouched.
      expect(importSessionState("remote-2")).toEqual({ kind: "idle" });
      expect(importSessionState(LOCAL_TARGET_KEY)).toEqual({ kind: "idle" });
      dispose();
    });
  });

  it("regression (finding A via the registry): opening a new session for a target that already finished sending shows no stale progress", () => {
    createRoot((dispose) => {
      dispatchImportSession("remote-1", { type: "opened", sessionId: "old-session" });
      dispatchImportSession("remote-1", { type: "albumsSeen", albumIds: ["a1"] });
      dispatchImportSession("remote-1", {
        type: "albumsDrained",
        target: { id: "remote-1", name: "my remote" },
      });
      dispatchImportSession("remote-1", { type: "sendFinished" });
      expect(importSessionState("remote-1").kind).toBe("done");

      // user opens a fresh session against the SAME target before dismissing
      // the previous result.
      dispatchImportSession("remote-1", { type: "opened", sessionId: "new-session" });

      expect(importSessionState("remote-1")).toEqual({
        kind: "reviewing",
        sessionId: "new-session",
        albumIds: [],
      });
      dispose();
    });
  });

  it("closed resets a target back to idle without touching others", () => {
    createRoot((dispose) => {
      dispatchImportSession("remote-1", { type: "opened", sessionId: "s1" });
      dispatchImportSession("remote-2", { type: "opened", sessionId: "s2" });

      dispatchImportSession("remote-1", { type: "closed" });

      expect(importSessionState("remote-1")).toEqual({ kind: "idle" });
      expect(importSessionState("remote-2")).toEqual({
        kind: "reviewing",
        sessionId: "s2",
        albumIds: [],
      });
      dispose();
    });
  });
});
