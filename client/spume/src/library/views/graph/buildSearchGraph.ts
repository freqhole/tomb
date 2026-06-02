// search-mode subgraph builder. milestone B + C of the graph topnav
// search effort (see docs/explore-search-and-fixes-plan.md).
//
// inputs: the per-remote suggestion lists already fetched by
// GraphTopNavSearch (the "suggestions-only" data path; full /search is
// a future upgrade).
//
// outputs: a synthetic WalkGraph that lives in place of the normal
// library walk-graph for as long as search-mode is active.
//
// node id scheme:
//   - aggregated artist  : `s_artist::{slug(display_or_name)}` (synthetic,
//                          dedup'd across remotes; terminal in search-mode)
//   - aggregated album   : `s_album::{slug(display_or_album_title)}` (ditto)
//   - per-remote taxon   : `value::{remoteId}::{kind_slug}::{slug(display)}`
//                          (real library id! pivoting fires the regular
//                          createPivotHandler.maybeLoadTaxonsForPivot path
//                          and merges album children into the subgraph,
//                          matching default library-graph drill behaviour.)
// remote hubs reuse `remoteHubId(...)` so the visual identity matches
// what the user sees in the default graph.

import type {
  WalkGraph,
  WalkNode,
  WalkEdge,
  AlbumNodeData,
  ArtistNodeData,
} from "../../../components/graph/types";
import { rootId, remoteHubId, relationHubId, slug, valueNodeId } from "../../../components/graph/data/nodeIds";
import type { ImageMetadata } from "../../../music/services/storage/types";
import type { SearchSuggestion as APISuggestion } from "../../../music/data/types";
import { getArtistAbbreviation } from "../../../music/utils/format";
import { getRemoteMediaUrl } from "../../../utils/urls";

export interface SearchGraphInput {
  /** every remote that contributed at least one suggestion, in stable order. */
  remoteIds: string[];
  /** raw per-remote suggestion list (deduped is fine but not required). */
  resultsByRemote: Map<string, APISuggestion[]>;
  /** human-readable display name per remoteId (for hub labels). */
  remoteNamesById?: Map<string, string>;
  /** base url per remoteId — used to build `remote_url` for image
   *  metadata so the canvas thumbnail loader can resolve search-mode
   *  album/artist art over http (mirrors `adaptApiImage`). */
  remoteBaseUrlsById?: Map<string, string>;
  /** which remoteIds correspond to the local charnel-managed sidecar.
   *  surfaced as the home glyph on remote hubs, same as buildWalkGraph. */
  charnelManagedRemoteIds?: Set<string>;
}

export interface SearchGraphOutput {
  graph: WalkGraph;
  /** map from synthetic node id to its primary remote id. */
  primaryRemoteByNodeId: Map<string, string>;
  /** map from synthetic node id to all contributing remote ids. */
  contributorsByNodeId: Map<string, string[]>;
  /** map from synthetic node id back to the originating entity id per
   *  contributor. shape: nodeId -> Map<remoteId, entityId>.
   *  - artists: artist_id
   *  - albums: album_id
   *  - taxons: taxon value/slug */
  entityIdByNodeAndRemote: Map<string, Map<string, string>>;
  /** lightweight payloads for popover hydration + node-detail panels.
   *  populated from suggestion metadata so the user can hover/click a
   *  search-graph node and get something more useful than just a label.
   *  taxon nodes are intentionally omitted (they don't fit AlbumNodeData
   *  or ArtistNodeData; their drill-in will use a different code path). */
  nodesById: Map<string, AlbumNodeData | ArtistNodeData>;
  /** pre-resolved taxon entries per synthetic relation hub. seeded into
   *  the host's `taxonItemsByHub` cache so value-pivot drill-in can
   *  resolve `valueSlug -> { id, label }` without firing the library's
   *  full taxon loader (which would flood the search graph with sibling
   *  taxons and reparent value nodes off root). */
  searchTaxonsByHub: Map<string, Map<string, { id: string; label: string }>>;
}

type NodeRoleKind = "artist" | "album" | "taxon";

/** metadata shapes returned by grimoire suggestions. arrays come back
 *  as JSON-encoded strings (same convention as `images`) so the client
 *  has to JSON.parse them before use. */
interface SongMeta {
  match_type?: string;
  images?: string;
  album_id?: string;
  album_title?: string;
  artist_ids?: string;
  artist_names?: string;
}
interface AlbumMeta {
  match_type?: string;
  images?: string;
  artist_ids?: string;
  artist_names?: string;
}

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** suggestion metadata carries images as a JSON-encoded array of
 *  backend rows: `[{ media_blob_id, is_primary, blob_type }, ...]`.
 *  to feed the canvas thumbnail resolver we need a full ImageMetadata
 *  tagged with `remote_server_id` + a proper http `remote_url` built
 *  from the contributing remote's base url (mirrors `adaptApiImage`).
 *  returns the resolved url + populated metadata, or nulls when no
 *  usable image is present. */
function parseImages(
  raw: string | undefined,
  remoteId: string,
  baseUrl: string | undefined,
): { imageUrl: string | null; image: ImageMetadata | null } {
  if (!raw) return { imageUrl: null, image: null };
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return { imageUrl: null, image: null };
    type Row = { media_blob_id?: string; is_primary?: boolean; blob_type?: string };
    const visual = (arr as Row[]).filter((r) => r.blob_type !== "waveform");
    if (visual.length === 0) return { imageUrl: null, image: null };
    const primary = visual.find((r) => r.is_primary) ?? visual[0];
    const blobId = primary.media_blob_id;
    if (!blobId) return { imageUrl: null, image: null };
    const url = baseUrl ? getRemoteMediaUrl(baseUrl, blobId) : null;
    const image: ImageMetadata = {
      remote_blob_id: blobId,
      remote_server_id: remoteId,
      remote_url: url ?? undefined,
      is_primary: !!primary.is_primary,
      blob_type: (primary.blob_type ?? "original") as ImageMetadata["blob_type"],
    };
    return { imageUrl: url, image };
  } catch {
    return { imageUrl: null, image: null };
  }
}

function albumIdFor(title: string): string {
  return `s_album::${slug(title)}`;
}
function artistIdFor(name: string): string {
  return `s_artist::${slug(name)}`;
}

export function buildSearchGraph(input: SearchGraphInput): SearchGraphOutput {
  const { remoteIds, resultsByRemote, remoteBaseUrlsById } = input;

  const nodes: WalkNode[] = [];
  const edges: WalkEdge[] = [];
  const primaryRemoteByNodeId = new Map<string, string>();
  const contributorsByNodeId = new Map<string, string[]>();
  const entityIdByNodeAndRemote = new Map<string, Map<string, string>>();

  const rId = rootId();

  const contributingRemotes = remoteIds.filter((id) => (resultsByRemote.get(id)?.length ?? 0) > 0);

  nodes.push({
    id: rId,
    role: "root",
    label: "search results",
    parentId: null,
    childCount: contributingRemotes.length,
  });

  const hubChildCount = new Map<string, number>();
  for (const remoteId of contributingRemotes) {
    const rhId = remoteHubId(remoteId);
    nodes.push({
      id: rhId,
      role: "remote",
      label: input.remoteNamesById?.get(remoteId) ?? remoteId,
      parentId: rId,
      childCount: 0,
      isCharnelManaged: input.charnelManagedRemoteIds?.has(remoteId) || undefined,
    });
    edges.push({ source: rId, target: rhId });
    hubChildCount.set(rhId, 0);
  }

  interface AggNode {
    id: string;
    role: NodeRoleKind;
    label: string;
    primaryRemoteId: string;
    contributors: Set<string>;
    /** id of the artist node this album hangs off, if any. albums
     *  with no artist info fall back to root. ignored for artist /
     *  taxon nodes. */
    artistParentId?: string;
    /** name of the artist (display) used when emitting AlbumNodeData
     *  for popovers — first one wins, mirrors artistParentId. */
    artistParentName?: string;
    /** additional artists on multi-artist albums. these don't become
     *  the tree parent (walker getVisible() is parentId-based) but
     *  get secondary visual edges so collabs/features are visible. */
    secondaryArtistIds: Set<string>;
    /** `{hubId}::{thisId}` keys already emitted, dedupes remote-hub
     *  provenance edges across contributors. */
    hubEdges: Set<string>;
    /** first non-null image found across contributors. covers the
     *  common case where one remote has art and the others don't. */
    imageUrl: string | null;
    image: ImageMetadata | null;
    /** taxon-only: source remote (taxons stay per-remote) + relation
     *  kind. used to emit real `value::*` ids that plug into the
     *  library's pivot handler unchanged. */
    taxonRemoteId?: string;
    taxonKindSlug?: string;
  }
  const aggById = new Map<string, AggNode>();

  function ensureAgg(
    id: string,
    role: NodeRoleKind,
    label: string,
    remoteId: string,
  ): AggNode {
    let agg = aggById.get(id);
    if (!agg) {
      agg = {
        id,
        role,
        label,
        primaryRemoteId: remoteId,
        contributors: new Set<string>(),
        secondaryArtistIds: new Set<string>(),
        hubEdges: new Set<string>(),
        imageUrl: null,
        image: null,
      };
      aggById.set(id, agg);
    }
    return agg;
  }

  function maybeSetImage(agg: AggNode, raw: string | undefined, remoteId: string): void {
    if (agg.imageUrl || agg.image) return;
    const { imageUrl, image } = parseImages(raw, remoteId, remoteBaseUrlsById?.get(remoteId));
    if (imageUrl || image) {
      agg.imageUrl = imageUrl;
      agg.image = image;
    }
  }

  function setEntity(nodeId: string, remoteId: string, entityId: string): void {
    let m = entityIdByNodeAndRemote.get(nodeId);
    if (!m) {
      m = new Map<string, string>();
      entityIdByNodeAndRemote.set(nodeId, m);
    }
    if (!m.has(remoteId)) m.set(remoteId, entityId);
  }

  for (const remoteId of contributingRemotes) {
    const list = resultsByRemote.get(remoteId) ?? [];
    for (const s of list) {
      switch (s.suggestion_type) {
        case "artist": {
          const id = artistIdFor(s.display);
          const agg = ensureAgg(id, "artist", s.display, remoteId);
          agg.contributors.add(remoteId);
          setEntity(id, remoteId, s.entity_id);
          maybeSetImage(agg, (s.metadata as { images?: string } | undefined)?.images, remoteId);
          break;
        }
        case "album": {
          const meta = (s.metadata ?? {}) as AlbumMeta;
          const artistIds = parseJsonArray(meta.artist_ids);
          const artistNames = parseJsonArray(meta.artist_names);
          const id = albumIdFor(s.display);
          const agg = ensureAgg(id, "album", s.display, remoteId);
          agg.contributors.add(remoteId);
          setEntity(id, remoteId, s.entity_id);
          maybeSetImage(agg, meta.images, remoteId);

          for (let i = 0; i < artistNames.length; i++) {
            const aName = artistNames[i];
            if (!aName) continue;
            const aId = artistIdFor(aName);
            const aAgg = ensureAgg(aId, "artist", aName, remoteId);
            aAgg.contributors.add(remoteId);
            const realArtistId = artistIds[i];
            // only record entity-id when backend supplied one; orphan
            // artist nodes (name-only) stay un-routable so onSelect's
            // entityIdByNodeAndRemote.get(...)?.get(...) returns
            // undefined and the caller bails out of nav cleanly.
            if (realArtistId) setEntity(aId, remoteId, realArtistId);
            if (!agg.artistParentId) {
              agg.artistParentId = aId;
              agg.artistParentName = aName;
            } else if (aId !== agg.artistParentId) {
              agg.secondaryArtistIds.add(aId);
            }
          }
          break;
        }
        case "song": {
          const meta = (s.metadata ?? {}) as SongMeta;
          const albumTitle = meta.album_title;
          const albumId = meta.album_id;
          if (!albumTitle || !albumId) break;
          const artistIds = parseJsonArray(meta.artist_ids);
          const artistNames = parseJsonArray(meta.artist_names);
          const id = albumIdFor(albumTitle);
          const agg = ensureAgg(id, "album", albumTitle, remoteId);
          agg.contributors.add(remoteId);
          setEntity(id, remoteId, albumId);
          maybeSetImage(agg, meta.images, remoteId);

          for (let i = 0; i < artistNames.length; i++) {
            const aName = artistNames[i];
            if (!aName) continue;
            const aId = artistIdFor(aName);
            const aAgg = ensureAgg(aId, "artist", aName, remoteId);
            aAgg.contributors.add(remoteId);
            const realArtistId = artistIds[i];
            if (realArtistId) setEntity(aId, remoteId, realArtistId);
            if (!agg.artistParentId) {
              agg.artistParentId = aId;
              agg.artistParentName = aName;
            } else if (aId !== agg.artistParentId) {
              agg.secondaryArtistIds.add(aId);
            }
          }
          break;
        }
        case "playlist":
          break;
        default: {
          // taxon hit (genre / mood / style / era / label / custom).
          // emit a real library-style `value::{remoteId}::{kind}::{slug}`
          // id parented under the contributing remote's hub. that way:
          //   1. the node sits inside the remote subtree, matching how
          //      taxons appear in the default library graph;
          //   2. pivoting it triggers `createPivotHandler`'s
          //      `maybeLoadTaxonsForPivot`, which merges the real
          //      album children into the search subgraph — same drill
          //      behaviour as walking out from a value node in the
          //      regular library view.
          // kind_slug from metadata wins (c-1 added it for genre); the
          // suggestion_type is the legacy fallback.
          const meta = (s.metadata ?? {}) as { kind_slug?: string };
          const kindSlug = meta.kind_slug ?? s.suggestion_type ?? "taxon";
          const id = valueNodeId(remoteId, kindSlug, s.display);
          const agg = ensureAgg(id, "taxon", s.display, remoteId);
          agg.contributors.add(remoteId);
          agg.taxonRemoteId = remoteId;
          agg.taxonKindSlug = kindSlug;
          setEntity(id, remoteId, s.value || slug(s.display));
          break;
        }
      }
    }
  }

  // emit relation hub stubs for every (remote, kindSlug) combo that
  // produced at least one taxon hit. mirrors the library graph's
  // `relation::{remoteId}::{kindSlug}` hub shape so the pivot
  // handler's existing taxon-loader code path applies unchanged. we
  // parent these under root (not under the remote hub) for the same
  // reason albums are root-parented in search-mode: at the default
  // root pivot the user should see the taxon hubs alongside the
  // artist/album results, otherwise they'd have to first pivot a
  // remote to discover that any matched. the `{source: remote,
  // target: relation}` edge below preserves the provenance link.
  interface RelStub { remoteId: string; kindSlug: string; childCount: number }
  const relationHubs = new Map<string, RelStub>();
  for (const agg of aggById.values()) {
    if (agg.role !== "taxon" || !agg.taxonRemoteId || !agg.taxonKindSlug) continue;
    const relId = relationHubId(agg.taxonRemoteId, agg.taxonKindSlug);
    let stub = relationHubs.get(relId);
    if (!stub) {
      stub = { remoteId: agg.taxonRemoteId, kindSlug: agg.taxonKindSlug, childCount: 0 };
      relationHubs.set(relId, stub);
    }
    stub.childCount++;
  }
  for (const [relId, stub] of relationHubs) {
    const remoteParent = remoteHubId(stub.remoteId);
    nodes.push({
      id: relId,
      role: "relation",
      label: stub.kindSlug,
      parentId: rId,
      childCount: stub.childCount,
    });
    edges.push({ source: rId, target: relId });
    // provenance edge so the kind hub is wired back to its source
    // remote (drawn whenever both endpoints are visible).
    edges.push({ source: remoteParent, target: relId });
    hubChildCount.set(remoteParent, (hubChildCount.get(remoteParent) ?? 0) + 1);
  }

  // emit artists first so albums can reference them as parents.
  const orderedAggs: AggNode[] = [];
  for (const agg of aggById.values()) if (agg.role === "artist") orderedAggs.push(agg);
  for (const agg of aggById.values()) if (agg.role !== "artist") orderedAggs.push(agg);

  for (const agg of orderedAggs) {
    const contributors = Array.from(agg.contributors);
    let parentId: string = rId;
    if (agg.role === "album" && agg.artistParentId && aggById.has(agg.artistParentId)) {
      // library-style parentage: album under its primary artist. lets
      // the walker's existing "auto-expand albums for breadcrumb
      // artist" rule + "keep parent artist visible when album visible"
      // rule do the right thing on drill-in. albums whose artist isn't
      // among the search hits fall through to root parentage below.
      parentId = agg.artistParentId;
    } else if (agg.role === "taxon" && agg.taxonRemoteId && agg.taxonKindSlug) {
      // library-style parentage: value under its relation (kind) hub.
      // pivoting the kind hub then surfaces matched values via
      // clusterChildrenOf; pivoting a value triggers the regular
      // value-pivot album loader, same as the library graph.
      parentId = relationHubId(agg.taxonRemoteId, agg.taxonKindSlug);
    }

    nodes.push({
      id: agg.id,
      role: agg.role === "taxon" ? "value" : agg.role,
      label: agg.label,
      parentId,
      childCount: 0,
      // taxons start collapsed; the library pivot handler fills them
      // in on demand. artists/albums in search-mode are terminal so
      // no laziness needed there.
      lazy: agg.role === "taxon" ? true : undefined,
    });
    edges.push({ source: parentId, target: agg.id });

    // secondary artist edges for multi-artist albums: visible collabs
    // without changing tree parentage. (the primary artist edge is
    // already covered by the tree edge above.)
    if (agg.role === "album" && agg.secondaryArtistIds.size > 0) {
      for (const aId of agg.secondaryArtistIds) {
        if (!aggById.has(aId)) continue;
        if (aId === agg.artistParentId) continue;
        edges.push({ source: aId, target: agg.id });
      }
    }

    for (const remoteId of contributors) {
      const hubId = remoteHubId(remoteId);
      // taxons parent through a relation hub stub already; the relation
      // hub itself was edge-attributed to the remote above. skip per-
      // value provenance edges so the remote isn't spammed with one
      // edge per taxon match.
      if (agg.role === "taxon") continue;
      const edgeKey = `${hubId}::${agg.id}`;
      if (agg.hubEdges.has(edgeKey)) continue;
      agg.hubEdges.add(edgeKey);
      edges.push({ source: hubId, target: agg.id });
      hubChildCount.set(hubId, (hubChildCount.get(hubId) ?? 0) + 1);
    }
    primaryRemoteByNodeId.set(agg.id, agg.primaryRemoteId);
    contributorsByNodeId.set(agg.id, contributors);
  }

  const childCountById = new Map<string, number>();
  for (const agg of aggById.values()) {
    if (agg.role === "album" && agg.artistParentId && aggById.has(agg.artistParentId)) {
      childCountById.set(
        agg.artistParentId,
        (childCountById.get(agg.artistParentId) ?? 0) + 1,
      );
    }
  }
  for (const node of nodes) {
    if (node.role === "remote") {
      const count = hubChildCount.get(node.id);
      if (count !== undefined) node.childCount = count;
    } else if (node.role === "artist") {
      node.childCount = childCountById.get(node.id) ?? 0;
    }
  }
  let rootChildren = contributingRemotes.length + relationHubs.size;
  for (const agg of aggById.values()) {
    if (agg.role === "artist") rootChildren++;
    // albums under a known artist parent are not direct root children
    // anymore (library-style parentage); only orphan albums (no artist
    // among search hits) count toward root.
    else if (agg.role === "album" && !(agg.artistParentId && aggById.has(agg.artistParentId))) rootChildren++;
    // taxon values are now parented under their relation hub, not root.
  }
  const rootNode = nodes.find((n) => n.id === rId);
  if (rootNode) rootNode.childCount = rootChildren;

  // ---- nodesById (popover hydration + image overlays) -------------------
  const nodesById = new Map<string, AlbumNodeData | ArtistNodeData>();
  for (const agg of aggById.values()) {
    const contributors = Array.from(agg.contributors);
    if (agg.role === "artist") {
      const data: ArtistNodeData = {
        id: agg.id,
        kind: "artist",
        artistId: entityIdByNodeAndRemote.get(agg.id)?.get(agg.primaryRemoteId) ?? agg.id,
        name: agg.label,
        abbreviation: getArtistAbbreviation(agg.label),
        imageUrl: agg.imageUrl,
        image: agg.image,
        albumCount: childCountById.get(agg.id) ?? 0,
        genres: [],
        tags: [],
        moods: [],
        styles: [],
        label: null,
        era: null,
        customTaxons: {},
        sourceRemoteIds: contributors,
      };
      nodesById.set(agg.id, data);
    } else if (agg.role === "album") {
      const artistId =
        agg.artistParentId
          ? entityIdByNodeAndRemote.get(agg.artistParentId)?.get(agg.primaryRemoteId) ??
            agg.artistParentId
          : "";
      const data: AlbumNodeData = {
        id: agg.id,
        kind: "album",
        title: agg.label,
        artistId,
        artistName: agg.artistParentName ?? "",
        year: null,
        imageUrl: agg.imageUrl,
        image: agg.image,
        genres: [],
        tags: [],
        moods: [],
        styles: [],
        label: null,
        era: null,
        customTaxons: {},
        trackCount: 0,
        totalDurationSec: 0,
        sourceRemoteIds: contributors,
      };
      nodesById.set(agg.id, data);
    }
    // taxons intentionally omitted from nodesById — they use real
    // `value::*` ids so the library's loadTaxonInfoForNode + lazy pivot
    // loaders handle popover hydration and drill-in directly.
  }

  const searchTaxonsByHub = new Map<string, Map<string, { id: string; label: string }>>();
  for (const agg of aggById.values()) {
    if (agg.role !== "taxon" || !agg.taxonRemoteId || !agg.taxonKindSlug) continue;
    const relId = relationHubId(agg.taxonRemoteId, agg.taxonKindSlug);
    const valueSlug = slug(agg.label);
    const entityId = entityIdByNodeAndRemote.get(agg.id)?.get(agg.taxonRemoteId);
    if (!entityId) continue;
    let bucket = searchTaxonsByHub.get(relId);
    if (!bucket) {
      bucket = new Map();
      searchTaxonsByHub.set(relId, bucket);
    }
    bucket.set(valueSlug, { id: entityId, label: agg.label });
  }

  return {
    graph: { nodes, edges },
    primaryRemoteByNodeId,
    contributorsByNodeId,
    entityIdByNodeAndRemote,
    nodesById,
    searchTaxonsByHub,
  };
}
