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
  relationHubId,
  valueNodeId,
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
  // relation hubs whose query_taxons fetch has settled (success OR error).
  // prevents re-firing on every pivot revisit.
  const taxonsLoadedByHub = new Set<string>();
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
          void lookupAndMerge(remote.remote_id, artistName, artistSlug);
        }
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
    const addFromMap = (map: Map<string, AlbumNodeData | ArtistNodeData>) => {
      for (const node of map.values()) {
        if ("title" in node && (node as AlbumNodeData).artistId === artist.artistId) {
          out.push(node as AlbumNodeData);
        }
      }
    };
    const result = buildResult();
    if (result) addFromMap(result.nodesById);
    addFromMap(extraNodesById());
    return out;
  });

  const artistQuery = useArtistQuery(() => selectedArtist()?.artistId ?? undefined);

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

  const lookupAndMerge = async (otherRemoteId: string, artistName: string, artistSlug: string) => {
    const key = `${otherRemoteId}::${artistSlug}`;
    const remote = props.remotes().find((r) => r.remote_id === otherRemoteId);
    if (!remote) {
      crossRemoteLookups.set(key, "absent");
      return;
    }
    try {
      setFetchingByRemote((prev) => {
        const next = new Map(prev);
        next.set(`xremote::${key}`, true);
        return next;
      });
      const summaries = await queryClient.fetchQuery({
        queryKey: ["xremote-artist-lookup", otherRemoteId, artistSlug] as const,
        queryFn: async () => {
          const client = await getClientForRemote(remote);
          const resp = await client.music.queryAlbums({
            q: artistName,
            search_fields: null,
            filters: {},
            sort_by: null,
            sort_direction: null,
            limit: 200,
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
      const matches = albums.filter((a) => slug(a.artistName) === artistSlug);

      if (matches.length === 0) {
        crossRemoteLookups.set(key, "absent");
        return;
      }

      const artistNodes = deriveArtistNodes(matches, new Set());
      const slice = buildWalkGraph({
        remoteIds: [otherRemoteId],
        albumsByRemote: new Map([[otherRemoteId, matches]]),
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
      crossRemoteLookups.set(key, "loaded");
    } catch (err) {
      console.warn("cross-remote lookup failed", { otherRemoteId, artistName, err });
      crossRemoteLookups.delete(key);
    } finally {
      setFetchingByRemote((prev) => {
        const next = new Map(prev);
        next.delete(`xremote::${key}`);
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
  });

  // ---- event handlers ------------------------------------------------

  const handleSelect = (nodeId: string, _role: string) => {
    setSelectedId(nodeId);
    albumPanel.restore();
    artistPanel.restore();
  };

  const handlePivot = (nodeId: string) => {
    // hub pivots (not in nodesById) clear selection; artist pivots keep it
    const result = buildResult();
    if (!result || !result.nodesById.has(nodeId)) {
      setSelectedId(null);
    }
    // lazy taxon expansion: when the user pivots into a relation hub,
    // fetch every taxon of that kind from the remote and merge missing
    // value nodes + edges into the worker graph. eager page-1 album
    // fetch only surfaces taxons referenced by those albums; this fills
    // in the long tail without paginating the entire catalogue.
    void maybeLoadTaxonsForPivot(nodeId);
  };

  // kind_slugs that map 1:1 onto our RelationKind taxonomy. "favorite"
  // is a per-user flag not backed by a taxon kind, so we skip it.
  const TAXON_BACKED_KINDS = new Set<RelationKind>([
    "genre",
    "tag",
    "mood",
    "style",
    "era",
    "label",
  ]);

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
    if (!TAXON_BACKED_KINDS.has(parsed.relationKind)) return;
    if (taxonsLoadedByHub.has(nodeId)) return;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;
    taxonsLoadedByHub.add(nodeId);
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
      const addNodes: WalkNode[] = [];
      const addEdges: WalkEdge[] = [];
      for (const item of result.data.items) {
        // skip empty taxons — no albums means no traversable subtree.
        if (item.album_count <= 0) continue;
        const valId = valueNodeId(remoteId, kind, item.label);
        addNodes.push({
          id: valId,
          role: "value",
          label: item.label,
          parentId: relHubId,
          childCount: 0,
        });
        addEdges.push({ source: relHubId, target: valId });
      }
      // worker merge dedupes by id + edge key, so re-adding nodes already
      // synthesised from page-1 albums is a no-op.
      walkerClient()?.merge(addNodes, addEdges);
    } catch (err) {
      console.warn("lazy taxon fetch failed", { nodeId, err });
      // allow a future pivot to retry by removing the marker
      taxonsLoadedByHub.delete(nodeId);
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

  // click interceptor: tapping an offline remote hub re-checks health;
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
      toast.info(`checking ${name}...`);
      void runHealthCheck(parsed.remoteId).then((online) => {
        if (online === true) toast.success(`${name} is back online`);
        else if (online === false) toast.warning(`${name} is still offline`);
      });
      return true;
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
              onViewAlbum={(album) => {
                const r = remoteForNode(album);
                navigate(routes.albumOn(r?.remote_id ?? null, bareAlbumId(album)));
              }}
              onViewArtist={(album) => {
                if (!album.artistId) return;
                const r = remoteForNode(album);
                navigate(routes.artistOn(r?.remote_id ?? null, album.artistId));
              }}
              onSelectArtistById={(artistId) => {
                const nodeId = findArtistNodeId(artistId);
                if (nodeId) setSelectedId(nodeId);
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
                  ? (album) => {
                      const r = remoteForNode(album);
                      if (!r || !isRemoteAdmin(r.remote_id)) {
                        toast.error("admin permission required");
                        return;
                      }
                      showAlbumEditor({ albumId: bareAlbumId(album), remote: r });
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
              bio={artistQuery.data?.bio ?? null}
              isFavorite={artistQuery.data?.is_favorite}
              albums={selectedArtistAlbums()}
              onSelectAlbum={(album) => setSelectedId(album.id)}
              onViewArtist={(artist) => {
                navigate(routes.artistOn(null, artist.artistId));
              }}
              onEdit={
                isAnyRemoteAdmin()
                  ? (artist) => {
                      showArtistEditor({ artistId: artist.artistId });
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
