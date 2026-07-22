import { afterEach, describe, expect, it } from "vitest";
import { loadMiddenBlake3, resetMiddenBlake3Cache } from "./midden-blake3.js";

afterEach(() => {
  resetMiddenBlake3Cache();
});

describe("loadMiddenBlake3", () => {
  it("resolves to null when no midden-shaped module is bundled", async () => {
    const midden = await loadMiddenBlake3();
    expect(midden).toBeNull();
  });

  it("caches the (null) resolution across calls until reset", async () => {
    const first = await loadMiddenBlake3();
    const second = await loadMiddenBlake3();
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("resetMiddenBlake3Cache() allows a fresh resolution attempt", async () => {
    await loadMiddenBlake3();
    resetMiddenBlake3Cache();
    // this just confirms the reset doesn't throw and a subsequent call
    // still resolves cleanly (still null - no midden module in this env).
    const after = await loadMiddenBlake3();
    expect(after).toBeNull();
  });
});
