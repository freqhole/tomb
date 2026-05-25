// hubDirectional.test
//
// locks in the per-role directional layout contract for the worker.
// these helpers compute the stable angular slot + outward-radius
// factor used by `forceX` / `forceY` to anchor hub nodes; regressing
// them would silently re-introduce the "all hubs collapse to centre"
// or "remote tree wanders off-screen" classes of bugs.
//
// the angles MUST match the main thread's seedGrouping.hubLaneOffset
// so the phyllotaxis seed and the steady-state pull agree on the
// first tick. that's covered by the seedGrouping tests too — these
// tests pin the worker side independently.

import { describe, expect, it } from "vitest";
import {
  fnv1aHash,
  hashAngleRad,
  hubDirectional,
  leafWedgeFraction,
  outwardAngleFor,
} from "./hubDirectional";
import { HUB_DIRECTIONAL } from "../forceTuning";

describe("fnv1aHash / hashAngleRad", () => {
  it("is deterministic", () => {
    expect(fnv1aHash("hello")).toBe(fnv1aHash("hello"));
    expect(hashAngleRad("hello")).toBe(hashAngleRad("hello"));
  });
  it("returns unsigned 32-bit ints", () => {
    for (const s of ["", "a", "remote::alpha", "value::tag"]) {
      const h = fnv1aHash(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
  it("hashAngleRad stays in [0, 2π)", () => {
    for (const s of ["a", "b", "remote::x", "value::tag"]) {
      const a = hashAngleRad(s);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
  });
});

describe("hubDirectional", () => {
  it("returns null for non-hub ids", () => {
    expect(hubDirectional("alb-1")).toBeNull();
    expect(hubDirectional("artist::a")).toBeNull();
    expect(hubDirectional("anything-else")).toBeNull();
  });
  it("remote hubs use HUB_DIRECTIONAL.remote tuning", () => {
    const r = hubDirectional("hub_remote::alpha");
    expect(r).not.toBeNull();
    expect(r!.radiusFactor).toBe(HUB_DIRECTIONAL.remote.radiusFactor);
    expect(r!.strength).toBe(HUB_DIRECTIONAL.remote.strength);
    expect(r!.angle).toBe(hashAngleRad("remote::alpha"));
  });
  it("relation hubs share the parent remote's angle", () => {
    const r = hubDirectional("hub_remote::alpha");
    const rel = hubDirectional("hub_relation::alpha::tag");
    expect(rel).not.toBeNull();
    expect(rel!.angle).toBe(r!.angle);
    expect(rel!.radiusFactor).toBe(HUB_DIRECTIONAL.relation.radiusFactor);
    expect(rel!.strength).toBe(HUB_DIRECTIONAL.relation.strength);
  });
  it("relation hubs handle remote ids without a kind suffix", () => {
    const rel = hubDirectional("hub_relation::alpha");
    expect(rel).not.toBeNull();
    expect(rel!.angle).toBe(hashAngleRad("remote::alpha"));
  });
  it("value hubs hash on the full id (siblings get different angles)", () => {
    const a = hubDirectional("hub_relation_value::tag::indie")!;
    const b = hubDirectional("hub_relation_value::tag::ambient")!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a.radiusFactor).toBe(HUB_DIRECTIONAL.relationValue.radiusFactor);
    expect(a.strength).toBe(HUB_DIRECTIONAL.relationValue.strength);
    // overwhelmingly likely to differ for distinct fnv-1a inputs.
    expect(a.angle).not.toBe(b.angle);
  });
});

describe("leafWedgeFraction", () => {
  it("is deterministic for the same id", () => {
    expect(leafWedgeFraction("album-123")).toBe(leafWedgeFraction("album-123"));
  });
  it("stays within (-1, +1]", () => {
    for (const id of ["a", "b", "long-leaf-id-9999", "x", "ñoño"]) {
      const v = leafWedgeFraction(id);
      expect(v).toBeGreaterThan(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("yields distinct fractions for distinct ids", () => {
    const a = leafWedgeFraction("leaf-a");
    const b = leafWedgeFraction("leaf-b");
    const c = leafWedgeFraction("leaf-c");
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });
});

describe("outwardAngleFor", () => {
  it("is deterministic", () => {
    expect(outwardAngleFor("x", 1.5, 0.7)).toBe(outwardAngleFor("x", 1.5, 0.7));
  });
  it("stays within ±wedgeHalfRad of the hub angle", () => {
    const hubAngle = 0.8;
    const wedge = Math.PI / 4;
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      const a = outwardAngleFor(id, hubAngle, wedge);
      expect(Math.abs(a - hubAngle)).toBeLessThanOrEqual(wedge + 1e-9);
    }
  });
  it("spreads siblings sharing a parent hub angle", () => {
    const hubAngle = 2.1;
    const wedge = Math.PI / 3;
    const a = outwardAngleFor("sib-1", hubAngle, wedge);
    const b = outwardAngleFor("sib-2", hubAngle, wedge);
    expect(a).not.toBe(b);
  });
  it("a zero wedge collapses to the hub angle", () => {
    expect(outwardAngleFor("anything", 1.2, 0)).toBe(1.2);
  });
});
