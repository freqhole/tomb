// relation metadata + edge construction for the album graph
import type { AlbumNodeData, GraphEdge, RelationKind } from "./types";

export interface RelationKindMeta {
  kind: RelationKind;
  label: string;
  /** css color (used for swatch + canvas stroke) */
  color: string;
  /** short description for tooltips / legend */
  description: string;
}

export const RELATION_KINDS: RelationKindMeta[] = [
  {
    kind: "genre",
    label: "genre",
    color: "#7c5cff",
    description: "shared primary genre taxon",
  },
  {
    kind: "tag",
    label: "tag",
    color: "#22c55e",
    description: "shared community tag",
  },
  {
    kind: "same_artist",
    label: "same artist",
    color: "#f59e0b",
    description: "same artist",
  },
  {
    kind: "related_artist",
    label: "related artist",
    color: "#ec4899",
    description: "linked through related-artist signals",
  },
  {
    kind: "mood",
    label: "mood",
    color: "#06b6d4",
    description: "shared mood taxon",
  },
  {
    kind: "style",
    label: "style",
    color: "#a78bfa",
    description: "shared style taxon",
  },
  {
    kind: "era",
    label: "era",
    color: "#94a3b8",
    description: "same 5-year release era",
  },
  {
    kind: "label",
    label: "label",
    color: "#ef4444",
    description: "same record label",
  },
];

export const RELATION_COLOR: Record<RelationKind, string> = RELATION_KINDS.reduce(
  (acc, r) => {
    acc[r.kind] = r.color;
    return acc;
  },
  {} as Record<RelationKind, string>
);

export const RELATION_LABEL: Record<RelationKind, string> = RELATION_KINDS.reduce(
  (acc, r) => {
    acc[r.kind] = r.label;
    return acc;
  },
  {} as Record<RelationKind, string>
);

export interface BuildEdgesOptions {
  /** only build edges for these kinds; undefined = all */
  kinds?: RelationKind[];
  /**
   * per-group "fan-out" cap. for each shared value (e.g. genre="rock"), we
   * chain nodes in a ring so each node gets at most this many edges of that
   * kind. caps explosion on huge libraries.
   */
  perGroupFanout?: number;
  /** drop groups smaller than this */
  minGroupSize?: number;
}

const DEFAULT_FANOUT = 3;

/**
 * build edges between album nodes for the requested relation kinds.
 *
 * strategy per kind:
 * - group nodes by the shared value (genre name, tag, label, era, artistId,
 *   mood, style)
 * - within each group, connect each node to the next `fanout` nodes in
 *   stable id order, forming a sparse chain (not a clique). this keeps edge
 *   count O(N * fanout) instead of O(N^2).
 *
 * related_artist is special: edge when albumA.artist appears in
 * albumB.relatedArtistIds (or vice-versa), capped at `fanout` per source.
 */
export function buildRelationEdges(
  nodes: AlbumNodeData[],
  options: BuildEdgesOptions = {}
): GraphEdge[] {
  const kinds = options.kinds ?? RELATION_KINDS.map((r) => r.kind);
  const fanout = options.perGroupFanout ?? DEFAULT_FANOUT;
  const minGroupSize = options.minGroupSize ?? 2;
  const edges: GraphEdge[] = [];

  const addChain = (
    kind: RelationKind,
    label: string | undefined,
    members: AlbumNodeData[],
    weight: number
  ) => {
    if (members.length < minGroupSize) return;
    const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = 1; j <= fanout && i + j < sorted.length; j++) {
        edges.push({
          source: sorted[i].id,
          target: sorted[i + j].id,
          kind,
          weight,
          label,
        });
      }
    }
  };

  const groupBy = (keyFn: (n: AlbumNodeData) => string[] | string | null) => {
    const m = new Map<string, AlbumNodeData[]>();
    for (const n of nodes) {
      const k = keyFn(n);
      const keys = Array.isArray(k) ? k : k ? [k] : [];
      for (const key of keys) {
        if (!key) continue;
        let arr = m.get(key);
        if (!arr) {
          arr = [];
          m.set(key, arr);
        }
        arr.push(n);
      }
    }
    return m;
  };

  if (kinds.includes("genre")) {
    for (const [g, members] of groupBy((n) => n.genres)) {
      addChain("genre", g, members, 0.8);
    }
  }
  if (kinds.includes("tag")) {
    for (const [t, members] of groupBy((n) => n.tags.map((tt) => tt.label))) {
      addChain("tag", t, members, 0.5);
    }
  }
  if (kinds.includes("same_artist")) {
    for (const [a, members] of groupBy((n) => n.artistId)) {
      // for same-artist we want a clique (usually small) — bump fanout
      const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          edges.push({
            source: sorted[i].id,
            target: sorted[j].id,
            kind: "same_artist",
            weight: 1,
            label: a,
          });
        }
      }
    }
  }
  if (kinds.includes("mood")) {
    for (const [m, members] of groupBy((n) => n.moods)) {
      addChain("mood", m, members, 0.5);
    }
  }
  if (kinds.includes("style")) {
    for (const [s, members] of groupBy((n) => n.styles)) {
      addChain("style", s, members, 0.5);
    }
  }
  if (kinds.includes("era")) {
    for (const [e, members] of groupBy((n) => n.era)) {
      addChain("era", e, members, 0.3);
    }
  }
  if (kinds.includes("label")) {
    for (const [l, members] of groupBy((n) => n.label)) {
      addChain("label", l, members, 0.6);
    }
  }

  if (kinds.includes("related_artist")) {
    // index albums by their artistId so we can resolve relations
    const byArtist = new Map<string, AlbumNodeData[]>();
    for (const n of nodes) {
      let arr = byArtist.get(n.artistId);
      if (!arr) {
        arr = [];
        byArtist.set(n.artistId, arr);
      }
      arr.push(n);
    }
    const seen = new Set<string>();
    for (const n of nodes) {
      let drawn = 0;
      for (const relArtistId of n.relatedArtistIds) {
        if (drawn >= fanout) break;
        const targets = byArtist.get(relArtistId);
        if (!targets) continue;
        for (const t of targets) {
          if (t.id === n.id) continue;
          const key =
            n.id < t.id ? `${n.id}|${t.id}` : `${t.id}|${n.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({
            source: n.id,
            target: t.id,
            kind: "related_artist",
            weight: 0.7,
          });
          drawn++;
          if (drawn >= fanout) break;
        }
      }
    }
  }

  return edges;
}

export function countEdgesByKind(
  edges: GraphEdge[]
): Record<string, number> {
  const counts: Record<string, number> = RELATION_KINDS.reduce(
    (acc, r) => {
      acc[r.kind] = 0;
      return acc;
    },
    {} as Record<string, number>
  );
  for (const e of edges) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
}
