import type { WalkNode, WalkEdge } from "../types";

export function remote(remoteId: string, label: string, childCount: number): WalkNode {
  return { id: `remote::${remoteId}`, role: "remote", label, parentId: "root", childCount };
}

export function relation(remoteId: string, kind: string, label: string, childCount: number): WalkNode {
  return {
    id: `relation::${remoteId}::${kind}`,
    role: "relation",
    label,
    parentId: `remote::${remoteId}`,
    childCount,
  };
}

export function value(kind: string, val: string, label: string, childCount: number): WalkNode {
  return {
    id: `value::${kind}::${val}`,
    role: "value",
    label,
    parentId: `relation::local::${kind}`,
    childCount,
  };
}

export function artist(remoteId: string, artistId: string, name: string, albumCount: number): WalkNode {
  return {
    id: `artist::${remoteId}::${artistId}`,
    role: "artist",
    label: name,
    parentId: null,
    childCount: albumCount,
  };
}

export function album(remoteId: string, albumId: string, title: string): WalkNode {
  return {
    id: `album::${remoteId}::${albumId}`,
    role: "album",
    label: title,
    parentId: null,
    childCount: 0,
  };
}

// ghost artist — referenced in collaborator/metadata edges but not present
// in any remote's library. label-only render, no shape, no click target.
// id deliberately namespaced with `ghost::` (no remote prefix) so the
// cross-remote name matcher skips them.
export function ghostArtist(ghostId: string, name: string): WalkNode {
  return {
    id: `ghost::${ghostId}`,
    role: "ghost_artist",
    label: name,
    parentId: null,
    childCount: 0,
  };
}

export function edge(source: string, target: string): WalkEdge {
  return { source, target };
}
