// graph2/WalkCanvas.tsx — SolidJS canvas component.
// renders the walk graph: shapes per role, edge lines, labels, hover highlight.

import { createEffect, createSignal, onCleanup, onMount, createMemo } from "solid-js";
import type { WalkGraph } from "./types";
import { createWalkerClient } from "./worker/client";
import type { VisibleNode, TopologyEdge } from "./worker/messages";

export interface WalkCanvasProps {
  graph: WalkGraph;
  /** insets in px reserved by chrome (playerbar bottom, sidebar right, etc.).
   *  defaults to 0. in real freqhole pass { bottom: 72, right: 320 } when bars
   *  are visible. **/
  insets?: { bottom?: number; right?: number };
  /** which node to start focused on */
  initialPivot: string;
  /** optional pre-seeded breadcrumb for stories that start mid-walk */
  initialBreadcrumb?: string[];
  width?: number;
  height?: number;
}

// ---- colors ----------------------------------------------------------------

const ROLE_COLOR: Record<string, string> = {
  root: "#4b5563",
  remote: "#7c3aed",
  relation: "#0891b2",
  value: "#059669",
  artist: "#d97706",
  album: "#475569",
};

const EDGE_COLOR = "#6b7280"; // visible on black
const EDGE_ALBUM = "#94a3b8"; // lighter for artist→album wires
const EDGE_BREADCRUMB = "#f59e0b";
const PIVOT_RING_COLOR = "#ffffff";
const BREADCRUMB_COLOR = "#fcd34d";
const LABEL_COLOR = "#f1f5f9";
const LABEL_SHADOW = "#000000";
const HOVER_RING_COLOR = "rgba(255,255,255,0.5)";

// ---- shape drawing ---------------------------------------------------------

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation = 0
) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// wonky triangle: slightly irregular like the freqhole logo - one vertex taller
// kept for reference but replaced by freqholeMarkPath below

/** the real freqhole brand mark — 4-sided silhouette from assets/freqhole.svg.
 *  vertex fractions are taken directly from src/components/graph/draw/shared/shapes.ts.
 *  `r` is the half-extent of the bounding square (so the shape fits a 2r × 2r box). */
function freqholeMarkPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const size = r * 2;
  const x0 = cx - r;
  const y0 = cy - r;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5 * size, y0 + 0.95 * size); // bottom center
  ctx.lineTo(x0 + 0.14 * size, y0 + 0.18 * size); // top-left
  ctx.lineTo(x0 + 0.86 * size, y0 + 0.18 * size); // top-right
  ctx.lineTo(x0 + 0.66 * size, y0 + 0.74 * size); // inner-right notch
  ctx.closePath();
}

/** sets up the canvas path for a node's shape without filling or stroking.
 *  used for both the node fill and the hover/pivot ring (at r + gap). */
function nodeShapePath(
  ctx: CanvasRenderingContext2D,
  role: string,
  x: number,
  y: number,
  r: number
) {
  switch (role) {
    case "root":
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case "remote":
      freqholeMarkPath(ctx, x, y, r);
      break;
    case "relation":
      drawPolygon(ctx, x, y, r, 6, 0);
      break;
    case "value":
      drawPolygon(ctx, x, y, r, 8, Math.PI / 8);
      break;
    case "album": {
      const half = r * 0.88;
      ctx.beginPath();
      ctx.rect(x - half, y - half, half * 2, half * 2);
      break;
    }
    case "artist":
    default:
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
  }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  n: VisibleNode,
  x: number,
  y: number,
  radius: number
) {
  const color = n.isBreadcrumb ? (ROLE_COLOR[n.role] ?? "#888") : (ROLE_COLOR[n.role] ?? "#888");
  ctx.fillStyle = color;
  ctx.strokeStyle = n.isPivot
    ? PIVOT_RING_COLOR
    : n.isBreadcrumb
      ? BREADCRUMB_COLOR
      : "rgba(255,255,255,0.15)";
  ctx.lineWidth = n.isPivot ? 3 : n.isBreadcrumb ? 2 : 1;

  nodeShapePath(ctx, n.role, x, y, radius);
  ctx.fill();
  ctx.stroke();

  // count badge for hub nodes
  if ((n.role === "relation" || n.role === "value" || n.role === "remote") && n.childCount > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = `bold ${Math.max(9, Math.round(radius * 0.42))}px system-ui,sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n.childCount), x, y + radius * 0.18);
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  n: VisibleNode,
  x: number,
  y: number,
  radius: number
) {
  const fontSize = n.role === "album" ? 10 : 12;
  ctx.font = `${fontSize}px system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const label = n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label;
  const textY = y + radius + 4;

  // shadow
  ctx.fillStyle = LABEL_SHADOW;
  ctx.fillText(label, x + 1, textY + 1);

  ctx.fillStyle = n.isPivot ? "#ffffff" : n.isBreadcrumb ? BREADCRUMB_COLOR : LABEL_COLOR;
  ctx.fillText(label, x, textY);
}

// ---- component -------------------------------------------------------------

export default function WalkCanvas(props: WalkCanvasProps) {
  let canvas!: HTMLCanvasElement;

  // when no explicit dimensions given, fill the window minus any chrome insets.
  // update reactively on resize so the worker always gets the real viewport size.
  const [winW, setWinW] = createSignal(window.innerWidth);
  const [winH, setWinH] = createSignal(window.innerHeight);

  const w = createMemo(() => props.width ?? winW() - (props.insets?.right ?? 0));
  const h = createMemo(() => props.height ?? winH() - (props.insets?.bottom ?? 0));

  function onWindowResize() {
    setWinW(window.innerWidth);
    setWinH(window.innerHeight);
  }

  // latest topology snapshot
  let nodes: VisibleNode[] = [];
  let edges: TopologyEdge[] = [];
  // latest position buffer
  let positions: Float32Array = new Float32Array(0);

  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  let rafId = 0;

  const client = createWalkerClient();
  onCleanup(() => {
    cancelAnimationFrame(rafId);
    client.dispose();
    window.removeEventListener("resize", onWindowResize);
  });

  // register listeners
  client.onTopology((nds, eds) => {
    nodes = nds;
    edges = eds;
  });
  client.onFrame((pos) => {
    positions = pos;
  });

  onMount(() => {
    // storybook-solidjs-vite wraps story args in a createStore, making props
    // reactive Store proxies. Proxies can't be structured-cloned across worker
    // boundaries, so we serialize to plain JSON first.
    const plainGraph = JSON.parse(JSON.stringify(props.graph));
    const plainBreadcrumb = props.initialBreadcrumb
      ? JSON.parse(JSON.stringify(props.initialBreadcrumb))
      : undefined;
    window.addEventListener("resize", onWindowResize);
    client.init(plainGraph, props.initialPivot, w(), h(), plainBreadcrumb);

    const dpr = window.devicePixelRatio ?? 1;
    canvas.width = w() * dpr;
    canvas.height = h() * dpr;
    canvas.style.width = `${w()}px`;
    canvas.style.height = `${h()}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    function draw() {
      ctx.clearRect(0, 0, w(), h());

      // background — pure black
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w(), h());

      if (nodes.length === 0 || positions.length === 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const hov = hoveredId();

      // draw edges
      for (const e of edges) {
        const x0 = positions[e.sourceIdx * 2];
        const y0 = positions[e.sourceIdx * 2 + 1];
        const x1 = positions[e.targetIdx * 2];
        const y1 = positions[e.targetIdx * 2 + 1];
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        const isAlbumEdge =
          nodes[e.sourceIdx]?.role === "album" || nodes[e.targetIdx]?.role === "album";
        ctx.strokeStyle = e.isBreadcrumb ? EDGE_BREADCRUMB : isAlbumEdge ? EDGE_ALBUM : EDGE_COLOR;
        ctx.lineWidth = e.isBreadcrumb ? 2.5 : 1;
        ctx.globalAlpha = e.isBreadcrumb ? 0.9 : isAlbumEdge ? 0.8 : 0.7;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // draw nodes (back to front: albums, artists, values, relations, remotes, root)
      const roleOrder = ["album", "artist", "value", "relation", "remote", "root"];
      const sorted = [...nodes.keys()].sort((a, b) => {
        return roleOrder.indexOf(nodes[a].role) - roleOrder.indexOf(nodes[b].role);
      });

      for (const i of sorted) {
        const n = nodes[i];
        const x = positions[i * 2];
        const y = positions[i * 2 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const r = nodeDisplayRadius(n);

        // hover ring — follows the node's actual shape outline
        if (hov === n.id) {
          const gap = n.role === "remote" ? 5 : 6;
          nodeShapePath(ctx, n.role, x, y, r + gap);
          ctx.strokeStyle = HOVER_RING_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        drawNode(ctx, n, x, y, r);
        if (hov !== n.id) drawLabel(ctx, n, x, y, r);
      }

      // draw hovered node's label last so it's never buried
      if (hov !== null) {
        const hi = nodes.findIndex((n) => n.id === hov);
        if (hi !== -1 && Number.isFinite(positions[hi * 2])) {
          drawLabel(
            ctx,
            nodes[hi],
            positions[hi * 2],
            positions[hi * 2 + 1],
            nodeDisplayRadius(nodes[hi])
          );
        }
      }

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
  });

  // resize
  createEffect(() => {
    client.resize(w(), h());
  });

  // hit test → hover
  function onMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    client.hitTest(x, y).then((id) => setHoveredId(id));
  }

  function onMouseLeave() {
    setHoveredId(null);
  }

  // click → expand (walk)
  function onClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    client.hitTest(x, y).then((id) => {
      if (id) client.expand(id);
    });
  }

  return (
    <canvas
      ref={canvas}
      style={{
        display: "block",
        // when no explicit size given, fill the viewport
        ...(props.width == null && {
          position: "fixed" as const,
          inset: "0",
          width: "100vw",
          height: "100vh",
          "margin-bottom": `${props.insets?.bottom ?? 0}px`,
          "margin-right": `${props.insets?.right ?? 0}px`,
        }),
        cursor: hoveredId() ? "pointer" : "default",
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    />
  );
}

// ---- helpers ----------------------------------------------------------------

function nodeDisplayRadius(n: VisibleNode): number {
  switch (n.role) {
    case "root":
      return 14;
    case "remote":
      return 28 + Math.min(Math.sqrt(n.childCount) * 3, 16);
    case "relation":
      return 20 + Math.min(Math.sqrt(n.childCount) * 4, 20);
    case "value":
      return 14 + Math.min(Math.sqrt(n.childCount) * 3, 16);
    case "artist":
      return 18;
    case "album":
      return 11;
    default:
      return 14;
  }
}
