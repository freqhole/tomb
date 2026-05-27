// LibraryGraphSubview
//
// real graph subview using the bloom-walk explorer (graph2).
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
import WalkCanvas from "../../../components/graph2/WalkCanvas";
import type { WalkApi } from "../../../components/graph2/WalkCanvas";
import type { WalkerClient } from "../../../components/graph2/worker/client";
import { GraphTopNavTools } from "../../../components/graph/GraphTopNavTools";
import { buildWalkGraph } from "../../../components/graph2/data/buildWalkGraph";
import { rootId, parseNodeId, slug } from "../../../components/graph2/data/nodeIds";
import { getClientForRemote } from "../../../app/api/client";
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
  const INITIAL_PAGE_SIZE = 500;
  const MAX_PAGE_SIZE = 2500;
  const TARGET_PAGE_COUNT = 4;
  const [pageSize, setPageSize] = createSignal(INITIAL_PAGE_SIZE);

  const albumsQuery = useLibraryAlbumsQuery({
    remote: () => props.remote,
    search: () => props.search() || undefined,
    pageSizeFn: pageSize,
    disablePolling: true,
  });

  // ramp page size once we know total_count
  createEffect(() => {
    const first = albumsQuery.data?.pages?.[0];
    if (!first) return;
    const total = first.total ?? 0;
    if (total <= INITIAL_PAGE_SIZE) return;
    const target = Math.min(
      MAX_PAGE_SIZE,
      Math.max(INITIAL_PAGE_SIZE, Math.ceil(total / TARGET_PAGE_COUNT))
    );
    if (target !== pageSize()) setPageSize(target);
  });

  // auto-fetch all pages
  createEffect(() => {
    const q = albumsQuery;
    if (q.hasNextPage && !q.isFetchingNextPage && !q.isFetching) {
      void q.fetchNextPage();
    }
  });

  // report in-flight status
  createEffect(() => {
    const q = albumsQuery;
    const fetching = q.isFetching || q.isFetchingNextPage || !!q.hasNextPage;
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
    // remote set churned — slug-based assumptions are invalid
    crossRemoteLookups.clear();
    setExtraNodesById(new Map());
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
    const remoteIds = [...byRemote.keys()].filter((id) => (byRemote.get(id)?.length ?? 0) > 0);
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

  return (
    <div class="h-full flex flex-col">
      <For each={props.remotes()}>
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
