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
import { useRemoteIsAdminMulti } from "../../hooks/useRemoteRole";
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
  groupNodeId,
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
import { TaxonDetailPopover } from "../../../components/graph/TaxonDetailPopover";
import {
  BulkSelectionPopover,
  type BulkAvailableTaxon,
  type BulkCandidateParent,
  type BulkMode,
} from "../../../components/graph/BulkSelectionPopover";
import type { TaxonRef } from "freqhole-api-client";
import type { ContributingRemote } from "../../../components/graph/RemoteSplitButton";
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
  // shared in-flight taxon fetches keyed by relation-hub id. lets the
  // value-pivot album loader await the parent hub's fetch without
  // duplicating the request when both fire on the same gesture.
  const taxonFetchPromises = new Map<string, Promise<void>>();
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

  // pick the "best" artist image for avatar/glyph display. priority:
  //   1. is_primary === true (user/server flagged as featured)
  //   2. blob_type === "original" (full-res over thumbnail)
  //   3. first available
  // waveforms are filtered out — they're audio peak data, not visual
  // art. returns null when the list is empty or contains only
  // waveforms, so the caller can fall back to an album cover.
  const pickPrimaryImage = (images: ImageMetadata[] | null | undefined): ImageMetadata | null => {
    if (!images || images.length === 0) return null;
    const visual = images.filter((i) => i.blob_type !== "waveform");
    if (visual.length === 0) return null;
    const primary = visual.find((i) => i.is_primary === true);
    if (primary) return primary;
    const original = visual.find((i) => i.blob_type === "original");
    if (original) return original;
    return visual[0] ?? null;
  };

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

  // edit mode: when active, lasso selection and modifier-click multi-select
  // replace normal click-to-pivot behavior.
  const [editMode, setEditMode] = createSignal(false);
  const [multiSelection, setMultiSelection] = createSignal<Set<string>>(new Set());
  // exit edit mode when the taxon selection is cleared
  createEffect(() => {
    if (!selectedTaxonInfo() && editMode()) {
      setEditMode(false);
      setMultiSelection(new Set<string>());
    }
  });

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
  //
  // each remote keeps its own per-remote artist node
  // (`artist::{remoteId}::{artistId}`) with a remote-specific artistId.
  // the worker visually collapses same-name artists across remotes into
  // a single rendered glyph (the cluster "leader"), but the leader's id
  // is arbitrary \u2014 it can belong to any contributing remote. when the
  // user clicks the leader, selectedId() returns that arbitrary remote's
  // id, which is wrong for two reasons:
  //   1. the user walked the graph from a specific remote hub
  //      (root \u2192 remote::X \u2192 ...); they expect data from X.
  //   2. artist ids aren't portable across remotes, so querying the
  //      "wrong" remote with the leader's artistId returns no bio.
  //
  // we rebuild a per-name index of every loaded artist node (across all
  // remotes) keyed by slug(name). selectedArtistRemote / artistQuery
  // then look up the cluster, pick the member whose remote matches the
  // breadcrumb's `remote::*`, and query THAT member's (remoteId, artistId).
  type ClusterMember = {
    nodeId: string; // full graph key, `artist::{remoteId}::{artistId}`
    remoteId: string;
    data: ArtistNodeData;
  };
  const artistClusterByNameSlug = createMemo<Map<string, ClusterMember[]>>(() => {
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
    const main = buildResult()?.nodesById;
    if (main) for (const [id, n] of main) ingest(id, n);
    for (const [id, n] of extraNodesById()) ingest(id, n);
    return out;
  });

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

  // user-driven override for the popover's data-source remote. when set,
  // selectedArtistMember picks this remote instead of the breadcrumb's
  // primary. cleared whenever the selected artist's name slug changes
  // (so picking a remote on artist A doesn't carry over to artist B).
  const [dataSourceRemoteOverride, setDataSourceRemoteOverride] = createSignal<{
    artistSlug: string;
    remoteId: string;
  } | null>(null);

  // clear the manual override when the selected artist changes.
  createEffect(() => {
    const a = selectedArtist();
    if (!a) {
      setDataSourceRemoteOverride(null);
      return;
    }
    const ov = dataSourceRemoteOverride();
    if (ov && ov.artistSlug !== slug(a.name)) {
      setDataSourceRemoteOverride(null);
    }
  });

  // for the currently-selected artist, find the cluster member that
  // should drive the popover. preference order:
  //   1. user override (data-source picker in the popover).
  //   2. cluster member matching primaryWalkRemoteId (the remote the
  //      user walked out from).
  //   3. cluster member matching parseNodeId(selectedId).remoteId (the
  //      leader's own remote).
  //   4. fallback: the selected node itself as a one-member cluster.
  const selectedArtistMember = createMemo<ClusterMember | null>(() => {
    const a = selectedArtist();
    if (!a) return null;
    const graphId = selectedId();
    if (!graphId) return null;
    const cluster = artistClusterByNameSlug().get(slug(a.name)) ?? [];
    const override = dataSourceRemoteOverride();
    if (override && override.artistSlug === slug(a.name)) {
      const match = cluster.find((m) => m.remoteId === override.remoteId);
      if (match) return match;
    }
    const primary = primaryWalkRemoteId();
    if (primary) {
      const match = cluster.find((m) => m.remoteId === primary);
      if (match) return match;
    }
    let leaderRemote: string | null = null;
    try {
      const parsed = parseNodeId(graphId);
      if (parsed.kind === "artist") leaderRemote = parsed.remoteId;
    } catch {
      // ignore
    }
    if (leaderRemote) {
      const match = cluster.find((m) => m.remoteId === leaderRemote);
      if (match) return match;
    }
    // last-resort one-member "cluster" from whatever we have selected.
    if (leaderRemote) {
      return { nodeId: graphId, remoteId: leaderRemote, data: a };
    }
    return null;
  });

  // resolve the authoritative remote for the currently-selected artist.
  // uses the breadcrumb-derived primary first (so "the remote you walked
  // out from" wins over the cluster leader's arbitrary remote), then
  // falls back to the leader's own remote, then sourceRemoteIds, then
  // the first remote in the picker.
  const selectedArtistRemote = createMemo<Remote | undefined>(() => {
    const member = selectedArtistMember();
    if (member) {
      const found = props.remotes().find((r) => r.remote_id === member.remoteId);
      if (found) return found;
    }
    const a = selectedArtist();
    if (!a) return undefined;
    const fallback = a.sourceRemoteIds?.[0];
    if (fallback) {
      const found = props.remotes().find((r) => r.remote_id === fallback);
      if (found) return found;
    }
    return props.remotes()[0];
  });

  // log the artist detail fetch context so we can see which remote the
  // bio/image data is actually coming from versus which remote owns
  // the selected graph node and which remote the user walked out from.
  createEffect(() => {
    const a = selectedArtist();
    if (!a) return;
    const r = selectedArtistRemote();
    const member = selectedArtistMember();
    console.info("[graph] artist detail source", {
      selectedGraphId: selectedId(),
      nodeIdField: a.id,
      selectedArtistId: a.artistId,
      selectedName: a.name,
      sourceRemoteIds: a.sourceRemoteIds,
      primaryWalkRemoteId: primaryWalkRemoteId(),
      resolvedRemoteId: r?.remote_id,
      resolvedRemoteName: r?.name,
      resolvedMemberArtistId: member?.data.artistId,
      clusterMembers:
        artistClusterByNameSlug()
          .get(slug(a.name))
          ?.map((m) => ({ remoteId: m.remoteId, artistId: m.data.artistId })) ?? [],
    });
  });

  const artistQuery = useArtistQuery(
    () => selectedArtistMember()?.data.artistId ?? selectedArtist()?.artistId ?? undefined,
    () => selectedArtistRemote()
  );

  // the artist object actually rendered in the popover. starts from the
  // cluster member (correct for the chosen remote: name + albumCount +
  // taxonomy reflect that remote's view), then overlays a best-effort
  // image:
  //   1. the member's own ArtistNodeData.image (derived from one of its
  //      albums in deriveArtistNodes.ts).
  //   2. the first ImageMetadata returned by the artist detail query
  //      \u2014 these are actual artist images (vs album cover fallbacks).
  //   3. any cluster member's image (cross-remote fallback so a remote
  //      without artist art can still show an avatar from a peer).
  // imageUrl is overlaid the same way as a legacy fallback for
  // pre-resolved url paths.
  const selectedArtistDisplay = createMemo<ArtistNodeData | null>(() => {
    const a = selectedArtist();
    if (!a) return null;
    const member = selectedArtistMember();
    const base = member?.data ?? a;
    let image = base.image ?? null;
    let imageUrl = base.imageUrl ?? null;
    // 2. promote artist-detail query images when available + matching.
    const q = artistQuery.data;
    const memberArtistId = member?.data.artistId ?? a.artistId;
    if (!image && q && q.artist_id === memberArtistId && q.images?.length) {
      image = pickPrimaryImage(q.images);
    }
    // 3. cluster-wide cross-remote fallback.
    if (!image) {
      const cluster = artistClusterByNameSlug().get(slug(a.name)) ?? [];
      for (const m of cluster) {
        if (m.data.image) {
          image = m.data.image;
          break;
        }
      }
    }
    if (!imageUrl) {
      const cluster = artistClusterByNameSlug().get(slug(a.name)) ?? [];
      for (const m of cluster) {
        if (m.data.imageUrl) {
          imageUrl = m.data.imageUrl;
          break;
        }
      }
    }
    if (image === base.image && imageUrl === base.imageUrl) return base;
    return { ...base, image, imageUrl };
  });

  // contributing-remote list specifically for the data-source picker:
  // marks the member matching the current selected remote so the popover
  // can highlight it. parent of contributingRemotesForArtist already
  // sorts charnel-managed first; reuse that ordering.
  const dataSourceRemotesForSelected = createMemo<ContributingRemote[]>(() => {
    const a = selectedArtist();
    if (!a) return [];
    return contributingRemotesForArtist(a);
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
        charnelManagedRemoteIds: new Set(
          props
            .remotes()
            .filter((r) => !!r.is_charnel_managed)
            .map((r) => r.remote_id)
        ),
        remoteNamesById: new Map(props.remotes().map((r) => [r.remote_id, r.name])),
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
      // e: toggle edit mode when a taxon/hub is selected
      if (e.key === "e" && selectedTaxonInfo()) {
        e.preventDefault();
        if (editMode()) {
          setEditMode(false);
          setMultiSelection(new Set<string>());
        } else {
          setEditMode(true);
        }
      }
      // del/backspace: soft-delete focused taxon (single) or bulk taxon selection
      if ((e.key === "Delete" || e.key === "Backspace") && editMode()) {
        if (multiSelection().size >= 2 && bulkMode() === "taxons" && bulkCanEdit()) {
          e.preventDefault();
          const n = bulkCounts().taxons;
          if (window.confirm(`soft-delete ${n} selected taxon${n === 1 ? "" : "s"}?`)) {
            void handleBulkDeleteTaxons();
          }
        } else if (selectedTaxonInfo()?.taxonId) {
          e.preventDefault();
          const label = selectedTaxonInfo()?.label ?? "this taxon";
          if (window.confirm(`soft-delete taxon '${label}'?`)) {
            void handleDeleteTaxon();
          }
        }
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

    // search input has no meaning in the graph viz for now; hide it.
    slots.setHideSearch(true);
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
    // lazy unassigned expansion: pull the next page of albums missing
    // taxon assignments and attach them as direct children of the
    // unassigned hub. flat (no value tier), paged client-side.
    void maybeLoadUnassignedForPivot(nodeId);
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
    // taxon (value/group) nodes are also intentional selections — don't
    // clear selectedId when the user clicked one of those.
    if (!lookupNode(nodeId)) {
      let isTaxonNode = false;
      try {
        const p = parseNodeId(nodeId);
        isTaxonNode = p.kind === "value" || p.kind === "group" || p.kind === "relation";
      } catch {
        // non-parseable id — treat as hub pivot
      }
      if (!isTaxonNode) setSelectedId(null);
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
  const NON_TAXON_KINDS = new Set<string>(["favorites", "era", "recently_added", "unassigned"]);

  // pivot-loader dedup sets for synthesized hubs.
  const eraBinsLoadedByHub = new Set<string>();
  const eraBinsFetchPromises = new Map<string, Promise<void>>();
  const recentlyAddedLoadedByHub = new Set<string>();
  const recentlyAddedFetchPromises = new Map<string, Promise<void>>();
  const unassignedLoadedByHub = new Set<string>();
  const unassignedFetchPromises = new Map<string, Promise<void>>();
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
        // fetch taxons (with counts), parent edges, and full taxon details
        // (with color) in parallel. three calls per hub, but they're all
        // lightweight taxonomy reads and run concurrently.
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

        // build parent->children mapping from the DAG edges
        const childIdSet = new Set<string>(); // taxon ids that are parents of another taxon
        const taxonParentOf = new Map<string, string>(); // child taxon_id -> parent taxon_id
        if (parentsResult.success && parentsResult.data) {
          for (const edge of parentsResult.data) {
            childIdSet.add(edge.parent_id);
            taxonParentOf.set(edge.child_id, edge.parent_id);
          }
        }
        // stash for edit-mode mutation handlers (re-parent needs current parent)
        taxonParentsByHub.set(relHubId, new Map(taxonParentOf));

        // color map from full taxon details (color is not in queryTaxons summary)
        const taxonColorById = new Map<string, string>();
        if (fullTaxonsResult.success && fullTaxonsResult.data) {
          for (const t of fullTaxonsResult.data) {
            if (t.color) taxonColorById.set(t.id, t.color);
          }
        }

        // taxon lookup by id — used to resolve parent node ids from taxon_id edges
        const taxonById = new Map<string, { id: string; label: string }>();
        for (const item of taxonsResult.data.items) {
          taxonById.set(item.id, { id: item.id, label: item.label });
        }
        // stash labels per hub for edit-mode mutation handlers
        const labelMap = new Map<string, string>();
        for (const item of taxonsResult.data.items) labelMap.set(item.id, item.label);
        taxonLabelsByHub.set(relHubId, labelMap);

        // populate label-keyed taxon cache for downstream value-pivot lookups
        // (need taxon.id for genre_id filter, taxon.label for include_tags).
        // key MUST be slug(item.label) so it matches both the value/group node
        // id (which embeds slug(item.label)) AND the entity-side relation
        // synthesis path (which only knows the label, not the taxon id).
        let cache = taxonItemsByHub.get(relHubId);
        if (!cache) {
          cache = new Map();
          taxonItemsByHub.set(relHubId, cache);
        }
        const addNodes: WalkNode[] = [];
        const addEdges: WalkEdge[] = [];
        for (const item of taxonsResult.data.items) {
          cache.set(slug(item.label), {
            id: item.id,
            label: item.label,
            albumCount: item.album_count,
          });
          // a taxon is a group iff it has at least one child in the parent map.
          // groups render even with 0 direct albums so their children have a
          // valid parent node; leaves with 0 albums are skipped as before.
          const isGroup = childIdSet.has(item.id);
          if (!isGroup && item.album_count <= 0) continue;
          const taxonNodeId = isGroup
            ? groupNodeId(remoteId, kind, item.label)
            : valueNodeId(remoteId, kind, item.label);

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

          // children attach to their parent group node; roots attach to the hub
          const parentTaxonId = taxonParentOf.get(item.id);
          const parentTaxon = parentTaxonId ? taxonById.get(parentTaxonId) : undefined;
          const edgeSource = parentTaxon
            ? groupNodeId(remoteId, kind, parentTaxon.label)
            : relHubId;
          addEdges.push({ source: edgeSource, target: taxonNodeId });
        }
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
    // accepted triggers:
    //  - direct pivot on the era hub (`relation::{remoteId}::era`)
    //  - pivot on the parent remote (`remote::{remoteId}`), used to
    //    eager-seed the era hub with its real count before the user
    //    has to click into it.
    let remoteId: string;
    if (parsed.kind === "relation" && parsed.relationKind === "era") {
      remoteId = parsed.remoteId;
    } else if (parsed.kind === "remote") {
      remoteId = parsed.remoteId;
    } else {
      return;
    }
    const relHubId = relationHubId(remoteId, "era");
    // dedup is keyed on the hub id so both trigger paths share state.
    if (eraBinsLoadedByHub.has(relHubId)) return;
    const inFlight = eraBinsFetchPromises.get(relHubId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(remoteId) === true) return;
    const remote = props.remotes().find((r) => r.remote_id === remoteId);
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
        // pre-filter to live bins so we can decide whether to emit the
        // era hub at all (skip when every bin is empty — e.g. no albums
        // have year metadata).
        const liveBins = result.data.bins.filter((b) => b.count > 0);
        if (liveBins.length === 0) {
          // mark loaded so we don't refetch on every remote pivot, even
          // though no hub was emitted. an albums-added later won't
          // surface an era hub until the user reloads the view; that's
          // acceptable for now.
          eraBinsLoadedByHub.add(relHubId);
          return;
        }
        // emit the era hub itself (not in buildWalkGraph anymore) with
        // the live bin count baked in so the hexagon shows a real
        // number on first paint.
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
    // accepted triggers: pivot on the recently_added hub OR on the
    // parent remote (eager seed before the user clicks the hub).
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
    const remote = props.remotes().find((r) => r.remote_id === remoteId);
    if (!remote) return;
    const promise = (async () => {
      setFetchingNodeFlag(relHubId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.recentlyAddedAlbums({ limit: null });
        if (!result.success || !result.data) return;
        // skip emitting the hub entirely when the library has no
        // recently-added albums (e.g. brand-new remote, all-empty
        // catalogue). matches the era-hub behaviour: no count, no hub.
        if (result.data.albums.length === 0) {
          recentlyAddedLoadedByHub.add(relHubId);
          return;
        }
        const adapted: AlbumNodeData[] = result.data.albums.map((item) =>
          adaptQueryAlbumItem(item, remote)
        );
        // append into the per-remote signal first so buildResult ->
        // incremental client.merge picks up the album nodes (and any
        // new artist nodes derived from them).
        appendAlbumsToRemote(remoteId, adapted);
        // emit the recently_added hub itself (not in buildWalkGraph
        // anymore) with the true count baked in, plus the hub->album
        // and hub->artist edges. the album/artist nodes themselves
        // arrive via the rAF-batched buildResult merge; the worker
        // dedupes edges by `${source}::${target}` so this is safe to
        // issue before/after the node merge.
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

  // lazy unassigned expansion. triggered on pivot into a
  // `relation::{remoteId}::unassigned` hub. fetches one page of albums
  // missing taxon assignments via `client.music.unassignedAlbums(...)`,
  // appends them to nodesByRemote (so they flow through buildResult
  // into the normal artist/album taxonomy), and merges direct edges
  // from the hub to each album. paged via offset = adapted.length so
  // repeated pivots fetch the next page until exhausted.
  const unassignedPageByHub = new Map<string, number>();
  const unassignedExhaustedByHub = new Set<string>();
  const maybeLoadUnassignedForPivot = async (nodeId: string): Promise<void> => {
    let parsed: ReturnType<typeof parseNodeId>;
    try {
      parsed = parseNodeId(nodeId);
    } catch {
      return;
    }
    // accepted triggers: pivot on the unassigned hub OR on the
    // parent remote (eager seed before the user clicks the hub).
    let remoteId: string;
    if (parsed.kind === "relation" && parsed.relationKind === "unassigned") {
      remoteId = parsed.remoteId;
    } else if (parsed.kind === "remote") {
      remoteId = parsed.remoteId;
    } else {
      return;
    }
    const relHubId = relationHubId(remoteId, "unassigned");
    // re-pivots can request another page until the server reports
    // exhaustion; first-pivot dedup is via the in-flight promise map.
    if (unassignedExhaustedByHub.has(relHubId)) return;
    const inFlight = unassignedFetchPromises.get(relHubId);
    if (inFlight) return inFlight;
    if (offlineByRemote().get(remoteId) === true) return;
    const remote = props.remotes().find((r) => r.remote_id === remoteId);
    if (!remote) return;
    const pageSize = 100;
    const offset = unassignedPageByHub.get(relHubId) ?? 0;
    const promise = (async () => {
      setFetchingNodeFlag(relHubId, true);
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.unassignedAlbums({
          kind_slug: null,
          limit: pageSize,
          offset,
        });
        if (!result.success || !result.data) return;
        const albums = result.data.albums;
        // mark the hub as loaded on first fetch even if the page is
        // empty so we don't keep retrying. when the page is short of
        // pageSize the server has nothing more to give us.
        if (albums.length < pageSize) {
          unassignedExhaustedByHub.add(relHubId);
        }
        unassignedPageByHub.set(relHubId, offset + albums.length);
        unassignedLoadedByHub.add(relHubId);
        if (albums.length === 0) return;
        const adapted: AlbumNodeData[] = albums.map((item) => adaptQueryAlbumItem(item, remote));
        appendAlbumsToRemote(remoteId, adapted);
        const rhId = remoteHubId(remoteId);
        // child count tracks the total seen so far on this hub.
        const totalSoFar = offset + albums.length;
        const addNodes: WalkNode[] = [
          {
            id: relHubId,
            role: "relation",
            label: "unassigned",
            parentId: rhId,
            childCount: totalSoFar,
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
      } catch (err) {
        console.warn("lazy unassigned-albums fetch failed", { nodeId, err });
      } finally {
        setFetchingNodeFlag(relHubId, false);
        unassignedFetchPromises.delete(relHubId);
      }
    })();
    unassignedFetchPromises.set(relHubId, promise);
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
    if (parsed.kind !== "value" && parsed.kind !== "group" && parsed.kind !== "artist") return;
    if (albumsLoadedByPivot.has(nodeId)) return;
    if (offlineByRemote().get(parsed.remoteId) === true) return;
    const remote = props.remotes().find((r) => r.remote_id === parsed.remoteId);
    if (!remote) return;

    // resolve filter shape per pivot kind.
    let filters: Record<string, unknown> | null = null;
    if (parsed.kind === "value" || parsed.kind === "group") {
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
        const result = await client.music.listRelatedArtists({
          artist_id: parsed.artistId,
          include_pending: true,
          include_incoming: true,
        });
        if (!result.success || !result.data) return;
        const remoteId = parsed.remoteId;
        // build a one-shot name-slug -> nodeId index over loaded artists
        // on the SAME REMOTE as the pivot, so we can resolve related-artist
        // rows whose related_artist_id is null (api couldn't auto-link)
        // but whose name matches an artist we already know about on this
        // remote. cross-remote name matching is intentionally NOT done:
        // we want the graph walk to stay scoped to the remote the user
        // started on, otherwise clicking a "matched" related artist
        // would query the wrong remote (which doesn't have that artist
        // id and so returns no bio / no related-artists).
        const byNameSameRemote = new Map<string, string>();
        const sameRemotePrefix = `artist::${remoteId}::`;
        const maps = [buildResult()?.nodesById, extraNodesById()] as const;
        for (const map of maps) {
          if (!map) continue;
          for (const [id, n] of map) {
            if (!("artistId" in n)) continue;
            // trust the graph key (which always carries the remote)
            // over ArtistNodeData.sourceRemoteIds (which can be empty
            // or stale for nodes synthesized via cross-remote merges).
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
          // record bidirectionally so the popover for either endpoint
          // can surface this relation even if its own remote returned
          // no rows (typical when the row was stored as name-only).
          // ghosts are excluded because the popover can't show them
          // as proper artist entries.
          if (!targetId.startsWith("ghost_artist::")) {
            recordRelatedEdge(nodeId, targetId, isPending ? "pending" : "accepted");
          }
        };
        for (const row of result.data.items) {
          const nameKey = slug(row.related_name ?? "");
          const isPending = row.status === "pending";
          // 1. preferred: explicit in-library link via related_artist_id.
          if (row.in_library && row.related_artist_id) {
            const explicit = artistNodeId(remoteId, row.related_artist_id);
            // only use explicit id if a node actually exists for it;
            // otherwise fall through to name-match so the edge isn't
            // a phantom (worker skips edges with unknown endpoints).
            const existsExplicit =
              buildResult()?.nodesById.has(explicit) === true || extraNodesById().has(explicit);
            if (existsExplicit) {
              pushEdge(explicit, isPending);
              continue;
            }
          }
          // 2. name-slug fallback: match a loaded artist on the SAME
          //    remote only. cross-remote name matches would attach
          //    edges to the wrong remote's artist node, causing the
          //    popover to query the wrong remote (see the cluster /
          //    primaryWalkRemoteId logic above).
          if (nameKey) {
            const matched = byNameSameRemote.get(nameKey);
            if (matched) {
              pushEdge(matched, isPending);
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

  // load artist primary images once per online+activated remote so the
  // graph artist nodes can replace their album-derived placeholders with
  // real artist art (when the remote has any). same activation gate as
  // favorites — paid for only when the user reaches the remote.
  createEffect(() => {
    for (const remote of onlineRemotes()) {
      if (artistImagesLoadedRemotes.has(remote.remote_id)) continue;
      artistImagesLoadedRemotes.add(remote.remote_id);
      void loadArtistImagesForRemote(remote);
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

  // ---- edit-mode mutation handlers (phase 4b) -----------------------------
  // these run when the user drags a node onto another node (handleDrop) or
  // right-clicks an edge (handleEdgeRightClick) while editing. all routes are
  // admin-gated server-side; ui only invokes from edit mode + isRemoteAdmin.

  type ParsedId = ReturnType<typeof parseNodeId>;
  const tryParse = (id: string): ParsedId | null => {
    try {
      return parseNodeId(id);
    } catch {
      return null;
    }
  };
  const isTaxonId = (p: ParsedId | null): boolean =>
    !!p && (p.kind === "value" || p.kind === "group");

  // walk parent chain up from `taxonId` within `relHubId`'s parent map.
  // returns the chain (not including taxonId itself). used for cycle
  // pre-flight before adding a parent edge.
  const ancestorsInHub = (relHubId: string, taxonId: string): string[] => {
    const parents = taxonParentsByHub.get(relHubId);
    if (!parents) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = parents.get(taxonId);
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = parents.get(cur);
    }
    return out;
  };

  // resolve a value/group node id to the underlying taxon_id by walking the
  // hub's items map. taxon items are keyed by slug(label) and carry id+label.
  const taxonIdForNode = (p: ParsedId): { taxonId: string; relHubId: string } | null => {
    if (!p || (p.kind !== "value" && p.kind !== "group")) return null;
    const relHubId = relationHubId(p.remoteId, p.relationKind);
    const cache = taxonItemsByHub.get(relHubId);
    if (!cache) return null;
    const item = cache.get(p.valueSlug);
    if (!item) return null;
    return { taxonId: item.id, relHubId };
  };

  const refreshHub = async (relHubId: string) => {
    taxonsLoadedByHub.delete(relHubId);
    await maybeLoadTaxonsForPivot(relHubId);
  };

  // surface aggregate result of a parallel-fan-out mutation as a toast.
  // logs every rejected reason for debug; user sees a single tally.
  const summarizeMutation = (
    label: string,
    results: PromiseSettledResult<unknown>[]
  ): { ok: number; fail: number } => {
    let ok = 0;
    let fail = 0;
    for (const r of results) {
      if (r.status === "fulfilled") ok += 1;
      else {
        fail += 1;
        console.warn(`[graph] ${label} op failed`, r.reason);
      }
    }
    if (fail === 0 && ok > 0) toast.success(`${label}: ${ok} ok`);
    else if (ok === 0 && fail > 0) toast.error(`${label}: ${fail} failed`);
    else if (fail > 0) toast.warning(`${label}: ${ok} ok, ${fail} failed`);
    return { ok, fail };
  };

  // collect every album id for an artist that's currently in the graph.
  const albumIdsForArtist = (remoteId: string, artistId: string): string[] => {
    const out: string[] = [];
    const result = buildResult();
    if (result) {
      for (const [key, node] of result.nodesById) {
        if (
          "title" in node &&
          (node as AlbumNodeData).artistId === artistId &&
          (node as AlbumNodeData).sourceRemoteId === remoteId
        ) {
          const parsed = tryParse(key);
          if (parsed?.kind === "album") out.push(parsed.albumId);
        }
      }
    }
    return out;
  };

  // drop dispatcher: every source mapped onto target. mixed-kind sources or
  // cross-remote targets are rejected to keep the matrix tractable.
  const handleDrop = async (sourceIds: string[], targetId: string) => {
    if (sourceIds.length === 0) return;
    const targetParsed = tryParse(targetId);
    if (!targetParsed) return;
    const srcParsed = sourceIds.map(tryParse).filter((p): p is ParsedId => !!p);
    if (srcParsed.length === 0) return;
    // require same remote across the whole gesture
    const targetRemote =
      "remoteId" in targetParsed ? (targetParsed as { remoteId: string }).remoteId : null;
    if (!targetRemote) return;
    if (
      srcParsed.some(
        (p) => "remoteId" in p && (p as { remoteId: string }).remoteId !== targetRemote
      )
    ) {
      console.warn("[graph] drop: cross-remote not supported");
      toast.warning("cross-remote bulk drop is not supported");
      return;
    }
    const remote = props.remotes().find((r) => r.remote_id === targetRemote);
    if (!remote) return;
    if (!isRemoteAdmin(targetRemote)) return;
    const client = await getClientForRemote(remote);

    // case A: target is a value/group taxon node
    if (isTaxonId(targetParsed)) {
      const tgt = taxonIdForNode(targetParsed);
      if (!tgt) return;
      const targetKind = (targetParsed as { relationKind: string }).relationKind;

      // sub-case A1: all sources are taxons in the same kind -> re-parent
      const allTaxonsSameKind = srcParsed.every(
        (p) => isTaxonId(p) && (p as { relationKind: string }).relationKind === targetKind
      );
      if (allTaxonsSameKind) {
        const parents = taxonParentsByHub.get(tgt.relHubId);
        const ops: Promise<unknown>[] = [];
        for (const p of srcParsed) {
          const src = taxonIdForNode(p);
          if (!src) continue;
          if (src.taxonId === tgt.taxonId) continue; // self
          // cycle pre-flight: target must not be a descendant of source.
          // descendant-of-source <=> source appears in target's ancestor chain.
          // walk target ancestors and skip if src.taxonId in chain (would form cycle).
          const targetAncestors = ancestorsInHub(tgt.relHubId, tgt.taxonId);
          if (targetAncestors.includes(src.taxonId)) {
            console.warn("[graph] drop: would create cycle, skipping", {
              src: src.taxonId,
              tgt: tgt.taxonId,
            });
            continue;
          }
          const existingParent = parents?.get(src.taxonId);
          if (existingParent === tgt.taxonId) continue; // already parented here
          if (existingParent) {
            ops.push(
              client.music.removeTaxonParent({ child_id: src.taxonId, parent_id: existingParent })
            );
          }
          ops.push(client.music.addTaxonParent({ child_id: src.taxonId, parent_id: tgt.taxonId }));
        }
        const results = await Promise.allSettled(ops);
        summarizeMutation("re-parent", results);
        await refreshHub(tgt.relHubId);
        return;
      }

      // sub-case A2: sources are albums and/or artists -> assign taxon
      const albumIds = new Set<string>();
      for (const p of srcParsed) {
        if (p.kind === "album") albumIds.add(p.albumId);
        else if (p.kind === "artist") {
          for (const aid of albumIdsForArtist(targetRemote, p.artistId)) albumIds.add(aid);
        }
      }
      if (albumIds.size === 0) return;
      const ops: Promise<unknown>[] = [];
      for (const aid of albumIds) {
        ops.push(
          client.music.addAlbumTaxon({ album_id: aid, taxon_id: tgt.taxonId, origin: "manual" })
        );
      }
      const results = await Promise.allSettled(ops);
      summarizeMutation("assign taxon", results);
      await refreshHub(tgt.relHubId);
      return;
    }

    // case B: target is a relation hub (same kind). sources must be taxons of
    // that kind. semantics: detach each source from its current parent (make it root).
    if (targetParsed.kind === "relation") {
      const relHubId = relationHubId(targetRemote, targetParsed.relationKind);
      const parents = taxonParentsByHub.get(relHubId);
      if (!parents) return;
      const ops: Promise<unknown>[] = [];
      for (const p of srcParsed) {
        if (
          !isTaxonId(p) ||
          (p as { relationKind: string }).relationKind !== targetParsed.relationKind
        )
          continue;
        const src = taxonIdForNode(p);
        if (!src) continue;
        const existingParent = parents.get(src.taxonId);
        if (!existingParent) continue;
        ops.push(
          client.music.removeTaxonParent({ child_id: src.taxonId, parent_id: existingParent })
        );
      }
      const results = await Promise.allSettled(ops);
      summarizeMutation("detach taxon", results);
      await refreshHub(relHubId);
      return;
    }
  };

  // right-click on an edge in edit mode: prompt to remove the relationship.
  const handleEdgeRightClick = async (srcId: string, tgtId: string) => {
    const srcParsed = tryParse(srcId);
    const tgtParsed = tryParse(tgtId);
    if (!srcParsed || !tgtParsed) return;
    const remoteId =
      "remoteId" in srcParsed
        ? (srcParsed as { remoteId: string }).remoteId
        : "remoteId" in tgtParsed
          ? (tgtParsed as { remoteId: string }).remoteId
          : null;
    if (!remoteId || !isRemoteAdmin(remoteId)) return;
    const remote = props.remotes().find((r) => r.remote_id === remoteId);
    if (!remote) return;

    // taxon parent edge: src=parent (group), tgt=child (value/group), same kind
    if (
      isTaxonId(srcParsed) &&
      isTaxonId(tgtParsed) &&
      (srcParsed as { relationKind: string }).relationKind ===
        (tgtParsed as { relationKind: string }).relationKind
    ) {
      const parent = taxonIdForNode(srcParsed);
      const child = taxonIdForNode(tgtParsed);
      if (!parent || !child) return;
      const parents = taxonParentsByHub.get(parent.relHubId);
      if (parents?.get(child.taxonId) !== parent.taxonId) return;
      if (!window.confirm("remove this parent link?")) return;
      const client = await getClientForRemote(remote);
      const resp = await client.music.removeTaxonParent({
        child_id: child.taxonId,
        parent_id: parent.taxonId,
      });
      if (!resp.success) {
        console.warn("[graph] remove parent edge failed", resp);
        toast.error("failed to remove parent link");
      } else {
        toast.success("parent link removed");
      }
      await refreshHub(parent.relHubId);
      return;
    }

    // album <-> value taxon link: src=value, tgt=album (or vice versa)
    const valueP = isTaxonId(srcParsed) ? srcParsed : isTaxonId(tgtParsed) ? tgtParsed : null;
    const albumP =
      srcParsed.kind === "album" ? srcParsed : tgtParsed.kind === "album" ? tgtParsed : null;
    if (valueP && albumP && (valueP.kind === "value" || valueP.kind === "group")) {
      const t = taxonIdForNode(valueP);
      if (!t) return;
      if (!window.confirm("remove this album-taxon link?")) return;
      const client = await getClientForRemote(remote);
      const resp = await client.music.removeAlbumTaxon({
        album_id: albumP.albumId,
        taxon_id: t.taxonId,
      });
      if (!resp.success) {
        console.warn("[graph] remove album-taxon link failed", resp);
        toast.error("failed to remove album link");
      } else {
        toast.success("album link removed");
      }
      await refreshHub(t.relHubId);
      return;
    }
  };

  // create a new taxon in the currently-pivoted relation hub (or under the
  // currently-selected taxon if one is selected). called from the detail
  // popover "add taxon" button.
  const handleCreateTaxon = async (label: string) => {
    const info = selectedTaxonInfo();
    if (!info) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    const remote = props.remotes().find((r) => r.remote_id === info.remoteId);
    if (!remote) return;
    if (!isRemoteAdmin(info.remoteId)) return;
    // resolve kind_slug from the relation hub id
    const parsedHub = tryParse(info.relHubId);
    if (!parsedHub || parsedHub.kind !== "relation") return;
    const client = await getClientForRemote(remote);
    const created = await client.music.createTaxon({
      kind_slug: parsedHub.relationKind,
      label: trimmed,
    });
    if (!created.success || !created.data) {
      console.warn("[graph] create taxon failed", created);
      toast.error("failed to create taxon");
      return;
    }
    toast.success(`taxon '${trimmed}' created`);
    // if the user was sitting on a value/group node, also parent the new taxon under it
    if (info.taxonId) {
      const parented = await client.music.addTaxonParent({
        child_id: created.data.id,
        parent_id: info.taxonId,
      });
      if (!parented.success) console.warn("[graph] parent new taxon failed", parented);
    }
    await refreshHub(info.relHubId);
  };

  // soft-delete the currently-selected taxon. exits edit mode + clears selection.
  const handleDeleteTaxon = async () => {
    const info = selectedTaxonInfo();
    if (!info?.taxonId) return;
    const remote = props.remotes().find((r) => r.remote_id === info.remoteId);
    if (!remote) return;
    if (!isRemoteAdmin(info.remoteId)) return;
    const client = await getClientForRemote(remote);
    const resp = await client.music.deleteTaxon({ id: info.taxonId });
    if (!resp.success) {
      console.warn("[graph] delete taxon failed", resp);
      toast.error("failed to delete taxon");
      return;
    }
    toast.success("taxon deleted");
    setEditMode(false);
    setMultiSelection(new Set<string>());
    setSelectedId(null);
    await refreshHub(info.relHubId);
  };

  // ---- bulk (multi-selection) actions (phase 4c) --------------------------
  // shown via BulkSelectionPopover when multiSelection has 2+ nodes in edit
  // mode. fan out the same per-item mutations used by drag-drop.

  // classify the multi-selection into one of three buckets.
  const bulkParsedSelection = createMemo(() => {
    const out: ParsedId[] = [];
    for (const id of multiSelection()) {
      const p = tryParse(id);
      if (p) out.push(p);
    }
    return out;
  });

  const bulkCounts = createMemo(() => {
    const c = { taxons: 0, albums: 0, artists: 0 };
    for (const p of bulkParsedSelection()) {
      if (p.kind === "value" || p.kind === "group") c.taxons += 1;
      else if (p.kind === "album") c.albums += 1;
      else if (p.kind === "artist") c.artists += 1;
    }
    return c;
  });

  const bulkMode = createMemo<BulkMode>(() => {
    const c = bulkCounts();
    if (c.taxons > 0 && c.albums === 0 && c.artists === 0) return "taxons";
    if (c.taxons === 0 && (c.albums > 0 || c.artists > 0)) return "media";
    return "mixed";
  });

  // single shared remote across the selection (else null). every mutation
  // route is admin-gated per remote, so we refuse cross-remote bulk ops.
  const bulkRemoteId = createMemo<string | null>(() => {
    let remote: string | null = null;
    for (const p of bulkParsedSelection()) {
      if (!("remoteId" in p)) continue;
      const rid = (p as { remoteId: string }).remoteId;
      if (remote === null) remote = rid;
      else if (remote !== rid) return null;
    }
    return remote;
  });

  // single shared kind across the taxon selection (only meaningful for
  // "taxons" mode). when null, re-parent picker is disabled.
  const bulkKindSlug = createMemo<string | null>(() => {
    let kind: string | null = null;
    for (const p of bulkParsedSelection()) {
      if (p.kind !== "value" && p.kind !== "group") continue;
      const k = (p as { relationKind: string }).relationKind;
      if (kind === null) kind = k;
      else if (kind !== k) return null;
    }
    return kind;
  });

  const bulkRelHubId = createMemo<string | null>(() => {
    const rid = bulkRemoteId();
    const kind = bulkKindSlug();
    if (!rid || !kind) return null;
    return relationHubId(rid, kind);
  });

  // children index per hub, derived from taxonParentsByHub.
  const childrenForHub = (relHubId: string): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>();
    const parents = taxonParentsByHub.get(relHubId);
    if (!parents) return out;
    for (const [child, parent] of parents) {
      if (!out.has(parent)) out.set(parent, new Set());
      out.get(parent)!.add(child);
    }
    return out;
  };

  // every selected taxon id (resolved via taxonItemsByHub cache).
  const bulkSelectedTaxonIds = createMemo<Set<string>>(() => {
    const out = new Set<string>();
    for (const p of bulkParsedSelection()) {
      if (p.kind !== "value" && p.kind !== "group") continue;
      const t = taxonIdForNode(p);
      if (t) out.add(t.taxonId);
    }
    return out;
  });

  // true when every selected taxon has at least one child (i.e. is a group).
  const bulkAllGroups = createMemo<boolean>(() => {
    const hub = bulkRelHubId();
    const ids = bulkSelectedTaxonIds();
    if (!hub || ids.size === 0) return false;
    const children = childrenForHub(hub);
    for (const id of ids) {
      if (!children.has(id) || children.get(id)!.size === 0) return false;
    }
    return true;
  });

  // candidate parents in the kind: every taxon except the selection itself
  // and its descendants (would create a cycle).
  const bulkCandidateParents = createMemo<BulkCandidateParent[]>(() => {
    const hub = bulkRelHubId();
    if (!hub) return [];
    const cache = taxonItemsByHub.get(hub);
    if (!cache) return [];
    const selected = bulkSelectedTaxonIds();
    const children = childrenForHub(hub);
    // collect every descendant of the selection (bfs)
    const banned = new Set<string>(selected);
    const queue: string[] = [...selected];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const kids = children.get(cur);
      if (!kids) continue;
      for (const k of kids) {
        if (!banned.has(k)) {
          banned.add(k);
          queue.push(k);
        }
      }
    }
    const out: BulkCandidateParent[] = [];
    for (const item of cache.values()) {
      if (banned.has(item.id)) continue;
      out.push({ id: item.id, label: item.label });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  // flatten every loaded hub's taxon cache so media-mode typeahead can
  // assign across any kind we've already pivoted into. cross-remote filtered
  // to the bulk remote so we only assign within the selection's remote.
  const bulkAvailableTaxons = createMemo<BulkAvailableTaxon[]>(() => {
    const rid = bulkRemoteId();
    if (!rid) return [];
    const out: BulkAvailableTaxon[] = [];
    for (const [hubId, cache] of taxonItemsByHub) {
      const hubParsed = tryParse(hubId);
      if (!hubParsed || hubParsed.kind !== "relation") continue;
      if (hubParsed.remoteId !== rid) continue;
      const kindMeta = taxonKindMetaByHub.get(hubId);
      const kindLabel = kindMeta?.label ?? hubParsed.relationKind;
      const kindColor = kindMeta?.color ?? null;
      for (const item of cache.values()) {
        out.push({ id: item.id, label: item.label, kindLabel, kindColor });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  const bulkCanEdit = createMemo<boolean>(() => {
    const rid = bulkRemoteId();
    return !!rid && isRemoteAdmin(rid);
  });

  // re-parent every selected taxon under `parentTaxonId` (or null = root).
  // removes any existing same-kind parent edge first to keep each child
  // single-parented within the kind.
  const handleBulkReparent = async (parentTaxonId: string | null) => {
    const hub = bulkRelHubId();
    const rid = bulkRemoteId();
    if (!hub || !rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = props.remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const parents = taxonParentsByHub.get(hub);
    const client = await getClientForRemote(remote);
    const ops: Promise<unknown>[] = [];
    // cycle pre-flight: when targeting a real parent, refuse children-of-self.
    const children = childrenForHub(hub);
    const descendantsOfTarget = new Set<string>();
    if (parentTaxonId) {
      const queue = [parentTaxonId];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const kids = children.get(cur);
        if (!kids) continue;
        for (const k of kids) {
          if (!descendantsOfTarget.has(k)) {
            descendantsOfTarget.add(k);
            queue.push(k);
          }
        }
      }
    }
    for (const taxonId of bulkSelectedTaxonIds()) {
      if (taxonId === parentTaxonId) continue;
      if (parentTaxonId && descendantsOfTarget.has(taxonId)) continue;
      const existing = parents?.get(taxonId);
      if (existing === parentTaxonId) continue;
      if (existing) {
        ops.push(client.music.removeTaxonParent({ child_id: taxonId, parent_id: existing }));
      }
      if (parentTaxonId) {
        ops.push(client.music.addTaxonParent({ child_id: taxonId, parent_id: parentTaxonId }));
      }
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk re-parent", results);
    await refreshHub(hub);
  };

  // set color on every selected taxon (groups-only — gated by allGroups in ui).
  const handleBulkSetColor = async (color: string | null) => {
    const rid = bulkRemoteId();
    if (!rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = props.remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const ops: Promise<unknown>[] = [];
    for (const taxonId of bulkSelectedTaxonIds()) {
      ops.push(client.music.set_taxon_color({ taxon_id: taxonId, color }));
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk set color", results);
    const hub = bulkRelHubId();
    if (hub) await refreshHub(hub);
  };

  // soft-delete every selected taxon.
  const handleBulkDeleteTaxons = async () => {
    const rid = bulkRemoteId();
    if (!rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = props.remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const ops: Promise<unknown>[] = [];
    for (const taxonId of bulkSelectedTaxonIds()) {
      ops.push(client.music.deleteTaxon({ id: taxonId }));
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk delete", results);
    const hub = bulkRelHubId();
    setMultiSelection(new Set<string>());
    setSelectedId(null);
    if (hub) await refreshHub(hub);
  };

  // assign a taxon to every selected album, fanning out across selected
  // artists' albums on the same remote.
  const handleBulkAssignTaxon = async (taxonId: string) => {
    const rid = bulkRemoteId();
    if (!rid) return;
    if (!isRemoteAdmin(rid)) return;
    const remote = props.remotes().find((r) => r.remote_id === rid);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const albumIds = new Set<string>();
    for (const p of bulkParsedSelection()) {
      if (p.kind === "album") albumIds.add(p.albumId);
      else if (p.kind === "artist") {
        for (const aid of albumIdsForArtist(rid, p.artistId)) albumIds.add(aid);
      }
    }
    if (albumIds.size === 0) return;
    const ops: Promise<unknown>[] = [];
    for (const aid of albumIds) {
      ops.push(client.music.addAlbumTaxon({ album_id: aid, taxon_id: taxonId, origin: "manual" }));
    }
    const results = await Promise.allSettled(ops);
    summarizeMutation("bulk assign", results);
    // best-effort refresh: refresh the hub that owns this taxon if cached
    for (const [hubId, cache] of taxonItemsByHub) {
      let found = false;
      for (const item of cache.values()) {
        if (item.id === taxonId) {
          found = true;
          break;
        }
      }
      if (found) {
        await refreshHub(hubId);
        break;
      }
    }
  };

  const bulkActive = createMemo<boolean>(() => editMode() && multiSelection().size >= 2);

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
        />

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
            <span class="text-pink-300/50 text-[10px]">(esc · del · e)</span>
            <button
              type="button"
              aria-label="exit edit mode"
              class="text-pink-300/70 hover:text-pink-200 cursor-pointer p-0 leading-none"
              onClick={() => {
                setEditMode(false);
                setMultiSelection(new Set<string>());
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </Show>

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
            title={`${selectedAlbum()?.title ?? ""} — ${selectedAlbum()?.artistName ?? ""}`}
            class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto max-w-[min(280px,calc(100%-1.5rem))]"
          >
            <Icon name="chevronUp" size={12} />
            <span class="truncate">{selectedAlbum()?.title ?? "album"}</span>
            <Show when={selectedAlbum()?.artistName}>
              <span class="text-white/40 truncate">— {selectedAlbum()!.artistName}</span>
            </Show>
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

        <Show when={selectedArtist() !== null && artistPanel.hidden()}>
          <button
            type="button"
            onClick={artistPanel.restore}
            title={selectedArtistDisplay()?.name ?? "artist"}
            class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto max-w-[min(280px,calc(100%-1.5rem))]"
          >
            <Icon name="chevronUp" size={12} />
            <span class="truncate">{selectedArtistDisplay()?.name ?? "artist"}</span>
          </button>
        </Show>

        {/* bulk-selection popover — shown in edit mode when multi-select has 2+ */}
        <Show when={bulkActive()}>
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
              kindColor={() =>
                taxonKindMetaByHub.get(selectedTaxonInfo()?.relHubId ?? "")?.color ?? undefined
              }
              albumCount={() => selectedTaxonInfo()?.albumCount}
              parents={() => selectedTaxonData()?.ancestors ?? []}
              descendants={() => selectedTaxonData()?.descendants ?? []}
              canEdit={() => isRemoteAdmin(selectedTaxonInfo()?.remoteId ?? null)}
              onEditHierarchy={() => {
                if (editMode()) {
                  setEditMode(false);
                  setMultiSelection(new Set<string>());
                } else {
                  setEditMode(true);
                }
              }}
              onClose={() => setSelectedId(null)}
              isGroup={() => (selectedTaxonData()?.descendants?.length ?? 0) > 0}
              editMode={editMode}
              onCreateTaxon={(label) => {
                void handleCreateTaxon(label);
              }}
              onDeleteTaxon={() => {
                void handleDeleteTaxon();
              }}
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
              <button
                type="button"
                onClick={() => setTaxonPanelHidden(false)}
                title={label}
                class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto max-w-[min(280px,calc(100%-1.5rem))]"
              >
                <Icon name="chevronUp" size={12} />
                <Show when={swatch}>
                  <span
                    class="inline-block w-3 h-3 rounded-sm border border-white/20 flex-shrink-0"
                    style={{ background: swatch! }}
                  />
                </Show>
                <span class="truncate">{label}</span>
              </button>
            );
          })()}
        </Show>
      </div>
    </div>
  );
}
