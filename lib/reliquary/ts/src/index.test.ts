import { describe, expect, it } from "vitest";
import { RELIQUARY_VERSION } from "./index.js";

describe("reliquary package", () => {
  it("exports version", () => {
    expect(RELIQUARY_VERSION).toBe("0.1.0");
  });
});
