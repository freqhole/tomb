import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fixture, fixtureList } from "./fixtures";

const simpleSchema = z.object({
  name: z.string().default("default-name"),
  count: z.number().default(0),
  active: z.boolean().default(true),
});

const nestedSchema = z.object({
  title: z.string().default("untitled"),
  dimensions: z
    .object({
      width: z.number().default(100),
      height: z.number().default(50),
    })
    .default({}),
});

const optionalSchema = z.object({
  required: z.string().default("present"),
  optional: z.string().optional(),
  nullable: z.string().nullable().default(null),
});

describe("fixture", () => {
  it("produces valid data from a simple schema", () => {
    const data = fixture(simpleSchema);
    expect(data).toEqual({ name: "default-name", count: 0, active: true });
  });

  it("applies typed overrides", () => {
    const data = fixture(simpleSchema, { name: "custom", count: 42 });
    expect(data.name).toBe("custom");
    expect(data.count).toBe(42);
    expect(data.active).toBe(true); // default preserved
  });

  it("result passes schema validation", () => {
    const data = fixture(simpleSchema, { count: 99 });
    expect(() => simpleSchema.parse(data)).not.toThrow();
  });

  it("handles optional and nullable fields", () => {
    const data = fixture(optionalSchema);
    expect(data.required).toBe("present");
    expect(data.nullable).toBeNull();
    // optional can be undefined
  });

  it("handles nested objects", () => {
    const data = fixture(nestedSchema);
    expect(data.title).toBe("untitled");
    // zod's .default({}) returns {} as-is without re-parsing inner defaults,
    // so the nested fields don't get their defaults filled in
    expect(data.dimensions).toEqual({});
  });
});

describe("fixtureList", () => {
  it("creates N instances", () => {
    const list = fixtureList(simpleSchema, 3);
    expect(list).toHaveLength(3);
    list.forEach((item) => {
      expect(() => simpleSchema.parse(item)).not.toThrow();
    });
  });

  it("applies per-index overrides", () => {
    const list = fixtureList(simpleSchema, 3, (i) => ({ count: i * 10 }));
    expect(list[0].count).toBe(0);
    expect(list[1].count).toBe(10);
    expect(list[2].count).toBe(20);
  });

  it("creates zero instances", () => {
    const list = fixtureList(simpleSchema, 0);
    expect(list).toEqual([]);
  });
});
