// relation metadata + edge construction for the album graph
import type {
  AlbumNodeData,
  ArtistNodeData,
  GraphEdge,
  GraphNodeData,
  RelationKind,
} from "./types";
import { nodeKind } from "./types";

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
  {
    kind: "favorite",
    label: "favorites",
    // accent pink — matches the heart accent the rest of the ui uses
    // (var(--color-accent-500) defaults to #ff1a9e).
    color: "#ff1a9e",
    description: "albums + artists you've marked as a favorite",
  },
  {
    kind: "artist_album",
    label: "artist ↔ album",
    color: "#fbbf24",
    description: "artist node linked to one of its in-library albums",
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
  /**
   * resolved last.fm related-artist relationships, keyed by source
   * artist id. each entry is the set of *in-library* related artist
   * ids (the api also returns external matches; the caller should
   * filter those out before passing them here). drives the
   * `related_artist` edge kind. when omitted, no related-artist
   * edges are produced.
   */
  relatedArtists?: Map<string, Set<string>>;
}

const DEFAULT_FANOUT = 3;

/**
 * build edges between graph nodes for the requested relation kinds.
 *
 * supports a heterogeneous node set: `AlbumNodeData` and
 * `ArtistNodeData` participate uniformly in the taxonomic relation
 * kinds (genre / tag / mood / style / era / label), because artist
 * nodes carry a unioned view of their albums' taxonomies. specialized
 * kinds:
 *   - `same_artist`: clique over albums sharing an artistId. excludes
 *     artist nodes (an artist is never "same artist" as another).
 *   - `related_artist`: artist↔artist wires from the `relatedArtists`
 *     map, restricted to pairs where *both* endpoints are present as
 *     in-library artist nodes.
 *   - `artist_album`: every artist node connects to its in-library
 *     albums.
 *   - `favorite`: every favorited album AND favorited artist gets
 *     chained into one group.
 *
 * other kinds use the chain-by-shared-attribute strategy:
 * - group nodes by the shared value (genre name, tag, label, era,
 *   mood, style)
 * - within each group, connect each node to the next `fanout` nodes in
 *   stable id order, forming a sparse chain (not a clique). this keeps
 *   edge count O(N * fanout) instead of O(N^2).
 */
export function buildRelationEdges(
  nodes: GraphNodeData[],
  options: BuildEdgesOptions = {}
): GraphEdge[] {
  const kinds = options.kinds ?? RELATION_KINDS.map((r) => r.kind);
  const fanout = options.perGroupFanout ?? DEFAULT_FANOUT;
  const minGroupSize = options.minGroupSize ?? 2;
  const edges: GraphEdge[] = [];

  // partition once — most kinds only care about one slice.
  const albumNodes: AlbumNodeData[] = [];
  const artistNodes: ArtistNodeData[] = [];
  for (const n of nodes) {
    if (nodeKind(n) === "artist") artistNodes.push(n as ArtistNodeData);
    else albumNodes.push(n as AlbumNodeData);
  }

  const addChain = (
    kind: RelationKind,
    label: string | undefined,
    members: GraphNodeData[],
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

  const groupBy = (keyFn: (n: GraphNodeData) => string[] | string | null) => {
    const m = new Map<string, GraphNodeData[]>();
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
    // album-only: artist nodes have no peer "same artist" semantic.
    const albumByArtist = new Map<string, AlbumNodeData[]>();
    for (const a of albumNodes) {
      let arr = albumByArtist.get(a.artistId);
      if (!arr) {
        arr = [];
        albumByArtist.set(a.artistId, arr);
      }
      arr.push(a);
    }
    for (const [a, members] of albumByArtist) {
      // for same-artist we want a clique (usually small) — bump fanout
      const sorted = [...members].sort((x, y) => x.id.localeCompare(y.id));
      // prefer the artist *name* for the label so edge tooltips read
      // "same_artist: Aphex Twin" instead of an opaque id. fall back to
      // the id when no name is available.
      const labelName = sorted[0]?.artistName || a;
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          edges.push({
            source: sorted[i].id,
            target: sorted[j].id,
            kind: "same_artist",
            weight: 1,
            label: labelName,
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
  if (kinds.includes("favorite")) {
    // single group: every album AND artist the user has favorited
    // gets chained together via the standard fanout, so large
    // favorite sets don't explode into an N² clique.
    const favAlbums = albumNodes.filter((n) => n.isFavorite);
    const favArtists = artistNodes.filter((n) => n.isFavorite);
    const favs = [...favAlbums, ...favArtists];
    addChain("favorite", "favorites", favs, 0.6);
  }

  if (kinds.includes("artist_album") && artistNodes.length > 0) {
    // every artist node wires to each in-library album by that artist.
    // weight is 1 (structural relation, not a soft similarity) so the
    // sim's link force keeps the album cluster anchored around the
    // artist circle.
    const albumsByArtistId = new Map<string, AlbumNodeData[]>();
    for (const a of albumNodes) {
      let arr = albumsByArtistId.get(a.artistId);
      if (!arr) {
        arr = [];
        albumsByArtistId.set(a.artistId, arr);
      }
      arr.push(a);
    }
    for (const artist of artistNodes) {
      const albums = albumsByArtistId.get(artist.artistId);
      if (!albums) continue;
      for (const album of albums) {
        edges.push({
          source: artist.id,
          target: album.id,
          kind: "artist_album",
          weight: 1,
          label: artist.name,
        });
      }
    }
  }

  if (kinds.includes("related_artist") && options.relatedArtists && artistNodes.length > 0) {
    // artist↔artist edges from last.fm/audiodb/mb cross-references,
    // restricted to pairs where *both* endpoints are present as
    // in-library artist nodes. de-duped (a→b and b→a collapse to a
    // single undirected edge by id-order).
    const artistIdsInLibrary = new Set(artistNodes.map((a) => a.artistId));
    const byArtistId = new Map(artistNodes.map((a) => [a.artistId, a] as const));
    const seen = new Set<string>();
    for (const src of artistNodes) {
      const related = options.relatedArtists.get(src.artistId);
      if (!related) continue;
      let drawn = 0;
      for (const tgtArtistId of related) {
        if (drawn >= fanout) break;
        if (tgtArtistId === src.artistId) continue;
        if (!artistIdsInLibrary.has(tgtArtistId)) continue;
        const tgt = byArtistId.get(tgtArtistId);
        if (!tgt) continue;
        const key =
          src.id < tgt.id ? `${src.id}|${tgt.id}` : `${tgt.id}|${src.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: src.id,
          target: tgt.id,
          kind: "related_artist",
          weight: 0.7,
          label: `${src.name} ↔ ${tgt.name}`,
        });
        drawn++;
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
