import { describe, expect, it } from "vitest";
import { RELIQUARY_VERSION } from "./index.js";

describe("phase 0 skeleton", () => {
  it("exports something so vitest + tsc have a real target", () => {
    expect(RELIQUARY_VERSION).toBe("0.1.0");
  });
});
