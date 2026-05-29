// node id encoding/decoding for the graph2 walk explorer.
// single authoritative scheme — all main-thread and worker code must use
// these helpers (or the mirror copy in walker.worker.ts) instead of
// hand-formatting ids.

// v1 subset of relation kinds recognised by this module.
// must match the strings used in AlbumNodeData / ArtistNodeData fields.
//
// `era` and `recent` are synthesized server-side hubs (see grimoire
// `list_era_bins` / `list_recently_added_albums`): they don't map to
// stored `taxonz` rows, but reuse the same `relation::` / `value::`
// node id scheme so the walk explorer can render them with no
// special cases on the drawing side.
export type RelationKind =
  | "genre"
  | "tag"
  | "mood"
  | "style"
  | "era"
  | "label"
  | "favorite"
  | "recently_added"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {}); // user-defined kind_slugs

// ---- slug ------------------------------------------------------------------
// ported verbatim from walker.worker.ts so main-side and worker-side slugs
// agree byte-for-byte. cross-remote matching relies on this.

export function slug(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---- encoders --------------------------------------------------------------

export function rootId(): string {
  return "root";
}

export function remoteHubId(remoteId: string): string {
  return `remote::${remoteId}`;
}

export function relationHubId(remoteId: string, kind: RelationKind): string {
  return `relation::${remoteId}::${kind}`;
}

/** value is slugged before embedding in the id. */
export function valueNodeId(remoteId: string, kind: RelationKind, value: string): string {
  return `value::${remoteId}::${kind}::${slug(value)}`;
}

export function artistNodeId(remoteId: string, artistId: string): string {
  // artistId must be a bare local id (e.g. "123"), not the full ArtistNodeData.id
  // (which is "artist::${artistId}"). strip the prefix before calling this.
  return `artist::${remoteId}::${artistId}`;
}

export function albumNodeId(remoteId: string, albumId: string): string {
  // albumId must be a bare local id (e.g. "456"), not the full AlbumNodeData.id
  // (which is "${remoteId}::${albumId}" per adaptAlbum). strip the prefix before calling this.
  return `album::${remoteId}::${albumId}`;
}

/** name is slugged; ghost artists have no stable library id. */
export function ghostArtistId(name: string): string {
  return `ghost_artist::${slug(name)}`;
}

// ---- decoder ----------------------------------------------------------------

export type ParsedNodeId =
  | { kind: "root" }
  | { kind: "remote"; remoteId: string }
  | { kind: "relation"; remoteId: string; relationKind: RelationKind }
  | { kind: "value"; remoteId: string; relationKind: RelationKind; valueSlug: string }
  | { kind: "artist"; remoteId: string; artistId: string }
  | { kind: "album"; remoteId: string; albumId: string }
  | { kind: "ghost_artist"; ghostSlug: string };

export function parseNodeId(id: string): ParsedNodeId {
  if (id === "root") return { kind: "root" };

  const parts = id.split("::");
  const [prefix, ...rest] = parts;

  switch (prefix) {
    case "remote": {
      if (rest.length !== 1) throw new Error(`unparseable node id: ${id}`);
      return { kind: "remote", remoteId: rest[0] };
    }
    case "relation": {
      if (rest.length !== 2) throw new Error(`unparseable node id: ${id}`);
      return { kind: "relation", remoteId: rest[0], relationKind: rest[1] as RelationKind };
    }
    case "value": {
      if (rest.length !== 3) throw new Error(`unparseable node id: ${id}`);
      return { kind: "value", remoteId: rest[0], relationKind: rest[1] as RelationKind, valueSlug: rest[2] };
    }
    case "artist": {
      if (rest.length !== 2) throw new Error(`unparseable node id: ${id}`);
      return { kind: "artist", remoteId: rest[0], artistId: rest[1] };
    }
    case "album": {
      if (rest.length !== 2) throw new Error(`unparseable node id: ${id}`);
      return { kind: "album", remoteId: rest[0], albumId: rest[1] };
    }
    case "ghost_artist": {
      if (rest.length !== 1) throw new Error(`unparseable node id: ${id}`);
      return { kind: "ghost_artist", ghostSlug: rest[0] };
    }
    default:
      throw new Error(`unparseable node id: ${id}`);
  }
}
