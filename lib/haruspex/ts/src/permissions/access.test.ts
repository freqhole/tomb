import { describe, expect, it } from "vitest";

import { FREQHOLE_ROLE_HIERARCHY, type FreqholeRole } from "./role-table.js";
import {
  bindRoleHierarchy,
  canAccess,
  canAccessOwnerOr,
  hasAtLeastRole,
  isOwner,
} from "./access.js";

describe("hasAtLeastRole", () => {
  it("holds when the actual role is at least as privileged", () => {
    expect(hasAtLeastRole(FREQHOLE_ROLE_HIERARCHY, "admin", "member")).toBe(true);
    expect(hasAtLeastRole(FREQHOLE_ROLE_HIERARCHY, "root", "root")).toBe(true);
  });

  it("fails when the actual role is less privileged", () => {
    expect(hasAtLeastRole(FREQHOLE_ROLE_HIERARCHY, "viewer", "member")).toBe(false);
  });

  it("works against a caller-supplied role table with its own vocabulary", () => {
    const hierarchy = { owner: 0, editor: 10, reader: 20 };
    expect(hasAtLeastRole(hierarchy, "editor", "reader")).toBe(true);
    expect(hasAtLeastRole(hierarchy, "reader", "editor")).toBe(false);
  });
});

describe("isOwner", () => {
  it("is true only when the ids match and ownerId is set", () => {
    expect(isOwner("u1", "u1")).toBe(true);
    expect(isOwner("u1", "u2")).toBe(false);
    expect(isOwner("u1", null)).toBe(false);
  });
});

describe("canAccessOwnerOr", () => {
  it("passes for the owner regardless of role", () => {
    expect(
      canAccessOwnerOr(FREQHOLE_ROLE_HIERARCHY, "u1", "u1", "viewer", "admin"),
    ).toBe(true);
  });

  it("falls back to the role check for a non-owner", () => {
    expect(
      canAccessOwnerOr(FREQHOLE_ROLE_HIERARCHY, "u1", "u2", "admin", "admin"),
    ).toBe(true);
    expect(
      canAccessOwnerOr(FREQHOLE_ROLE_HIERARCHY, "u1", "u2", "viewer", "admin"),
    ).toBe(false);
  });
});

describe("canAccess", () => {
  const ctx = (userRole: FreqholeRole | null, userId: string | null, ownerId: string | null) => ({
    userRole,
    userId,
    ownerId,
  });

  it("public always passes", () => {
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, { type: "public" }, ctx(null, null, null))).toBe(
      true,
    );
  });

  it("authenticated requires a non-null role", () => {
    expect(
      canAccess(FREQHOLE_ROLE_HIERARCHY, { type: "authenticated" }, ctx("viewer", "u1", null)),
    ).toBe(true);
    expect(
      canAccess(FREQHOLE_ROLE_HIERARCHY, { type: "authenticated" }, ctx(null, null, null)),
    ).toBe(false);
  });

  it("role requires at least the given privilege", () => {
    const rule = { type: "role" as const, role: "admin" as const };
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, rule, ctx("root", "u1", null))).toBe(true);
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, rule, ctx("member", "u1", null))).toBe(false);
  });

  it("owner requires the caller to be the resource owner", () => {
    const rule = { type: "owner" as const };
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, rule, ctx("viewer", "u1", "u1"))).toBe(true);
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, rule, ctx("viewer", "u1", "u2"))).toBe(false);
  });

  it("owner_or passes for the owner or a sufficiently privileged role", () => {
    const rule = { type: "owner_or" as const, role: "admin" as const };
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, rule, ctx("viewer", "u1", "u1"))).toBe(true);
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, rule, ctx("admin", "u1", "u2"))).toBe(true);
    expect(canAccess(FREQHOLE_ROLE_HIERARCHY, rule, ctx("member", "u1", "u2"))).toBe(false);
  });
});

describe("bindRoleHierarchy", () => {
  it("bundles the same behavior without re-threading the hierarchy", () => {
    const checks = bindRoleHierarchy(FREQHOLE_ROLE_HIERARCHY);
    expect(checks.hasAtLeastRole("admin", "member")).toBe(true);
    expect(checks.isOwner("u1", "u1")).toBe(true);
    expect(checks.canAccessOwnerOr("u1", "u2", "admin", "admin")).toBe(true);
    expect(
      checks.canAccess({ type: "role", role: "member" }, { userRole: "admin", userId: "u1", ownerId: null }),
    ).toBe(true);
  });
});
