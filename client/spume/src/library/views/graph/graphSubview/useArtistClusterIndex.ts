import { createMemo, type Accessor } from "solid-js";
import type { AlbumNodeData, ArtistNodeData } from "../../../../components/graph/types";
import { parseNodeId, slug } from "../../../../components/graph/data/nodeIds";

export type ClusterMember = {
  nodeId: string; // full graph key, `artist::{remoteId}::{artistId}`
  remoteId: string;
  data: ArtistNodeData;
};

// each remote keeps its own per-remote artist node
// (`artist::{remoteId}::{artistId}`) with a remote-specific artistId.
// the worker visually collapses same-name artists across remotes into
// a single rendered glyph (the cluster "leader"), but the leader's id
// is arbitrary — it can belong to any contributing remote. callers use
// this per-name index to look up every loaded artist node (across all
// remotes) keyed by slug(name).
export function useArtistClusterIndex(
  mainNodes: Accessor<Map<string, AlbumNodeData | ArtistNodeData> | undefined>,
  extraNodes: Accessor<Map<string, AlbumNodeData | ArtistNodeData>>
): Accessor<Map<string, ClusterMember[]>> {
  return createMemo<Map<string, ClusterMember[]>>(() => {
    const out = new Map<string, ClusterMember[]>();
    const ingest = (id: string, n: AlbumNodeData | ArtistNodeData) => {
      if (!("artistId" in n)) return;
      // restrict to true artist graph keys (skip ghost_artist::, etc).
      let parsed: ReturnType<typeof parseNodeId>;
      try {
        parsed = parseNodeId(id);
      } catch {
        return;
      }
      if (parsed.kind !== "artist") return;
      const a = n as ArtistNodeData;
      const key = slug(a.name);
      if (!key) return;
      let arr = out.get(key);
      if (!arr) {
        arr = [];
        out.set(key, arr);
      }
      // dedupe by remoteId so a re-merged map entry doesn't pile up.
      if (arr.some((m) => m.remoteId === parsed.remoteId)) return;
      arr.push({ nodeId: id, remoteId: parsed.remoteId, data: a });
    };
    const main = mainNodes();
    if (main) for (const [id, n] of main) ingest(id, n);
    for (const [id, n] of extraNodes()) ingest(id, n);
    return out;
  });
}
