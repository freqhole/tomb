import { describe, expect, it } from "vitest";
import { decidePlayAction } from "./decidePlayAction";

describe("decidePlayAction", () => {
  it('loads fresh when nothing has ever been loaded (the real bug: null, not "stopped")', () => {
    // this is the exact case a prior fix got wrong - it checked for
    // `"stopped"`, but a never-loaded backend's snapshot state is `null`
    // (see backend.ts's `emptySnapshot`), so that check silently never
    // matched and the cenotaph player's current song never started.
    expect(decidePlayAction(null)).toBe("load");
    expect(decidePlayAction(undefined)).toBe("load");
  });

  it('loads fresh for "stopped" and "loading" too - only "paused" resumes in place', () => {
    expect(decidePlayAction("stopped")).toBe("load");
    expect(decidePlayAction("loading")).toBe("load");
  });

  it("resumes in place when paused", () => {
    expect(decidePlayAction("paused")).toBe("resume");
  });

  it("is a no-op when already playing (a redundant resume must not interrupt playback)", () => {
    expect(decidePlayAction("playing")).toBe("noop");
  });
});
