export const ROLE_COLOR: Record<string, string> = {
  root: "#ff00ff",
  remote: "#ec4899",
  relation: "#0891b2",
  value: "#059669",
  group: "#059669",
  artist: "#d97706",
  album: "#475569",
};

// deterministic per-kind color for value nodes. derived from a small string
// hash of the kind so any new taxon kind (genres / tags / era / mood / decade /
// whatever) gets a stable, well-separated hue without a manual table. used as
// the node stroke + as the edge color for wires touching a value node.
export function hashKind(kind: string): number {
  // djb2 — small, no deps, fine spread for short strings
  let h = 5381;
  for (let i = 0; i < kind.length; i++) h = (h * 33 + kind.charCodeAt(i)) | 0;
  // multiply by a prime coprime to 360 so similar prefixes don't cluster hues
  return ((h >>> 0) * 137) % 360;
}

/** mid-lightness "active" tone — for strokes + edges (pops on black). */
export function valueKindStroke(kind: string): string {
  return `hsl(${hashKind(kind)} 75% 62%)`;
}

/** deterministic accent color for a remote id. used by the strategy A
 *  contributor-dot ring drawn around clustered entity nodes so each
 *  contributing remote is visually distinguishable. reuses hashKind so
 *  any new remote gets a stable, well-separated hue. */
export function remoteAccentColor(remoteId: string): string {
  return `hsl(${hashKind(remoteId)} 80% 60%)`;
}

/** deterministic 3-color gradient (magenta -> purple -> orange) used as
 *  the fill for a remote hub when no avatar image is available. the
 *  gradient direction and a small per-remote hue shift are seeded from
 *  the remote id hash so every remote keeps a stable, distinct look. */
export function remoteGradientFill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  remoteId: string
): CanvasGradient {
  const h = hashKind(remoteId);
  const angle = (h * Math.PI) / 180;
  const dx = Math.cos(angle) * radius;
  const dy = Math.sin(angle) * radius;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  const shift = (h % 30) - 15;
  g.addColorStop(0, `hsl(${320 + shift} 85% 58%)`); // magenta
  g.addColorStop(0.55, `hsl(${275 + shift} 70% 50%)`); // purple
  g.addColorStop(1, `hsl(${28 + shift} 92% 56%)`); // orange
  return g;
}

/** pick black or white based on the perceived luminance of bg. accepts
 *  hex (#rrggbb or #rgb) or hsl(h s% l%) strings. returns #ffffff for
 *  dark fills, #000000 for light fills. */
export function readableTextColor(bg: string): string {
  if (bg.startsWith("hsl")) {
    const match = bg.match(/hsl\(\s*\d+\s+\d+%\s+(\d+)%\s*\)/);
    if (match) {
      const l = parseInt(match[1], 10);
      return l < 60 ? "#ffffff" : "#000000";
    }
  } else if (bg.startsWith("#")) {
    let hex = bg.slice(1);
    if (hex.length === 3)
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      return luma < 128 ? "#ffffff" : "#000000";
    }
  }
  return "#ffffff";
}

/** hierarchy rank for picking the more-central ("hub") endpoint of an
 *  edge. lower rank = closer to root. used so breadcrumb edges adopt
 *  the parent hub's color instead of a uniform amber. */
export const ROLE_RANK: Record<string, number> = {
  root: 0,
  remote: 1,
  relation: 2,
  value: 3,
  group: 3,
  artist: 4,
  album: 5,
  ghost_artist: 6,
};

export const EDGE_COLOR = "#6b7280"; // visible on black
export const EDGE_ALBUM = "#94a3b8"; // lighter for artist→album wires
export const EDGE_BREADCRUMB = "#f59e0b";
export const CROSS_REMOTE_COLOR = "#fbbf24"; // amber, slightly brighter than breadcrumb — used dashed
export const RELATED_ARTIST_EDGE_COLOR = "#c4b5fd"; // lavender; distinct from taxon hues + cross-remote amber
export const GHOST_LABEL_COLOR = "rgba(241,245,249,0.55)"; // dimmed label tint for ghost artists
export const PIVOT_RING_COLOR = "#ffffff";
export const SELECTION_RING_COLOR = "#ff1a9e";
export const BREADCRUMB_COLOR = "#fcd34d";
export const LABEL_COLOR = "#f1f5f9";
export const HOVER_RING_COLOR = "rgba(255,255,255,0.5)";

// loading-comet palette mirrors the conic-gradient on the player-bar
// play/pause ring: pink head → magenta mid → purple tail. used by the
// per-node loading arc so all "async in progress" signals match.
export const COMET_HEAD = "#ec4899";
export const COMET_MID = "#c026d3";
export const COMET_TAIL = "#a855f7";
