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
import { useLibraryAlbumsQuery } from "../../queries/useLibraryAlbums";
import { useTopNavSlots } from "../../../app/shell/topNavSlots";
import { adaptAlbum } from "./adaptAlbum";
import { deriveArtistNodes } from "./deriveArtistNodes";
import { addToQueue, playQueue } from "../../../music/services/queue/queue";
import { routes } from "../../../music/utils/routing";
import { useToggleFavoriteMutation } from "../../../music/queries/favorites";
import { toast } from "../../../components/feedback/Toast";
import { isNarrowViewport } from "../../../config/breakpoints";
import { setPageInfo, clearPageInfo } from "../../../app/services/pageInfo";
import type { AlbumNodeData, ArtistNodeData } from "../../../components/graph/types";
import { getAuthStatus, getAuthInfo } from "../../../app/services/remotes/authStatusStore";
import { permissions, type UserRoleName } from "freqhole-api-client";
import {
  showAlbumEditor,
  showArtistEditor,
  isAnyModalOpen,
  showImageCarousel,
  formatImageCarouselTitle,
} from "../../../music/hooks/modals";
import { resolveBlobUrl } from "../../../music/services/storage/blobResolver";
import { usesBlobResolver } from "../../../music/services/storage/transportCache";
import { resolveLocalBlobUrl } from "../../../music/utils/images";
import { getArtistAbbreviation } from "../../../music/utils/format";
import { useArtistQuery } from "../../../music/queries/songs";
import type { ImageMetadata } from "../../../music/services/storage/types";
import WalkCanvas from "../../../components/graph/WalkCanvas";
import type { WalkApi } from "../../../components/graph/WalkCanvas";
import type { WalkerClient } from "../../../components/graph/worker/client";
import { GraphTopNavTools } from "../../../components/graph/GraphTopNavTools";
import { buildWalkGraph } from "../../../components/graph/data/buildWalkGraph";
import {
  rootId,
  parseNodeId,
  slug,
  remoteHubId,
  relationHubId,
  valueNodeId,
  artistNodeId,
  ghostArtistId,
  type RelationKind,
} from "../../../components/graph/data/nodeIds";
import type { WalkNode, WalkEdge } from "../../../components/graph/types";
import { getClientForRemote } from "../../../app/api/client";
import {
  checkRemoteHealth,
  onRemoteStatusChange,
  getRemoteById,
} from "../../../app/services/remotes/remoteManager";
import { adaptApiImage, adaptApiUrls } from "../../../music/data/remote/adapters";
import type { AlbumSummary } from "../../../music/data/types";
import { AlbumDetailPopover } from "../../../components/graph/AlbumDetailPopover";
import { ArtistDetailPopover } from "../../../components/graph/ArtistDetailPopover";
import type { ContributingRemote } from "../../../components/graph/RemoteSplitButton";
import { useDetailPanelHide } from "../../../components/graph/useDetailPanelHide";
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

// ---- per-remote loader ------------------------------------------------------

/** mounts one infinite query per remote, emits adapted album nodes
 *  back via onNodes as pages stream in. */
function RemoteAlbumsLoader(props: {
  remote: Remote;
  search: () => string;
  onNodes: (remoteId: string, nodes: AlbumNodeData[]) => void;
  onFetchingChange?: (remoteId: string, fetching: boolean) => void;
}) {
  // 2026-05-26: lazy-load phase 1. previously this loader auto-paginated
  // the entire album catalogue per remote to populate relation hubs.
  // now we only fetch page 1 (a sample sized for first-render usefulness)
  // and rely on per-pivot query_taxons / query_albums calls to fill in
  // the rest on demand. ramp-up + fetchNextPage loop removed.
  const PAGE_SIZE = 200;

  const albumsQuery = useLibraryAlbumsQuery({
    remote: () => props.remote,
    search: () => props.search() || undefined,
    pageSize: PAGE_SIZE,
    disablePolling: true,
  });

  // report in-flight status. only the first page now, so this clears as
  // soon as that single fetch settles.
  createEffect(() => {
    const q = albumsQuery;
    const fetching = q.isFetching;
    props.onFetchingChange?.(props.remote.remote_id, fetching);
  });
  onCleanup(() => {
    props.onFetchingChange?.(props.remote.remote_id, false);
  });

  // emit adapted nodes per page (only fires when page count/total changes)
  let lastPages = -1;
  let lastCount = -1;
  createEffect(() => {
    const pages = albumsQuery.data?.pages ?? [];
    if (pages.length === 0) return;
    const id = props.remote.remote_id;
    const out: AlbumNodeData[] = [];
    for (const page of pages) {
      for (const summary of page.items) {
        out.push(adaptAlbum(summary, { remoteId: id }));
      }
    }
    if (pages.length === lastPages && out.length === lastCount) return;
    lastPages = pages.length;
    lastCount = out.length;
    props.onNodes(id, out);
  });

  return null;
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

  // admin state drives edit buttons in popovers
  const authStatus = getAuthStatus();
  const isRemoteAdmin = (remoteId: string | null | undefined): boolean => {
    if (!remoteId) return false;
    const entry = authStatus().get(remoteId) ?? getAuthInfo(remoteId);
    if (!entry || !entry.loggedIn || !entry.role) return false;
    return permissions.isAdmin(entry.role as UserRoleName);
  };
  const isAnyRemoteAdmin = (): boolean => {
    for (const r of props.remotes()) if (isRemoteAdmin(r.remote_id)) return true;
    return false;
  };

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
  // remotes for which we've already fetched taxon kinds and seeded
  // first-order relation hubs into the graph.
  const taxonKindsLoadedRemotes = new Set<string>();
  // relation hubs whose query_taxons fetch has settled (success OR error).
  // prevents re-firing on every pivot revisit.
  const taxonsLoadedByHub = new Set<string>();
  // shared in-flight taxon fetches keyed by relation-hub id. lets the
  // value-pivot album loader await the parent hub's fetch without
  // duplicating the request when both fire on the same gesture.
  const taxonFetchPromises = new Map<string, Promise<void>>();
  // value/artist pivots whose lazy album fetch has been issued. dedup
  // guard for query_albums calls in maybeLoadAlbumsForPivot.
  const albumsLoadedByPivot = new Set<string>();
  // taxon metadata by parent relation hub id -> slug -> { id, label }.
  // populated by maybeLoadTaxonsForPivot; used by value-pivot album
  // fetch to look up the original label / taxon id for filter shaping.
  const taxonItemsByHub = new Map<string, Map<string, { id: string; label: string }>>();
  const [extraNodesById, setExtraNodesById] = createSignal<
    Map<string, AlbumNodeData | ArtistNodeData>
  >(new Map());
  type LookupState = "loading" | "loaded" | "absent";
  const crossRemoteLookups = new Map<string, LookupState>();

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
      const rhId = remoteHubId(remoteId);
      const SKIP_SLUGS = new Set(["favorite", "favorites"]);
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
    for (const [remoteId, albums] of nodesByRemote()) {
      const favIds = new Set<string>();
      for (const a of albums) {
        if (a.isFavorite && a.artistId) favIds.add(a.artistId);
      }
      out.set(remoteId, deriveArtistNodes(albums, favIds));
    }
    return out;
  });

  const buildResult = createMemo(() => {
    const byRemote = nodesByRemote();
    // include every selected remote so offline / not-yet-loaded remotes still
    // surface in the graph as remote hubs (dimmed if offline). filtering by
    // data presence would hide them entirely.
    const remoteIds = props.remotes().map((r) => r.remote_id);
    if (remoteIds.length === 0) return null;
    return buildWalkGraph({
      remoteIds,
      albumsByRemote: byRemote,
      artistsByRemote: artistsByRemote(),
      favoriteSongAlbumIds: favSongAlbumIds(),
      favoriteSongArtistIds: favSongArtistIds(),
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

  let hadInit = false;
  const prevNodeIds = new Set<string>();
  const prevEdgeKeys = new Set<string>();
  let prevRemoteKey = "";

  createEffect(() => {
    const client = walkerClient();
    if (!client) return;
    const result = buildResult();
    if (!result || result.graph.nodes.length === 0) return;

    // detect remote-set change (user added/removed a remote) -> full reset
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
    }

    const { width, height } = canvasSize();

    if (!hadInit) {
      hadInit = true;
      for (const n of result.graph.nodes) prevNodeIds.add(n.id);
      for (const e of result.graph.edges) prevEdgeKeys.add(`${e.source}::${e.target}`);
      client.init(result.graph, rootId(), width, height);
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

  // subscribe to visible-ids to trigger cross-remote artist lookups
  createEffect(() => {
    const client = walkerClient();
    if (!client) return;
    const unsub = client.onVisibleIds((ids) => {
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

  const selectedAlbum = createMemo<AlbumNodeData | null>(() => {
    const id = selectedId();
    if (!id) return null;
    const node = lookupNode(id);
    if (!node || !("title" in node)) return null;
    return node as AlbumNodeData;
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

  const albumPanel = useDetailPanelHide(selectedAlbum);
  const artistPanel = useDetailPanelHide(selectedArtist);

  const selectedArtistAlbums = createMemo<AlbumNodeData[]>(() => {
    const artist = selectedArtist();
    if (!artist) return [];
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
        if ("title" in node && (node as AlbumNodeData).artistId === artist.artistId) {
          out.push({ ...(node as AlbumNodeData), id: key });
        }
      }
    };
    const result = buildResult();
    if (result) addFromMap(result.nodesById);
    addFromMap(extraNodesById());
    return out;
  });

  const artistQuery = useArtistQuery(() => selectedArtist()?.artistId ?? undefined);

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
      const remote = remoteForArtist(a);
      if (!remote) {
        console.warn("[graph] related-artists source: no remote for artist", {
          id: a.id,
          artistId: a.artistId,
          name: a.name,
          sourceRemoteIds: a.sourceRemoteIds,
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
    async (key): Promise<ArtistNodeData[]> => {
      try {
        const client = await getClientForRemote(key.remote);
        console.info("[graph] related-artists fetch start", {
          artistId: key.artistId,
          remote: key.remote.remote_id,
        });
        const result = await client.music.listRelatedArtists({ artist_id: key.artistId });
        if (!result.success || !result.data) {
          console.warn("[graph] related-artists fetch returned no data", {
            artistId: key.artistId,
            remote: key.remote.remote_id,
            success: result.success,
            result,
          });
          return [];
        }
        const remoteId = key.remote.remote_id;
        const out: ArtistNodeData[] = [];
        const seen = new Set<string>();
        // name-slug index over already-loaded artists for fallback
        // matches when related_artist_id is null but a same-remote
        // artist with the same name exists.
        const byNameSameRemote = new Map<string, ArtistNodeData>();
        const byNameAnyRemote = new Map<string, ArtistNodeData>();
        const maps = [buildResult()?.nodesById, extraNodesById()] as const;
        for (const map of maps) {
          if (!map) continue;
          for (const node of map.values()) {
            if (!("artistId" in node)) continue;
            const a = node as ArtistNodeData;
            const k = slug(a.name);
            if (!k) continue;
            if (!byNameAnyRemote.has(k)) byNameAnyRemote.set(k, a);
            const nr = a.sourceRemoteIds?.[0];
            if (nr === remoteId && !byNameSameRemote.has(k)) {
              byNameSameRemote.set(k, a);
            }
          }
        }
        let resolved = 0;
        for (const row of result.data.items) {
          let match: ArtistNodeData | null = null;
          if (row.in_library && row.related_artist_id) {
            const explicit = artistNodeId(remoteId, row.related_artist_id);
            const node =
              buildResult()?.nodesById.get(explicit) ?? extraNodesById().get(explicit) ?? null;
            if (node && "artistId" in node) match = node as ArtistNodeData;
          }
          if (!match) {
            const nameKey = slug(row.related_name ?? "");
            if (nameKey) {
              match = byNameSameRemote.get(nameKey) ?? byNameAnyRemote.get(nameKey) ?? null;
            }
          }
          if (match) {
            if (match.artistId === key.artistId) continue;
            if (seen.has(match.id)) continue;
            seen.add(match.id);
            out.push(match);
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
        return [...resolvedRows, ...stubRows];
      } catch (err) {
        console.warn("popover related-artists fetch failed", err);
        return [];
      }
    }
  );

  // per-id image lookup for WalkCanvas artwork rendering (per S1/S11)
  const getImage = (
    id: string
  ): import("../../../music/services/storage/types").ImageMetadata | null =>
    lookupNode(id)?.image ?? null;

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
  const toContributingRemote = (r: Remote): ContributingRemote => ({
    id: r.remote_id,
    name: r.name,
    isCharnelManaged: !!r.is_charnel_managed,
    imageUrl: r.image_url ?? null,
  });
  const sortContributingRemotes = (refs: ContributingRemote[]): ContributingRemote[] =>
    [...refs].sort((a, b) => {
      if (!!a.isCharnelManaged !== !!b.isCharnelManaged) {
        return a.isCharnelManaged ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  const contributingRemotesForArtist = (artist: ArtistNodeData): ContributingRemote[] => {
    const target = slug(artist.name);
    if (!target) return [];
    const out: ContributingRemote[] = [];
    const byRemote = artistsByRemote();
    for (const r of props.remotes()) {
      const list = byRemote.get(r.remote_id) ?? [];
      if (list.some((a) => slug(a.name) === target)) {
        out.push(toContributingRemote(r));
      }
    }
    return sortContributingRemotes(out);
  };
  const contributingRemotesForAlbum = (album: AlbumNodeData): ContributingRemote[] => {
    const targetTitle = slug(album.title);
    const targetArtist = slug(album.artistName ?? "");
    if (!targetTitle) return [];
    const out: ContributingRemote[] = [];
    const byRemote = nodesByRemote();
    for (const r of props.remotes()) {
      const list = byRemote.get(r.remote_id) ?? [];
      if (
        list.some((a) => slug(a.title) === targetTitle && slug(a.artistName ?? "") === targetArtist)
      ) {
        out.push(toContributingRemote(r));
      }
    }
    return sortContributingRemotes(out);
  };
  const resolvePickedRemote = (
    picked: string | undefined,
    fallback: Remote | undefined
  ): Remote | undefined => {
    if (picked) {
      const match = props.remotes().find((r) => r.remote_id === picked);
      if (match) return match;
    }
    return fallback;
  };

  // find the artist record on `remote` that corresponds to `artist`
  // (matched on name slug). cluster-leader nodes carry the id of
  // whichever remote contributed the leader, so when the user picks a
  // different remote from the split-button flyout we must look up the
  // picked-remote's own id for the same artist before opening the
  // editor or navigating. returns the original artist when no match
  // is found so callers can still attempt the action.
  const artistForRemote = (artist: ArtistNodeData, remoteId: string): ArtistNodeData => {
    const target = slug(artist.name);
    if (!target) return artist;
    const list = artistsByRemote().get(remoteId);
    if (!list) return artist;
    const found = list.find((a) => slug(a.name) === target);
    return found ?? artist;
  };

  // same idea for albums: match on (title, artistName) slug pair.
  const albumForRemote = (album: AlbumNodeData, remoteId: string): AlbumNodeData => {
    const targetTitle = slug(album.title);
    const targetArtist = slug(album.artistName ?? "");
    if (!targetTitle) return album;
    const list = nodesByRemote().get(remoteId);
    if (!list) return album;
    const found = list.find(
      (a) => slug(a.title) === targetTitle && slug(a.artistName ?? "") === targetArtist
    );
    return found ?? album;
  };

  /** select a node and pan the canvas to it without resetting the
   *  breadcrumb. used by detail popover links (album row, relation chip,
   *  related-artist row) to keep ui in sync with the visual focus. */
  const selectAndPanTo = (nodeId: string) => {
    setSelectedId(nodeId);
    albumPanel.restore();
    artistPanel.restore();
    walkerClient()?.repivot(nodeId, false);
  };

  const fetchAlbumSongs = async (remote: Remote, albumId: string) => {
    const { RemoteMusicDataSource } = await import("../../../music/data/remote/remoteSource");
    const ds = new RemoteMusicDataSource(remote);
    const resp = await ds.getAlbumSongs(albumId);
    return resp.items;
  };

  const buildImageUrls = async (
    image: ImageMetadata | null | undefined,
    imageUrl: string | null | undefined,
    fallbackRemoteId?: string | null
  ): Promise<string[]> => {
    const urls: string[] = [];
    const add = (u: string | null | undefined) => {
      if (!u || urls.includes(u)) return;
      urls.push(u);
    };
    add(imageUrl);
    if (image) {
      add(image.remote_url);
      const blobId = image.remote_blob_id || image.local_blob_id;
      const serverId = image.remote_server_id || fallbackRemoteId;
      if (blobId && serverId) {
        try {
          if (await usesBlobResolver(serverId)) {
            add(await resolveBlobUrl(blobId, serverId, "image"));
          }
        } catch {
          // best-effort
        }
      }
      if (image.local_blob_id && !image.remote_server_id) {
        try {
          add(await resolveLocalBlobUrl(image.local_blob_id));
        } catch {
          /* ignore */
        }
      }
    }
    return urls;
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

  // batched cross-remote lookup: takes a map of slug→artistName for one
  // remote, fires a single queryAlbums call using the artist_names
  // filter, then merges all matching artist+album nodes in one pass.
  // each candidate slug is then marked "loaded" if any albums matched,
  // or "absent" otherwise.
  const batchLookupAndMerge = async (otherRemoteId: string, candidates: Map<string, string>) => {
    if (candidates.size === 0) return;
    const remote = props.remotes().find((r) => r.remote_id === otherRemoteId);
    if (!remote) {
      for (const slugKey of candidates.keys()) {
        crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "absent");
      }
      return;
    }
    // re-check offline at fire time (the dispatch loop also checks,
    // but the remote may have flipped between scheduling and firing).
    if (offlineByRemote().get(otherRemoteId) === true) {
      for (const slugKey of candidates.keys()) {
        crossRemoteLookups.delete(`${otherRemoteId}::${slugKey}`);
      }
      return;
    }

    const names = Array.from(candidates.values());
    const fetchKey = `xremote-batch::${otherRemoteId}::${Array.from(candidates.keys()).sort().join(",")}`;
    try {
      setFetchingByRemote((prev) => {
        const next = new Map(prev);
        next.set(fetchKey, true);
        return next;
      });
      const summaries = await queryClient.fetchQuery({
        queryKey: ["xremote-artist-batch", otherRemoteId, ...names.slice().sort()] as const,
        queryFn: async () => {
          const client = await getClientForRemote(remote);
          const resp = await client.music.queryAlbums({
            q: null,
            search_fields: null,
            filters: { artist_names: names },
            sort_by: null,
            sort_direction: null,
            limit: 1000,
            offset: 0,
            user_id: null,
            favorites_only: null,
            min_rating: null,
          });
          if (!resp.success || !resp.data) throw new Error("xremote album query failed");
          const baseUrl = (remote as { base_url?: string }).base_url ?? "";
          const rid = remote.remote_id;
          return resp.data.items.map(
            (item): AlbumSummary => ({
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
              images: item.images?.length
                ? item.images.map((img) => adaptApiImage(img, baseUrl, rid))
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
            })
          );
        },
        staleTime: 60_000,
      });

      const albums = summaries.map((s) => adaptAlbum(s, { remoteId: otherRemoteId }));
      // bucket matched albums by candidate slug
      const matchesBySlug = new Map<string, typeof albums>();
      for (const a of albums) {
        const s = slug(a.artistName);
        if (!candidates.has(s)) continue;
        if (!matchesBySlug.has(s)) matchesBySlug.set(s, []);
        matchesBySlug.get(s)!.push(a);
      }

      // mark absent for any candidate that produced no matches
      for (const slugKey of candidates.keys()) {
        if (!matchesBySlug.has(slugKey)) {
          crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "absent");
        }
      }

      const allMatches = albums.filter((a) => candidates.has(slug(a.artistName)));
      if (allMatches.length === 0) return;

      const artistNodes = deriveArtistNodes(allMatches, new Set());
      const slice = buildWalkGraph({
        remoteIds: [otherRemoteId],
        albumsByRemote: new Map([[otherRemoteId, allMatches]]),
        artistsByRemote: new Map([[otherRemoteId, artistNodes]]),
      });

      // include only the artist + album nodes and the edges directly
      // connecting them. skip relation/value hubs — they'd be orphans
      // unless the other remote is already fully loaded, in which case
      // they're already present.
      const sliceArtistIds = new Set(
        slice.graph.nodes
          .filter((n) => n.id.startsWith(`artist::${otherRemoteId}::`))
          .map((n) => n.id)
      );
      const sliceAlbumIds = new Set(
        slice.graph.nodes
          .filter((n) => n.id.startsWith(`album::${otherRemoteId}::`))
          .map((n) => n.id)
      );
      const addNodes = slice.graph.nodes.filter(
        (n) => sliceArtistIds.has(n.id) || sliceAlbumIds.has(n.id)
      );
      const addEdges = slice.graph.edges.filter(
        (e) =>
          (sliceArtistIds.has(e.source) && sliceAlbumIds.has(e.target)) ||
          // keep remote-hub → artist edge so the worker can place the artist
          // in the tree; if the hub doesn't exist the edge is a no-op.
          (e.source === `remote::${otherRemoteId}` && sliceArtistIds.has(e.target))
      );

      // augment extraNodesById so popovers work for cross-remote nodes
      setExtraNodesById((prev) => {
        const next = new Map(prev);
        for (const [id, node] of slice.nodesById) next.set(id, node);
        return next;
      });

      walkerClient()?.merge(addNodes, addEdges);

      for (const slugKey of matchesBySlug.keys()) {
        crossRemoteLookups.set(`${otherRemoteId}::${slugKey}`, "loaded");
      }
    } catch (err) {
      console.warn("cross-remote batch lookup failed", {
        otherRemoteId,
        candidateCount: candidates.size,
        err,
      });
      // drop the "loading" slots so a future trigger can retry
      for (const slugKey of candidates.keys()) {
        crossRemoteLookups.delete(`${otherRemoteId}::${slugKey}`);
      }
    } finally {
      setFetchingByRemote((prev) => {
        const next = new Map(prev);
        next.delete(fetchKey);
        return next;
      });
    }
  };

  // ---- pageInfo ------------------------------------------------------

  createEffect(() => {
    setPageInfo({ title: "library", count: buildResult()?.graph.nodes.length ?? 0 });
  });
  onCleanup(() => clearPageInfo());

  // ---- viewport + keyboard shortcuts ---------------------------------

  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  onMount(() => {
    const onResize = () => setIsNarrow(isNarrowViewport());
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));

    const onKey = (e: KeyboardEvent) => {
      if (!props.isActive()) return;
      if (e.key === "Escape") {
        if (isAnyModalOpen()) return;
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
    const narrow = isNarrow();
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
    const chips = (
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <Show when={narrow}>{topNavTools}</Show>
          <Show when={props.bulkTagMode?.()}>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] leading-none whitespace-nowrap border border-[var(--color-accent-500,#ff1a9e)]/50 bg-[var(--color-accent-500,#ff1a9e)]/15 text-[var(--color-accent-500,#ff1a9e)]"
              title="bulk-tag mode not available in this view"
            >
              bulk-tag mode (not available)
            </span>
          </Show>
        </div>
      </div>
    );
    slots.setSecondaryRowContent(chips);
    if (!narrow) slots.setRightContent(topNavTools);
    // search input has no meaning in the graph viz for now; hide it.
    slots.setHideSearch(true);
  });

  // ---- event handlers ------------------------------------------------

  const handleSelect = (nodeId: string, _role: string) => {
    setSelectedId(nodeId);
    albumPanel.restore();
    artistPanel.restore();
  };

  // fan out every lazy-load hook that should fire when a node becomes
  // the pivot. shared between handlePivot (real canvas pivot) and
  // pivotKeepingPanel (relation chip "expand without dismissing panel").
  const triggerPivotLoaders = (nodeId: string) => {
    // lazy taxon expansion: when the user pivots into a relation hub,
    // fetch every taxon of that kind from the remote and merge missing
    // value nodes + edges into the worker graph. eager page-1 album
    // fetch only surfaces taxons referenced by those albums; this fills
    // in the long tail without paginating the entire catalogue.
    void maybeLoadTaxonsForPivot(nodeId);
    // lazy era binning: era is synthesized server-side via
    // `list_era_bins`. fetch on pivot and merge the bins as value nodes
    // under the era hub, then attach value->album edges by classifying
    // in-memory album years into the bin ranges.
    void maybeLoadEraBinsForPivot(nodeId);
    // lazy era-bin album expansion: when the pivot is an era bin value
    // node, fetch all albums whose year falls inside its range so the
    // bin fans out into real content.
    void maybeLoadAlbumsForEraBin(nodeId);
    // lazy recently-added expansion: pull the top-N most recently added
    // albums and attach them as direct children of the recently_added
    // hub. flat (no value tier).
    void maybeLoadRecentlyAddedForPivot(nodeId);
    // lazy album expansion: when the pivot is a value (taxon) or an
    // artist, fetch only the albums belonging to that subtree. results
    // append into nodesByRemote and propagate through buildResult ->
    // incremental client.merge.
    void maybeLoadAlbumsForPivot(nodeId);
    // lazy related-artists expansion: when the pivot is an artist,
    // fetch rows from related_artistz for that artist and emit
    // related-artist edges to any in-library counterparts.
    void maybeLoadRelatedArtistsForPivot(nodeId);
    // lazy relation fan-out: when the pivot is an artist or album,
    // ensure every relation hub's taxons are loaded and synthesize
    // value->entity edges from the entity's unioned taxon fields so
    // all relevant taxons render around the pivot.
    void maybeLoadRelationsForEntityPivot(nodeId);
  };

  const handlePivot = (nodeId: string) => {
    // hub pivots (not a real entity node) clear selection; entity pivots
    // (artist/album, including cross-remote leaders that only live in
    // extraNodesById) keep the current selection so the detail popover
    // opens on the first click. previously this only checked
    // buildResult().nodesById which caused a two-click race for cluster
    // leaders + cross-remote merged nodes.
    if (!lookupNode(nodeId)) {
      setSelectedId(null);
    }
    triggerPivotLoaders(nodeId);
  };

  /** mirror a canvas click on `nodeId` (worker expand + lazy loaders)
   *  WITHOUT touching selection or restoring panels. used by the relation
   *  chip clicks in the album/artist detail popovers so the panel stays
   *  open while the value node fans out its related entities. */
  const pivotKeepingPanel = (nodeId: string) => {
    walkerClient()?.expand(nodeId);
    triggerPivotLoaders(nodeId);
  };

  // kinds that are NOT backed by a queryable taxon: "favorites" is a per-user
  // flag. "era" and "recently_added" are now synthesized in list_taxon_kinds
  // so they render as first-class hubs, but they still have no queryable
  // taxonz rows — pivot drill-in is handled by maybeLoadEraBinsForPivot and
  // maybeLoadRecentlyAddedForPivot. keep them in the filter so the generic
  // queryTaxons lazy-loader skips them and doesn't fire a wasted request.
  const NON_TAXON_KINDS = new Set<string>(["favorites", "era", "recently_added"]);

  // pivot-loader dedup sets for synthesized hubs.
  const eraBinsLoadedByHub = new Set<string>();
  const eraBinsFetchPromises = new Map<string, Promise<void>>();
  const recentlyAddedLoadedByHub = new Set<string>();
  const recentlyAddedFetchPromises = new Map<string, Promise<void>>();
  // related-artists pivot dedup: keyed by the full artist node id
  // (`artist::{remoteId}::{artistId}`). populated after a successful fetch
  // so subsequent pivots on the same artist don't re-issue the call.
  const relatedArtistsLoadedByPivot = new Set<string>();
  const relatedArtistsFetchPromises = new Map<string, Promise<void>>();
  // entity-relation fan-out dedup: keyed by full artist/album node id.
  // populated after emitting value->entity edges for that pivot.
  const entityRelationsLoadedByPivot = new Set<string>();
  // era bin metadata per era hub id, keyed by value_norm slug. used to
  // re-classify newly-arrived albums into existing bins and to shape
  // future filter requests if/when server-side year-range filters land.
  type EraBinMeta = {
    value_norm: string;
    label: string;
    min_year: number | null;
    max_year: number | null;
  };
  const eraBinsByHub = new Map<string, EraBinMeta[]>();

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
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(nodeId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.queryTaxons({
          kind_slug: parsed.relationKind,
          q: null,
          // large enough to cover most libraries in one shot; if any kind
          // grows past this we'll need to wire pagination here.
          limit: 1000,
          offset: 0,
        });
        if (!result.success || !result.data) return;
        const remoteId = parsed.remoteId;
        const kind = parsed.relationKind;
        const relHubId = relationHubId(remoteId, kind);
        // populate label-keyed taxon cache for downstream value-pivot lookups
        // (need taxon.id for genre_id filter, taxon.label for include_tags).
        // key MUST be slug(item.label) so it matches both the value node id
        // (which embeds slug(item.label)) AND the entity-side relation
        // synthesis path (which only knows the label, not the taxon id).
        // detail-panel relation clicks also compute valueNodeId(_, _, label)
        // and rely on this same id form.
        let cache = taxonItemsByHub.get(relHubId);
        if (!cache) {
          cache = new Map();
          taxonItemsByHub.set(relHubId, cache);
        }
        const addNodes: WalkNode[] = [];
        const addEdges: WalkEdge[] = [];
        for (const item of result.data.items) {
          // key by slug(item.label) so cache.get(parsed.valueSlug) matches
          // what valueNodeId(_, _, item.label) embeds.
          cache.set(slug(item.label), { id: item.id, label: item.label });
          // skip empty taxons — no albums means no traversable subtree.
          if (item.album_count <= 0) continue;
          const valId = valueNodeId(remoteId, kind, item.label);
          addNodes.push({
            id: valId,
            role: "value",
            label:
              item.label && item.label.trim().length > 0
                ? item.label
                : (item.slug ?? item.id).replace(/_/g, " "),
            parentId: relHubId,
            // eager count from query_taxons so the badge is correct
            // before albums for this value have been lazy-loaded.
            childCount: item.album_count,
            // mark lazy so the value renders even before any albums
            // for this taxon have been loaded (worker visibility
            // filter hides value nodes with childCount === 0 unless
            // lazy). album fanout is fetched on-demand via
            // maybeLoadAlbumsForPivot when the user pivots in.
            lazy: true,
          });
          addEdges.push({ source: relHubId, target: valId });
        }
        // worker merge dedupes by id + edge key, so re-adding nodes already
        // synthesised from page-1 albums is a no-op.
        walkerClient()?.merge(addNodes, addEdges);
        taxonsLoadedByHub.add(nodeId);
      } catch (err) {
        console.warn("lazy taxon fetch failed", { nodeId, err });
        // leave taxonsLoadedByHub unset so a future pivot retries
      } finally {
        setFetchingNodeFlag(nodeId, false);
        taxonFetchPromises.delete(nodeId);
      }
    })();
    taxonFetchPromises.set(nodeId, promise);
    return promise;
  };

  // lazy era binning. triggered when the user pivots into a
  // `relation::{remoteId}::era` hub. fetches server-side decade-aware
  // bins via `client.music.eraBins(...)` and merges one value node per
  // bin into the worker graph. then classifies every known album in
  // the remote by its `year` field into the matching bin and emits
  // value->album edges so the bin fans out into real content. the bin
  // table is cached in eraBinsByHub so future album loads (e.g. from
  // other pivots) can be classified retroactively, but for v1 we only
  // run the album classification pass once at fetch time.
  const maybeLoadEraBinsForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    if (parsed.kind !== "relation" || parsed.relationKind !== "era") return;
    if (eraBinsLoadedByHub.has(nodeId)) return;
    const inFlight = eraBinsFetchPromises.get(nodeId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(nodeId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.eraBins({
          target_min: null,
          target_max: null,
        });
        if (!result.success || !result.data) return;
        const remoteId = parsed.remoteId;
        const relHubId = relationHubId(remoteId, "era");
        const bins: EraBinMeta[] = [];
        const addNodes: WalkNode[] = [];
        const addEdges: WalkEdge[] = [];
        for (const bin of result.data.bins) {
          if (bin.count <= 0) continue;
          const valId = valueNodeId(remoteId, "era", bin.value_norm);
          addNodes.push({
            id: valId,
            role: "value",
            label: bin.label,
            parentId: relHubId,
            childCount: bin.count,
            // mark lazy so the bin renders even before any albums for
            // this remote have been loaded (worker visibility filter
            // hides value nodes with childCount === 0 unless lazy).
            // album-fanout is fetched on-demand via
            // maybeLoadAlbumsForEraBin when the user pivots into the bin.
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

        // classify known in-memory albums into bins by year and attach
        // value->album edges. classification is a linear scan per album
        // (bins are typically <= ~30 so this is fine).
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
          // album id in the graph is `album::${remoteId}::${bareAlbumId}`.
          // AlbumNodeData.id is `${remoteId}::${albumId}`; strip prefix.
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
        eraBinsLoadedByHub.add(nodeId);
      } catch (err) {
        console.warn("lazy era-bins fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(nodeId, false);
        eraBinsFetchPromises.delete(nodeId);
      }
    })();
    eraBinsFetchPromises.set(nodeId, promise);
    return promise;
  };

  // dedup state for per-bin album lazy fetches.
  const eraBinAlbumsLoadedByHub = new Set<string>();
  const eraBinAlbumsFetchPromises = new Map<string, Promise<void>>();

  // lazy era-bin album expansion. triggered on pivot into a
  // `value::{remoteId}::era::{value_norm}` node. fetches all albums
  // whose release_date year falls inside the bin's [min_year, max_year]
  // via `client.music.eraAlbums(...)`, appends them to nodesByRemote
  // (so artists derive normally), and merges direct value->album edges
  // so the bin fans out immediately.
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
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    // bin metadata must be present — populated by maybeLoadEraBinsForPivot.
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
        // attach value->album AND value->artist edges so the bin fans
        // out into both albums and their owning artists without waiting
        // for buildResult's pass to classify in-memory albums.
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

  // lazy recently-added expansion. triggered on pivot into a
  // `relation::{remoteId}::recently_added` hub. fetches the top-N most
  // recently added albums via `client.music.recentlyAddedAlbums(...)`,
  // appends them to nodesByRemote (so they flow through buildResult
  // into the normal artist/album taxonomy), and merges direct edges
  // from the hub to each album so the hub fans out immediately.
  const maybeLoadRecentlyAddedForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    if (parsed.kind !== "relation" || parsed.relationKind !== "recently_added") return;
    if (recentlyAddedLoadedByHub.has(nodeId)) return;
    const inFlight = recentlyAddedFetchPromises.get(nodeId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(nodeId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.recentlyAddedAlbums({ limit: null });
        if (!result.success || !result.data) return;
        const remoteId = parsed.remoteId;
        const relHubId = relationHubId(remoteId, "recently_added");
        const adapted: AlbumNodeData[] = result.data.albums.map((item) =>
          adaptQueryAlbumItem(item, remote)
        );
        // append into the per-remote signal first so buildResult ->
        // incremental client.merge picks up the album nodes (and any
        // new artist nodes derived from them).
        appendAlbumsToRemote(remoteId, adapted);
        // then merge the hub->album and hub->artist edges directly.
        // the album/artist nodes themselves arrive via the rAF-batched
        // buildResult merge; the worker dedupes edges by
        // `${source}::${target}` so this is safe to issue before/after
        // the node merge.
        const addEdges: WalkEdge[] = [];
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
        walkerClient()?.merge([], addEdges);
        recentlyAddedLoadedByHub.add(nodeId);
      } catch (err) {
        console.warn("lazy recently-added fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(nodeId, false);
        recentlyAddedFetchPromises.delete(nodeId);
      }
    })();
    recentlyAddedFetchPromises.set(nodeId, promise);
    return promise;
  };

  // build a query_albums filter for a value pivot. returns null if the
  // relation kind has no usable server-side filter (mood/style/era/label
  // aren't first-class filters today — they'll fall back to whatever
  // page-1 produced until we add filter support server-side).
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
        // synthesised hubs — handled by dedicated loaders, not query_albums.
        return null;
      case "mood":
      case "style":
      case "label":
      default:
        // taxon-backed kind — filter albums by taxon id.
        return { taxon_ids: [taxon.id] };
    }
  };

  // adapt the raw query_albums item shape into an AlbumSummary, then into
  // an AlbumNodeData. mirrors the inline mapping in useLibraryAlbums.
  const adaptQueryAlbumItem = (
    // typing the wire shape loosely keeps this isolated from codegen
    // drift; the fields read here are all stable.
    item: any, // eslint-disable-line @typescript-eslint/no-explicit-any
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
    if (parsed.kind !== "value" && parsed.kind !== "artist") return;
    if (albumsLoadedByPivot.has(nodeId)) return;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;

    // resolve filter shape per pivot kind.
    let filters: Record<string, unknown> | null = null;
    if (parsed.kind === "value") {
      // ensure parent hub's taxons are loaded so we have id + label to
      // shape the filter. shares any in-flight fetch via the promise map.
      const relHubId = relationHubId(parsed.remoteId, parsed.relationKind);
      if (!taxonItemsByHub.has(relHubId)) {
        await maybeLoadTaxonsForPivot(relHubId);
      }
      filters = filterForValuePivot(relHubId, parsed.relationKind, parsed.valueSlug);
      // unsupported kind (mood/style/era/label) or taxon not found —
      // leave the subtree to whatever page-1 already surfaced.
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
        // single-shot cap. popular genres on huge libraries can exceed
        // this; pagination is a follow-up if needed.
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
      // append to nodesByRemote — buildResult re-runs and the incremental
      // merge effect picks up the new albums/artists/edges automatically.
      appendAlbumsToRemote(remote.remote_id, adapted);
      // for value pivots: buildResult only wires album↔artist edges, not
      // value→album/artist. emit those directly so the value node fans
      // out into its matched albums (and their owning artists) the same
      // way era-bin pivots do. artist pivots already have proper edges
      // from buildResult so we skip in that case.
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
      // allow retry on next pivot
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

  // lazy related-artists expansion. triggered on pivot into an
  // `artist::{remoteId}::{artistId}` node. fetches rows from the remote's
  // related_artistz table via `client.music.listRelatedArtists` and
  // merges related-artist edges (flagged `isRelatedArtist: true`) for any
  // row whose `related_artist_id` resolves to an artist node already in
  // (or later merged into) the same remote's library. external-only rows
  // (no in-library counterpart) are skipped for v1; future work could
  // synthesize ghost artist nodes for them.
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
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(nodeId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.listRelatedArtists({ artist_id: parsed.artistId });
        if (!result.success || !result.data) return;
        const remoteId = parsed.remoteId;
        // build a one-shot name-slug -> nodeId index over loaded artists
        // so we can resolve related-artist rows whose related_artist_id
        // is null (api couldn't auto-link) but whose name matches an
        // artist we already know about. prefer same-remote, fall back to
        // any remote.
        const byNameSameRemote = new Map<string, string>();
        const byNameAnyRemote = new Map<string, string>();
        const maps = [buildResult()?.nodesById, extraNodesById()] as const;
        for (const map of maps) {
          if (!map) continue;
          for (const [id, n] of map) {
            if (!("artistId" in n)) continue;
            const a = n as ArtistNodeData;
            const k = slug(a.name);
            if (!k) continue;
            if (!byNameAnyRemote.has(k)) byNameAnyRemote.set(k, id);
            const nodeRemote = a.sourceRemoteIds?.[0];
            if (nodeRemote === remoteId && !byNameSameRemote.has(k)) {
              byNameSameRemote.set(k, id);
            }
          }
        }
        const addNodes: WalkNode[] = [];
        const addEdges: WalkEdge[] = [];
        const seen = new Set<string>();
        const pushEdge = (targetId: string) => {
          if (targetId === nodeId) return;
          const key = `${nodeId}::${targetId}`;
          if (seen.has(key)) return;
          seen.add(key);
          addEdges.push({ source: nodeId, target: targetId, isRelatedArtist: true });
        };
        for (const row of result.data.items) {
          const nameKey = slug(row.related_name ?? "");
          // 1. preferred: explicit in-library link via related_artist_id.
          if (row.in_library && row.related_artist_id) {
            const explicit = artistNodeId(remoteId, row.related_artist_id);
            // only use explicit id if a node actually exists for it;
            // otherwise fall through to name-match so the edge isn't
            // a phantom (worker skips edges with unknown endpoints).
            const existsExplicit =
              buildResult()?.nodesById.has(explicit) === true || extraNodesById().has(explicit);
            if (existsExplicit) {
              pushEdge(explicit);
              continue;
            }
          }
          // 2. name-slug fallback: match any loaded artist by name.
          //    same-remote preferred, then any remote.
          if (nameKey) {
            const matched = byNameSameRemote.get(nameKey) ?? byNameAnyRemote.get(nameKey);
            if (matched) {
              pushEdge(matched);
              continue;
            }
          }
          // 3. external: synthesize a ghost-artist node so the user
          //    still sees the relation. ghost nodes render as small
          //    italic labels and have no drill-in.
          if (nameKey && row.related_name) {
            const ghostId = ghostArtistId(row.related_name);
            if (ghostId === nodeId) continue;
            // emit ghost node once; merge dedupes by id.
            addNodes.push({
              id: ghostId,
              role: "ghost_artist",
              label: row.related_name,
              parentId: nodeId,
              childCount: 0,
            });
            pushEdge(ghostId);
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
        // allow retry on next pivot
      } finally {
        setFetchingNodeFlag(nodeId, false);
        relatedArtistsFetchPromises.delete(nodeId);
      }
    })();
    relatedArtistsFetchPromises.set(nodeId, promise);
    return promise;
  };

  // lazy relation fan-out for artist / album pivots. when the user
  // pivots into an entity node we want every relation taxon the entity
  // belongs to to render around it (genre / tag / mood / style / label /
  // era / customTaxons). buildWalkGraph doesn't emit value->entity edges
  // and per-hub loaders only emit hub->value edges, so on its own the
  // pivot has no taxon connections. this loader:
  //   1. reads the unioned taxon fields off the entity node data
  //      (set by deriveArtistNodes / adaptAlbum).
  //   2. fires `maybeLoadTaxonsForPivot(relHubId)` in parallel for every
  //      kind the entity has values for so the value nodes get loaded.
  //   3. synthesizes value->entity edges using `slug(label)` to match
  //      the same id scheme that `maybeLoadTaxonsForPivot` produces
  //      (matches the lookup pattern used by detail panels).
  //
  // edges land in the worker via the normal merge path; the worker
  // dedupes and only renders the ones whose endpoints are both visible.
  // value nodes arriving later will activate the previously-queued
  // edges automatically.
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
    // collect (kind, label) pairs from the unioned taxon fields. the
    // well-known kinds map to specific field names; customTaxons carries
    // the long tail under user-defined kind slugs.
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
    // tags carry { label, weight }; reduce to labels.
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
    // kick off taxon loads in parallel for every kind we need values
    // for. fire-and-forget; the worker activates edges once both
    // endpoints are visible.
    const seenKinds = new Set<RelationKind>();
    for (const { kind } of pairs) {
      if (seenKinds.has(kind)) continue;
      seenKinds.add(kind);
      void maybeLoadTaxonsForPivot(relationHubId(remoteId, kind));
    }
    // synthesize value->entity edges. dedup at the edge-key level so a
    // tag appearing on multiple albums of a pivoted artist still only
    // produces one edge.
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

  // load song favorites once per online+activated remote. fires whenever
  // onlineRemotes changes (new remote activated, came back online, etc.).
  createEffect(() => {
    for (const remote of onlineRemotes()) {
      if (favSongLoadedRemotes.has(remote.remote_id)) continue;
      favSongLoadedRemotes.add(remote.remote_id);
      void loadFavoriteSongsForRemote(remote);
    }
  });

  // seed first-order categorical relation hubs from list_taxon_kinds
  // for each online+activated remote (dedup'd by remote). album_count
  // comes from the server so badges render without a lazy round-trip.
  createEffect(() => {
    for (const remote of onlineRemotes()) {
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
          onBreadcrumbChange={(depth) => setBreadcrumbDepth(depth)}
          onSelect={handleSelect}
          onPivot={handlePivot}
          selectedId={selectedId()}
          getImage={getImage}
          isOfflineNode={isOfflineNode}
          isLoadingNode={isLoadingNode}
          interceptClick={interceptClick}
        />

        {/* album detail popover */}
        <Show when={selectedAlbum() !== null && !albumPanel.hidden()}>
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

        <Show when={selectedAlbum() !== null && albumPanel.hidden()}>
          <button
            type="button"
            onClick={albumPanel.restore}
            title="show details"
            class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto"
          >
            <Icon name="chevronUp" size={12} />
            <span class="text-white/60">album - show details</span>
          </button>
        </Show>

        {/* artist detail popover - mutually exclusive with album popover */}
        <Show when={selectedArtist() !== null && !artistPanel.hidden()}>
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
              artist={selectedArtist()!}
              contributingRemotes={
                selectedArtist() ? contributingRemotesForArtist(selectedArtist()!) : undefined
              }
              bio={artistQuery.data?.bio ?? null}
              isFavorite={artistQuery.data?.is_favorite}
              albums={selectedArtistAlbums()}
              onSelectAlbum={(album) => selectAndPanTo(album.id)}
              relatedArtists={selectedArtistRelated() ?? []}
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

        <Show when={selectedArtist() !== null && artistPanel.hidden()}>
          <button
            type="button"
            onClick={artistPanel.restore}
            title="show details"
            class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto"
          >
            <Icon name="chevronUp" size={12} />
            <span class="text-white/60">artist - show details</span>
          </button>
        </Show>
      </div>
    </div>
  );
}
