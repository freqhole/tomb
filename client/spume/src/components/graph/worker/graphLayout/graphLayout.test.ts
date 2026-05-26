import { describe, expect, it } from "vitest";
import { graphLayout, HOP_HORIZON_DEFAULT, stubIdFor } from "./graphLayout";
import type { LayoutEdge, LayoutNode } from "./types";

const viewport = { width: 1200, height: 800 };

function makeNode(id: string, kind: LayoutNode["kind"] = "artist", albumCount?: number): LayoutNode {
  return { id, kind, albumCount };
}

describe("graphLayout", () => {
  it("returns empty result when pivot is missing", () => {
    const nodes: LayoutNode[] = [makeNode("a"), makeNode("b")];
    const edges: LayoutEdge[] = [{ source: "a", target: "b" }];
    const r = graphLayout(nodes, edges, { pivotId: "ghost", viewport });
    expect(r.positions.size).toBe(0);
    expect(r.visibleIds).toEqual([]);
    expect(r.stubs).toEqual([]);
  });

  it("places the pivot at the viewport center", () => {
    const nodes: LayoutNode[] = [makeNode("p")];
    const r = graphLayout(nodes, [], { pivotId: "p", viewport });
    const p = r.positions.get("p")!;
    expect(p.x).toBeCloseTo(600, 6);
    expect(p.y).toBeCloseTo(400, 6);
    expect(p.tier).toBe(0);
    expect(p.wedge.halfWidth).toBeCloseTo(Math.PI, 6);
  });

  it("rings tier-1 kids around the pivot at the tier-1 radius", () => {
    const nodes: LayoutNode[] = [
      makeNode("p"),
      makeNode("a"),
      makeNode("b"),
      makeNode("c"),
      makeNode("d"),
    ];
    const edges: LayoutEdge[] = [
      { source: "p", target: "a" },
      { source: "p", target: "b" },
      { source: "p", target: "c" },
      { source: "p", target: "d" },
    ];
    const r = graphLayout(nodes, edges, { pivotId: "p", viewport });
    const center = { x: 600, y: 400 };
    const expectedRadius = Math.min(viewport.width, viewport.height) * 0.22;
    for (const id of ["a", "b", "c", "d"]) {
      const layout = r.positions.get(id)!;
      const d = Math.hypot(layout.x - center.x, layout.y - center.y);
      expect(d).toBeCloseTo(expectedRadius, 5);
      expect(layout.tier).toBe(1);
    }
    expect(r.visibleIds).toContain("p");
    expect(r.visibleIds.length).toBe(5);
  });

  it("blooms tier-2 kids OUTWARD from their tier-1 parent (away from pivot)", () => {
    const nodes: LayoutNode[] = [
      makeNode("p"),
      makeNode("t1"),
      makeNode("g1"),
      makeNode("g2"),
    ];
    const edges: LayoutEdge[] = [
      { source: "p", target: "t1" },
      { source: "t1", target: "g1" },
      { source: "t1", target: "g2" },
    ];
    const r = graphLayout(nodes, edges, { pivotId: "p", viewport });
    const pivot = r.positions.get("p")!;
    const t1 = r.positions.get("t1")!;
    const g1 = r.positions.get("g1")!;
    const g2 = r.positions.get("g2")!;

    // outward direction = unit(t1 - pivot).
    const outX = t1.x - pivot.x;
    const outY = t1.y - pivot.y;
    const outLen = Math.hypot(outX, outY);

    // each grandkid relative to t1 should have positive dot product
    // with the outward vector (i.e. they're on the OUTSIDE of t1,
    // not curving back toward the pivot).
    for (const g of [g1, g2]) {
      const dx = g.x - t1.x;
      const dy = g.y - t1.y;
      const dot = (dx * outX + dy * outY) / Math.max(outLen, 1e-9);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("respects the hop horizon, dropping tier-3 nodes from the output", () => {
    const nodes: LayoutNode[] = [
      makeNode("p"),
      makeNode("t1"),
      makeNode("t2"),
      makeNode("t3"),
    ];
    const edges: LayoutEdge[] = [
      { source: "p", target: "t1" },
      { source: "t1", target: "t2" },
      { source: "t2", target: "t3" },
    ];
    const r = graphLayout(nodes, edges, { pivotId: "p", viewport, hopHorizon: 2 });
    expect(r.positions.has("t1")).toBe(true);
    expect(r.positions.has("t2")).toBe(true);
    expect(r.positions.has("t3")).toBe(false);
  });

  it("injects a 'more' stub when a hub has more kids than fit", () => {
    // pivot with one hub child; the hub has 50 leaf children.
    const nodes: LayoutNode[] = [makeNode("p"), makeNode("hub", "hub", 50)];
    const edges: LayoutEdge[] = [{ source: "p", target: "hub" }];
    for (let i = 0; i < 50; i++) {
      nodes.push(makeNode(`leaf${i}`, "album"));
      edges.push({ source: "hub", target: `leaf${i}` });
    }
    const r = graphLayout(nodes, edges, { pivotId: "p", viewport });
    expect(r.stubs.length).toBe(1);
    expect(r.stubs[0].parentId).toBe("hub");
    expect(r.stubs[0].id).toBe(stubIdFor("hub"));
    expect(r.stubs[0].hiddenIds.length).toBeGreaterThan(0);
    expect(r.positions.has(stubIdFor("hub"))).toBe(true);
    // visibleIds includes the synthetic stub.
    expect(r.visibleIds).toContain(stubIdFor("hub"));
  });

  it("does not add a stub when all kids fit", () => {
    const nodes: LayoutNode[] = [makeNode("p"), makeNode("hub", "hub", 2)];
    const edges: LayoutEdge[] = [{ source: "p", target: "hub" }];
    for (let i = 0; i < 2; i++) {
      nodes.push(makeNode(`leaf${i}`, "album"));
      edges.push({ source: "hub", target: `leaf${i}` });
    }
    const r = graphLayout(nodes, edges, { pivotId: "p", viewport });
    expect(r.stubs).toEqual([]);
  });

  it("is deterministic: same input → same output", () => {
    const nodes: LayoutNode[] = [
      makeNode("p"),
      makeNode("a"),
      makeNode("b"),
      makeNode("c"),
    ];
    const edges: LayoutEdge[] = [
      { source: "p", target: "a" },
      { source: "p", target: "b" },
      { source: "p", target: "c" },
    ];
    const r1 = graphLayout(nodes, edges, { pivotId: "p", viewport });
    const r2 = graphLayout(nodes, edges, { pivotId: "p", viewport });
    for (const id of r1.positions.keys()) {
      const p1 = r1.positions.get(id)!;
      const p2 = r2.positions.get(id)!;
      expect(p1.x).toBe(p2.x);
      expect(p1.y).toBe(p2.y);
    }
  });

  it("defaults the hop horizon when unspecified", () => {
    expect(HOP_HORIZON_DEFAULT).toBe(32);
  });

  it("handles a pivot with no neighbours gracefully", () => {
    const nodes: LayoutNode[] = [makeNode("p"), makeNode("orphan")];
    const r = graphLayout(nodes, [], { pivotId: "p", viewport });
    expect(r.visibleIds).toEqual(["p"]);
    expect(r.positions.size).toBe(1);
  });
});
