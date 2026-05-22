// quadtree-backed hit testing for graph nodes.
// rebuilt on every tick of the d3-force simulation.
import { quadtree, type Quadtree } from "d3-quadtree";
import type { GraphNode } from "./types";

export interface HitTester {
  /** find the topmost node at world-space (x, y) within `radius` pixels. */
  find(x: number, y: number, radius?: number): GraphNode | undefined;
  /** find all nodes whose centers are inside the given world-space rect. */
  findInRect(x0: number, y0: number, x1: number, y1: number): GraphNode[];
}

export function buildHitTester(
  nodes: GraphNode[],
  defaultRadius: number
): HitTester {
  const tree: Quadtree<GraphNode> = quadtree<GraphNode>()
    .x((d) => d.x ?? 0)
    .y((d) => d.y ?? 0)
    .addAll(nodes);

  return {
    find(x, y, radius = defaultRadius) {
      return tree.find(x, y, radius) ?? undefined;
    },
    findInRect(x0, y0, x1, y1) {
      const lo = Math.min;
      const hi = Math.max;
      const minX = lo(x0, x1);
      const maxX = hi(x0, x1);
      const minY = lo(y0, y1);
      const maxY = hi(y0, y1);
      const out: GraphNode[] = [];
      tree.visit((node, nx0, ny0, nx1, ny1) => {
        if (!node.length) {
          // leaf
          let n: { data: GraphNode; next?: { data: GraphNode; next?: unknown } } | undefined =
            node as unknown as { data: GraphNode; next?: { data: GraphNode; next?: unknown } };
          do {
            const d = n.data;
            const px = d.x ?? 0;
            const py = d.y ?? 0;
            if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
              out.push(d);
            }
            n = n.next as typeof n;
          } while (n);
        }
        // skip subtree if its bounds are entirely outside our rect
        return nx0 > maxX || nx1 < minX || ny0 > maxY || ny1 < minY;
      });
      return out;
    },
  };
}
