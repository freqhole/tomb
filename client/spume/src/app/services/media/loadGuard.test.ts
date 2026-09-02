import { beforeEach, describe, expect, it } from "vitest";
import { beginMediaLoad, cancelMediaLoads, isMediaLoadCurrent } from "./loadGuard";

describe("media load guard", () => {
  beforeEach(() => {
    // unique keys per test keep the module-level generation map isolated.
  });

  it("keeps the current load valid", () => {
    const generation = beginMediaLoad("current");
    expect(isMediaLoadCurrent("current", generation)).toBe(true);
  });

  it("invalidates a load when its item leaves the queue", () => {
    const generation = beginMediaLoad("departed");
    cancelMediaLoads(["departed"]);
    expect(isMediaLoadCurrent("departed", generation)).toBe(false);
  });

  it("does not cancel a different item still in the queue", () => {
    const a = beginMediaLoad("departed-a");
    const b = beginMediaLoad("remaining-b");
    cancelMediaLoads(["departed-a"]);
    expect(isMediaLoadCurrent("departed-a", a)).toBe(false);
    expect(isMediaLoadCurrent("remaining-b", b)).toBe(true);
  });

  it("makes a newer attempt current after an earlier one was cancelled", () => {
    const first = beginMediaLoad("retry");
    cancelMediaLoads(["retry"]);
    const second = beginMediaLoad("retry");
    expect(isMediaLoadCurrent("retry", first)).toBe(false);
    expect(isMediaLoadCurrent("retry", second)).toBe(true);
  });
});
