import type { QueryClient } from "@tanstack/solid-query";
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import type { AlbumNodeData, ArtistNodeData } from "../../../../components/graph/types";
import type { AlbumSummary } from "../../../../music/data/types";
import type { WalkerClient } from "../../../../components/graph/worker/client";
import type { WalkNode, WalkEdge } from "../../../../components/graph/types";
import {
  parseNodeId,
  slug,
  remoteHubId,
  relationHubId,
  valueNodeId,
  groupNodeId,
  artistNodeId,
  ghostArtistId,
  type RelationKind,
} from "../../../../components/graph/data/nodeIds";
import { getClientForRemote } from "../../../../app/api/client";
import { adaptApiImage, adaptApiUrls } from "../../../../music/data/remote/adapters";
import { adaptAlbum } from "../adaptAlbum";

export interface PivotHandlerDeps {
  remotes: () => Remote[];
  offlineByRemote: () => Map<string, boolean>;
  walkerClient: () => WalkerClient | null;
  buildResult: () => { nodesById: Map<string, AlbumNodeData | ArtistNodeData> } | null;
  extraNodesById: () => Map<string, AlbumNodeData | ArtistNodeData>;
  lookupNode: (id: string) => AlbumNodeData | ArtistNodeData | null;
  setSelectedId: (next: string | null) => void;
  nodesByRemote: () => Map<string, AlbumNodeData[]>;
  appendAlbumsToRemote: (remoteId: string, incoming: AlbumNodeData[]) => number;
  setFetchingByRemote: (
    updater: (prev: Map<string, boolean>) => Map<string, boolean>
  ) => void;
  setFetchingNodeFlag: (nodeId: string, fetching: boolean) => void;
  recordRelatedEdge: (aId: string, bId: string, status: "accepted" | "pending") => void;
  taxonsLoadedByHub: Set<string>;
  taxonItemsByHub: Map<string, Map<string, { id: string; label: string; albumCount: number }>>;
  taxonParentsByHub: Map<string, Map<string, string>>;
  taxonLabelsByHub: Map<string, Map<string, string>>;
  albumsLoadedByPivot: Set<string>;
  /** when true (search-mode active), autonomous loaders that fan out
   *  the full library context for a pivoted node are suppressed. the
   *  search subgraph is intentionally a curated subset; firing the
   *  library's taxon/era/related-artist loaders on a search pivot
   *  drowns the user's filtered results in unrelated sibling nodes
   *  ("the graph just reset"). value-pivot album drill-in still
   *  runs because it's scoped to the clicked node. */
  searchMode?: () => boolean;
  /** when set, empty leaf taxons (no albums + no children) are still
   *  surfaced so admins can see + work with placeholders they just
   *  created. when false (default), they're filtered out to keep the
   *  graph readable. */
  editMode?: () => boolean;
  /** fires after a taxon hub finishes loading + merging fresh nodes.
   *  hosts use this to re-derive any per-hub state (e.g. edit-mode
   *  filter hide sets) that depends on the populated taxon caches. */
  onHubRefreshed?: (relHubId: string) => void;
  /** host-owned page state for the unassigned hub: which page to fetch
   *  + page size. when omitted, pager defaults to page 0 / size 16. */
  getUnassignedPagerState?: (relHubId: string) => { pageIndex: number; pageSize: number };
  /** fires after an unassigned page load completes. host uses this to
   *  update its pager ui (total count, can-prev/next). */
  onUnassignedPageInfo?: (
    relHubId: string,
    info: { total: number; pageIndex: number; pageSize: number; consumed: number; hasNext: boolean }
  ) => void;
  queryClient?: QueryClient;
}

export function createPivotHandler(deps: PivotHandlerDeps) {
  const {
    remotes,
    offlineByRemote,
    walkerClient,
    buildResult,
    extraNodesById,
    lookupNode,
    setSelectedId,
    nodesByRemote,
    appendAlbumsToRemote,
    setFetchingNodeFlag,
    recordRelatedEdge,
    taxonsLoadedByHub,
    taxonItemsByHub,
    taxonParentsByHub,
    taxonLabelsByHub,
    albumsLoadedByPivot,
    editMode,
    searchMode,
    onHubRefreshed,
    getUnassignedPagerState,
    onUnassignedPageInfo,
  } = deps;

  // kinds that are NOT backed by a queryable taxon: "favorites" is a per-user
  // flag. "era" and "recently_added" are synthesised in list_taxon_kinds so
  // they render as first-class hubs but have no queryable taxonz rows.
  const NON_TAXON_KINDS = new Set<string>(["favorites", "era", "recently_added", "unassigned"]);

  // pivot-loader dedup sets for synthesized hubs.
  const eraBinsLoadedByHub = new Set<string>();
  const eraBinsFetchPromises = new Map<string, Promise<void>>();
  const recentlyAddedLoadedByHub = new Set<string>();
  const recentlyAddedFetchPromises = new Map<string, Promise<void>>();
  const unassignedLoadedByHub = new Set<string>();
  const unassignedFetchPromises = new Map<string, Promise<void>>();
  // raw API offset cursor per page index. index [i] gives the offset to
  // request to fetch page i. index [0] is always 0. each completed fetch
  // pushes the next cursor so backwards navigation can replay the same
  // page boundaries even if pageSize was changed mid-walk (pageSize
  // change resets the array).
  const unassignedPageOffsetsByHub = new Map<string, number[]>();
  // page size used to compute each entry in unassignedPageOffsetsByHub.
  // tracked so a size change can invalidate the cached cursors.
  const unassignedPageSizeAnchorByHub = new Map<string, number>();
  // ids of album+artist nodes merged for the currently-displayed page.
  // removed before the next page is merged so the canvas swaps pages
  // cleanly instead of accumulating every page's nodes.
  const unassignedPageNodeIdsByHub = new Map<string, string[]>();
  const relatedArtistsLoadedByPivot = new Set<string>();
  const relatedArtistsFetchPromises = new Map<string, Promise<void>>();
  const entityRelationsLoadedByPivot = new Set<string>();
  const taxonFetchPromises = new Map<string, Promise<void>>();
  type EraBinMeta = {
    value_norm: string;
    label: string;
    min_year: number | null;
    max_year: number | null;
  };
  const eraBinsByHub = new Map<string, EraBinMeta[]>();
  const eraBinAlbumsLoadedByHub = new Set<string>();
  const eraBinAlbumsFetchPromises = new Map<string, Promise<void>>();
  // ids of taxon nodes (value + group) we've merged per hub. used to
  // evict stale nodes/edges on refresh so re-parented taxons drop
  // their old hub-edge instead of stacking a new one alongside it.
  const taxonNodeIdsByHub = new Map<string, Set<string>>();
  const unassignedExhaustedByHub = new Set<string>();
  /** unassigned default pager state when host doesn't supply one. */
  const UNASSIGNED_DEFAULT_PAGE_SIZE = 16;

  const maybeLoadTaxonsForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    if (parsed.kind !== "relation") return;
    if (NON_TAXON_KINDS.has(parsed.relationKind)) return;
    if (taxonsLoadedByHub.has(nodeId)) return;
    const inFlight = taxonFetchPromises.get(nodeId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(nodeId, true);
      try {
        const client = await getClientForRemote(remote);
        const [taxonsResult, parentsResult, fullTaxonsResult] = await Promise.all([
          client.music.queryTaxons({
            kind_slug: parsed.relationKind,
            q: null,
            limit: 1000,
            offset: 0,
          }),
          client.music.listTaxonParentsForKind({ kind_slug: parsed.relationKind }),
          client.music.listTaxonsByKind({ kind_slug: parsed.relationKind }),
        ]);
        if (!taxonsResult.success || !taxonsResult.data) return;
        const remoteId = parsed.remoteId;
        const kind = parsed.relationKind;
        const relHubId = relationHubId(remoteId, kind);

        const childIdSet = new Set<string>();
        const taxonParentOf = new Map<string, string>();
        if (parentsResult.success && parentsResult.data) {
          for (const edge of parentsResult.data) {
            childIdSet.add(edge.parent_id);
            taxonParentOf.set(edge.child_id, edge.parent_id);
          }
        }
        taxonParentsByHub.set(relHubId, new Map(taxonParentOf));

        const taxonColorById = new Map<string, string>();
        if (fullTaxonsResult.success && fullTaxonsResult.data) {
          for (const t of fullTaxonsResult.data) {
            if (t.color) taxonColorById.set(t.id, t.color);
          }
        }

        const taxonById = new Map<string, { id: string; label: string }>();
        for (const item of taxonsResult.data.items) {
          taxonById.set(item.id, { id: item.id, label: item.label });
        }
        const labelMap = new Map<string, string>();
        for (const item of taxonsResult.data.items) labelMap.set(item.id, item.label);
        taxonLabelsByHub.set(relHubId, labelMap);

        let cache = taxonItemsByHub.get(relHubId);
        if (!cache) {
          cache = new Map();
          taxonItemsByHub.set(relHubId, cache);
        } else {
          // refresh: drop stale entries so removed/renamed taxons don't
          // linger in the cache used by typeahead + chip rendering.
          cache.clear();
        }
        const addNodes: WalkNode[] = [];
        const addEdges: WalkEdge[] = [];
        const freshNodeIds = new Set<string>();
        for (const item of taxonsResult.data.items) {
          cache.set(slug(item.label), {
            id: item.id,
            label: item.label,
            albumCount: item.album_count,
          });
          const isGroup = childIdSet.has(item.id);
          // hide empty leaf taxons in read mode; show them in edit mode
          // so newly-created placeholders are visible immediately.
          if (!isGroup && item.album_count <= 0 && !editMode?.()) continue;
          const taxonNodeId = isGroup
            ? groupNodeId(remoteId, kind, item.label)
            : valueNodeId(remoteId, kind, item.label);
          freshNodeIds.add(taxonNodeId);

          addNodes.push({
            id: taxonNodeId,
            role: isGroup ? "group" : "value",
            label:
              item.label && item.label.trim().length > 0
                ? item.label
                : (item.slug ?? item.id).replace(/_/g, " "),
            parentId: relHubId,
            childCount: item.album_count,
            lazy: true,
            tint: isGroup ? (taxonColorById.get(item.id) ?? undefined) : undefined,
          });

          const parentTaxonId = taxonParentOf.get(item.id);
          const parentTaxon = parentTaxonId ? taxonById.get(parentTaxonId) : undefined;
          const edgeSource = parentTaxon
            ? groupNodeId(remoteId, kind, parentTaxon.label)
            : relHubId;
          addEdges.push({ source: edgeSource, target: taxonNodeId });
        }
        // evict any node ids we'd previously merged for this hub.
        // we ALWAYS drop them — even ids that re-appear in the fresh
        // set — because role and edge source may have changed (e.g.
        // a value got promoted to a group, or a child got a new
        // taxon parent). the subsequent merge re-adds them with the
        // correct topology.
        const prevNodeIds = taxonNodeIdsByHub.get(relHubId);
        if (prevNodeIds && prevNodeIds.size > 0) {
          walkerClient()?.remove(Array.from(prevNodeIds));
        }
        taxonNodeIdsByHub.set(relHubId, freshNodeIds);
        walkerClient()?.merge(addNodes, addEdges);
        onHubRefreshed?.(relHubId);
        taxonsLoadedByHub.add(nodeId);
      } catch (err) {
        console.warn("lazy taxon fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(nodeId, false);
        taxonFetchPromises.delete(nodeId);
      }
    })();
    taxonFetchPromises.set(nodeId, promise);
    return promise;
  };

  const maybeLoadEraBinsForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    let remoteId: string;
    if (parsed.kind === "relation" && parsed.relationKind === "era") {
      remoteId = parsed.remoteId;
    } else if (parsed.kind === "remote") {
      remoteId = parsed.remoteId;
    } else {
      return;
    }
    const relHubId = relationHubId(remoteId, "era");
    if (eraBinsLoadedByHub.has(relHubId)) return;
    const inFlight = eraBinsFetchPromises.get(relHubId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(remoteId) === true) return;
    const remote = remotes().find((r) => r.remote_id === remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(relHubId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.eraBins({
          target_min: null,
          target_max: null,
        });
        if (!result.success || !result.data) return;
        const bins: EraBinMeta[] = [];
        const addNodes: WalkNode[] = [];
        const addEdges: WalkEdge[] = [];
        const liveBins = result.data.bins.filter((b) => b.count > 0);
        if (liveBins.length === 0) {
          eraBinsLoadedByHub.add(relHubId);
          return;
        }
        const rhId = remoteHubId(remoteId);
        const totalEraAlbums = liveBins.reduce((s, b) => s + b.count, 0);
        addNodes.push({
          id: relHubId,
          role: "relation",
          label: "era",
          parentId: rhId,
          childCount: totalEraAlbums,
          lazy: true,
        });
        addEdges.push({ source: rhId, target: relHubId });
        for (const bin of liveBins) {
          const valId = valueNodeId(remoteId, "era", bin.value_norm);
          addNodes.push({
            id: valId,
            role: "value",
            label: bin.label,
            parentId: relHubId,
            childCount: bin.count,
            lazy: true,
          });
          addEdges.push({ source: relHubId, target: valId });
          bins.push({
            value_norm: bin.value_norm,
            label: bin.label,
            min_year: bin.min_year ?? null,
            max_year: bin.max_year ?? null,
          });
        }
        eraBinsByHub.set(relHubId, bins);

        const albums = nodesByRemote().get(remoteId) ?? [];
        for (const album of albums) {
          if (album.year == null) continue;
          const bin = bins.find(
            (b) =>
              b.min_year != null &&
              b.max_year != null &&
              album.year! >= b.min_year &&
              album.year! <= b.max_year
          );
          if (!bin) continue;
          const valId = valueNodeId(remoteId, "era", bin.value_norm);
          const prefix = `${remoteId}::`;
          const bareAlbumId = album.id.startsWith(prefix)
            ? album.id.slice(prefix.length)
            : album.id;
          addEdges.push({
            source: valId,
            target: `album::${remoteId}::${bareAlbumId}`,
          });
        }

        walkerClient()?.merge(addNodes, addEdges);
        eraBinsLoadedByHub.add(relHubId);
      } catch (err) {
        console.warn("lazy era-bins fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(relHubId, false);
        eraBinsFetchPromises.delete(relHubId);
      }
    })();
    eraBinsFetchPromises.set(relHubId, promise);
    return promise;
  };

  const maybeLoadAlbumsForEraBin = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    if (parsed.kind !== "value" || parsed.relationKind !== "era") return;
    if (eraBinAlbumsLoadedByHub.has(nodeId)) return;
    const inFlight = eraBinAlbumsFetchPromises.get(nodeId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    const relHubId = relationHubId(parsed.remoteId, "era");
    const bins = eraBinsByHub.get(relHubId);
    const bin = bins?.find((b) => b.value_norm === parsed.valueSlug);
    if (!bin || bin.min_year == null || bin.max_year == null) return;
    const promise = (async () => {
      setFetchingNodeFlag(nodeId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.eraAlbums({
          min_year: bin.min_year!,
          max_year: bin.max_year!,
          limit: null,
          offset: null,
        });
        if (!result.success || !result.data) return;
        const remoteId = parsed.remoteId;
        const adapted: AlbumNodeData[] = result.data.albums.map((item) =>
          adaptQueryAlbumItem(item, remote)
        );
        appendAlbumsToRemote(remoteId, adapted);
        const addEdges: WalkEdge[] = [];
        const prefix = `${remoteId}::`;
        const seenArtists = new Set<string>();
        for (const album of adapted) {
          const bareAlbumId = album.id.startsWith(prefix)
            ? album.id.slice(prefix.length)
            : album.id;
          addEdges.push({
            source: nodeId,
            target: `album::${remoteId}::${bareAlbumId}`,
          });
          if (album.artistId && !seenArtists.has(album.artistId)) {
            seenArtists.add(album.artistId);
            addEdges.push({
              source: nodeId,
              target: `artist::${remoteId}::${album.artistId}`,
            });
          }
        }
        walkerClient()?.merge([], addEdges);
        eraBinAlbumsLoadedByHub.add(nodeId);
      } catch (err) {
        console.warn("lazy era-bin albums fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(nodeId, false);
        eraBinAlbumsFetchPromises.delete(nodeId);
      }
    })();
    eraBinAlbumsFetchPromises.set(nodeId, promise);
    return promise;
  };

  const maybeLoadRecentlyAddedForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    let remoteId: string;
    if (parsed.kind === "relation" && parsed.relationKind === "recently_added") {
      remoteId = parsed.remoteId;
    } else if (parsed.kind === "remote") {
      remoteId = parsed.remoteId;
    } else {
      return;
    }
    const relHubId = relationHubId(remoteId, "recently_added");
    if (recentlyAddedLoadedByHub.has(relHubId)) return;
    const inFlight = recentlyAddedFetchPromises.get(relHubId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(remoteId) === true) return;
    const remote = remotes().find((r) => r.remote_id === remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(relHubId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.recentlyAddedAlbums({ limit: null });
        if (!result.success || !result.data) return;
        if (result.data.albums.length === 0) {
          recentlyAddedLoadedByHub.add(relHubId);
          return;
        }
        const adapted: AlbumNodeData[] = result.data.albums.map((item) =>
          adaptQueryAlbumItem(item, remote)
        );
        appendAlbumsToRemote(remoteId, adapted);
        const rhId = remoteHubId(remoteId);
        const addNodes: WalkNode[] = [
          {
            id: relHubId,
            role: "relation",
            label: "recently added",
            parentId: rhId,
            childCount: adapted.length,
            lazy: true,
          },
        ];
        const addEdges: WalkEdge[] = [{ source: rhId, target: relHubId }];
        const prefix = `${remoteId}::`;
        const seenArtists = new Set<string>();
        for (const album of adapted) {
          const bareAlbumId = album.id.startsWith(prefix)
            ? album.id.slice(prefix.length)
            : album.id;
          addEdges.push({
            source: relHubId,
            target: `album::${remoteId}::${bareAlbumId}`,
          });
          if (album.artistId && !seenArtists.has(album.artistId)) {
            seenArtists.add(album.artistId);
            addEdges.push({
              source: relHubId,
              target: `artist::${remoteId}::${album.artistId}`,
            });
          }
        }
        walkerClient()?.merge(addNodes, addEdges);
        recentlyAddedLoadedByHub.add(relHubId);
      } catch (err) {
        console.warn("lazy recently-added fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(relHubId, false);
        recentlyAddedFetchPromises.delete(relHubId);
      }
    })();
    recentlyAddedFetchPromises.set(relHubId, promise);
    return promise;
  };

  const maybeLoadUnassignedForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    let remoteId: string;
    if (parsed.kind === "relation" && parsed.relationKind === "unassigned") {
      remoteId = parsed.remoteId;
    } else if (parsed.kind === "remote") {
      remoteId = parsed.remoteId;
    } else {
      return;
    }
    const relHubId = relationHubId(remoteId, "unassigned");
    if (unassignedLoadedByHub.has(relHubId)) return;
    return loadUnassignedPage(relHubId);
  };

  const loadUnassignedPage = async (relHubId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(relHubId);
    } catch {
      return;
    }
    if (parsed.kind !== "relation" || parsed.relationKind !== "unassigned") return;
    const remoteId = parsed.remoteId;
    if (offlineByRemote().get(remoteId) === true) return;
    const remote = remotes().find((r) => r.remote_id === remoteId);
    if (!remote) return;

    const inFlight = unassignedFetchPromises.get(relHubId);
    if (inFlight) return inFlight;

    const requested = getUnassignedPagerState?.(relHubId);
    const pageSize = Math.max(1, requested?.pageSize ?? UNASSIGNED_DEFAULT_PAGE_SIZE);
    const pageIndex = Math.max(0, requested?.pageIndex ?? 0);

    // page-size change invalidates cached page offsets (the boundaries
    // were computed for a different size). reset everything; the host
    // is expected to clamp pageIndex to 0 on size change as well.
    if (unassignedPageSizeAnchorByHub.get(relHubId) !== pageSize) {
      unassignedPageOffsetsByHub.set(relHubId, [0]);
      unassignedPageSizeAnchorByHub.set(relHubId, pageSize);
      unassignedExhaustedByHub.delete(relHubId);
    }
    const cursors = unassignedPageOffsetsByHub.get(relHubId) ?? [0];
    // can't jump ahead past the furthest fetched cursor
    const clampedPage = Math.min(pageIndex, cursors.length - 1);
    const rawOffset = cursors[clampedPage];
    // overfetch headroom so the per-artist-trim has whole blocks to
    // choose from. fetch enough to comfortably fit pageSize even when
    // the last artist on a page has many records.
    const requestLimit = Math.max(pageSize * 2, pageSize + 16);

    const promise = (async () => {
      setFetchingNodeFlag(relHubId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.unassignedAlbums({
          kind_slug: null,
          limit: requestLimit,
          offset: rawOffset,
        });
        if (!result.success || !result.data) return;
        const albums = result.data.albums;
        const total = result.data.count;

        // group albums by artist (first-seen order). then take whole
        // artist blocks until the page is full; always take at least
        // the first block so we advance even when one artist owns more
        // unassigned albums than fits in pageSize.
        type RawAlbum = typeof albums[number];
        const blocks: { artistKey: string; rows: RawAlbum[] }[] = [];
        const blockIndex = new Map<string, number>();
        for (const item of albums) {
          const key = item.artist?.id ?? `__no_artist__::${item.album.id}`;
          let i = blockIndex.get(key);
          if (i === undefined) {
            i = blocks.length;
            blockIndex.set(key, i);
            blocks.push({ artistKey: key, rows: [] });
          }
          blocks[i].rows.push(item);
        }
        const taken: RawAlbum[] = [];
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          if (taken.length === 0 || taken.length + block.rows.length <= pageSize) {
            for (const row of block.rows) taken.push(row);
          } else {
            break;
          }
        }
        const consumed = taken.length;

        // remove the prior page's album+artist nodes so the swap is
        // clean (and so re-paginating doesn't accumulate). breadcrumb /
        // pivot ids are protected by the worker's remove() logic.
        const prevIds = unassignedPageNodeIdsByHub.get(relHubId);
        if (prevIds && prevIds.length > 0) {
          walkerClient()?.remove(prevIds);
        }

        // exhausted: server returned strictly fewer rows than requested
        // (we asked for more than pageSize). no more pages after this.
        const hasNext = albums.length > consumed || albums.length === requestLimit;
        if (!hasNext) {
          unassignedExhaustedByHub.add(relHubId);
        } else {
          unassignedExhaustedByHub.delete(relHubId);
          cursors[clampedPage + 1] = rawOffset + consumed;
        }
        unassignedPageOffsetsByHub.set(relHubId, cursors);
        unassignedLoadedByHub.add(relHubId);

        const rhId = remoteHubId(remoteId);
        const addNodes: WalkNode[] = [
          {
            id: relHubId,
            role: "relation",
            label: "unassigned",
            parentId: rhId,
            childCount: total,
            lazy: true,
          },
        ];
        const addEdges: WalkEdge[] = [{ source: rhId, target: relHubId }];
        const prefix = `${remoteId}::`;
        const seenArtists = new Set<string>();
        const pageNodeIds: string[] = [];
        if (consumed > 0) {
          const adapted: AlbumNodeData[] = taken.map((item) => adaptQueryAlbumItem(item, remote));
          appendAlbumsToRemote(remoteId, adapted);
          for (const album of adapted) {
            const bareAlbumId = album.id.startsWith(prefix)
              ? album.id.slice(prefix.length)
              : album.id;
            const albumNodeId = `album::${remoteId}::${bareAlbumId}`;
            addEdges.push({ source: relHubId, target: albumNodeId });
            pageNodeIds.push(albumNodeId);
            if (album.artistId && !seenArtists.has(album.artistId)) {
              seenArtists.add(album.artistId);
              const artistNodeIdStr = `artist::${remoteId}::${album.artistId}`;
              addEdges.push({ source: relHubId, target: artistNodeIdStr });
              pageNodeIds.push(artistNodeIdStr);
            }
          }
        }
        unassignedPageNodeIdsByHub.set(relHubId, pageNodeIds);
        walkerClient()?.merge(addNodes, addEdges);
        onUnassignedPageInfo?.(relHubId, {
          total,
          pageIndex: clampedPage,
          pageSize,
          consumed,
          hasNext,
        });
      } catch (err) {
        console.warn("lazy unassigned-albums fetch failed", { relHubId, err });
      } finally {
        setFetchingNodeFlag(relHubId, false);
        unassignedFetchPromises.delete(relHubId);
      }
    })();
    unassignedFetchPromises.set(relHubId, promise);
    return promise;
  };

  const reloadUnassignedPage = (relHubId: string): Promise<void> => {
    // host requested a re-fetch (page nav or size change). drop the
    // loaded flag so the next call to maybeLoad/loadUnassignedPage
    // re-runs the fetch instead of treating it as already done.
    unassignedLoadedByHub.delete(relHubId);
    return loadUnassignedPage(relHubId);
  };

  const filterForValuePivot = (
    relHubId: string,
    relationKind: RelationKind,
    valueSlug: string
  ): Record<string, unknown> | null => {
    const taxon = taxonItemsByHub.get(relHubId)?.get(valueSlug);
    if (!taxon) return null;
    switch (relationKind) {
      case "genre":
        return { genre_id: taxon.id };
      case "tag":
        return { include_tags: [taxon.label] };
      case "era":
      case "recently_added":
      case "favorites":
        return null;
      case "mood":
      case "style":
      case "label":
      default:
        return { taxon_ids: [taxon.id] };
    }
  };

  const adaptQueryAlbumItem = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item: any,
    remote: Remote
  ): AlbumNodeData => {
    const baseUrl = (remote as { base_url?: string }).base_url ?? "";
    const remoteId = remote.remote_id;
    const summary: AlbumSummary = {
      album_id: item.album.id,
      title: item.album.title,
      artist_id: item.artist?.id ?? "",
      artist_name: item.artist?.name ?? "unknown artist",
      album_type: item.album.album_type,
      year: undefined,
      release_date: item.album.release_date ?? undefined,
      label: item.album.label ?? undefined,
      genres: item.album.genres ?? undefined,
      song_count: item.album.song_count,
      total_duration: item.album.total_duration,
      images:
        item.images && item.images.length > 0
          ? item.images.map((img: unknown) => adaptApiImage(img as never, baseUrl, remoteId))
          : undefined,
      urls: adaptApiUrls(item.album.urls),
      is_favorite: item.is_favorite ?? undefined,
      user_rating: item.rating ?? undefined,
      tags: item.album_tags ?? undefined,
      created_at: item.album.created_at,
      updated_at: item.album.updated_at,
      created_by_username: item.album.created_by_username ?? undefined,
      updated_by_username: item.album.updated_by_username ?? undefined,
      metadata: item.album.metadata ?? null,
      mb_lookup_status: item.album.mb_lookup_status ?? null,
      mb_lookup_at: item.album.mb_lookup_at ?? null,
      mb_lookup_by: item.album.mb_lookup_by ?? null,
    };
    return adaptAlbum(summary, { remoteId });
  };

  const maybeLoadAlbumsForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    if (parsed.kind !== "value" && parsed.kind !== "group" && parsed.kind !== "artist") return;
    if (albumsLoadedByPivot.has(nodeId)) return;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;

    let filters: Record<string, unknown> | null = null;
    if (parsed.kind === "value" || parsed.kind === "group") {
      const relHubId = relationHubId(parsed.remoteId, parsed.relationKind);
      if (!taxonItemsByHub.has(relHubId)) {
        await maybeLoadTaxonsForPivot(relHubId);
      }
      filters = filterForValuePivot(relHubId, parsed.relationKind, parsed.valueSlug);
      if (!filters) return;
    } else {
      filters = { artist_id: parsed.artistId };
    }

    albumsLoadedByPivot.add(nodeId);
    setFetchingNodeFlag(nodeId, true);
    try {
      const client = await getClientForRemote(remote);
      const result = await client.music.queryAlbums({
        q: null,
        search_fields: null,
        filters,
        sort_by: null,
        sort_direction: null,
        limit: 500,
        offset: 0,
        user_id: null,
        favorites_only: null,
        min_rating: null,
      });
      if (!result.success || !result.data) return;
      const adapted: AlbumNodeData[] = [];
      for (const item of result.data.items) {
        adapted.push(adaptQueryAlbumItem(item, remote));
      }
      appendAlbumsToRemote(remote.remote_id, adapted);
      if (parsed.kind === "value") {
        const remoteId = parsed.remoteId;
        const prefix = `${remoteId}::`;
        const addEdges: WalkEdge[] = [];
        const seenArtists = new Set<string>();
        for (const album of adapted) {
          const bareAlbumId = album.id.startsWith(prefix)
            ? album.id.slice(prefix.length)
            : album.id;
          addEdges.push({
            source: nodeId,
            target: `album::${remoteId}::${bareAlbumId}`,
          });
          if (album.artistId && !seenArtists.has(album.artistId)) {
            seenArtists.add(album.artistId);
            addEdges.push({
              source: nodeId,
              target: `artist::${remoteId}::${album.artistId}`,
            });
          }
        }
        if (addEdges.length > 0) walkerClient()?.merge([], addEdges);
      }
    } catch (err) {
      console.warn("lazy album fetch failed", { nodeId, err });
      albumsLoadedByPivot.delete(nodeId);
    } finally {
      setFetchingNodeFlag(nodeId, false);
    }
  };

  const findArtistNodeId = (artistId: string): string | null => {
    for (const map of [buildResult()?.nodesById, extraNodesById()] as const) {
      if (!map) continue;
      for (const [id, node] of map) {
        if ("artistId" in node && (node as ArtistNodeData).artistId === artistId) return id;
      }
    }
    return null;
  };

  const maybeLoadRelatedArtistsForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    if (parsed.kind !== "artist") return;
    if (relatedArtistsLoadedByPivot.has(nodeId)) return;
    const inFlight = relatedArtistsFetchPromises.get(nodeId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(nodeId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.listRelatedArtists({
          artist_id: parsed.artistId,
          include_pending: true,
          include_incoming: true,
        });
        if (!result.success || !result.data) return;
        const remoteId = parsed.remoteId;
        const byNameSameRemote = new Map<string, string>();
        const sameRemotePrefix = `artist::${remoteId}::`;
        const maps = [buildResult()?.nodesById, extraNodesById()] as const;
        for (const map of maps) {
          if (!map) continue;
          for (const [id, n] of map) {
            if (!("artistId" in n)) continue;
            if (!id.startsWith(sameRemotePrefix)) continue;
            const a = n as ArtistNodeData;
            const k = slug(a.name);
            if (!k) continue;
            if (!byNameSameRemote.has(k)) byNameSameRemote.set(k, id);
          }
        }
        const addNodes: WalkNode[] = [];
        const addEdges: WalkEdge[] = [];
        const seen = new Set<string>();
        const pushEdge = (targetId: string, isPending: boolean) => {
          if (targetId === nodeId) return;
          const key = `${nodeId}::${targetId}`;
          if (seen.has(key)) return;
          seen.add(key);
          addEdges.push({ source: nodeId, target: targetId, isRelatedArtist: true, isPending });
          if (!targetId.startsWith("ghost_artist::")) {
            recordRelatedEdge(nodeId, targetId, isPending ? "pending" : "accepted");
          }
        };
        for (const row of result.data.items) {
          const nameKey = slug(row.related_name ?? "");
          const isPending = row.status === "pending";
          if (row.in_library && row.related_artist_id) {
            const explicit = artistNodeId(remoteId, row.related_artist_id);
            const existsExplicit =
              buildResult()?.nodesById.has(explicit) === true || extraNodesById().has(explicit);
            if (existsExplicit) {
              pushEdge(explicit, isPending);
              continue;
            }
          }
          if (nameKey) {
            const matched = byNameSameRemote.get(nameKey);
            if (matched) {
              pushEdge(matched, isPending);
              continue;
            }
          }
          if (nameKey && row.related_name) {
            const ghostId = ghostArtistId(row.related_name);
            if (ghostId === nodeId) continue;
            addNodes.push({
              id: ghostId,
              role: "ghost_artist",
              label: row.related_name,
              parentId: nodeId,
              childCount: 0,
            });
            pushEdge(ghostId, isPending);
          }
        }
        if (addNodes.length > 0 || addEdges.length > 0) {
          walkerClient()?.merge(addNodes, addEdges);
        }
        console.info("[graph] related-artists merged", {
          pivot: nodeId,
          totalRows: result.data.items.length,
          addedNodes: addNodes.length,
          addedEdges: addEdges.length,
        });
        relatedArtistsLoadedByPivot.add(nodeId);
      } catch (err) {
        console.warn("lazy related-artists fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(nodeId, false);
        relatedArtistsFetchPromises.delete(nodeId);
      }
    })();
    relatedArtistsFetchPromises.set(nodeId, promise);
    return promise;
  };

  const maybeLoadRelationsForEntityPivot = (nodeId: string): void => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    if (parsed.kind !== "artist" && parsed.kind !== "album") return;
    if (entityRelationsLoadedByPivot.has(nodeId)) return;
    const node = lookupNode(nodeId);
    if (!node) return;
    const remoteId = parsed.remoteId;
    const pairs: Array<{ kind: RelationKind; label: string }> = [];
    const pushAll = (kind: RelationKind, labels: readonly string[] | undefined) => {
      if (!labels) return;
      for (const l of labels) {
        if (l && l.trim().length > 0) pairs.push({ kind, label: l });
      }
    };
    pushAll("genre", node.genres);
    pushAll("mood", node.moods);
    pushAll("style", node.styles);
    if (node.tags) {
      for (const t of node.tags) {
        if (t.label && t.label.trim().length > 0) pairs.push({ kind: "tag", label: t.label });
      }
    }
    if (node.label) pushAll("label", [node.label]);
    if (node.era) pushAll("era", [node.era]);
    if (node.customTaxons) {
      for (const [kindSlug, labels] of Object.entries(node.customTaxons)) {
        pushAll(kindSlug as RelationKind, labels);
      }
    }
    if (pairs.length === 0) {
      entityRelationsLoadedByPivot.add(nodeId);
      return;
    }
    const seenKinds = new Set<RelationKind>();
    for (const { kind } of pairs) {
      if (seenKinds.has(kind)) continue;
      seenKinds.add(kind);
      void maybeLoadTaxonsForPivot(relationHubId(remoteId, kind));
    }
    const addEdges: WalkEdge[] = [];
    const seenEdges = new Set<string>();
    for (const { kind, label } of pairs) {
      const valId = valueNodeId(remoteId, kind, slug(label));
      const key = `${valId}::${nodeId}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      addEdges.push({ source: valId, target: nodeId });
    }
    if (addEdges.length > 0) walkerClient()?.merge([], addEdges);
    entityRelationsLoadedByPivot.add(nodeId);
  };

  const triggerPivotLoaders = (nodeId: string) => {
    if (searchMode?.()) {
      // in search-mode the only loader we want is the value-pivot album
      // drill-in (scoped to the clicked node). every other loader fans
      // out full library context that wasn't part of the search hit set
      // and would visually "reset" the curated subgraph.
      void maybeLoadAlbumsForPivot(nodeId);
      return;
    }
    void maybeLoadTaxonsForPivot(nodeId);
    void maybeLoadEraBinsForPivot(nodeId);
    void maybeLoadAlbumsForEraBin(nodeId);
    void maybeLoadRecentlyAddedForPivot(nodeId);
    void maybeLoadUnassignedForPivot(nodeId);
    void maybeLoadAlbumsForPivot(nodeId);
    void maybeLoadRelatedArtistsForPivot(nodeId);
    void maybeLoadRelationsForEntityPivot(nodeId);
  };

  const handlePivot = (nodeId: string) => {
    if (!lookupNode(nodeId)) {
      let isTaxonNode = false;
      try {
        const p = parseNodeId(nodeId);
        isTaxonNode =
          p.kind === "value" ||
          p.kind === "group" ||
          p.kind === "relation" ||
          p.kind === "remote";
      } catch {
        // non-parseable id — treat as hub pivot
      }
      if (!isTaxonNode) setSelectedId(null);
    }
    triggerPivotLoaders(nodeId);
  };

  const pivotKeepingPanel = (nodeId: string) => {
    walkerClient()?.expand(nodeId);
    triggerPivotLoaders(nodeId);
  };

  // clear every internal dedup/cache map that tracks nodes/edges merged
  // into the worker. called by the host after `walkerClient.init()` (a
  // full worker reset wipes the merged taxon/era/unassigned/related
  // overlays — without this, the dedup sets below would still say
  // "already loaded" and the loaders would never re-emit them).
  const resetMergedState = () => {
    eraBinsLoadedByHub.clear();
    eraBinsFetchPromises.clear();
    eraBinsByHub.clear();
    eraBinAlbumsLoadedByHub.clear();
    eraBinAlbumsFetchPromises.clear();
    recentlyAddedLoadedByHub.clear();
    recentlyAddedFetchPromises.clear();
    unassignedLoadedByHub.clear();
    unassignedFetchPromises.clear();
    unassignedPageOffsetsByHub.clear();
    unassignedPageSizeAnchorByHub.clear();
    unassignedPageNodeIdsByHub.clear();
    unassignedExhaustedByHub.clear();
    relatedArtistsLoadedByPivot.clear();
    relatedArtistsFetchPromises.clear();
    entityRelationsLoadedByPivot.clear();
    taxonFetchPromises.clear();
    taxonNodeIdsByHub.clear();
  };

  return {
    handlePivot,
    pivotKeepingPanel,
    findArtistNodeId,
    maybeLoadTaxonsForPivot,
    maybeLoadAlbumsForPivot,
    maybeLoadRelatedArtistsForPivot,
    reloadUnassignedPage,
    resetMergedState,
  };
}
