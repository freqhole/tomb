import { describe, expect, it } from "vitest";
import { HARUSPEX_VERSION } from "./index.js";

describe("haruspex skeleton", () => {
  it("exports something so vitest + tsc have a real target", () => {
    expect(HARUSPEX_VERSION).toBe("0.1.0");
  });
});
