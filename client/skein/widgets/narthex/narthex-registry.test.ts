import { describe, expect, it } from "vitest";
import { createNarthexRegistry } from "./index";

describe("createNarthexRegistry", () => {
  it("registers canvas-card, canvas-wizard, profile, friends, and label", () => {
    const registry = createNarthexRegistry();
    expect(registry.has("canvas-card")).toBe(true);
    expect(registry.has("canvas-wizard")).toBe(true);
    expect(registry.has("profile")).toBe(true);
    expect(registry.has("friends")).toBe(true);
    expect(registry.has("label")).toBe(true);
  });

  it("has exactly 5 widget types", () => {
    const registry = createNarthexRegistry();
    expect(registry.types().length).toBe(5);
  });

  it("canvas-card is hidden", () => {
    const registry = createNarthexRegistry();
    expect(registry.get("canvas-card")!.metadata.hidden).toBe(true);
  });

  it("profile is a singleton", () => {
    const registry = createNarthexRegistry();
    expect(registry.get("profile")!.metadata.singleton).toBe(true);
    expect(registry.get("profile")!.metadata.singletonId).toBe("skein-profile");
  });

  it("friends is a singleton", () => {
    const registry = createNarthexRegistry();
    expect(registry.get("friends")!.metadata.singleton).toBe(true);
    expect(registry.get("friends")!.metadata.singletonId).toBe("skein-friends");
  });

  it("canvas-wizard is not hidden", () => {
    const registry = createNarthexRegistry();
    expect(registry.get("canvas-wizard")!.metadata.hidden).toBeFalsy();
  });

  it("label is not hidden", () => {
    const registry = createNarthexRegistry();
    expect(registry.get("label")!.metadata.hidden).toBeFalsy();
  });

  it("friends is not hidden", () => {
    const registry = createNarthexRegistry();
    expect(registry.get("friends")!.metadata.hidden).toBeFalsy();
  });

  it("non-hidden widgets for palette", () => {
    const registry = createNarthexRegistry();
    const visible = registry.all().filter((f) => !f.metadata.hidden);
    expect(visible.length).toBe(4);
    const types = visible.map((f) => f.type);
    expect(types).toContain("canvas-wizard");
    expect(types).toContain("friends");
    expect(types).toContain("profile");
    expect(types).toContain("label");
  });
});
