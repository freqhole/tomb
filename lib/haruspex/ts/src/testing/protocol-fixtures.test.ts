import { describe, expect, it } from "vitest";

import { loadProtocolFixture, loadProtocolFixtures } from "./protocol-fixtures.js";

describe("loadProtocolFixtures", () => {
  it("loads all fixtures as a keyed record", () => {
    const fixtures = loadProtocolFixtures();
    expect(Object.keys(fixtures).length).toBeGreaterThan(0);
    expect(fixtures["hello"]).toBeDefined();
  });
});

describe("loadProtocolFixture", () => {
  it("loads a single fixture by name", () => {
    const fixture = loadProtocolFixture("hello");
    expect(fixture).toBeDefined();
    expect(typeof fixture).toBe("object");
  });

  it("throws when the fixture does not exist", () => {
    expect(() => loadProtocolFixture("nonexistent")).toThrow();
  });
});
