import { beforeEach, describe, expect, it } from "vitest";
import { WidgetRegistry } from "./widget-registry";
import type { WidgetFactory } from "./widget-types";

function stubFactory(type: string): WidgetFactory {
  return {
    type,
    metadata: { name: type, version: "0.1.0" },
    create: () => ({
      container: {} as any,
      destroy: () => {},
    }),
  };
}

describe("WidgetRegistry", () => {
  let registry: WidgetRegistry;

  beforeEach(() => {
    registry = new WidgetRegistry();
  });

  it("starts empty", () => {
    expect(registry.types()).toEqual([]);
    expect(registry.all()).toEqual([]);
  });

  it("register adds a factory", () => {
    const factory = stubFactory("test-widget");
    registry.register(factory);
    expect(registry.has("test-widget")).toBe(true);
    expect(registry.get("test-widget")).toBe(factory);
  });

  it("types returns registered type strings", () => {
    registry.register(stubFactory("alpha"));
    registry.register(stubFactory("beta"));
    expect(registry.types()).toEqual(["alpha", "beta"]);
  });

  it("all returns registered factories", () => {
    const a = stubFactory("alpha");
    const b = stubFactory("beta");
    registry.register(a);
    registry.register(b);
    expect(registry.all()).toEqual([a, b]);
  });

  it("get returns undefined for unknown type", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("has returns false for unknown type", () => {
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("throws on duplicate registration", () => {
    registry.register(stubFactory("dupe"));
    expect(() => registry.register(stubFactory("dupe"))).toThrow(
      'widget type "dupe" is already registered'
    );
  });
});
