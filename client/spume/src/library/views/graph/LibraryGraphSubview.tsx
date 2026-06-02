// LibraryGraphSubview
//
// real graph subview using the bloom-walk explorer.
// fans RemoteAlbumsLoader over every provided remote, builds a WalkGraph
// via buildWalkGraph, and drives WalkCanvas with incremental merge so
// large libraries stream in without restarting the sim from scratch.
//
// dropped in this phase (v1):
//   - bulk-tag lasso (S7): props kept, callbacks no-op
//   - related-artist edges (S8)
//   - recently-added hub (S9)
//   - in-canvas remote selection toggle: all props.remotes are loaded
//   - full drilldown state machine (root/relation_values/entities tiers)
//
// the graph visualises ALL provided remotes as disconnected sub-trees
// hanging off the root node. cross-remote artist matching (slug-based
// amber dashed wires) is handled by the existing crossRemoteEdges logic
// inside the worker.

import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { useTopNavSlots } from "../../../app/shell/topNavSlots";
import { deriveArtistNodes } from "./deriveArtistNodes";
import { RemoteAlbumsLoader } from "./graphSubview/RemoteAlbumsLoader";
import { pickPrimaryImage, buildImageUrls, fetchAlbumSongs } from "./graphSubview/helpers";
import { useArtistClusterIndex } from "./graphSubview/useArtistClusterIndex";
import {
  CollapsedAlbumButton,
  CollapsedArtistButton,
  CollapsedTaxonButton,
  CollapsedRemoteButton,
} from "./graphSubview/CollapsedPanels";
import { createSelectedArtistDisplay } from "./graphSubview/useSelectedArtistDisplay";
import { createContributingRemotes } from "./graphSubview/useContributingRemotes";
import { createCrossRemoteLazyLoading } from "./graphSubview/useCrossRemoteLazyLoading";
import { createPivotHandler } from "./graphSubview/createPivotHandler";
import { createEditModeHandlers } from "./graphSubview/editModeHandlers";
import { createBulkHandlers } from "./graphSubview/bulkHandlers";
import { addToQueue, playQueue } from "../../../music/services/queue/queue";
import { routes, getDefaultRoute } from "../../../music/utils/routing";
import { useToggleFavoriteMutation } from "../../../music/queries/favorites";
import { toast } from "../../../components/feedback/Toast";
import { isNarrowViewport } from "../../../config/breakpoints";
import { setPageInfo, clearPageInfo } from "../../../app/services/pageInfo";
import type { AlbumNodeData, ArtistNodeData } from "../../../components/graph/types";
import { useRemoteIsAdminMulti } from "../../hooks/useRemoteRole";
import {
  showAlbumEditor,
  showArtistEditor,
  isAnyModalOpen,
  showImageCarousel,
  formatImageCarouselTitle,
} from "../../../music/hooks/modals";
import { getArtistAbbreviation } from "../../../music/utils/format";
import type { ImageMetadata } from "../../../music/services/storage/types";
import WalkCanvas from "../../../components/graph/WalkCanvas";
import type { WalkApi } from "../../../components/graph/WalkCanvas";
import type { WalkerClient } from "../../../components/graph/worker/client";
import { GraphTopNavTools } from "../../../components/graph/GraphTopNavTools";
import { GraphTopNavSearch } from "./GraphTopNavSearch";
import { buildWalkGraph } from "../../../components/graph/data/buildWalkGraph";
import {
  rootId,
  parseNodeId,
  slug,
  remoteHubId,
  relationHubId,
  valueNodeId,
  groupNodeId,
  artistNodeId,
  type RelationKind,
} from "../../../components/graph/data/nodeIds";
import type { WalkNode, WalkEdge } from "../../../components/graph/types";
import { getClientForRemote } from "../../../app/api/client";
import {
  checkRemoteHealth,
  onRemoteStatusChange,
  getRemoteById,
} from "../../../app/services/remotes/remoteManager";
import { adaptApiImage } from "../../../music/data/remote/adapters";
import { AlbumDetailPopover } from "../../../components/graph/AlbumDetailPopover";
import { ArtistDetailPopover } from "../../../components/graph/ArtistDetailPopover";
import { TaxonDetailPopover } from "../../../components/graph/TaxonDetailPopover";
import { RemoteDetailPopover } from "../../../components/graph/RemoteDetailPopover";
import { BulkSelectionPopover } from "../../../components/graph/BulkSelectionPopover";
import { GraphEditPanel } from "./graphSubview/GraphEditPanel";
import {
  SimTuningOverlay,
  DEFAULT_TUNING,
  type SimTuningValues,
} from "../../../components/graph/SimTuningOverlay";
import type { TaxonRef, TaxonKind as TaxonKindType } from "freqhole-api-client";
import { Icon } from "../../../components/icons/registry";

// ---- public props -----------------------------------------------------------

export interface LibraryGraphSubviewProps {
  /** every selected remote whose albums should be merged into the graph. */
  remotes: Remote[];
  /** the parent's current subview signal - used to pause the sim when
   *  graph is not visible. */
  isActive: () => boolean;
  /** [no-op] when truthy, locks the canvas into lasso mode.
   *  lasso/bulk-tag dropped in v1, restore later. */
  bulkTagMode?: () => boolean;
  /** [no-op] receives lasso results.
   *  lasso/bulk-tag dropped in v1, restore later. */
  onLassoAlbums?: (remote: Remote, albumIds: string[]) => void;
  /** optional trailing slot for the topnav tools cluster. */
  extraTools?: JSX.Element;
}

// ---- outer shell ------------------------------------------------------------

export function LibraryGraphSubview(props: LibraryGraphSubviewProps) {
  return (
    <Show
      when={props.remotes.length > 0}
      fallback={
        <div
          class="h-full flex items-center justify-center text-[var(--color-text-disabled)] text-xs"
          data-testid="library-graph-placeholder"
        >
          <span>select one or more remotes to load albums</span>
        </div>
      }
    >
      <Inner
        remotes={() => props.remotes}
        isActive={props.isActive}
        bulkTagMode={props.bulkTagMode}
        extraTools={props.extraTools}
      />
    </Show>
  );
}

// ---- inner component --------------------------------------------------------

function Inner(props: {
  remotes: () => Remote[];
  isActive: () => boolean;
  bulkTagMode?: () => boolean;
  extraTools?: JSX.Element;
}) {
  const navigate = useNavigate();
  const slots = useTopNavSlots();
  const queryClient = useQueryClient();
  const favoriteMutation = useToggleFavoriteMutation();

  // search query (phase 6 wires it to topnav search)
  const [searchQuery] = createSignal("");

  // admin state drives edit buttons in popovers. delegated to the
  // canonical multi-remote hook so this view stays in sync with
  // anywhere else that gates on admin role.
  const { isAdmin: isRemoteAdmin, isAnyAdmin: isAnyRemoteAdminMemo } = useRemoteIsAdminMulti(() =>
    props.remotes()
  );
  const isAnyRemoteAdmin = (): boolean => isAnyRemoteAdminMemo();

  // ---- per-remote album store + rAF batcher ---------------------------

  const [nodesByRemote, setNodesByRemote] = createSignal<Map<string, AlbumNodeData[]>>(new Map());
  const [fetchingByRemote, setFetchingByRemote] = createSignal<Map<string, boolean>>(new Map());
  // per-remote offline flag. seeded from Remote.is_offline and kept fresh by
  // checkRemoteHealth + onRemoteStatusChange. offline remotes still appear in
  // the graph (as dimmed remote hubs) but we skip mounting their album loaders
  // so no api requests fan out.
  const [offlineByRemote, setOfflineByRemote] = createSignal<Map<string, boolean>>(new Map());
  // remotes currently being re-checked (debounce + spinner-ish ux for clicks)
  const recheckingRemotes = new Set<string>();
  // remotes whose album loader has been mounted. seeded with the
  // charnel-managed remote (tauri local sidecar) when it exists so we get
  // an instant first render without firing N concurrent fetches; other
  // remotes are mounted on-demand when the user clicks their hub.
  const [activatedRemotes, setActivatedRemotes] = createSignal<Set<string>>(new Set());
  // per-node in-flight loading flag. distinct from fetchingByRemote which
  // tracks the broad initial-page query. used by isLoadingNode so any pivot
  // (relation hub, value, artist...) can paint a comet while its lazy
  // expansion fetch is in flight.
  const [fetchingByNode, setFetchingByNode] = createSignal<Map<string, boolean>>(new Map());
  // song-derived favorite ids per remote. loaded once per activated remote
  // via querySongs({ favorites_only: true }). unioned with album/artist
  // isFavorite flags in buildWalkGraph to build the flat favorite hub.
  const [favSongAlbumIds, setFavSongAlbumIds] = createSignal<Map<string, Set<string>>>(new Map());
  const [favSongArtistIds, setFavSongArtistIds] = createSignal<Map<string, Set<string>>>(new Map());
  const favSongLoadedRemotes = new Set<string>();
  // per-remote "beloved" (all-users favorites aggregate) ids — fetched
  // via listBeloved(). drives the pink beloved hub in buildWalkGraph.
  const [belovedAlbumIds, setBelovedAlbumIds] = createSignal<Map<string, Set<string>>>(new Map());
  const [belovedArtistIds, setBelovedArtistIds] = createSignal<Map<string, Set<string>>>(new Map());
  const belovedLoadedRemotes = new Set<string>();
  // per-remote artist-image cache: artist_id -> primary ImageMetadata.
  // populated lazily on first activation via query_artists; lets the
  // artist graph nodes (deriveArtistNodes only sees albums) and the
  // detail popover prefer real artist primary images over album-cover
  // fallbacks. priority within the artist's images is
  // is_primary === true > blob_type === "original" > first.
  const [artistImagesByRemote, setArtistImagesByRemote] = createSignal<
    Map<string, Map<string, ImageMetadata>>
  >(new Map());
  const artistImagesLoadedRemotes = new Set<string>();
  // remotes for which we've already fetched taxon kinds and seeded
  // first-order relation hubs into the graph.
  const taxonKindsLoadedRemotes = new Set<string>();
  // relation hubs whose query_taxons fetch has settled (success OR error).
  // prevents re-firing on every pivot revisit.
  const taxonsLoadedByHub = new Set<string>();
  // value/artist pivots whose lazy album fetch has been issued. dedup
  // guard for query_albums calls in maybeLoadAlbumsForPivot.
  const albumsLoadedByPivot = new Set<string>();
  // taxon metadata by parent relation hub id -> slug -> { id, label, albumCount }.
  // populated by maybeLoadTaxonsForPivot; used by value-pivot album
  // fetch to look up the original label / taxon id for filter shaping.
  const taxonItemsByHub = new Map<
    string,
    Map<string, { id: string; label: string; albumCount: number }>
  >();
  // parent edges per relation hub: child_taxon_id -> parent_taxon_id.
  // populated by maybeLoadTaxonsForPivot; consulted by edit-mode drag
  // handlers to know which existing parent link to remove on re-parent.
  const taxonParentsByHub = new Map<string, Map<string, string>>();
  // labels per relation hub: taxon_id -> label. lets edit-mode handlers
  // resolve a taxon id back to the value/group node id without a
  // full refetch.
  const taxonLabelsByHub = new Map<string, Map<string, string>>();
  // kind metadata by relation hub id -> { label, color }. populated in
  // loadTaxonKindsForRemote for the taxon detail popover kind chip.
  const taxonKindMetaByHub = new Map<string, { label: string; color: string | null }>();
  // full taxon kind list per remote (categorical + scalar, empty
  // included). populated by loadTaxonKindsForRemote and consumed by
  // the remote detail popover for the "add taxon" kind dropdown.
  const [taxonKindsByRemote, setTaxonKindsByRemote] = createSignal<Map<string, TaxonKindType[]>>(
    new Map()
  );
  const [extraNodesById, setExtraNodesById] = createSignal<
    Map<string, AlbumNodeData | ArtistNodeData>
  >(new Map());
  type LookupState = "loading" | "loaded" | "absent";
  const crossRemoteLookups = new Map<string, LookupState>();

  const setFetchingNodeFlag = (nodeId: string, fetching: boolean) => {
    setFetchingByNode((prev) => {
      const cur = prev.get(nodeId) ?? false;
      if (cur === fetching) return prev;
      const next = new Map(prev);
      if (fetching) next.set(nodeId, true);
      else next.delete(nodeId);
      return next;
    });
  };

  const setFetchingFor = (remoteId: string, fetching: boolean) => {
    setFetchingByRemote((prev) => {
      const cur = prev.get(remoteId) ?? false;
      if (cur === fetching) return prev;
      const next = new Map(prev);
      next.set(remoteId, fetching);
      return next;
    });
  };

  const pendingUpdates = new Map<string, AlbumNodeData[]>();
  let flushScheduled = false;

  const flushPending = () => {
    flushScheduled = false;
    if (pendingUpdates.size === 0) return;
    const batch = new Map(pendingUpdates);
    pendingUpdates.clear();
    setNodesByRemote((prev) => {
      const next = new Map(prev);
      for (const [k, v] of batch) next.set(k, v);
      return next;
    });
  };

  const setNodesFor = (remoteId: string, list: AlbumNodeData[]) => {
    pendingUpdates.set(remoteId, list);
    if (flushScheduled) return;
    flushScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(flushPending);
    } else {
      queueMicrotask(flushPending);
    }
  };

  /** append-merge variant of setNodesFor used by lazy pivot fetches.
   *  dedupes by album node id, preserves the existing list ordering, and
   *  routes through the same rAF batcher so a pending page-1 flush isn't
   *  clobbered by an in-flight pivot fetch. returns the number of new
   *  albums actually added. */
  const appendAlbumsToRemote = (remoteId: string, incoming: AlbumNodeData[]): number => {
    if (incoming.length === 0) return 0;
    // prefer any in-flight pending list (covers the race where page-1
    // landed but its rAF flush hasn't run yet); else fall back to the
    // current signal value.
    const baseline = pendingUpdates.get(remoteId) ?? nodesByRemote().get(remoteId) ?? [];
    const seen = new Set(baseline.map((n) => n.id));
    const out = baseline.slice();
    let added = 0;
    for (const a of incoming) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
      added++;
    }
    if (added === 0) return 0;
    setNodesFor(remoteId, out);
    return added;
  };

  // prune stale remotes when the provided list changes
  createEffect(() => {
    const active = new Set(props.remotes().map((r) => r.remote_id));
    setNodesByRemote((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const k of [...next.keys()]) {
        if (!active.has(k)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setFetchingByRemote((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const k of [...next.keys()]) {
        if (!active.has(k)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setOfflineByRemote((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const k of [...next.keys()]) {
        if (!active.has(k)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // remote set churned — slug-based assumptions are invalid
    crossRemoteLookups.clear();
    setExtraNodesById(new Map());
    // drop lazy-load bookkeeping for stale remotes so re-adding the
    // same remote later triggers a fresh fetch.
    setFetchingByNode((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const k of [...next.keys()]) {
        // node ids carry `::${remoteId}::` for non-root/non-ghost kinds.
        const parts = k.split("::");
        const remoteId = parts[1];
        if (remoteId && !active.has(remoteId)) {
          next.delete(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    for (const hubId of [...taxonsLoadedByHub]) {
      const parts = hubId.split("::");
      const remoteId = parts[1];
      if (remoteId && !active.has(remoteId)) taxonsLoadedByHub.delete(hubId);
    }
    for (const pivotId of [...albumsLoadedByPivot]) {
      const parts = pivotId.split("::");
      const remoteId = parts[1];
      if (remoteId && !active.has(remoteId)) albumsLoadedByPivot.delete(pivotId);
    }
    for (const hubId of [...taxonItemsByHub.keys()]) {
      const parts = hubId.split("::");
      const remoteId = parts[1];
      if (remoteId && !active.has(remoteId)) taxonItemsByHub.delete(hubId);
    }
    for (const hubId of [...taxonParentsByHub.keys()]) {
      const parts = hubId.split("::");
      const remoteId = parts[1];
      if (remoteId && !active.has(remoteId)) taxonParentsByHub.delete(hubId);
    }
    for (const hubId of [...taxonLabelsByHub.keys()]) {
      const parts = hubId.split("::");
      const remoteId = parts[1];
      if (remoteId && !active.has(remoteId)) taxonLabelsByHub.delete(hubId);
    }
  });

  // seed offline flags from Remote.is_offline and run a fresh health check
  // for any remote whose last_checked is stale (or missing). re-runs whenever
  // props.remotes() changes so newly-added remotes get probed.
  const HEALTH_TTL_MS = 30_000;
  createEffect(() => {
    const list = props.remotes();
    // seed signal synchronously so first render gates loaders correctly
    setOfflineByRemote((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const r of list) {
        const flag = r.is_offline === true;
        if (next.get(r.remote_id) !== flag) {
          next.set(r.remote_id, flag);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // kick off async refresh for stale entries
    const now = Date.now();
    for (const r of list) {
      const last = r.last_checked ?? 0;
      if (now - last < HEALTH_TTL_MS) continue;
      void runHealthCheck(r.remote_id);
    }
  });

  // fetch all artists for a remote and cache each one's primary image
  // (per pickPrimaryImage). only the chosen image is stored — the full
  // images[] array stays on the in-flight artistQuery result for the
  // popover carousel. dedup'd by artistImagesLoadedRemotes; refetched
  // implicitly when activatedRemotes flips for a remote.
  const loadArtistImagesForRemote = async (remote: Remote): Promise<void> => {
    try {
      const client = await getClientForRemote(remote);
      const resp = await client.music.queryArtists({
        q: null,
        search_fields: null,
        filters: {},
        sort_by: null,
        sort_direction: null,
        limit: 1000,
        offset: 0,
        user_id: null,
        favorites_only: null,
        min_rating: null,
      });
      if (!resp.success || !resp.data) return;
      const baseUrl = (remote as { base_url?: string }).base_url ?? "";
      const rid = remote.remote_id;
      const byArtistId = new Map<string, ImageMetadata>();
      for (const it of resp.data.items) {
        const apiImages = it.images ?? it.artist.images ?? null;
        if (!apiImages || apiImages.length === 0) continue;
        const adapted = apiImages.map((img) => adaptApiImage(img, baseUrl, rid));
        const best = pickPrimaryImage(adapted);
        if (best) byArtistId.set(it.artist.id, best);
      }
      if (byArtistId.size === 0) return;
      setArtistImagesByRemote((prev) => {
        const next = new Map(prev);
        next.set(rid, byArtistId);
        return next;
      });
    } catch (err) {
      console.warn("artist images fetch failed", { remoteId: remote.remote_id, err });
    }
  };

  const loadFavoriteSongsForRemote = async (remote: Remote): Promise<void> => {
    try {
      const client = await getClientForRemote(remote);
      const result = await client.music.querySongs({
        q: null,
        search_fields: null,
        filters: {},
        favorites_only: true,
        limit: 1000,
        offset: 0,
        sort_by: null,
        sort_direction: null,
        user_id: null,
        min_rating: null,
        mb_lookup_status: null,
      });
      if (!result.success || !result.data) return;
      const albumIds = new Set<string>();
      const artistIds = new Set<string>();
      for (const item of result.data.items) {
        if (item.album?.id) albumIds.add(item.album.id);
        if (item.artist?.id) artistIds.add(item.artist.id);
      }
      setFavSongAlbumIds((prev) => {
        const next = new Map(prev);
        next.set(remote.remote_id, albumIds);
        return next;
      });
      setFavSongArtistIds((prev) => {
        const next = new Map(prev);
        next.set(remote.remote_id, artistIds);
        return next;
      });
    } catch (err) {
      console.warn("song favorites fetch failed", { remoteId: remote.remote_id, err });
    }
  };

  // fetch "beloved" (all-users favorites aggregate) ids for a remote.
  // backend returns the distinct union of album/artist ids favorited
  // by any user (direct + song-derived). drives the pink beloved hub.
  const loadBelovedForRemote = async (remote: Remote): Promise<void> => {
    if (belovedLoadedRemotes.has(remote.remote_id)) return;
    belovedLoadedRemotes.add(remote.remote_id);
    try {
      const client = await getClientForRemote(remote);
      const result = await client.music.listBeloved({});
      if (!result.success || !result.data) return;
      const albumIds = new Set<string>(result.data.album_ids);
      const artistIds = new Set<string>(result.data.artist_ids);
      setBelovedAlbumIds((prev) => {
        const next = new Map(prev);
        next.set(remote.remote_id, albumIds);
        return next;
      });
      setBelovedArtistIds((prev) => {
        const next = new Map(prev);
        next.set(remote.remote_id, artistIds);
        return next;
      });
    } catch (err) {
      console.warn("beloved fetch failed", { remoteId: remote.remote_id, err });
    }
  };

  // fetch taxon kinds for a remote and seed first-order relation hub
  // nodes (one per categorical user-defined kind). favorites is still
  // emitted by buildWalkGraph (per-user flag, no taxon_kindz row).
  // era and recently_added are now returned by list_taxon_kinds.
  const loadTaxonKindsForRemote = async (remote: Remote): Promise<void> => {
    try {
      const client = await getClientForRemote(remote);
      const result = await client.music.listTaxonKinds();
      if (!result.success || !result.data) return;
      const remoteId = remote.remote_id;
      // stash the full kind list (categorical + scalar, empties
      // included) so the remote detail popover can drive its "add
      // taxon" kind dropdown without an extra round-trip.
      setTaxonKindsByRemote((prev) => {
        const next = new Map(prev);
        next.set(remoteId, result.data ?? []);
        return next;
      });
      const rhId = remoteHubId(remoteId);
      const SKIP_SLUGS = new Set(["favorite", "favorites", "beloved"]);
      const addNodes: WalkNode[] = [];
      const addEdges: WalkEdge[] = [];
      for (const kind of result.data) {
        // only categorical kinds become hubs; scalar kinds (bpm,
        // energy, loudness_db, ...) are surfaced elsewhere.
        if (kind.value_type !== "categorical") continue;
        if (SKIP_SLUGS.has(kind.slug)) continue;
        // skip empties so we don't pollute the hub with hollow nodes.
        if (!kind.album_count || kind.album_count <= 0) continue;
        const id = relationHubId(remoteId, kind.slug);
        addNodes.push({
          id,
          role: "relation",
          label:
            kind.label && kind.label.trim().length > 0 ? kind.label : kind.slug.replace(/_/g, " "),
          parentId: rhId,
          childCount: kind.album_count,
          lazy: true,
          tint: kind.color ?? undefined,
        });
        addEdges.push({ source: rhId, target: id });
        taxonKindMetaByHub.set(id, {
          label:
            kind.label && kind.label.trim().length > 0 ? kind.label : kind.slug.replace(/_/g, " "),
          color: kind.color ?? null,
        });
      }
      if (addNodes.length > 0 || addEdges.length > 0) {
        walkerClient()?.merge(addNodes, addEdges);
      }
    } catch (err) {
      console.warn("taxon kinds fetch failed", { remoteId: remote.remote_id, err });
    }
  };

  // run a health check (deduped) and reflect the result into offlineByRemote.
  const runHealthCheck = async (remoteId: string): Promise<boolean | null> => {
    if (recheckingRemotes.has(remoteId)) return null;
    recheckingRemotes.add(remoteId);
    try {
      const remote = await getRemoteById(remoteId);
      if (!remote) return null;
      const online = await checkRemoteHealth(remote);
      setOfflineByRemote((prev) => {
        if (prev.get(remoteId) === !online) return prev;
        const next = new Map(prev);
        next.set(remoteId, !online);
        return next;
      });
      return online;
    } catch {
      return null;
    } finally {
      recheckingRemotes.delete(remoteId);
    }
  };

  // listen for status changes from anywhere else in the app (e.g. p2p peer
  // offline events, settings view recheck) so the graph dims/undims in sync.
  onMount(() => {
    const unsub = onRemoteStatusChange((remoteId, isOffline) => {
      setOfflineByRemote((prev) => {
        if (prev.get(remoteId) === isOffline) return prev;
        const next = new Map(prev);
        next.set(remoteId, isOffline);
        return next;
      });
    });
    onCleanup(unsub);
  });

  // ---- graph derivation -----------------------------------------------

  const artistsByRemote = createMemo<Map<string, ArtistNodeData[]>>(() => {
    const out = new Map<string, ArtistNodeData[]>();
    const imgIdx = artistImagesByRemote();
    for (const [remoteId, albums] of nodesByRemote()) {
      const favIds = new Set<string>();
      for (const a of albums) {
        if (a.isFavorite && a.artistId) favIds.add(a.artistId);
      }
      const derived = deriveArtistNodes(albums, favIds);
      // image priority: album cover (already on node from
      // deriveArtistNodes) wins. only fall back to the artist's own
      // primary image when there's no album-derived cover — keeps
      // waveforms / odd artist-level art from clobbering the catalog
      // signal that an album cover provides.
      const remoteImgs = imgIdx.get(remoteId);
      if (remoteImgs && remoteImgs.size > 0) {
        for (let i = 0; i < derived.length; i++) {
          const node = derived[i];
          if (node.image) continue;
          const primary = remoteImgs.get(node.artistId);
          if (primary) derived[i] = { ...node, image: primary };
        }
      }
      out.set(remoteId, derived);
    }
    return out;
  });

  // edit mode: when active, lasso selection and modifier-click multi-select
  // replace normal click-to-pivot behavior. owned by exactly one remote at
  // a time — entering scopes the canvas to that remote (see scope-lock).
  // declared here (above buildResult) because buildResult reads it for the
  // scope-lock narrowing; the memo body runs eagerly on creation so the
  // signal must exist by then.
  const [editingRemoteId, setEditingRemoteId] = createSignal<string | null>(null);
  const editMode = createMemo(() => editingRemoteId() !== null);
  // back-compat shim for handlers that historically toggled a boolean.
  // only the exit path (false) is honored — enter must specify a remote id.
  const setEditMode = (next: boolean) => {
    if (!next) setEditingRemoteId(null);
  };

  const buildResult = createMemo(() => {
    const byRemote = nodesByRemote();
    // include every selected remote so offline / not-yet-loaded remotes still
    // surface in the graph as remote hubs (dimmed if offline). filtering by
    // data presence would hide them entirely.
    // edit-mode scope-lock: when editing, narrow to the active remote only so
    // the canvas reflects the editing scope and cross-remote clustering is
    // suppressed (the worker's linkGroup needs >=2 distinct remotes).
    const active = editingRemoteId();
    const remoteIds = active
      ? props
          .remotes()
          .filter((r) => r.remote_id === active)
          .map((r) => r.remote_id)
      : props.remotes().map((r) => r.remote_id);
    if (remoteIds.length === 0) return null;
    return buildWalkGraph({
      remoteIds,
      albumsByRemote: byRemote,
      artistsByRemote: artistsByRemote(),
      favoriteSongAlbumIds: favSongAlbumIds(),
      favoriteSongArtistIds: favSongArtistIds(),
      belovedAlbumIdsByRemote: belovedAlbumIds(),
      belovedArtistIdsByRemote: belovedArtistIds(),
      charnelManagedRemoteIds: new Set(
        props
          .remotes()
          .filter((r) => !!r.is_charnel_managed)
          .map((r) => r.remote_id)
      ),
      remoteNamesById: new Map(props.remotes().map((r) => [r.remote_id, r.name])),
    });
  });
  // node lookup that covers both the eagerly-loaded data and any cross-remote
  // merges added during the session.
  const lookupNode = (id: string): AlbumNodeData | ArtistNodeData | null =>
    buildResult()?.nodesById.get(id) ?? extraNodesById().get(id) ?? null;
  // ---- walker client lifecycle ----------------------------------------
  //
  // WalkCanvas creates and owns the worker. we get a reference via
  // onClientReady, then manage incremental init/merge from here so
  // streaming page loads don't restart the sim.

  const [walkerClient, setWalkerClient] = createSignal<WalkerClient | null>(null);
  const [walkApi, setWalkApi] = createSignal<WalkApi | null>(null);
  const [breadcrumbDepth, setBreadcrumbDepth] = createSignal(1);
  // current breadcrumb id set (root..pivot, unordered). populated by
  // WalkCanvas via onBreadcrumbChange and read by selectedArtistRemote
  // to derive the "primary" remote for the current walk path: whichever
  // `remote::*` id sits on the breadcrumb. when the user walks
  // root -> remote::X -> ... -> artist, X is the remote they "walked
  // out from" and the popover should query that remote.
  const [breadcrumbIds, setBreadcrumbIds] = createSignal<Set<string>>(new Set());

  let hadInit = false;
  const prevNodeIds = new Set<string>();
  const prevEdgeKeys = new Set<string>();
  let prevRemoteKey = "";
  // bumped every time the worker is `init()`-reset so loaders that
  // pushed nodes through `walkerClient.merge` (taxon kind hubs, artist
  // image overlays, favorites' synthesized edges, etc.) re-fire and
  // repopulate. without this the scoped subtree in edit mode collapses
  // to a bare remote hub because every incremental merge was wiped.
  const [mergeResetTick, setMergeResetTick] = createSignal(0);

  createEffect(() => {
    const client = walkerClient();
    if (!client) return;
    const result = buildResult();
    if (!result || result.graph.nodes.length === 0) return;

    // detect remote-set change (user added/removed a remote, or edit-
    // mode scope-lock collapsed/restored the remote list) -> full reset
    const remoteKey = result.graph.nodes
      .filter((n) => n.role === "remote")
      .map((n) => n.id)
      .sort()
      .join("|");
    if (remoteKey !== prevRemoteKey) {
      prevRemoteKey = remoteKey;
      hadInit = false;
      prevNodeIds.clear();
      prevEdgeKeys.clear();
      // worker will be wiped by init() below; lazy taxon caches need to
      // re-fetch because the value/group nodes they tracked are gone.
      taxonsLoadedByHub.clear();
      albumsLoadedByPivot.clear();
    }

    const { width, height } = canvasSize();

    if (!hadInit) {
      hadInit = true;
      for (const n of result.graph.nodes) prevNodeIds.add(n.id);
      for (const e of result.graph.edges) prevEdgeKeys.add(`${e.source}::${e.target}`);
      // when entering edit mode the scope-lock leaves a single remote
      // in the graph; landing the pivot on that remote's hub matches
      // what the user just clicked into instead of bouncing back to
      // the global root.
      const active = editingRemoteId();
      const initialPivot = active ? remoteHubId(active) : rootId();
      client.init(result.graph, initialPivot, width, height);
      // signal merge-based loaders to re-emit (they were wiped by init).
      setMergeResetTick((n) => n + 1);
    } else {
      const addNodes = result.graph.nodes.filter((n) => !prevNodeIds.has(n.id));
      const addEdges = result.graph.edges.filter(
        (e) => !prevEdgeKeys.has(`${e.source}::${e.target}`)
      );
      if (addNodes.length === 0 && addEdges.length === 0) return;
      for (const n of addNodes) prevNodeIds.add(n.id);
      for (const e of addEdges) prevEdgeKeys.add(`${e.source}::${e.target}`);
      client.merge(addNodes, addEdges);
    }
  });

  // pause/resume when this subview is hidden
  createEffect(() => {
    const client = walkerClient();
    if (!client) return;
    client.setPaused(!props.isActive());
  });

  // mirror the worker's visible-ids stream into a signal so other
  // memos (e.g. the smart-filter scope inference) can react to what
  // is actually on-screen rather than re-deriving from buildResult.
  const [visibleIds, setVisibleIds] = createSignal<string[]>([]);
  // subscribe to visible-ids to trigger cross-remote artist lookups
  createEffect(() => {
    const client = walkerClient();
    if (!client) return;
    const unsub = client.onVisibleIds((ids) => {
      setVisibleIds(ids);
      // when any group has been eagerly expanded, drive album loading
      // for every visible value/group so the worker's subtree DFS can
      // surface the resulting artist + album nodes on the next pass.
      // maybeLoadAlbumsForPivot dedupes via albumsLoadedByPivot.
      if (eagerHubIds().size > 0) {
        for (const id of ids) {
          if (id.startsWith("value::") || id.startsWith("group::")) {
            void maybeLoadAlbumsForPivot(id);
          }
        }
      }
      // prefetch related-artist edges for every visible artist node so
      // the lavender wires appear as soon as the node renders rather
      // than waiting for the user to pivot. the fetcher dedupes via
      // relatedArtistsLoadedByPivot + relatedArtistsFetchPromises, so
      // re-firing here is cheap; offline / unknown-remote guards live
      // inside maybeLoadRelatedArtistsForPivot.
      for (const id of ids) {
        if (id.startsWith("artist::")) {
          void maybeLoadRelatedArtistsForPivot(id);
        }
      }
      // accumulate candidates by remote so we can fire one batched
      // queryAlbums per remote (artist_names filter) rather than N
      // single-artist queries.
      const pendingByRemote = new Map<string, Map<string, string>>();
      for (const id of ids) {
        if (!id.startsWith("artist::")) continue;
        let parsed: ReturnType<typeof parseNodeId>;
        try {
          parsed = parseNodeId(id);
        } catch {
          continue;
        }
        if (parsed.kind !== "artist") continue;
        const node = lookupNode(id);
        if (!node || !("name" in node)) continue;
        const artistName = (node as ArtistNodeData).name;
        const artistSlug = slug(artistName);
        if (!artistSlug) continue;
        for (const remote of props.remotes()) {
          if (remote.remote_id === parsed.remoteId) continue;
          // skip offline remotes here too so we don't even occupy the
          // crossRemoteLookups slot — keeps it open for retry after
          // the remote comes back online.
          if (offlineByRemote().get(remote.remote_id) === true) continue;
          const key = `${remote.remote_id}::${artistSlug}`;
          if (crossRemoteLookups.has(key)) continue;
          // if artist with this slug is already in the main graph for this
          // remote, mark as loaded — the worker already synthesized the wire.
          let alreadyPresent = false;
          const nb = buildResult()?.nodesById;
          if (nb) {
            for (const [nid, n] of nb) {
              if (
                nid.startsWith(`artist::${remote.remote_id}::`) &&
                "name" in n &&
                slug((n as ArtistNodeData).name) === artistSlug
              ) {
                alreadyPresent = true;
                break;
              }
            }
          }
          if (alreadyPresent) {
            crossRemoteLookups.set(key, "loaded");
            continue;
          }
          crossRemoteLookups.set(key, "loading");
          if (!pendingByRemote.has(remote.remote_id)) {
            pendingByRemote.set(remote.remote_id, new Map());
          }
          pendingByRemote.get(remote.remote_id)!.set(artistSlug, artistName);
        }
      }
      for (const [remoteId, candidates] of pendingByRemote) {
        void batchLookupAndMerge(remoteId, candidates);
      }
    });
    onCleanup(unsub);
  });

  onCleanup(() => {
    setWalkerClient(null);
    hadInit = false;
    prevNodeIds.clear();
    prevEdgeKeys.clear();
    prevRemoteKey = "";
  });

  // ---- canvas sizing via ResizeObserver ------------------------------

  let containerRef!: HTMLDivElement;
  const [canvasSize, setCanvasSize] = createSignal({ width: 600, height: 400 });

  // ---- selection state -----------------------------------------------

  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  // taxon selection state — populated async when a value/group node is clicked.
  // for relation hubs, taxonId is null and the popover renders kind-level info only.
  const [selectedTaxonInfo, setSelectedTaxonInfo] = createSignal<{
    taxonId: string | null;
    remoteId: string;
    kindSlug: string;
    relHubId: string;
    albumCount: number | undefined;
    label: string;
  } | null>(null);
  // clear taxon selection when the global selection is cleared (e.g. Escape key).
  createEffect(() => {
    if (!selectedId()) setSelectedTaxonInfo(null);
  });

  const [multiSelection, setMultiSelection] = createSignal<Set<string>>(new Set());
  // debug sim-tuning overlay (toggle with shift+d). values forwarded
  // to the worker any time they change.
  const [tuningOverlayOpen, setTuningOverlayOpen] = createSignal(false);
  const [simTuning, setSimTuning] = createSignal<SimTuningValues>({ ...DEFAULT_TUNING });
  createEffect(() => {
    walkerClient()?.setTuning(simTuning());
  });
  // in edit mode, a single value/group taxon selected via plain click
  // should still surface the bulk popover (nest/color/delete). this wrap
  // is what the bulk handlers see, so they auto-activate without us
  // having to mutate the real multiSelection signal.
  const effectiveMultiSelection = createMemo<Set<string>>(() => {
    const base = multiSelection();
    if (!editMode()) return base;
    const sid = selectedId();
    if (!sid || base.has(sid)) return base;
    try {
      const p = parseNodeId(sid);
      if (p && (p.kind === "value" || p.kind === "group")) {
        const next = new Set(base);
        next.add(sid);
        return next;
      }
    } catch {
      // ignore unparseable ids
    }
    return base;
  });
  const setEffectiveMultiSelection = (next: Set<string>) => {
    setMultiSelection(next);
    if (next.size === 0) setSelectedId(null);
  };
  // per-hub filter query for taxon children. only one hub is visible at a
  // time (the one in the open popover) so a flat map by hub id is fine.
  // when a query is set, non-matching value/group node ids under that hub
  // are sent to the worker via setHidden so the sim re-clusters around
  // the matches; everything else stays in the full graph.
  const [taxonFilterByHub, setTaxonFilterByHub] = createSignal<Map<string, string>>(new Map());
  // per-hub filter scope: when true, the filter only acts on octagons
  // (leaf value taxons) and leaves 7-sided group taxons visible so the
  // user can see the intermediate parents while corralling matches.
  // default true since that's the common case for re-parenting.
  const [taxonFilterValuesOnlyByHub, setTaxonFilterValuesOnlyByHub] = createSignal<
    Map<string, boolean>
  >(new Map());
  const activeHubFilterValuesOnly = createMemo<boolean>(() => {
    const info = selectedTaxonInfo();
    if (!info) return true;
    return taxonFilterValuesOnlyByHub().get(info.relHubId) ?? true;
  });
  // bumped by createPivotHandler every time a hub's taxon cache is
  // re-merged (e.g. after a re-parent drop). hubFilterIds depends on it
  // so the hide set is re-derived from the fresh taxonItemsByHub and the
  // worker keeps hiding the right nodes across edits.
  const [hubRefreshTick, setHubRefreshTick] = createSignal(0);
  // group node ids whose subtree has been eagerly expanded via long-press
  // or the detail-panel button. used to drive album/artist loading for
  // every visible descendant value/group, and to label the toggle button.
  const [eagerHubIds, setEagerHubIds] = createSignal<Set<string>>(new Set());
  const toggleEagerHub = (id: string) => {
    setEagerHubIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // unassigned hub pager state. page size is one of UNASSIGNED_PAGE_SIZES;
  // page index is clamped client-side once the total album count comes
  // back from the server. info map captures the last-known server
  // response (total + hasNext) so prev/next can be disabled correctly.
  const UNASSIGNED_PAGE_SIZES = [4, 8, 12, 16, 24, 32, 48, 64];
  const UNASSIGNED_DEFAULT_PAGE_SIZE = 16;
  const [unassignedPageIndexByHub, setUnassignedPageIndexByHub] = createSignal<Map<string, number>>(
    new Map()
  );
  const [unassignedPageSizeByHub, setUnassignedPageSizeByHub] = createSignal<Map<string, number>>(
    new Map()
  );
  const [unassignedInfoByHub, setUnassignedInfoByHub] = createSignal<
    Map<
      string,
      { total: number; pageIndex: number; pageSize: number; consumed: number; hasNext: boolean }
    >
  >(new Map());
  const getUnassignedPageIndex = (hubId: string) => unassignedPageIndexByHub().get(hubId) ?? 0;
  const getUnassignedPageSize = (hubId: string) =>
    unassignedPageSizeByHub().get(hubId) ?? UNASSIGNED_DEFAULT_PAGE_SIZE;
  // builds the pager bundle shared between the expanded popover and the
  // collapsed taxon button. returns undefined unless the currently-
  // selected hub is `relation::*::unassigned`.
  const buildUnassignedPager = () => {
    const info = selectedTaxonInfo();
    if (info?.kindSlug !== "unassigned") return undefined;
    const hubId = info.relHubId;
    return {
      pageIndex: () => getUnassignedPageIndex(hubId),
      pageSize: () => getUnassignedPageSize(hubId),
      pageSizes: UNASSIGNED_PAGE_SIZES,
      total: () => unassignedInfoByHub().get(hubId)?.total ?? 0,
      consumed: () => unassignedInfoByHub().get(hubId)?.consumed ?? 0,
      canPrev: () => getUnassignedPageIndex(hubId) > 0,
      canNext: () => unassignedInfoByHub().get(hubId)?.hasNext ?? false,
      onPrev: () => {
        const cur = getUnassignedPageIndex(hubId);
        if (cur <= 0) return;
        setUnassignedPageIndexByHub((prev) => {
          const next = new Map(prev);
          next.set(hubId, cur - 1);
          return next;
        });
        void reloadUnassignedPage(hubId);
      },
      onNext: () => {
        if (!(unassignedInfoByHub().get(hubId)?.hasNext ?? false)) return;
        const cur = getUnassignedPageIndex(hubId);
        setUnassignedPageIndexByHub((prev) => {
          const next = new Map(prev);
          next.set(hubId, cur + 1);
          return next;
        });
        void reloadUnassignedPage(hubId);
      },
      onPageSizeChange: (size: number) => {
        if (size === getUnassignedPageSize(hubId)) return;
        setUnassignedPageSizeByHub((prev) => {
          const next = new Map(prev);
          next.set(hubId, size);
          return next;
        });
        setUnassignedPageIndexByHub((prev) => {
          const next = new Map(prev);
          next.set(hubId, 0);
          return next;
        });
        void reloadUnassignedPage(hubId);
      },
    };
  };
  // unified key used to scope the filter query / scope override / values-
  // only sub-toggle across whichever popover is currently open. covers
  // relation, value, and group selections via their parent kind hub id,
  // and remote root selections via a synthetic `remote::{id}` key.
  const filterContextKey = createMemo<string | null>(() => {
    const info = selectedTaxonInfo();
    if (info) return info.relHubId;
    return null;
  });
  const activeHubFilterQuery = createMemo(() => {
    const key = filterContextKey();
    if (!key) return "";
    return taxonFilterByHub().get(key) ?? "";
  });
  // per-hub manual override for filter scope. when absent the scope
  // is inferred from visible context (see inferredFilterScope below).
  const [taxonFilterScopeByHub, setTaxonFilterScopeByHub] = createSignal<
    Map<string, "taxons" | "entities">
  >(new Map());
  // infer whether the filter input should match taxon labels (values +
  // groups) or entity labels (artists + albums) based on what's
  // currently visible. taxon scope only ever applies to a relation hub
  // selection (and even then `unassigned` always forces entities since
  // it only contains orphan albums). value / group / remote selections
  // always default to entities — their interesting children are
  // artists and albums, not sibling taxons.
  const inferredFilterScope = createMemo<"taxons" | "entities">(() => {
    const info = selectedTaxonInfo();
    if (info && info.taxonId !== null) return "entities";
    if (info && info.kindSlug === "unassigned") return "entities";
    if (!info) return "taxons";
    let taxonCount = 0;
    let entityCount = 0;
    for (const id of visibleIds()) {
      if (id.startsWith("value::") || id.startsWith("group::")) taxonCount++;
      else if (id.startsWith("artist::") || id.startsWith("album::")) entityCount++;
    }
    return entityCount > taxonCount ? "entities" : "taxons";
  });
  const activeFilterScope = createMemo<"taxons" | "entities">(() => {
    const key = filterContextKey();
    if (!key) return inferredFilterScope();
    return taxonFilterScopeByHub().get(key) ?? inferredFilterScope();
  });
  // compute matching + non-matching node ids for the currently-open
  // selection. matches feed the "select matches" multi-select shortcut;
  // non-matches become the worker hide set.
  const hubFilterIds = createMemo<{ matchIds: Set<string>; hideIds: Set<string> }>(() => {
    // subscribe to the refresh tick so this re-runs after refreshHub
    // repopulates taxonItemsByHub (e.g. post re-parent drop).
    hubRefreshTick();
    const info = selectedTaxonInfo();
    const key = filterContextKey();
    const query = activeHubFilterQuery().trim().toLowerCase();
    const matchIds = new Set<string>();
    const hideIds = new Set<string>();
    if (!key || !query) return { matchIds, hideIds };
    const scope = activeFilterScope();
    // taxon scope requires a relation-hub selection — only then do we
    // know which kind's children to enumerate from taxonItemsByHub.
    if (scope === "taxons" && info && info.taxonId === null) {
      const items = taxonItemsByHub.get(info.relHubId);
      if (!items) return { matchIds, hideIds };
      const parsed = parseNodeId(info.relHubId);
      if (!parsed || parsed.kind !== "relation") return { matchIds, hideIds };
      const remoteId = parsed.remoteId;
      const kind = parsed.relationKind;
      const childIdSet = new Set<string>();
      const parents = taxonParentsByHub.get(info.relHubId);
      if (parents) for (const pid of parents.values()) childIdSet.add(pid);
      for (const meta of items.values()) {
        const isGroup = childIdSet.has(meta.id);
        // values-only scope: skip group taxons so they remain visible
        // and don't pollute the hide set.
        if (isGroup && activeHubFilterValuesOnly()) continue;
        const nodeId = isGroup
          ? groupNodeId(remoteId, kind, meta.label)
          : valueNodeId(remoteId, kind, meta.label);
        if (meta.label.toLowerCase().includes(query)) matchIds.add(nodeId);
        else hideIds.add(nodeId);
      }
      return { matchIds, hideIds };
    }
    // entity scope: scan currently-visible artist + album nodes and
    // match against their names / titles. relies on the worker's
    // hide-set semantics so hidden artists fade off-screen without
    // tearing down their edges.
    for (const id of visibleIds()) {
      if (!id.startsWith("artist::") && !id.startsWith("album::")) continue;
      const node = lookupNode(id);
      if (!node) continue;
      let label = "";
      if ("title" in node) label = (node as AlbumNodeData).title ?? "";
      else if ("name" in node) label = (node as ArtistNodeData).name ?? "";
      if (!label) {
        hideIds.add(id);
        continue;
      }
      if (label.toLowerCase().includes(query)) matchIds.add(id);
      else hideIds.add(id);
    }
    return { matchIds, hideIds };
  });
  // push the hide set to the worker whenever it changes. clears when
  // no filter is active or no taxon hub is open.
  createEffect(() => {
    const client = walkerClient();
    if (!client) return;
    const { hideIds } = hubFilterIds();
    client.setHidden(Array.from(hideIds));
  });
  // clear the filter for a context when its popover closes / swaps.
  createEffect((prevKey: string | null) => {
    const curKey = filterContextKey();
    if (prevKey && prevKey !== curKey) {
      const next = new Map(taxonFilterByHub());
      if (next.delete(prevKey)) setTaxonFilterByHub(next);
      const nextScope = new Map(taxonFilterScopeByHub());
      if (nextScope.delete(prevKey)) setTaxonFilterScopeByHub(nextScope);
    }
    return curKey;
  }, null);
  // edit mode persists across selection changes — only explicit toggles,
  // escape, or the active remote going offline exit it.
  // clear any lingering filter state when no popover is open so the
  // hide set doesn't persist across navigation.
  createEffect(() => {
    if (!filterContextKey() && taxonFilterByHub().size > 0) {
      setTaxonFilterByHub(new Map());
    }
    if (!filterContextKey() && taxonFilterScopeByHub().size > 0) {
      setTaxonFilterScopeByHub(new Map());
    }
  });

  const selectedAlbum = createMemo<AlbumNodeData | null>(() => {
    const id = selectedId();
    if (!id) return null;
    const node = lookupNode(id);
    if (!node || !("title" in node)) return null;
    return node as AlbumNodeData;
  });

  // remote hub selection: derived from selectedId when the node is a
  // root remote hub. drives the RemoteDetailPopover.
  const selectedRemote = createMemo<Remote | null>(() => {
    const id = selectedId();
    if (!id) return null;
    try {
      const parsed = parseNodeId(id);
      if (parsed.kind !== "remote") return null;
      return props.remotes().find((r) => r.remote_id === parsed.remoteId) ?? null;
    } catch {
      return null;
    }
  });

  const selectedArtist = createMemo<ArtistNodeData | null>(() => {
    const id = selectedId();
    if (!id) return null;
    const node = lookupNode(id);
    if (!node || !("artistId" in node)) return null;
    try {
      const parsed = parseNodeId(id);
      if (parsed.kind !== "artist") return null;
    } catch {
      return null;
    }
    return node as ArtistNodeData;
  });

  // single shared minimized flag for ALL detail panels (album, artist,
  // taxon/hub). once the user collapses any one of them, all subsequent
  // selections render in the collapsed state — only an explicit
  // chevron-up restores. global by design so navigating between an
  // album, an artist, and a taxon doesn't keep popping panels back open.
  const [detailPanelsHidden, setDetailPanelsHidden] = createSignal(false);
  const albumPanel = {
    hidden: detailPanelsHidden,
    hide: () => setDetailPanelsHidden(true),
    restore: () => setDetailPanelsHidden(false),
  };
  const artistPanel = {
    hidden: detailPanelsHidden,
    hide: () => setDetailPanelsHidden(true),
    restore: () => setDetailPanelsHidden(false),
  };
  const taxonPanelHidden = detailPanelsHidden;
  const setTaxonPanelHidden = setDetailPanelsHidden;

  const selectedArtistAlbums = createMemo<AlbumNodeData[]>(() => {
    const artist = selectedArtist();
    if (!artist) return [];
    // align with the panel's data source: use the cluster member that
    // selectedArtistMember picked (breadcrumb-derived primary remote,
    // user override, or one-member fallback). without this the album
    // list filtered by the leader's artistId — possibly a different
    // remote than the one whose bio / images are showing — so the user
    // would see "data from X" but X's albums hidden behind some other
    // remote's catalog (or an empty list when no albums for that
    // artistId loaded yet).
    const member = selectedArtistMember();
    const filterArtistId = member?.data.artistId ?? artist.artistId;
    const out: AlbumNodeData[] = [];
    // buildResult().nodesById keys album nodes by their graph id
    // (`album::${remoteId}::${albumId}`), but the stored AlbumNodeData
    // carries the bare adapter id (`${remoteId}::${albumId}`). the
    // popover row's click handler routes through selectAndPanTo which
    // looks up nodes by graph id, so we stamp the map key onto the
    // returned album. without this the click resolves to a
    // non-existent node and the album panel never opens.
    const addFromMap = (map: Map<string, AlbumNodeData | ArtistNodeData>) => {
      for (const [key, node] of map) {
        if ("title" in node && (node as AlbumNodeData).artistId === filterArtistId) {
          out.push({ ...(node as AlbumNodeData), id: key });
        }
      }
    };
    const result = buildResult();
    if (result) addFromMap(result.nodesById);
    addFromMap(extraNodesById());
    return out;
  });

  // ---- cross-remote artist cluster index ------------------------------

  const artistClusterByNameSlug = useArtistClusterIndex(
    () => buildResult()?.nodesById,
    extraNodesById
  );

  // the "primary remote" for the current walk: scan the breadcrumb for
  // a `remote::*` id and decode it. when the user navigates
  // root \u2192 remote::X \u2192 ..., this returns X. when the user is at
  // root or in a context without a remote ancestor (e.g. global
  // favorites hub), returns undefined.
  const primaryWalkRemoteId = createMemo<string | null>(() => {
    for (const id of breadcrumbIds()) {
      if (id.startsWith("remote::")) {
        try {
          const parsed = parseNodeId(id);
          if (parsed.kind === "remote") return parsed.remoteId;
        } catch {
          // ignore unparseable
        }
      }
    }
    return null;
  });

  // bidirectional client-side index of related-artist relations as we
  // learn about them from any pivot's fetch. keyed by node id; the
  // inner map's key is the other endpoint's node id. lets the popover
  // surface relations that the *current* artist's own server response
  // didn't include (e.g. row stored on remote X as name-only pointing
  // at this artist — we discovered it from X's pivot fetch, but this
  // artist's own remote returns 0 incoming rows because no
  // `related_artist_id` resolved). declared up here (before the popover
  // resource + augmentation memo that read it) to avoid TDZ when the
  // memo runs at component setup.
  const relatedArtistEdgeIndex = new Map<
    string,
    Map<string, { direction: "outgoing" | "incoming" | "both"; status: "accepted" | "pending" }>
  >();
  // monotonically-bumped on every recordRelatedEdge so the popover's
  // augmentation memo recomputes when more relations are discovered
  // *after* the popover already opened (e.g. prefetch finished after
  // the user clicked).
  const [relatedEdgeIndexVersion, setRelatedEdgeIndexVersion] = createSignal(0);
  const recordRelatedEdge = (aId: string, bId: string, status: "accepted" | "pending"): void => {
    const mergeDir = (
      prev: "outgoing" | "incoming" | "both" | undefined,
      next: "outgoing" | "incoming"
    ): "outgoing" | "incoming" | "both" => {
      if (!prev) return next;
      if (prev === "both") return "both";
      return prev === next ? prev : "both";
    };
    const upsert = (from: string, to: string, dir: "outgoing" | "incoming") => {
      let inner = relatedArtistEdgeIndex.get(from);
      if (!inner) {
        inner = new Map();
        relatedArtistEdgeIndex.set(from, inner);
      }
      const prev = inner.get(to);
      // pending only "wins" if every observation is pending. once we
      // see an accepted observation, treat as accepted.
      const newStatus = prev?.status === "accepted" ? "accepted" : status;
      inner.set(to, {
        direction: mergeDir(prev?.direction, dir),
        status: newStatus,
      });
    };
    upsert(aId, bId, "outgoing");
    upsert(bId, aId, "incoming");
    setRelatedEdgeIndexVersion((v) => v + 1);
  };

  // related-artists list for the currently-selected artist (popover
  // section). uses the same `client.music.listRelatedArtists` endpoint
  // as the lazy graph loader. every response row surfaces in the
  // popover so the user always has feedback when data exists. rows
  // that resolve to a loaded artist node return that node (clickable).
  // rows that don't (external / not-yet-loaded) return a stub
  // ArtistNodeData with `artistId: ""` so the popover renders the
  // name + image but the click handler skips the pan-to-node action.
  const [selectedArtistRelated] = createResource(
    () => {
      const a = selectedArtist();
      if (!a) {
        console.info("[graph] related-artists source: no selectedArtist");
        return null;
      }
      // prefer the remote encoded in the graph node id (always present
      // and authoritative) over remoteForArtist, which falls back to
      // remotes()[0] when sourceRemoteIds is empty and would silently
      // query the wrong remote — yielding an empty popover even though
      // the edge loader (which parses the node id) populated edges.
      let remoteId: string | null = null;
      try {
        const parsed = parseNodeId(a.id);
        if (parsed.kind === "artist") remoteId = parsed.remoteId;
      } catch {
        // fall through to remoteForArtist
      }
      const remote = remoteId
        ? props.remotes().find((r) => r.remote_id === remoteId)
        : remoteForArtist(a);
      if (!remote) {
        console.warn("[graph] related-artists source: no remote for artist", {
          id: a.id,
          artistId: a.artistId,
          name: a.name,
          sourceRemoteIds: a.sourceRemoteIds,
          parsedRemoteId: remoteId,
        });
        return null;
      }
      if (offlineByRemote().get(remote.remote_id) === true) {
        console.warn("[graph] related-artists source: remote offline", {
          remote: remote.remote_id,
        });
        return null;
      }
      console.info("[graph] related-artists source: ready", {
        nodeId: a.id,
        artistId: a.artistId,
        name: a.name,
        sourceRemoteIds: a.sourceRemoteIds,
        targetRemote: remote.remote_id,
      });
      return { artistId: a.artistId, remote };
    },
    async (
      key
    ): Promise<{
      artists: ArtistNodeData[];
      meta: Map<
        string,
        { direction: "outgoing" | "incoming" | "both"; status: "accepted" | "pending" }
      >;
    }> => {
      const empty = {
        artists: [] as ArtistNodeData[],
        meta: new Map<
          string,
          { direction: "outgoing" | "incoming" | "both"; status: "accepted" | "pending" }
        >(),
      };
      try {
        const client = await getClientForRemote(key.remote);
        console.info("[graph] related-artists fetch start", {
          artistId: key.artistId,
          remote: key.remote.remote_id,
        });
        const result = await client.music.listRelatedArtists({
          artist_id: key.artistId,
          include_pending: true,
          include_incoming: true,
        });
        if (!result.success || !result.data) {
          console.warn("[graph] related-artists fetch returned no data", {
            artistId: key.artistId,
            remote: key.remote.remote_id,
            success: result.success,
            result,
          });
          return empty;
        }
        const remoteId = key.remote.remote_id;
        const out: ArtistNodeData[] = [];
        const seen = new Set<string>();
        // per-row metadata keyed by the resolved/stub node id, so the
        // popover can render direction glyph + pending badge.
        const meta = new Map<
          string,
          { direction: "outgoing" | "incoming" | "both"; status: "accepted" | "pending" }
        >();
        const rowMeta = (row: {
          direction: string;
          status: string;
        }): { direction: "outgoing" | "incoming" | "both"; status: "accepted" | "pending" } => ({
          direction:
            row.direction === "incoming" || row.direction === "both"
              ? (row.direction as "incoming" | "both")
              : "outgoing",
          status: row.status === "pending" ? "pending" : "accepted",
        });
        // name-slug index over already-loaded artists for fallback
        // matches when related_artist_id is null but a same-remote
        // artist with the same name exists. we store the map *key*
        // (the graph node id, e.g. `artist::${remoteId}::${artistId}`)
        // alongside the node because ArtistNodeData.id from
        // deriveArtistNodes lacks the remote prefix — and selectAndPanTo
        // / lookupNode key off the graph id.
        const byNameSameRemote = new Map<string, { id: string; node: ArtistNodeData }>();
        const byNameAnyRemote = new Map<string, { id: string; node: ArtistNodeData }>();
        const maps = [buildResult()?.nodesById, extraNodesById()] as const;
        for (const map of maps) {
          if (!map) continue;
          for (const [mapKey, node] of map) {
            if (!("artistId" in node)) continue;
            const a = node as ArtistNodeData;
            const k = slug(a.name);
            if (!k) continue;
            if (!byNameAnyRemote.has(k)) byNameAnyRemote.set(k, { id: mapKey, node: a });
            const nr = a.sourceRemoteIds?.[0];
            if (nr === remoteId && !byNameSameRemote.has(k)) {
              byNameSameRemote.set(k, { id: mapKey, node: a });
            }
          }
        }
        let resolved = 0;
        for (const row of result.data.items) {
          let matchNode: ArtistNodeData | null = null;
          let matchId: string | null = null;
          if (row.in_library && row.related_artist_id) {
            const explicit = artistNodeId(remoteId, row.related_artist_id);
            const node =
              buildResult()?.nodesById.get(explicit) ?? extraNodesById().get(explicit) ?? null;
            if (node && "artistId" in node) {
              matchNode = node as ArtistNodeData;
              matchId = explicit;
            }
          }
          if (!matchNode) {
            const nameKey = slug(row.related_name ?? "");
            if (nameKey) {
              const m = byNameSameRemote.get(nameKey) ?? byNameAnyRemote.get(nameKey);
              if (m) {
                matchNode = m.node;
                matchId = m.id;
              }
            }
          }
          if (matchNode && matchId) {
            if (matchNode.artistId === key.artistId) continue;
            if (seen.has(matchId)) continue;
            seen.add(matchId);
            // stamp the graph node id onto the returned artist so the
            // popover's onSelectRelatedArtist -> selectAndPanTo can
            // actually find the node. without this, ArtistNodeData.id
            // is `artist::${artistId}` (no remote) and lookupNode
            // returns null, silently dropping the click.
            out.push({ ...matchNode, id: matchId });
            meta.set(matchId, rowMeta(row));
            // feed the bidirectional client-side index so the *other*
            // artist's popover can also surface this relation later
            // even if its own remote returns 0 rows.
            const pivotNodeId = selectedArtist()?.id;
            if (pivotNodeId) {
              recordRelatedEdge(
                pivotNodeId,
                matchId,
                row.status === "pending" ? "pending" : "accepted"
              );
            }
            resolved += 1;
            continue;
          }
          // stub: surface external / not-yet-loaded related artists with
          // just name + image so the user still sees the relation.
          const name = row.related_name?.trim();
          if (!name) continue;
          const stubId = `related_stub::${remoteId}::${slug(name)}`;
          if (seen.has(stubId)) continue;
          seen.add(stubId);
          out.push({
            id: stubId,
            kind: "artist",
            artistId: "", // sentinel — non-resolvable, click is a no-op
            name,
            abbreviation: getArtistAbbreviation(name),
            imageUrl: row.image_url ?? null,
            image: null,
            albumCount: 0,
            genres: [],
            tags: [],
            moods: [],
            styles: [],
            label: null,
            era: null,
            customTaxons: {},
          });
          meta.set(stubId, rowMeta(row));
        }
        console.info("[graph] related-artists fetched", {
          artistId: key.artistId,
          remote: remoteId,
          total: result.data.items.length,
          resolved,
          stubs: out.length - resolved,
        });
        // server already orders in-library first, but cross-remote name
        // matches can resolve rows the server flagged as external. do a
        // stable partition so all resolved (clickable, in *some* loaded
        // library) entries land at the top, preserving server order
        // within each group.
        const resolvedRows: ArtistNodeData[] = [];
        const stubRows: ArtistNodeData[] = [];
        for (const row of out) {
          if (row.artistId) resolvedRows.push(row);
          else stubRows.push(row);
        }
        return { artists: [...resolvedRows, ...stubRows], meta };
      } catch (err) {
        console.warn("popover related-artists fetch failed", err);
        return empty;
      }
    }
  );

  // reactive view that merges the server-derived popover data with
  // client-side edges discovered via *other* pivots' fetches. recomputes
  // whenever the edge index version bumps so late-arriving prefetches
  // surface in the open popover without forcing a refetch.
  const augmentedRelatedArtists = createMemo<{
    artists: ArtistNodeData[];
    meta: Map<
      string,
      { direction: "outgoing" | "incoming" | "both"; status: "accepted" | "pending" }
    >;
  }>(() => {
    // depend on the index version so this memo re-runs when edges are
    // recorded (the underlying Map mutates in place; the signal is our
    // reactive trigger).
    void relatedEdgeIndexVersion();
    const base = selectedArtistRelated();
    const a = selectedArtist();
    const artists: ArtistNodeData[] = base?.artists ? [...base.artists] : [];
    const meta = new Map(base?.meta ?? []);
    if (!a) return { artists, meta };
    const known = relatedArtistEdgeIndex.get(a.id);
    if (!known || known.size === 0) return { artists, meta };
    const seen = new Set(artists.map((x) => x.id));
    let added = 0;
    for (const [otherId, edgeMeta] of known) {
      if (seen.has(otherId)) {
        // already surfaced by server; merge direction so e.g. server's
        // "outgoing" + client-known "incoming" becomes "both".
        const existing = meta.get(otherId);
        if (existing && existing.direction !== edgeMeta.direction) {
          meta.set(otherId, { direction: "both", status: existing.status });
        }
        continue;
      }
      const node = buildResult()?.nodesById.get(otherId) ?? extraNodesById().get(otherId) ?? null;
      if (!node || !("artistId" in node)) continue;
      const matchNode = node as ArtistNodeData;
      if (a.artistId && matchNode.artistId === a.artistId) continue;
      seen.add(otherId);
      artists.push({ ...matchNode, id: otherId });
      meta.set(otherId, edgeMeta);
      added += 1;
    }
    if (added > 0) {
      console.info("[graph] related-artists augmented from edge index", {
        selectedId: a.id,
        added,
        total: artists.length,
      });
    }
    return { artists, meta };
  });

  // taxon detail data for the currently-selected taxon node.
  // fetches full Taxon, ancestors, and descendants in parallel.
  const [selectedTaxonData] = createResource(
    () => selectedTaxonInfo(),
    async (info) => {
      // relation hub: no single taxon to fetch; popover renders kind-only.
      if (!info.taxonId) return null;
      const remote = props.remotes().find((r) => r.remote_id === info.remoteId);
      if (!remote) return null;
      try {
        const client = await getClientForRemote(remote);
        const [taxonRes, ancestorsRes, descendantsRes] = await Promise.all([
          client.music.getTaxon({ id: info.taxonId }),
          client.music.getTaxonAncestors({ id: info.taxonId }),
          client.music.getTaxonDescendants({ id: info.taxonId }),
        ]);
        return {
          taxon: taxonRes.success && taxonRes.data ? taxonRes.data : null,
          ancestors: (ancestorsRes.success && ancestorsRes.data
            ? ancestorsRes.data
            : []) as TaxonRef[],
          descendants: (descendantsRes.success && descendantsRes.data
            ? descendantsRes.data
            : []) as TaxonRef[],
        };
      } catch (err) {
        console.warn("taxon detail fetch failed", { taxonId: info.taxonId, err });
        return null;
      }
    }
  );

  // per-id image lookup for WalkCanvas artwork rendering (per S1/S11).
  // for artist nodes we additionally fall back across the cross-remote
  // cluster: if the leader's own remote has no image, we scan the
  // cluster's other members and use the first non-null image we find.
  // this lets a remote without artist art still display an avatar when
  // any contributing remote has one. ordering puts the breadcrumb's
  // primary remote first so its image wins when present.
  const getImage = (
    id: string
  ): import("../../../music/services/storage/types").ImageMetadata | null => {
    // remote hub nodes aren't in `nodesById` / `extraNodesById` (those
    // only carry artists + albums). resolve their avatar directly from
    // the Remote record so the graph can paint hub artwork when present.
    if (id.startsWith("remote::")) {
      const remoteId = id.slice("remote::".length);
      const r = props.remotes().find((x) => x.remote_id === remoteId);
      if (!r) return null;
      const raw = r.image_url ?? undefined;
      const baseUrl = (r as { base_url?: string }).base_url ?? "";
      const remoteUrl = raw
        ? raw.startsWith("asset://") || raw.startsWith("http://") || raw.startsWith("https://")
          ? raw
          : baseUrl
            ? `${baseUrl}${raw}`
            : undefined
        : undefined;
      if (!r.image_blob_id && !remoteUrl) return null;
      return {
        remote_blob_id: r.image_blob_id ?? undefined,
        remote_server_id: r.remote_id,
        remote_url: remoteUrl,
        blob_type: "thumbnail",
        is_primary: true,
      };
    }
    const direct = lookupNode(id)?.image ?? null;
    if (direct) return direct;
    // only artist nodes get the cluster-fallback treatment; albums are
    // not cluster-aggregated by the worker today.
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(id);
    } catch {
      return null;
    }
    if (parsed.kind !== "artist") return null;
    const node = lookupNode(id) as ArtistNodeData | null;
    if (!node) return null;
    const cluster = artistClusterByNameSlug().get(slug(node.name)) ?? [];
    if (cluster.length === 0) return null;
    const primary = primaryWalkRemoteId();
    // search primary remote first, then everyone else.
    const ordered = primary
      ? [...cluster].sort((a, b) => {
          if (a.remoteId === primary && b.remoteId !== primary) return -1;
          if (b.remoteId === primary && a.remoteId !== primary) return 1;
          return 0;
        })
      : cluster;
    for (const m of ordered) {
      if (m.data.image) return m.data.image;
    }
    return null;
  };

  // ---- action helpers ------------------------------------------------

  const bareAlbumId = (album: AlbumNodeData): string => {
    try {
      const parsed = parseNodeId(album.id);
      if (parsed.kind === "album") return parsed.albumId;
    } catch {
      // fallback
    }
    const parts = album.id.split("::");
    return parts[parts.length - 1];
  };

  const remoteForNode = (album: AlbumNodeData): Remote | undefined => {
    const remoteId = album.sourceRemoteId;
    if (remoteId) return props.remotes().find((r) => r.remote_id === remoteId);
    return props.remotes()[0];
  };

  const remoteForArtist = (artist: ArtistNodeData): Remote | undefined => {
    const remoteId = artist.sourceRemoteIds?.[0];
    if (remoteId) return props.remotes().find((r) => r.remote_id === remoteId);
    return props.remotes()[0];
  };

  // ---- multi-remote contributor lookup --------------------------------
  //
  // when the same artist or album exists on more than one remote, the
  // detail popover's edit / open buttons render as split-buttons so the
  // user can route the action to a specific remote. these helpers
  // discover the contributing remotes by name-slug matching across every
  // loaded remote (mirrors the worker's cluster algorithm in
  // walker.worker.ts phase 3). sorted with charnel-managed first, then
  // by remote name.
  const {
    contributingRemotesForArtist,
    contributingRemotesForAlbum,
    resolvePickedRemote,
    artistForRemote,
    albumForRemote,
  } = createContributingRemotes({
    remotes: () => props.remotes(),
    artistsByRemote,
    nodesByRemote,
  });

  const {
    setDataSourceRemoteOverride,
    selectedArtistMember,
    selectedArtistRemote,
    selectedArtistDisplay,
    dataSourceRemotesForSelected,
    artistQuery,
  } = createSelectedArtistDisplay({
    selectedArtist,
    selectedId,
    artistClusterByNameSlug,
    primaryWalkRemoteId,
    remotes: () => props.remotes(),
    contributingRemotesForArtist,
  });

  /** select a node and pan the canvas to it without resetting the
   *  breadcrumb. used by detail popover links (album row, relation chip,
   *  related-artist row) to keep ui in sync with the visual focus. */
  const selectAndPanTo = (nodeId: string) => {
    setSelectedId(nodeId);
    walkerClient()?.repivot(nodeId, false);
  };

  const openAlbumCarousel = async (album: AlbumNodeData) => {
    const remoteId = album.sourceRemoteId ?? remoteForNode(album)?.remote_id ?? null;
    const urls = await buildImageUrls(album.image, album.imageUrl, remoteId);
    if (urls.length === 0) return;
    showImageCarousel({ images: urls, title: formatImageCarouselTitle(album.title, urls.length) });
  };

  const openArtistCarousel = async (artist: ArtistNodeData) => {
    const urls: string[] = [];
    const queryData = artistQuery.data;
    const matches = queryData && queryData.artist_id === artist.artistId;
    if (matches && queryData.images?.length) {
      for (const img of queryData.images) {
        if (img.blob_type !== "original") continue;
        const more = await buildImageUrls(img, null, null);
        for (const u of more) if (!urls.includes(u)) urls.push(u);
      }
    }
    if (urls.length === 0) {
      const more = await buildImageUrls(artist.image, artist.imageUrl, null);
      for (const u of more) if (!urls.includes(u)) urls.push(u);
    }
    if (urls.length === 0) return;
    showImageCarousel({ images: urls, title: formatImageCarouselTitle(artist.name, urls.length) });
  };

  // ---- cross-remote lazy loading -------------------------------------

  const { batchLookupAndMerge } = createCrossRemoteLazyLoading({
    remotes: () => props.remotes(),
    offlineByRemote,
    crossRemoteLookups,
    setFetchingByRemote,
    queryClient,
    setExtraNodesById,
    walkerClient,
  });

  // ---- pageInfo ------------------------------------------------------

  createEffect(() => {
    setPageInfo({ title: "library", count: buildResult()?.graph.nodes.length ?? 0 });
  });
  onCleanup(() => clearPageInfo());

  // ---- viewport + keyboard shortcuts ---------------------------------

  const [, setIsNarrow] = createSignal(isNarrowViewport());

  onMount(() => {
    const onResize = () => setIsNarrow(isNarrowViewport());
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));

    const onKey = (e: KeyboardEvent) => {
      if (!props.isActive()) return;
      if (e.key === "Escape") {
        if (isAnyModalOpen()) return;
        if (editMode()) {
          setEditingRemoteId(null);
          setMultiSelection(new Set<string>());
        }
        setSelectedId(null);
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // f/r: navigate back to root (phase 6 will add proper fit/zoom)
      if (e.key === "f" || e.key === "r") {
        e.preventDefault();
        walkerClient()?.repivot(rootId(), true);
      }
      // shift + d: toggle debug sim-tuning overlay
      if (e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setTuningOverlayOpen(!tuningOverlayOpen());
      }
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const w = Math.max(width, 1);
      const h = Math.max(height, 1);
      setCanvasSize({ width: w, height: h });
      walkerClient()?.resize(w, h);
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // ---- topnav slots --------------------------------------------------

  const isRefetching = () => {
    for (const v of fetchingByRemote().values()) {
      if (v) return true;
    }
    return false;
  };

  createEffect(() => {
    const depth = breadcrumbDepth();
    const topNavTools = (
      <GraphTopNavTools
        onBack={depth > 1 ? () => walkApi()?.back() : undefined}
        onFit={() => walkApi()?.fit()}
        onResetWalk={() => walkApi()?.resetWalk()}
        onResetView={() => walkApi()?.resetView()}
        onRefetch={() => void queryClient.invalidateQueries({ queryKey: ["library-albums"] })}
        isRefetching={isRefetching}
        extra={props.extraTools}
      />
    );

    // keep graph tools on the primary top-nav row for both narrow and wide
    // viewports. previously narrow mode rendered these in secondaryRowContent,
    // which made them appear on row 2 at initial load.
    slots.setRightContent(topNavTools);

    // only allocate the secondary row when there is actual chip content.
    // this also prevents duplicate graph controls after wide -> narrow resize.
    if (props.bulkTagMode?.()) {
      slots.setSecondaryRowContent(
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] leading-none whitespace-nowrap border border-[var(--color-accent-500,#ff1a9e)]/50 bg-[var(--color-accent-500,#ff1a9e)]/15 text-[var(--color-accent-500,#ff1a9e)]"
              title="bulk-tag mode not available in this view"
            >
              bulk-tag mode (not available)
            </span>
          </div>
        </div>
      );
    } else {
      slots.setSecondaryRowContent(undefined);
    }

    // mount the cross-remote graph search container into the topnav's
    // search slot. milestone A: aggregated suggestions across every
    // online remote with per-remote loading indicators. milestone B
    // (pending): on enter, swap the graph data for a synthetic search
    // subgraph. see docs/explore-search-and-fixes-plan.md.
    slots.setHideSearch(false);
    slots.setSearchContent(
      <GraphTopNavSearch remotes={() => props.remotes()} onNavigate={(path) => navigate(path)} />
    );
  });

  // ---- event handlers ------------------------------------------------

  // async handler for taxon (value/group) node selection. ensures the
  // parent hub is loaded, then resolves the taxon id from the cache and
  // sets selectedTaxonInfo so the detail resource can fire.
  const loadTaxonInfoForNode = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      setSelectedTaxonInfo(null);
      return;
    }
    if (parsed.kind !== "value" && parsed.kind !== "group") {
      setSelectedTaxonInfo(null);
      return;
    }
    const { remoteId, relationKind, valueSlug } = parsed;
    const relHubId = relationHubId(remoteId, relationKind);
    // ensure hub taxons are loaded (no-op if already done; deduped internally).
    await maybeLoadTaxonsForPivot(relHubId);
    // abort if the user selected a different node while we were waiting.
    if (selectedId() !== nodeId) return;
    const meta = taxonItemsByHub.get(relHubId)?.get(valueSlug);
    if (!meta) {
      setSelectedTaxonInfo(null);
      return;
    }
    setSelectedTaxonInfo({
      taxonId: meta.id,
      remoteId,
      kindSlug: relationKind,
      relHubId,
      albumCount: meta.albumCount,
      label: meta.label,
    });
  };

  const handleSelect = (nodeId: string, _role: string) => {
    // single-selection of any node other than a currently-eager-expanded
    // group collapses every previously-expanded subtree back to its
    // normal pivot-driven visibility. shift / cmd / ctrl multi-select
    // routes through onMultiSelectionChange and never reaches here, so
    // those gestures preserve the expansion.
    {
      const cur = eagerHubIds();
      if (cur.size > 0 && !cur.has(nodeId)) {
        setEagerHubIds(new Set<string>());
        walkerClient()?.collapseSubtrees();
      }
    }
    setSelectedId(nodeId);
    try {
      const parsed = parseNodeId(nodeId);
      if (parsed.kind === "value" || parsed.kind === "group") {
        void loadTaxonInfoForNode(nodeId);
      } else if (parsed.kind === "relation") {
        // relation hub: kind-level popover; no per-taxon fetch needed.
        const relHubId = relationHubId(parsed.remoteId, parsed.relationKind);
        const meta = taxonKindMetaByHub.get(relHubId);
        setSelectedTaxonInfo({
          taxonId: null,
          remoteId: parsed.remoteId,
          kindSlug: parsed.relationKind,
          relHubId,
          albumCount: undefined,
          label: meta?.label ?? parsed.relationKind,
        });
      } else {
        setSelectedTaxonInfo(null);
      }
    } catch {
      setSelectedTaxonInfo(null);
    }
  };

  // fan out every lazy-load hook that should fire when a node becomes
  // the pivot. shared between handlePivot (real canvas pivot) and
  // pivotKeepingPanel (relation chip "expand without dismissing panel").
  const {
    handlePivot,
    pivotKeepingPanel,
    findArtistNodeId,
    maybeLoadTaxonsForPivot,
    maybeLoadAlbumsForPivot,
    maybeLoadRelatedArtistsForPivot,
    reloadUnassignedPage,
    resetMergedState,
  } = createPivotHandler({
    remotes: () => props.remotes(),
    offlineByRemote,
    walkerClient,
    buildResult,
    extraNodesById,
    lookupNode,
    setSelectedId,
    nodesByRemote,
    appendAlbumsToRemote,
    setFetchingByRemote,
    setFetchingNodeFlag,
    recordRelatedEdge,
    taxonsLoadedByHub,
    taxonItemsByHub,
    taxonParentsByHub,
    taxonLabelsByHub,
    albumsLoadedByPivot,
    editMode,
    onHubRefreshed: (_relHubId) => setHubRefreshTick((n) => n + 1),
    getUnassignedPagerState: (relHubId) => ({
      pageIndex: getUnassignedPageIndex(relHubId),
      pageSize: getUnassignedPageSize(relHubId),
    }),
    onUnassignedPageInfo: (relHubId, info) => {
      setUnassignedInfoByHub((prev) => {
        const next = new Map(prev);
        next.set(relHubId, info);
        return next;
      });
      // clamp host page index if server returned earlier than requested
      // (e.g. asked for page 3 but cursors only go up to page 1 because
      // the page size changed).
      if (info.pageIndex !== getUnassignedPageIndex(relHubId)) {
        setUnassignedPageIndexByHub((prev) => {
          const next = new Map(prev);
          next.set(relHubId, info.pageIndex);
          return next;
        });
      }
    },
    queryClient,
  });

  // worker reset (mergeResetTick advance) wipes every node/edge the
  // pivot handler had merged in (era bins, recently-added, unassigned
  // pages, related-artist clusters, taxon value/group nodes). clear its
  // internal dedup/cache state so the next pivot re-fetches and merges.
  let pivotHandlerLastResetTick = 0;
  createEffect(() => {
    const tick = mergeResetTick();
    if (tick === pivotHandlerLastResetTick) return;
    pivotHandlerLastResetTick = tick;
    if (tick === 0) return;
    resetMergedState();
  });

  // ---- render --------------------------------------------------------

  // seed activatedRemotes: prefer the charnel-managed remote (tauri local
  // sidecar). if there isn't one, fall back to the first remote so the
  // user always sees an initial dataset. additional remotes activate when
  // their hub is clicked. prune entries for removed remotes.
  createEffect(() => {
    const list = props.remotes();
    if (list.length === 0) return;
    setActivatedRemotes((prev) => {
      const ids = new Set(list.map((r) => r.remote_id));
      const next = new Set<string>();
      for (const id of prev) if (ids.has(id)) next.add(id);
      if (next.size === 0) {
        const charnel = list.find((r) => r.is_charnel_managed);
        const seed = charnel ?? list[0];
        if (seed) next.add(seed.remote_id);
      }
      // identity-stable when membership unchanged
      if (next.size === prev.size) {
        let same = true;
        for (const id of next)
          if (!prev.has(id)) {
            same = false;
            break;
          }
        if (same) return prev;
      }
      return next;
    });
  });

  const activateRemote = (remoteId: string) => {
    setActivatedRemotes((prev) => {
      if (prev.has(remoteId)) return prev;
      const next = new Set(prev);
      next.add(remoteId);
      return next;
    });
  };

  // loaders only mount for remotes that are (a) online AND (b) activated.
  // skipping offline remotes avoids hammering an unreachable server; the
  // activation gate defers initial-load cost until the user actually
  // navigates to that remote's hub.
  const onlineRemotes = createMemo(() => {
    const off = offlineByRemote();
    const act = activatedRemotes();
    return props.remotes().filter((r) => off.get(r.remote_id) !== true && act.has(r.remote_id));
  });

  // exit edit mode when the active remote goes offline or is removed.
  createEffect(() => {
    const target = editingRemoteId();
    if (!target) return;
    const stillOnline = onlineRemotes().some((r) => r.remote_id === target);
    if (!stillOnline) {
      setEditingRemoteId(null);
      setMultiSelection(new Set<string>());
    }
  });

  // on entering edit mode, repivot to the active remote's hub so the
  // canvas reflects the scoped subtree immediately. also drop any
  // cross-remote lazy nodes so they don't leak into the scoped view,
  // and activate the remote so its album/artist loaders fire \u2014 click-
  // to-pivot is suppressed in edit mode, so without this the user
  // would see only the bare remote hub with no way to populate it.
  // (no manual repivot call here: the buildResult-watching effect
  // detects the scope-lock collapse, re-inits the worker, and lands
  // the pivot directly on the active remote's hub.)
  createEffect((prev: string | null) => {
    const cur = editingRemoteId();
    if (cur && cur !== prev) {
      activateRemote(cur);
      setExtraNodesById(new Map());
    }
    return cur;
  }, null);

  // load song favorites once per online+activated remote. fires whenever
  // onlineRemotes changes (new remote activated, came back online, etc.)
  // or when the worker was re-init'd (mergeResetTick advances) so we
  // re-emit favorites' synthesized edges that the wipe took out.
  let favSongLastResetTick = 0;
  createEffect(() => {
    const tick = mergeResetTick();
    const online = onlineRemotes();
    if (tick !== favSongLastResetTick) {
      favSongLastResetTick = tick;
      for (const r of online) favSongLoadedRemotes.delete(r.remote_id);
      for (const r of online) belovedLoadedRemotes.delete(r.remote_id);
    }
    for (const remote of online) {
      if (favSongLoadedRemotes.has(remote.remote_id)) continue;
      favSongLoadedRemotes.add(remote.remote_id);
      void loadFavoriteSongsForRemote(remote);
      void loadBelovedForRemote(remote);
    }
  });

  // load artist primary images once per online+activated remote so the
  // graph artist nodes can replace their album-derived placeholders with
  // real artist art (when the remote has any). same activation gate as
  // favorites — paid for only when the user reaches the remote.
  let artistImagesLastResetTick = 0;
  createEffect(() => {
    const tick = mergeResetTick();
    const online = onlineRemotes();
    if (tick !== artistImagesLastResetTick) {
      artistImagesLastResetTick = tick;
      for (const r of online) artistImagesLoadedRemotes.delete(r.remote_id);
    }
    for (const remote of online) {
      if (artistImagesLoadedRemotes.has(remote.remote_id)) continue;
      artistImagesLoadedRemotes.add(remote.remote_id);
      void loadArtistImagesForRemote(remote);
    }
  });

  // seed first-order categorical relation hubs from list_taxon_kinds
  // for each online+activated remote (dedup'd by remote). album_count
  // comes from the server so badges render without a lazy round-trip.
  // also re-fires on worker reset so the merged hubs reappear instead
  // of leaving a bare remote node with no children.
  let taxonKindsLastResetTick = 0;
  createEffect(() => {
    const tick = mergeResetTick();
    const online = onlineRemotes();
    if (tick !== taxonKindsLastResetTick) {
      taxonKindsLastResetTick = tick;
      for (const r of online) taxonKindsLoadedRemotes.delete(r.remote_id);
    }
    for (const remote of online) {
      if (taxonKindsLoadedRemotes.has(remote.remote_id)) continue;
      taxonKindsLoadedRemotes.add(remote.remote_id);
      void loadTaxonKindsForRemote(remote);
    }
  });

  // offline-aware lookups for WalkCanvas. nodes for offline remotes (and
  // their entire subtree) get drawn dimmed so the user sees "this server is
  // unreachable but it's still here."
  const isOfflineNode = (id: string): boolean => {
    try {
      const parsed = parseNodeId(id);
      if (parsed.kind === "root" || parsed.kind === "ghost_artist") return false;
      return offlineByRemote().get(parsed.remoteId) === true;
    } catch {
      return false;
    }
  };

  // click interceptor: tapping an offline remote hub optimistically
  // re-checks health, draws the loading comet on the hub, and lets the
  // canvas pivot through so the drill-in feels instant. if the recheck
  // confirms the remote is still offline we surface a single warning
  // toast — no more "checking..." / "back online" chatter.
  // tapping an online-but-not-yet-activated remote hub mounts its loader
  // (and lets the click fall through so the canvas pivots there). active
  // online remote hubs use the default pivot/expand behavior.
  const interceptClick = (id: string): boolean => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(id);
    } catch {
      return false;
    }
    if (parsed.kind !== "remote") return false;
    if (offlineByRemote().get(parsed.remoteId) === true) {
      const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
      const name = remote?.name ?? parsed.remoteId;
      // optimistic comet while the health check runs
      setFetchingNodeFlag(id, true);
      void runHealthCheck(parsed.remoteId)
        .then((online) => {
          if (online === true) {
            // came back online: mount the loader so albums stream in.
            // the offlineByRemote flip already undimmed the subtree.
            activateRemote(parsed.remoteId);
          } else if (online === false) {
            toast.warning(`${name} is still offline`);
          }
        })
        .finally(() => setFetchingNodeFlag(id, false));
      // fall through so the canvas pivots to the hub immediately
      return false;
    }
    if (!activatedRemotes().has(parsed.remoteId)) {
      activateRemote(parsed.remoteId);
      // don't consume — let the canvas pivot to the hub so the user lands
      // there as albums stream in. the loading comet drawn on the hub via
      // isLoadingNode signals that data is incoming.
      return false;
    }
    return false;
  };

  // loading lookup for WalkCanvas: a node paints a comet arc while a
  // fetch for its subtree is in flight. two sources:
  //   - remote hub: the initial-page album loader (fetchingByRemote)
  //   - relation hub / future expansions: the per-pivot lazy fetch map
  //     (fetchingByNode) populated by maybeLoadTaxonsForPivot etc.
  const isLoadingNode = (id: string): boolean => {
    if (fetchingByNode().get(id) === true) return true;
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(id);
    } catch {
      return false;
    }
    if (parsed.kind !== "remote") return false;
    return fetchingByRemote().get(parsed.remoteId) === true;
  };

  // ---- edit-mode mutation handlers (phase 4b) -----------------------------
  // these run when the user drags a node onto another node (handleDrop) or
  // right-clicks an edge (handleEdgeRightClick) while editing. all routes are
  // admin-gated server-side; ui only invokes from edit mode + isRemoteAdmin.

  const {
    handleDrop,
    handleEdgeRightClick,
    handleCreateTaxon,
    handleDeleteTaxon,
    taxonIdForNode,
    refreshHub,
    albumIdsForArtist,
  } = createEditModeHandlers({
    remotes: () => props.remotes(),
    isRemoteAdmin,
    selectedTaxonInfo,
    setEditMode,
    setMultiSelection,
    setSelectedId,
    taxonItemsByHub,
    taxonParentsByHub,
    taxonsLoadedByHub,
    maybeLoadTaxonsForPivot,
    buildResult,
  });

  // ---- bulk (multi-selection) actions (phase 4c) --------------------------
  // shown via BulkSelectionPopover when multiSelection has 2+ nodes in edit
  // mode. fan out the same per-item mutations used by drag-drop.

  const {
    bulkCounts,
    bulkMode,
    bulkRelHubId,
    bulkAllGroups,
    bulkCandidateParents,
    bulkAvailableTaxons,
    bulkCurrentTaxons,
    bulkCanEdit,
    bulkActive,
    handleBulkReparent,
    handleBulkSetColor,
    handleBulkDeleteTaxons,
    handleBulkAssignTaxon,
    handleBulkRemoveTaxon,
    handleBulkGroupSelection,
  } = createBulkHandlers({
    remotes: () => props.remotes(),
    isRemoteAdmin,
    editMode,
    multiSelection: effectiveMultiSelection,
    setMultiSelection: setEffectiveMultiSelection,
    setSelectedId,
    taxonItemsByHub,
    taxonParentsByHub,
    taxonKindMetaByHub,
    taxonIdForNode,
    refreshHub,
    albumIdsForArtist,
  });

  // ---- graph edit panel (edit-mode taxon editor) -------------------------
  // resolves single or multi selection of albums/artists into a remote
  // + bare album-id set, drives a single editor in place of the usual
  // album/artist detail popovers.
  const editPanelRemote = createMemo<Remote | null>(() => {
    if (!editMode()) return null;
    const alb = selectedAlbum();
    if (alb) return remoteForNode(alb) ?? null;
    const art = selectedArtist();
    if (art) return remoteForArtist(art) ?? null;
    const rid = editingRemoteId();
    if (!rid) return null;
    return props.remotes().find((r) => r.remote_id === rid) ?? null;
  });

  const editPanelAlbumIds = createMemo<string[]>(() => {
    if (!editMode()) return [];
    // single album/artist selection
    const alb = selectedAlbum();
    if (alb && multiSelection().size === 0) return [bareAlbumId(alb)];
    const art = selectedArtist();
    if (art && multiSelection().size === 0) {
      const rid = art.sourceRemoteIds?.[0] ?? editingRemoteId();
      if (!rid) return [];
      return albumIdsForArtist(rid, art.artistId);
    }
    // multi selection — collect every album reachable via direct
    // selection or artist fan-out, ignoring taxon-only selections.
    const sel = multiSelection();
    if (sel.size === 0) return [];
    const editingRid = editingRemoteId();
    const out = new Set<string>();
    for (const id of sel) {
      let parsed: ReturnType<typeof parseNodeId>;
      try {
        parsed = parseNodeId(id);
      } catch {
        continue;
      }
      if (parsed.kind === "album") out.add(parsed.albumId);
      else if (parsed.kind === "artist") {
        for (const aid of albumIdsForArtist(parsed.remoteId, parsed.artistId)) out.add(aid);
      }
    }
    // if scope-locked editing remote is set, drop any albums that
    // somehow leaked from a different remote (defensive).
    void editingRid;
    return Array.from(out);
  });

  const editPanelSummary = createMemo<{ artists: string[]; albums: string[] }>(() => {
    const out = { artists: [] as string[], albums: [] as string[] };
    if (!editMode()) return out;
    const alb = selectedAlbum();
    if (alb && multiSelection().size === 0) {
      out.albums.push(alb.title);
      return out;
    }
    const art = selectedArtist();
    if (art && multiSelection().size === 0) {
      out.artists.push(art.name);
      return out;
    }
    for (const id of multiSelection()) {
      const node = lookupNode(id);
      if (!node) continue;
      if ("title" in node) out.albums.push((node as AlbumNodeData).title);
      else if ("name" in node) out.artists.push((node as ArtistNodeData).name);
    }
    return out;
  });

  const editPanelActive = createMemo<boolean>(() => {
    if (!editMode()) return false;
    if (!editPanelRemote()) return false;
    return editPanelAlbumIds().length > 0;
  });

  return (
    <div class="h-full flex flex-col">
      <For each={onlineRemotes()}>
        {(r) => (
          <RemoteAlbumsLoader
            remote={r}
            search={searchQuery}
            onNodes={setNodesFor}
            onFetchingChange={setFetchingFor}
          />
        )}
      </For>

      <Show when={buildResult() === null}>
        <div class="sr-only" data-testid="library-graph-loading" role="status" aria-live="polite">
          <span>loading...</span>
        </div>
      </Show>

      <div ref={containerRef} class="flex-1 min-h-0 relative">
        <WalkCanvas
          graph={buildResult()?.graph ?? { nodes: [], edges: [] }}
          initialPivot={rootId()}
          width={canvasSize().width}
          height={canvasSize().height}
          onClientReady={(c) => setWalkerClient(c)}
          onReady={(api) => setWalkApi(api)}
          onBreadcrumbChange={(depth, ids) => {
            setBreadcrumbDepth(depth);
            setBreadcrumbIds(new Set(ids));
          }}
          onSelect={handleSelect}
          onPivot={handlePivot}
          selectedId={selectedId()}
          getImage={getImage}
          isOfflineNode={isOfflineNode}
          isLoadingNode={isLoadingNode}
          interceptClick={interceptClick}
          editMode={editMode}
          multiSelection={multiSelection}
          onMultiSelectionChange={(ids) => setMultiSelection(ids)}
          onDrop={(sourceIds, targetId) => {
            void handleDrop([...sourceIds], targetId);
          }}
          onEdgeRightClick={(srcId, tgtId) => {
            void handleEdgeRightClick(srcId, tgtId);
          }}
          onExpandSubtree={(id) => toggleEagerHub(id)}
        />

        {/* debug sim-tuning overlay (toggle with shift+d) */}
        <Show when={tuningOverlayOpen()}>
          <SimTuningOverlay
            values={simTuning}
            onChange={(next) => setSimTuning(next)}
            onClose={() => setTuningOverlayOpen(false)}
          />
        </Show>

        {/* edit-mode badge */}
        <Show when={editMode()}>
          {/* subtle pink edge-glow overlay so it's unambiguous the canvas is in edit mode */}
          <div
            class="absolute inset-0 pointer-events-none z-[5]"
            style={{
              "box-shadow": "inset 0 0 24px 4px rgba(244,114,182,0.18)",
              "border-radius": "0",
            }}
          />
          <div class="absolute top-3 right-3 z-20 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-pink-500/40 bg-[rgba(50,0,25,0.85)] backdrop-blur-sm text-[11px] text-pink-300 pointer-events-auto select-none">
            <span>editing hierarchy</span>
            <span class="text-pink-300/50 text-[10px]">(esc)</span>
            <button
              type="button"
              aria-label="exit edit mode"
              class="text-pink-300/70 hover:text-pink-200 cursor-pointer p-0 leading-none"
              onClick={() => {
                setEditingRemoteId(null);
                setMultiSelection(new Set<string>());
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </Show>

        {/* album detail popover */}
        <Show when={selectedAlbum() !== null && !albumPanel.hidden() && !editMode()}>
          <div class="absolute bottom-3 left-3 z-10 max-w-[min(360px,calc(100%-1.5rem))] pointer-events-auto">
            <button
              type="button"
              onClick={albumPanel.hide}
              title="hide details"
              aria-label="hide details"
              class="absolute -top-2 -right-2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-full border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-white/70 hover:text-white hover:border-white/30 cursor-pointer p-0"
            >
              <Icon name="chevronDown" size={12} />
            </button>
            <AlbumDetailPopover
              albums={selectedAlbum() ? [selectedAlbum()!] : []}
              contributingRemotes={
                selectedAlbum() ? contributingRemotesForAlbum(selectedAlbum()!) : undefined
              }
              onPlay={async (album) => {
                const r = remoteForNode(album);
                if (!r) return;
                try {
                  const songs = await fetchAlbumSongs(r, bareAlbumId(album));
                  await playQueue(songs, {
                    source: { type: "album", label: album.title, entity_id: bareAlbumId(album) },
                  });
                } catch (err) {
                  toast.error(`failed to play album: ${(err as Error).message}`);
                }
              }}
              onShuffle={async (album) => {
                const r = remoteForNode(album);
                if (!r) return;
                try {
                  const songs = await fetchAlbumSongs(r, bareAlbumId(album));
                  const shuffled = [...songs].sort(() => Math.random() - 0.5);
                  await playQueue(shuffled, {
                    source: {
                      type: "shuffle",
                      label: album.title,
                      entity_id: bareAlbumId(album),
                    },
                  });
                } catch (err) {
                  toast.error(`failed to shuffle album: ${(err as Error).message}`);
                }
              }}
              onAddToQueue={async (album) => {
                const r = remoteForNode(album);
                if (!r) return;
                try {
                  const songs = await fetchAlbumSongs(r, bareAlbumId(album));
                  await addToQueue(songs, {
                    source: { type: "album", label: album.title, entity_id: bareAlbumId(album) },
                  });
                } catch (err) {
                  toast.error(`failed to enqueue album: ${(err as Error).message}`);
                }
              }}
              onViewAlbum={(album, pickedRemoteId) => {
                const r = resolvePickedRemote(pickedRemoteId, remoteForNode(album));
                const resolved = r ? albumForRemote(album, r.remote_id) : album;
                navigate(routes.albumOn(r?.remote_id ?? null, bareAlbumId(resolved)));
              }}
              onViewArtist={(album, pickedRemoteId) => {
                if (!album.artistId) return;
                const r = resolvePickedRemote(pickedRemoteId, remoteForNode(album));
                const resolved = r ? albumForRemote(album, r.remote_id) : album;
                navigate(
                  routes.artistOn(r?.remote_id ?? null, resolved.artistId || album.artistId)
                );
              }}
              onSelectArtistById={(artistId) => {
                const nodeId = findArtistNodeId(artistId);
                if (nodeId) selectAndPanTo(nodeId);
              }}
              onRelationClick={(kind, label) => {
                const album = selectedAlbum();
                const r = album ? remoteForNode(album) : undefined;
                const remoteId = r?.remote_id ?? album?.sourceRemoteId;
                if (!remoteId) return;
                // keep the album popover open; just fan out the value node
                // like a canvas click would.
                pivotKeepingPanel(valueNodeId(remoteId, kind as RelationKind, slug(label)));
              }}
              onToggleFavorite={(album) => {
                const r = remoteForNode(album);
                favoriteMutation.mutate(
                  {
                    targetType: "album",
                    targetId: bareAlbumId(album),
                    isFavorite: !(album.isFavorite ?? false),
                    remote: r,
                  },
                  {
                    onError: (err) => {
                      toast.error(`failed to toggle favorite: ${(err as Error).message}`);
                    },
                  }
                );
              }}
              onEdit={
                isAnyRemoteAdmin()
                  ? (album, pickedRemoteId) => {
                      const r = resolvePickedRemote(pickedRemoteId, remoteForNode(album));
                      if (!r || !isRemoteAdmin(r.remote_id)) {
                        toast.error("admin permission required");
                        return;
                      }
                      const resolved = albumForRemote(album, r.remote_id);
                      showAlbumEditor({ albumId: bareAlbumId(resolved), remote: r });
                    }
                  : undefined
              }
              onImageClick={(album) => void openAlbumCarousel(album)}
            />
          </div>
        </Show>

        <Show when={selectedAlbum() !== null && albumPanel.hidden() && !editMode()}>
          <CollapsedAlbumButton album={selectedAlbum()!} onRestore={albumPanel.restore} />
        </Show>

        {/* artist detail popover - mutually exclusive with album popover */}
        <Show when={selectedArtist() !== null && !artistPanel.hidden() && !editMode()}>
          <div class="absolute bottom-3 left-3 z-10 max-w-[min(360px,calc(100%-1.5rem))] pointer-events-auto">
            <button
              type="button"
              onClick={artistPanel.hide}
              title="hide details"
              aria-label="hide details"
              class="absolute -top-2 -right-2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-full border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-white/70 hover:text-white hover:border-white/30 cursor-pointer p-0"
            >
              <Icon name="chevronDown" size={12} />
            </button>
            <ArtistDetailPopover
              artist={selectedArtistDisplay()!}
              contributingRemotes={
                selectedArtist() ? contributingRemotesForArtist(selectedArtist()!) : undefined
              }
              bio={artistQuery.data?.bio ?? null}
              isFavorite={artistQuery.data?.is_favorite}
              dataSourceRemoteName={selectedArtistRemote()?.name ?? null}
              dataSourceRemoteId={selectedArtistRemote()?.remote_id ?? null}
              dataSourceRemotes={dataSourceRemotesForSelected()}
              onPickDataSourceRemote={(remoteId) => {
                const a = selectedArtist();
                if (!a) return;
                setDataSourceRemoteOverride({ artistSlug: slug(a.name), remoteId });
              }}
              albums={selectedArtistAlbums()}
              onSelectAlbum={(album) => selectAndPanTo(album.id)}
              relatedArtists={augmentedRelatedArtists().artists}
              relatedArtistMeta={augmentedRelatedArtists().meta}
              onSelectRelatedArtist={(artist) => {
                // stub rows (external / not-yet-loaded) have artistId=""
                // and no node in the graph — skip the pan.
                if (!artist.artistId) return;
                if (!lookupNode(artist.id)) return;
                selectAndPanTo(artist.id);
              }}
              onRelationClick={(kind, label) => {
                const artist = selectedArtist();
                const r = artist ? remoteForArtist(artist) : undefined;
                const remoteId = r?.remote_id ?? artist?.sourceRemoteIds?.[0];
                if (!remoteId) return;
                // keep the artist popover open; just fan out the value node
                // like a canvas click would.
                pivotKeepingPanel(valueNodeId(remoteId, kind as RelationKind, slug(label)));
              }}
              onViewArtist={(artist, pickedRemoteId) => {
                const r = resolvePickedRemote(pickedRemoteId, remoteForArtist(artist));
                const resolved = r ? artistForRemote(artist, r.remote_id) : artist;
                navigate(
                  routes.artistOn(r?.remote_id ?? null, resolved.artistId || artist.artistId)
                );
              }}
              onEdit={
                isAnyRemoteAdmin()
                  ? (artist, pickedRemoteId) => {
                      const r = resolvePickedRemote(pickedRemoteId, remoteForArtist(artist));
                      if (!r || !isRemoteAdmin(r.remote_id)) {
                        toast.error("admin permission required");
                        return;
                      }
                      const resolved = artistForRemote(artist, r.remote_id);
                      if (!resolved.artistId) {
                        toast.error("could not resolve artist id on selected remote");
                        return;
                      }
                      showArtistEditor({ artistId: resolved.artistId, remote: r });
                    }
                  : undefined
              }
              onToggleFavorite={(artist, next) => {
                favoriteMutation.mutate(
                  { targetType: "artist", targetId: artist.artistId, isFavorite: next },
                  {
                    onError: (err) => {
                      toast.error(`failed to toggle favorite: ${(err as Error).message}`);
                    },
                  }
                );
              }}
              onImageClick={(artist) => void openArtistCarousel(artist)}
            />
          </div>
        </Show>

        <Show when={selectedArtist() !== null && artistPanel.hidden() && !editMode()}>
          <CollapsedArtistButton
            artist={selectedArtistDisplay()!}
            onRestore={artistPanel.restore}
          />
        </Show>

        {/* graph edit panel — shown in edit mode when selection
            resolves to one or more albums (directly or via artist
            fan-out). replaces the album/artist detail popovers. */}
        <Show when={editPanelActive()}>
          <div class="absolute bottom-3 left-3 z-10 max-w-[min(360px,calc(100%-1.5rem))] pointer-events-auto">
            <GraphEditPanel
              remote={editPanelRemote}
              albumIds={editPanelAlbumIds}
              summary={editPanelSummary}
              onClose={() => {
                setSelectedId(null);
                setMultiSelection(new Set<string>());
              }}
              onAfterMutate={async () => {
                // refresh every taxon hub on the active remote so the
                // graph reflects the new links (counts, edges, etc.).
                const rid = editPanelRemote()?.remote_id;
                if (!rid) return;
                for (const hubId of taxonItemsByHub.keys()) {
                  if (hubId.startsWith(`${rid}::`)) await refreshHub(hubId);
                }
              }}
            />
          </div>
        </Show>

        {/* bulk-selection popover — shown in edit mode when multi-select has 2+ */}
        <Show when={bulkActive() && !editPanelActive()}>
          <div class="absolute bottom-3 left-3 z-10 max-w-[min(320px,calc(100%-1.5rem))] pointer-events-auto">
            <BulkSelectionPopover
              mode={bulkMode}
              counts={bulkCounts}
              allGroups={bulkAllGroups}
              kindLabel={() => {
                const hub = bulkRelHubId();
                return hub ? taxonKindMetaByHub.get(hub)?.label : undefined;
              }}
              kindColor={() => {
                const hub = bulkRelHubId();
                return hub ? (taxonKindMetaByHub.get(hub)?.color ?? undefined) : undefined;
              }}
              candidateParents={bulkCandidateParents}
              availableTaxons={bulkAvailableTaxons}
              currentTaxons={bulkCurrentTaxons}
              canEdit={bulkCanEdit}
              onReparentTo={(pid) => {
                void handleBulkReparent(pid);
              }}
              onSetColor={(c) => {
                void handleBulkSetColor(c);
              }}
              onDeleteTaxons={() => {
                void handleBulkDeleteTaxons();
              }}
              onAssignTaxon={(tid) => {
                void handleBulkAssignTaxon(tid);
              }}
              onRemoveTaxon={(tid) => {
                void handleBulkRemoveTaxon(tid);
              }}
              onGroupSelected={(label) => {
                void handleBulkGroupSelection(label);
              }}
              onClose={() => setMultiSelection(new Set<string>())}
            />
          </div>
        </Show>

        {/* taxon detail popover — shown when a value or group node is selected */}
        <Show when={selectedTaxonInfo() !== null && !taxonPanelHidden() && !bulkActive()}>
          <div class="absolute bottom-3 left-3 z-10 max-w-[min(288px,calc(100%-1.5rem))] pointer-events-auto">
            <button
              type="button"
              onClick={() => setTaxonPanelHidden(true)}
              title="hide details"
              aria-label="hide details"
              class="absolute -top-2 -right-2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-full border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-white/70 hover:text-white hover:border-white/30 cursor-pointer p-0"
            >
              <Icon name="chevronDown" size={12} />
            </button>
            <TaxonDetailPopover
              taxon={() => selectedTaxonData()?.taxon ?? null}
              kindLabel={() => taxonKindMetaByHub.get(selectedTaxonInfo()?.relHubId ?? "")?.label}
              kindSlug={() => selectedTaxonInfo()?.kindSlug}
              kindColor={() =>
                taxonKindMetaByHub.get(selectedTaxonInfo()?.relHubId ?? "")?.color ?? undefined
              }
              albumCount={() => selectedTaxonInfo()?.albumCount}
              parents={() => selectedTaxonData()?.ancestors ?? []}
              descendants={() => selectedTaxonData()?.descendants ?? []}
              canEdit={() => isRemoteAdmin(selectedTaxonInfo()?.remoteId ?? null)}
              onEditHierarchy={() => {
                const remoteId = selectedTaxonInfo()?.remoteId ?? null;
                if (editingRemoteId() === remoteId) {
                  setEditingRemoteId(null);
                  setMultiSelection(new Set<string>());
                } else if (remoteId) {
                  setEditingRemoteId(remoteId);
                }
              }}
              onClose={() => setSelectedId(null)}
              isGroup={() => (selectedTaxonData()?.descendants?.length ?? 0) > 0}
              editMode={editMode}
              onCreateTaxon={(label) => {
                void handleCreateTaxon(label);
              }}
              onRenameTaxon={async (label) => {
                const info = selectedTaxonInfo();
                if (!info?.taxonId) return;
                const remote = props.remotes().find((r) => r.remote_id === info.remoteId);
                if (!remote) return;
                if (!isRemoteAdmin(info.remoteId)) return;
                try {
                  const apiClient = await getClientForRemote(remote);
                  await apiClient.music.set_taxon_label({
                    taxon_id: info.taxonId,
                    label,
                  });
                  await refreshHub(info.relHubId);
                } catch (err) {
                  console.warn("[graph] rename taxon failed", err);
                  toast.error("failed to rename taxon");
                }
              }}
              onDeleteTaxon={() => {
                void handleDeleteTaxon();
              }}
              filterQuery={activeHubFilterQuery}
              onFilterChange={(query) => {
                const key = filterContextKey();
                if (!key) return;
                const next = new Map(taxonFilterByHub());
                if (query.length === 0) next.delete(key);
                else next.set(key, query);
                setTaxonFilterByHub(next);
              }}
              matchCount={() => hubFilterIds().matchIds.size}
              onSelectMatches={() => {
                const ids = hubFilterIds().matchIds;
                if (ids.size === 0) return;
                setMultiSelection(new Set(ids));
              }}
              filterValuesOnly={activeHubFilterValuesOnly}
              onFilterValuesOnlyChange={(valuesOnly) => {
                const info = selectedTaxonInfo();
                if (!info) return;
                const next = new Map(taxonFilterValuesOnlyByHub());
                next.set(info.relHubId, valuesOnly);
                setTaxonFilterValuesOnlyByHub(next);
              }}
              filterScope={activeFilterScope}
              inferredFilterScope={inferredFilterScope}
              onFilterScopeChange={(scope) => {
                const key = filterContextKey();
                if (!key) return;
                const next = new Map(taxonFilterScopeByHub());
                if (scope === null) next.delete(key);
                else next.set(key, scope);
                setTaxonFilterScopeByHub(next);
              }}
              onExpandSubtree={() => {
                const id = selectedId();
                if (!id) return;
                const parsed = parseNodeId(id);
                if (parsed.kind !== "group") return;
                toggleEagerHub(id);
                walkerClient()?.expandSubtree(id);
              }}
              isExpanded={() => {
                const id = selectedId();
                return id ? eagerHubIds().has(id) : false;
              }}
              unassignedPager={buildUnassignedPager()}
              onSetColor={(color) => {
                const info = selectedTaxonInfo();
                if (!info?.taxonId) return;
                const remote = props.remotes().find((r) => r.remote_id === info.remoteId);
                if (!remote) return;
                void (async () => {
                  try {
                    const apiClient = await getClientForRemote(remote);
                    await apiClient.music.set_taxon_color({
                      taxon_id: info.taxonId!,
                      color: color ?? null,
                    });
                  } catch (err) {
                    console.warn("set taxon color failed", { taxonId: info.taxonId, err });
                  }
                })();
              }}
              onRenameKind={async (label) => {
                const info = selectedTaxonInfo();
                if (!info) return;
                const remote = props.remotes().find((r) => r.remote_id === info.remoteId);
                if (!remote) return;
                if (!isRemoteAdmin(info.remoteId)) return;
                const kindSlug = info.kindSlug;
                const relHubId = info.relHubId;
                try {
                  const apiClient = await getClientForRemote(remote);
                  await apiClient.music.set_taxon_kind_label({
                    kind_slug: kindSlug,
                    label,
                  });
                  // optimistic local label update + hub re-merge so the
                  // hexagon picks up the new name without a refetch.
                  const prevMeta = taxonKindMetaByHub.get(relHubId);
                  if (prevMeta) {
                    taxonKindMetaByHub.set(relHubId, { ...prevMeta, label });
                  }
                  walkerClient()?.merge(
                    [
                      {
                        id: relHubId,
                        role: "relation",
                        label,
                        parentId: remoteHubId(info.remoteId),
                        childCount: info.albumCount ?? 0,
                        lazy: true,
                        tint: prevMeta?.color ?? undefined,
                      },
                    ],
                    []
                  );
                  // mirror the new label back into selectedTaxonInfo so the
                  // popover header reflects the change immediately.
                  setSelectedTaxonInfo((prev) => (prev ? { ...prev, label } : prev));
                  toast.success("kind renamed");
                } catch (err) {
                  console.warn("[graph] rename taxon kind failed", err);
                  toast.error("failed to rename kind");
                }
              }}
              onSetKindColor={(color) => {
                const info = selectedTaxonInfo();
                if (!info) return;
                const remote = props.remotes().find((r) => r.remote_id === info.remoteId);
                if (!remote) return;
                const kindSlug = info.kindSlug;
                const relHubId = info.relHubId;
                void (async () => {
                  try {
                    const apiClient = await getClientForRemote(remote);
                    const result = await apiClient.music.set_taxon_kind_color({
                      kind_slug: kindSlug,
                      color: color ?? null,
                    });
                    // optimistic local update so the hexagon re-tints
                    // without waiting for a refetch.
                    const prevMeta = taxonKindMetaByHub.get(relHubId);
                    if (prevMeta) {
                      taxonKindMetaByHub.set(relHubId, {
                        ...prevMeta,
                        color: color ?? null,
                      });
                    }
                    // re-merge the hub node so WalkCanvas picks up the new tint.
                    walkerClient()?.merge(
                      [
                        {
                          id: relHubId,
                          role: "relation",
                          label: prevMeta?.label ?? kindSlug,
                          parentId: remoteHubId(info.remoteId),
                          childCount: info.albumCount ?? 0,
                          lazy: true,
                          tint: color ?? undefined,
                        },
                      ],
                      []
                    );
                    toast.success(color ? `kind color set to ${color}` : "kind color cleared");
                    void result;
                  } catch (err) {
                    console.warn("set taxon kind color failed", {
                      kindSlug,
                      err,
                    });
                    toast.error("failed to set kind color");
                  }
                })();
              }}
            />
          </div>
        </Show>

        <Show when={selectedTaxonInfo() !== null && taxonPanelHidden() && !bulkActive()}>
          {(() => {
            const info = selectedTaxonInfo();
            const taxon = selectedTaxonData()?.taxon ?? null;
            const kindColor = taxonKindMetaByHub.get(info?.relHubId ?? "")?.color ?? null;
            const swatch = taxon?.color ?? kindColor;
            const label = info?.label ?? taxon?.label ?? "taxon";
            return (
              <CollapsedTaxonButton
                label={label}
                swatch={swatch ?? null}
                onRestore={() => setTaxonPanelHidden(false)}
                pager={(() => {
                  const pg = buildUnassignedPager();
                  if (!pg) return undefined;
                  const pageCount = () => {
                    const t = pg.total();
                    const ps = pg.pageSize();
                    if (t <= 0 || ps <= 0) return 1;
                    return Math.max(1, Math.ceil(t / ps));
                  };
                  return {
                    pageIndex: pg.pageIndex,
                    pageCount,
                    consumed: pg.consumed,
                    total: pg.total,
                    canPrev: pg.canPrev,
                    canNext: pg.canNext,
                    onPrev: pg.onPrev,
                    onNext: pg.onNext,
                  };
                })()}
              />
            );
          })()}
        </Show>

        {/* remote root detail popover — shown when a remote hub is selected */}
        <Show when={selectedRemote() !== null && !taxonPanelHidden() && !bulkActive()}>
          <div class="absolute bottom-3 left-3 z-10 max-w-[min(288px,calc(100%-1.5rem))] pointer-events-auto">
            <button
              type="button"
              onClick={() => setTaxonPanelHidden(true)}
              title="hide details"
              aria-label="hide details"
              class="absolute -top-2 -right-2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-full border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-white/70 hover:text-white hover:border-white/30 cursor-pointer p-0"
            >
              <Icon name="chevronDown" size={12} />
            </button>
            <RemoteDetailPopover
              remote={selectedRemote}
              canEdit={() => isRemoteAdmin(selectedRemote()?.remote_id ?? null)}
              taxonKinds={() => taxonKindsByRemote().get(selectedRemote()?.remote_id ?? "") ?? []}
              onClose={() => setSelectedId(null)}
              onBrowse={() => {
                const r = selectedRemote();
                if (!r) return;
                navigate(getDefaultRoute(r.remote_id));
              }}
              isEditing={() => {
                const r = selectedRemote();
                return !!r && editingRemoteId() === r.remote_id;
              }}
              onToggleEdit={() => {
                const r = selectedRemote();
                if (!r) return;
                if (editingRemoteId() === r.remote_id) {
                  setEditingRemoteId(null);
                  setMultiSelection(new Set<string>());
                } else {
                  setEditingRemoteId(r.remote_id);
                }
              }}
              onCreateTaxon={(kindSlug, label) => {
                const remote = selectedRemote();
                if (!remote) return;
                void (async () => {
                  try {
                    const apiClient = await getClientForRemote(remote);
                    const created = await apiClient.music.createTaxon({
                      kind_slug: kindSlug,
                      label,
                    });
                    if (!created.success || !created.data) {
                      toast.error("failed to create taxon");
                      return;
                    }
                    toast.success(`taxon '${label}' created`);
                    // re-fetch kinds so the hub list + counts pick up
                    // the newly-created taxon's parent kind and so the
                    // relation hub appears if it was previously empty.
                    taxonKindsLoadedRemotes.delete(remote.remote_id);
                    await loadTaxonKindsForRemote(remote);
                    taxonKindsLoadedRemotes.add(remote.remote_id);
                    // invalidate cached taxon items for this kind so a
                    // subsequent pivot re-fetches and the new taxon
                    // shows up as a value node.
                    const relHubId = relationHubId(remote.remote_id, kindSlug);
                    taxonsLoadedByHub.delete(relHubId);
                  } catch (err) {
                    console.warn("create taxon failed", { kindSlug, label, err });
                    toast.error("failed to create taxon");
                  }
                })();
              }}
              onCreateKind={(input) => {
                const remote = selectedRemote();
                if (!remote) return;
                void (async () => {
                  try {
                    const apiClient = await getClientForRemote(remote);
                    const created = await apiClient.music.createTaxonKind({
                      slug: input.slug,
                      label: input.label,
                      description: null,
                      color: input.color,
                      value_type: null,
                      unit: null,
                      display_order: null,
                    });
                    if (!created.success) {
                      toast.error(`failed to create kind '${input.slug}'`);
                      return;
                    }
                    toast.success(`kind '${input.label}' created`);
                    // re-fetch kinds so the new kind shows up in the
                    // chip list. note: empty kinds aren't seeded as
                    // hub nodes (loadTaxonKindsForRemote skips when
                    // album_count <= 0), so no walker merge here.
                    taxonKindsLoadedRemotes.delete(remote.remote_id);
                    await loadTaxonKindsForRemote(remote);
                    taxonKindsLoadedRemotes.add(remote.remote_id);
                  } catch (err) {
                    console.warn("create taxon kind failed", { input, err });
                    toast.error(`failed to create kind '${input.slug}'`);
                  }
                })();
              }}
            />
          </div>
        </Show>

        <Show when={selectedRemote() !== null && taxonPanelHidden() && !bulkActive()}>
          <CollapsedRemoteButton
            label={selectedRemote()?.name ?? "remote"}
            onRestore={() => setTaxonPanelHidden(false)}
          />
        </Show>
      </div>
    </div>
  );
}
