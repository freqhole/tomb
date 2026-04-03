import { describe, expect, it } from "vitest";
import { counterSchema } from "./counter";

describe("counterSchema", () => {
  it("parses empty object with defaults", () => {
    const result = counterSchema.parse({});
    expect(result).toEqual({ count: 0, step: 1, label: "counter" });
  });

  it("accepts valid overrides", () => {
    const result = counterSchema.parse({ count: 42, step: 5, label: "my counter" });
    expect(result).toEqual({ count: 42, step: 5, label: "my counter" });
  });

  it("fills in missing fields with defaults", () => {
    const result = counterSchema.parse({ count: 10 });
    expect(result.count).toBe(10);
    expect(result.step).toBe(1);
    expect(result.label).toBe("counter");
  });

  it("rejects non-numeric count", () => {
    expect(() => counterSchema.parse({ count: "not a number" })).toThrow();
  });

  it("rejects non-numeric step", () => {
    expect(() => counterSchema.parse({ step: true })).toThrow();
  });

  it("rejects non-string label", () => {
    expect(() => counterSchema.parse({ label: 123 })).toThrow();
  });
});
