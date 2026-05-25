// LibraryGraphSubview
//
// real graph subview for the library — drop-in replacement for the old
// `GraphPlaceholder`. fans `useLibraryAlbumsQuery` out over every
// selected remote, runs each page through `adaptAlbum`, merges into a
// single dynamic node list, feeds that into `createGraphLibraryView`,
// and pushes the graph's topnav cluster into the shared shell slots.
//
// multi-remote: nodes are keyed by `${remoteId}::${album_id}` (see
// `adaptAlbum`) so the same album on two remotes appears as two
// distinct nodes — intentional, can be merged later if desired.

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
import { createGraphLibraryView } from "./createGraphLibraryView";
import { adaptAlbum } from "./adaptAlbum";
import { RemoteMusicDataSource } from "../../../music/data/remote/remoteSource";
import { addToQueue, playQueue } from "../../../music/services/queue/queue";
import { routes } from "../../../music/utils/routing";
import { useToggleFavoriteMutation } from "../../../music/queries/favorites";
import { toast } from "../../../components/feedback/Toast";
import { isNarrowViewport } from "../../../config/breakpoints";
import { setPageInfo, clearPageInfo } from "../../../app/services/pageInfo";
import type {
  AlbumNodeData,
  ArtistNodeData,
  GraphEdge,
  GraphNodeData,
  RelationKind,
} from "../../../components/graph/types";
import { deriveArtistNodes } from "./deriveArtistNodes";
import { useRelatedArtistsByIds } from "../../queries/useRelatedArtistsByIds";
import { RELATION_LABEL } from "../../../components/graph/relations";
import {
  RELATION_HUB_KINDS,
  isAnyHubId,
  isRelationHubId,
  isRemoteHubId,
  isRelationValueHubId,
  parseRelationHubId,
  parseRelationValueHubId,
  parseRemoteHubId,
  relationHubId,
  relationSupportsValueLayer,
  relationValueHubId,
  remoteHubId,
} from "../../../components/graph/hubNodes";
import { getAuthInfo, getAuthStatus } from "../../../app/services/remotes/authStatusStore";
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

export interface LibraryGraphSubviewProps {
  /** every selected remote whose albums should be merged into the graph. */
  remotes: Remote[];
  /** the parent's current subview signal — used to pause the sim when
   *  graph is not visible (e.g. user flipped back to table view). */
  isActive: () => boolean;
  /** when truthy, locks the canvas into lasso mode and routes lasso
   *  completions to `onLassoAlbums` instead of the default no-op. */
  bulkTagMode?: () => boolean;
  /** receives the resolved Remote + bare album ids from a lasso
   *  completion. invoked only when `bulkTagMode()` is true. */
  onLassoAlbums?: (remote: Remote, albumIds: string[]) => void;
  /** optional trailing slot for the topnav tools cluster (e.g. an
   *  admin-only bulk-tag toggle owned by the parent). */
  extraTools?: JSX.Element;
}

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
        onLassoAlbums={props.onLassoAlbums}
        extraTools={props.extraTools}
      />
    </Show>
  );
}

/** small per-remote loader: owns its own infinite query, fetches all
 *  pages eagerly, and reports adapted nodes back via `onNodes`. lives
 *  as a child component so the query hook can be called inside the
 *  expected solid component scope. */
function RemoteAlbumsLoader(props: {
  remote: Remote;
  search: () => string;
  onNodes: (remoteId: string, nodes: AlbumNodeData[]) => void;
  /** reports the loader's in-flight status so the parent can render a
   *  refreshing chip while a manual refresh is round-tripping. true
   *  means a fetch (initial or `fetchNextPage`) is currently active. */
  onFetchingChange?: (remoteId: string, fetching: boolean) => void;
}) {
  // graph wants every album, not the table's 100-row pages. start at
  // a chunky baseline and ramp proportionally once we know `total_count`
  // so a 10k-album library lands in ~4 fetches instead of ~100.
  const INITIAL_PAGE_SIZE = 500;
  const MAX_PAGE_SIZE = 2500;
  const TARGET_PAGE_COUNT = 4;
  const [pageSize, setPageSize] = createSignal(INITIAL_PAGE_SIZE);
  const albumsQuery = useLibraryAlbumsQuery({
    remote: () => props.remote,
    search: () => props.search() || undefined,
    pageSizeFn: pageSize,
    // graph doesn't need the 5s mb-lookup re-poll; a manual refresh
    // button in the topnav handles staleness instead.
    disablePolling: true,
  });

  // ramp page size after we see the first response. once `total_count`
  // is known, aim for ~8 fetches total. capped at MAX_PAGE_SIZE so we
  // don't bury the server in a single mega-query.
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

  // auto-fetch next pages — the graph wants everything, not just one page.
  createEffect(() => {
    const q = albumsQuery;
    if (q.hasNextPage && !q.isFetchingNextPage && !q.isFetching) {
      void q.fetchNextPage();
    }
  });

  // surface in-flight status to the parent so it can render the
  // refreshing chip. a loader is "fetching" when it's actively
  // round-tripping (initial load, manual refetch, or auto next-page).
  createEffect(() => {
    const q = albumsQuery;
    const fetching = q.isFetching || q.isFetchingNextPage || q.hasNextPage;
    props.onFetchingChange?.(props.remote.remote_id, !!fetching);
  });
  onCleanup(() => {
    props.onFetchingChange?.(props.remote.remote_id, false);
  });

  // publish adapted nodes incrementally — every page is dumped into
  // the graph as it lands so the user sees something asap instead of
  // waiting for the full library. the rAF batcher in Inner still
  // coalesces concurrent publishes from multiple remotes into a single
  // graph mutation. with `disablePolling: true` above there are no
  // spurious refetch republishes to dedup, so a simple page-count
  // guard is enough to skip no-op re-runs of this effect.
  let lastEmittedPages = -1;
  let lastEmittedCount = -1;
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
    // skip no-op re-runs: a refetch that returns the same number of
    // pages with the same total album count means nothing visible
    // changed for the graph.
    if (pages.length === lastEmittedPages && out.length === lastEmittedCount) return;
    lastEmittedPages = pages.length;
    lastEmittedCount = out.length;
    props.onNodes(id, out);
  });

  return null;
}

function Inner(props: {
  remotes: () => Remote[];
  isActive: () => boolean;
  bulkTagMode?: () => boolean;
  onLassoAlbums?: (remote: Remote, albumIds: string[]) => void;
  extraTools?: JSX.Element;
}) {
  const navigate = useNavigate();
  const slots = useTopNavSlots();
  const queryClient = useQueryClient();
  const favoriteMutation = useToggleFavoriteMutation();

  // local search signal for the graph (until topnav search is wired
  // globally — phase 6 polish). starts empty = no filter applied.
  // setter is reserved for the upcoming topnav search input.
  const [searchQuery] = createSignal("");

  // admin-ness is per-remote. only check the *currently selected*
  // remotes (the only ones the user is actively viewing) so popovers
  // surface an edit button when relevant.
  const authStatus = getAuthStatus();
  const isRemoteAdmin = (remoteId: string | null | undefined): boolean => {
    if (!remoteId) return false;
    const entry = authStatus().get(remoteId) ?? getAuthInfo(remoteId);
    if (!entry || !entry.loggedIn || !entry.role) return false;
    return permissions.isAdmin(entry.role as UserRoleName);
  };
  const isAnyRemoteAdmin = (): boolean => {
    for (const r of selectedRemotes()) if (isRemoteAdmin(r.remote_id)) return true;
    return false;
  };

  // ---- in-graph remote selection ----
  //
  // the graph subview owns remote selection (instead of the parent
  // RemotePicker). every remote in `props.remotes` is rendered as a
  // wonky-triangle hub node, but album data is loaded only for
  // *selected* remotes. clicking a remote hub toggles selection;
  // single mode replaces, multi mode toggles membership.
  //
  // default selection: in tauri/charnel mode the local-managed remote
  // is preferred (it lights up the user's own library on first paint);
  // otherwise we pick the first remote in the provided list.
  const pickDefaultRemoteId = (list: Remote[]): string | null => {
    if (list.length === 0) return null;
    const charnel = list.find((r) => r.is_charnel_managed);
    return (charnel ?? list[0]).remote_id;
  };
  const [selectedRemoteIds, setSelectedRemoteIds] = createSignal<Set<string>>(new Set());
  // initialize + reconcile when the available remotes change. preserves
  // the user's existing selection when possible; falls back to default.
  createEffect(() => {
    const all = props.remotes();
    const allIds = new Set(all.map((r) => r.remote_id));
    const cur = selectedRemoteIds();
    const filtered = new Set<string>();
    for (const id of cur) if (allIds.has(id)) filtered.add(id);
    if (filtered.size === 0) {
      const def = pickDefaultRemoteId(all);
      if (def) filtered.add(def);
    }
    // only write if the set actually changed (avoid re-fire loops)
    if (filtered.size !== cur.size || [...filtered].some((id) => !cur.has(id))) {
      setSelectedRemoteIds(filtered);
    }
  });
  const selectedRemotes = createMemo<Remote[]>(() => {
    const ids = selectedRemoteIds();
    return props.remotes().filter((r) => ids.has(r.remote_id));
  });

  // per-remote node store, keyed by remote_id. updated by each
  // RemoteAlbumsLoader child as pages arrive. flattened into `nodes()`
  // below for the graph.
  const [nodesByRemote, setNodesByRemote] = createSignal<Map<string, AlbumNodeData[]>>(new Map());

  // per-remote in-flight status — drives the small "refreshing…" chip
  // overlaid on the graph after the initial load when the user clicks
  // the topnav refresh button.
  const [fetchingByRemote, setFetchingByRemote] = createSignal<Map<string, boolean>>(new Map());
  const setFetchingFor = (remoteId: string, fetching: boolean) => {
    setFetchingByRemote((prev) => {
      const cur = prev.get(remoteId) ?? false;
      if (cur === fetching) return prev;
      const next = new Map(prev);
      next.set(remoteId, fetching);
      return next;
    });
  };
  const isAnyRemoteRefetching = (): boolean => {
    for (const v of fetchingByRemote().values()) if (v) return true;
    return false;
  };
  // currently unreferenced — the in-canvas comet-trail spinner on
  // each remote hub (driven by `loadingNodeIds`) replaced the corner
  // chip overlay. kept as a public-ish hook for future chrome that
  // wants a coarse "any remote in flight?" signal.
  void isAnyRemoteRefetching;

  // batched-update plumbing: each `RemoteAlbumsLoader` reports a fresh
  // adapted list whenever a new page lands. publishing each one
  // immediately triggers a full graph re-layout per page per remote
  // (very slow for big libraries), so we coalesce all incoming updates
  // into a single rAF tick and flush them as one signal write. after
  // every flush we ask the graph to refit so newly added nodes land in
  // view.
  const pendingUpdates = new Map<string, AlbumNodeData[]>();
  let flushScheduled = false;
  let scheduleFit: (() => void) | null = null;

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
    scheduleFit?.();
  };

  const setNodesFor = (remoteId: string, list: AlbumNodeData[]) => {
    pendingUpdates.set(remoteId, list);
    if (flushScheduled) return;
    flushScheduled = true;
    // rAF coalesces multiple in-flight `onNodes` calls from sibling
    // loaders (one per remote) into a single graph mutation.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(flushPending);
    } else {
      queueMicrotask(flushPending);
    }
  };

  // when a remote is deselected (or removed from props.remotes),
  // prune its entry so its nodes drop from the graph on the next tick.
  // also clean up the per-remote fetching flag so a stale `true`
  // doesn't keep the "refreshing…" chip lit.
  createEffect(() => {
    const active = new Set(selectedRemotes().map((r) => r.remote_id));
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
  });

  const nodes = createMemo<AlbumNodeData[]>(() => {
    const out: AlbumNodeData[] = [];
    for (const list of nodesByRemote().values()) out.push(...list);
    return out;
  });

  // ---- tag filter ------------------------------------------------------
  // historical: the topnav's built-in tag picker (button + selected
  // badges, identical UX to the songs/albums views) used to be wired
  // here via `setPageInfo({ availableTags, selectedTagFilters, ... })`.
  // it's been ripped out for the graph subview because tag filtering
  // belongs in-canvas alongside the other relation surfaces (planned:
  // a tag-hub node type / sub-relation drilldown). until that lands,
  // `visibleNodes` is a pass-through over `nodes()` — the alias is
  // kept so the downstream callers (page count, lasso targets, etc.)
  // don't have to be re-pointed when the in-canvas picker arrives and
  // re-introduces a filter step.
  const visibleNodes = nodes;

  // push graph state into the shared `pageInfo` store. title/count
  // mirror what `AlbumsTable` pushes for the table subview so the page
  // header stays consistent across subview swaps.
  //
  // the topnav tag filter picker (button + selected badges) used to be
  // wired here, alongside the songs/albums views. it's now hidden in
  // the graph subview \u2014 the tag-filter machinery (`tagFilters` signal,
  // `visibleNodes` filtering, `handleAddTag` et al) is kept dormant so
  // a future in-canvas tag picker / tag hub node can re-light it
  // without re-importing the wiring. with no entries pushed in,
  // `tagFilters()` stays empty and `visibleNodes` is a pass-through.
  createEffect(() => {
    setPageInfo({
      title: "library",
      count: visibleNodes().length,
    });
  });
  onCleanup(() => clearPageInfo());

  // resolve the bare album_id from the namespaced node id
  // (`${remoteId}::${album_id}`). robust against future id encodings.
  const bareAlbumId = (n: AlbumNodeData): string => {
    const sep = n.id.indexOf("::");
    return sep >= 0 ? n.id.slice(sep + 2) : n.id;
  };

  /** find the source Remote for a node so we hit the right backend
   *  for songs/favorites. falls back to the first selected remote. */
  const remoteForNode = (n: AlbumNodeData): Remote | undefined => {
    const id = n.sourceRemoteId;
    const all = props.remotes();
    if (id) {
      const found = all.find((r) => r.remote_id === id);
      if (found) return found;
    }
    const sel = selectedRemotes();
    return sel[0] ?? all[0];
  };

  const fetchAlbumSongs = async (remote: Remote, albumId: string) => {
    const ds = new RemoteMusicDataSource(remote);
    const resp = await ds.getAlbumSongs(albumId);
    return resp.items;
  };

  // ---- content-kind selector ------------------------------------------
  // user-controlled toggle between album-only, artist-only, and both
  // when drilling into a relation, both artist and album fan-out nodes
  // are always shown together — the old albums/artists/both topnav
  // picker is gone. the per-artist related-artist query also fires
  // unconditionally so artist↔artist edges can be drawn.
  const MERGED_ARTIST_PREFIX = "merged_artist::";
  const MERGED_ALBUM_PREFIX = "merged_album::";

  const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
  const artistMergeKey = (
    artistName: string | null | undefined,
    artistId?: string | null
  ): string => {
    const byName = norm(artistName);
    if (byName) return byName;
    return `id:${norm(artistId)}`;
  };
  const albumMergeKey = (n: AlbumNodeData): string => {
    const ak = artistMergeKey(n.artistName, n.artistId);
    return `${ak}::${norm(n.title)}`;
  };
  // local aliases that mirror the prior in-file helper signatures so
  // the rest of the file can keep its current call shape.
  const relationValueFromHubId = parseRelationValueHubId;

  const [focusedNode, setFocusedNode] = createSignal<GraphNodeData | null>(null);
  type DrillMode = "root" | "relation_values" | "entities";
  const [drillMode, setDrillMode] = createSignal<DrillMode>("root");
  const [activeRelationKind, setActiveRelationKind] = createSignal<RelationKind | null>(null);
  // remoteId of the per-remote relation-kind hub the user drilled
  // into. only meaningful in the "relation_values" drill tier —
  // value hubs are shared across remotes, so this is cleared as
  // soon as the user descends past the value layer into entities.
  const [activeRemoteId, setActiveRemoteId] = createSignal<string | null>(null);
  const [activeRelationValueNorm, setActiveRelationValueNorm] = createSignal<string | null>(null);

  const enterRootMode = () => {
    setDrillMode("root");
    setActiveRelationKind(null);
    setActiveRemoteId(null);
    setActiveRelationValueNorm(null);
  };
  const enterRelationValuesMode = (kind: RelationKind, remoteId: string) => {
    setDrillMode("relation_values");
    setActiveRelationKind(kind);
    setActiveRemoteId(remoteId);
    setActiveRelationValueNorm(null);
  };
  const enterEntitiesMode = (kind: RelationKind, valueNorm: string | null = null) => {
    setDrillMode("entities");
    setActiveRelationKind(kind);
    // value hubs are shared across remotes; once we drop into the
    // entity tier the per-remote scope disappears.
    setActiveRemoteId(null);
    setActiveRelationValueNorm(valueNorm);
  };

  const mergedAlbums = createMemo<AlbumNodeData[]>(() => {
    const grouped = new Map<string, AlbumNodeData[]>();
    for (const album of visibleNodes()) {
      const key = albumMergeKey(album);
      const list = grouped.get(key);
      if (list) list.push(album);
      else grouped.set(key, [album]);
    }

    const merged: AlbumNodeData[] = [];
    for (const [key, list] of grouped) {
      const base = list[0];
      const genres = new Set<string>();
      const moods = new Set<string>();
      const styles = new Set<string>();
      const tags = new Map<string, number>();
      const labels = new Map<string, number>();
      const eras = new Map<string, number>();
      let hasFavorite = false;
      let trackCount = 0;
      let totalDurationSec = 0;

      for (const item of list) {
        for (const g of item.genres) genres.add(g);
        for (const m of item.moods) moods.add(m);
        for (const s of item.styles) styles.add(s);
        for (const t of item.tags) tags.set(t.label, Math.max(tags.get(t.label) ?? 0, t.weight));
        if (item.label) labels.set(item.label, (labels.get(item.label) ?? 0) + 1);
        if (item.era) eras.set(item.era, (eras.get(item.era) ?? 0) + 1);
        if (item.isFavorite) hasFavorite = true;
        trackCount = Math.max(trackCount, item.trackCount ?? 0);
        totalDurationSec = Math.max(totalDurationSec, item.totalDurationSec ?? 0);
      }

      const topCountValue = (m: Map<string, number>): string | null => {
        let best: string | null = null;
        let bestCount = -1;
        for (const [k, c] of m) {
          if (c > bestCount) {
            best = k;
            bestCount = c;
          }
        }
        return best;
      };

      merged.push({
        ...base,
        id: `${MERGED_ALBUM_PREFIX}${key}`,
        artistId: `${MERGED_ARTIST_PREFIX}${artistMergeKey(base.artistName, base.artistId)}`,
        genres: [...genres],
        moods: [...moods],
        styles: [...styles],
        tags: [...tags.entries()].map(([label, weight]) => ({ label, weight })),
        label: topCountValue(labels),
        era: topCountValue(eras),
        isFavorite: hasFavorite,
        trackCount,
        totalDurationSec,
      });
    }
    return merged;
  });

  const mergedFavoriteArtistIds = createMemo(() => {
    const set = new Set<string>();
    const byArtist = new Map<string, boolean>();
    for (const album of mergedAlbums()) {
      const cur = byArtist.get(album.artistId) ?? false;
      byArtist.set(album.artistId, cur || !!album.isFavorite);
    }
    for (const [artistId, fav] of byArtist) if (fav) set.add(artistId);
    return set;
  });

  const mergedArtistNodes = createMemo(() =>
    deriveArtistNodes(mergedAlbums(), mergedFavoriteArtistIds())
  );

  const remoteHubNodes = createMemo<ArtistNodeData[]>(() => {
    const countsByRemote = new Map<string, number>();
    for (const n of visibleNodes()) {
      const id = n.sourceRemoteId;
      if (!id) continue;
      countsByRemote.set(id, (countsByRemote.get(id) ?? 0) + 1);
    }
    return props.remotes().map((r) => ({
      id: remoteHubId(r.remote_id),
      kind: "artist",
      artistId: remoteHubId(r.remote_id),
      name: r.name || r.remote_id,
      abbreviation: (r.name || r.remote_id).slice(0, 3).toUpperCase(),
      imageUrl: null,
      image: null,
      albumCount: countsByRemote.get(r.remote_id) ?? 0,
      genres: [],
      tags: [],
      moods: [],
      styles: [],
      label: null,
      era: null,
      isFavorite: false,
    }));
  });

  // per-remote relation-kind hubs. each selected remote gets its own
  // hex per relation kind, so the tree splays into separate regions
  // of the canvas instead of fighting over a single shared hub.
  // counts are per-remote (membership filtered by sourceRemoteId).
  const relationHubNodes = createMemo<ArtistNodeData[]>(() => {
    const out: ArtistNodeData[] = [];
    const selIds = selectedRemoteIds();
    for (const remote of props.remotes()) {
      if (!selIds.has(remote.remote_id)) continue;
      const remoteId = remote.remote_id;
      const albumsForRemote = mergedAlbums().filter((a) => a.sourceRemoteId === remoteId);
      // ArtistNodeData doesn't carry sourceRemoteId directly — derive
      // the per-remote artist set from the artistIds present on
      // albums sourced from this remote.
      const remoteArtistIds = new Set<string>();
      for (const a of albumsForRemote) remoteArtistIds.add(a.artistId);
      const artistsForRemote = mergedArtistNodes().filter((n) => remoteArtistIds.has(n.artistId));
      for (const kind of RELATION_HUB_KINDS) {
        let count = 0;
        if (kind === "favorite") {
          count =
            albumsForRemote.filter((n) => !!n.isFavorite).length +
            artistsForRemote.filter((n) => !!n.isFavorite).length;
        } else if (kind === "same_artist") {
          const albumsPerArtist = new Map<string, number>();
          for (const a of albumsForRemote) {
            albumsPerArtist.set(a.artistId, (albumsPerArtist.get(a.artistId) ?? 0) + 1);
          }
          for (const n of artistsForRemote) {
            if ((albumsPerArtist.get(n.artistId) ?? 0) > 1) count++;
          }
        } else if (kind === "related_artist") {
          for (const n of artistsForRemote) {
            const related = relatedMap().get(n.artistId);
            if (related && related.size > 0) count++;
          }
        } else if (relationSupportsValueLayer(kind)) {
          const uniq = new Set<string>();
          for (const n of albumsForRemote) {
            for (const v of relationValuesForNode(kind, n)) uniq.add(v);
          }
          count = uniq.size;
        }
        if (count <= 0) continue;
        out.push({
          id: relationHubId(kind, remoteId),
          kind: "artist",
          artistId: relationHubId(kind, remoteId),
          name: RELATION_LABEL[kind] ?? kind,
          abbreviation: (RELATION_LABEL[kind] ?? kind).slice(0, 3).toUpperCase(),
          imageUrl: null,
          image: null,
          albumCount: count,
          genres: [],
          tags: [],
          moods: [],
          styles: [],
          label: null,
          era: null,
          isFavorite: false,
        });
      }
    }
    return out;
  });

  const relationValuesForNode = (kind: RelationKind, node: GraphNodeData): string[] => {
    switch (kind) {
      case "genre":
        return node.genres.map(norm).filter(Boolean);
      case "tag":
        return node.tags.map((t) => norm(t.label)).filter(Boolean);
      case "mood":
        return node.moods.map(norm).filter(Boolean);
      case "style":
        return node.styles.map(norm).filter(Boolean);
      case "era": {
        const e = norm(node.era);
        return e ? [e] : [];
      }
      case "label": {
        const l = norm(node.label);
        return l ? [l] : [];
      }
      default:
        return [];
    }
  };

  // shared (kind, value) hubs across all selected remotes. when the
  // user has drilled into a specific remote's relation-kind hub, we
  // narrow to only the values with membership from that remote;
  // counts always reflect the aggregate across every selected remote
  // so the convergence point shows the full cross-remote picture.
  const relationValueHubNodes = createMemo<ArtistNodeData[]>(() => {
    const kind = activeRelationKind();
    if (!kind || !relationSupportsValueLayer(kind)) return [];
    const counts = new Map<string, number>();
    const allowedValues = (() => {
      const remoteId = activeRemoteId();
      if (!remoteId) return null;
      const allowed = new Set<string>();
      for (const n of mergedAlbums()) {
        if (n.sourceRemoteId !== remoteId) continue;
        for (const v of relationValuesForNode(kind, n)) allowed.add(v);
      }
      return allowed;
    })();
    for (const n of mergedAlbums()) {
      for (const v of relationValuesForNode(kind, n)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const entries = [...counts.entries()]
      .filter(([v]) => allowedValues == null || allowedValues.has(v))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.map(([valueNorm, count]) => ({
      id: relationValueHubId(kind, valueNorm),
      kind: "artist",
      artistId: relationValueHubId(kind, valueNorm),
      name: valueNorm,
      abbreviation: valueNorm.slice(0, 3).toUpperCase(),
      imageUrl: null,
      image: null,
      albumCount: count,
      genres: [],
      tags: [],
      moods: [],
      styles: [],
      label: null,
      era: null,
      isFavorite: false,
    }));
  });

  const artistNodesById = createMemo(() => {
    const out = new Map<string, ArtistNodeData>();
    for (const a of mergedArtistNodes()) out.set(a.id, a);
    for (const a of remoteHubNodes()) out.set(a.id, a);
    for (const a of relationHubNodes()) out.set(a.id, a);
    for (const a of relationValueHubNodes()) out.set(a.id, a);
    return out;
  });

  const uniqueArtistIds = createMemo(() => mergedArtistNodes().map((a) => a.artistId));
  // related-artist lookups hit one remote — pick the first selected one
  // (the user's primary context), falling back to the first available.
  const primaryRemote = createMemo(() => selectedRemotes()[0] ?? props.remotes()[0]);
  const relatedQuery = useRelatedArtistsByIds({
    remote: primaryRemote,
    artistIds: uniqueArtistIds,
    enabled: () => activeRelationKind() === "related_artist",
  });
  const relatedMap = createMemo(() => relatedQuery.data ?? new Map<string, Set<string>>());

  const albumsPerMergedArtist = createMemo(() => {
    const out = new Map<string, number>();
    for (const album of mergedAlbums()) {
      out.set(album.artistId, (out.get(album.artistId) ?? 0) + 1);
    }
    return out;
  });

  const hasRelationMembership = (
    kind: RelationKind,
    node: GraphNodeData,
    valueNorm?: string | null
  ): boolean => {
    if (node.kind === "artist" && isAnyHubId(node.artistId)) {
      return false;
    }
    if (relationSupportsValueLayer(kind)) {
      const values = relationValuesForNode(kind, node);
      if (values.length === 0) return false;
      if (!valueNorm) return true;
      return values.includes(valueNorm);
    }
    switch (kind) {
      case "favorite":
        return !!node.isFavorite;
      case "same_artist":
        return (albumsPerMergedArtist().get(node.artistId) ?? 0) > 1;
      case "related_artist": {
        const related = relatedMap().get(node.artistId);
        return !!related && related.size > 0;
      }
      case "artist_album":
        return true;
      default:
        return false;
    }
  };

  createEffect(() => {
    const focus = focusedNode();
    if (!focus) return;
    if (focus.kind === "artist") {
      if (artistNodesById().has(focus.id)) return;
      setFocusedNode(null);
      return;
    }
    const exists = mergedAlbums().some((n) => n.id === focus.id);
    if (!exists) {
      setFocusedNode(null);
    }
  });

  const fanoutAlbums = createMemo<AlbumNodeData[]>(() => {
    const active = activeRelationKind();
    if (!active) return [];
    if (relationSupportsValueLayer(active) && !activeRelationValueNorm()) return [];
    return mergedAlbums().filter((n) =>
      hasRelationMembership(active, n, activeRelationValueNorm())
    );
  });
  const fanoutArtists = createMemo<ArtistNodeData[]>(() => {
    const active = activeRelationKind();
    if (!active) return [];
    if (relationSupportsValueLayer(active) && !activeRelationValueNorm()) return [];
    return mergedArtistNodes().filter((n) =>
      hasRelationMembership(active, n, activeRelationValueNorm())
    );
  });

  const graphNodes = createMemo<GraphNodeData[]>(() => {
    const out: GraphNodeData[] = [];
    out.push(...remoteHubNodes());
    const mode = drillMode();
    const active = activeRelationKind();
    const activeRemote = activeRemoteId();
    // pick the per-remote relation-kind hub the user drilled into.
    // in entities mode (after descending past the value tier) the
    // remote scope is gone, so fall back to the first matching hub
    // across all selected remotes so the ancestry chip stays visible.
    const activeRelationHub = active
      ? (relationHubNodes().find((n) => {
          const parsed = parseRelationHubId(n.artistId);
          if (!parsed || parsed.kind !== active) return false;
          return activeRemote == null || parsed.remoteId === activeRemote;
        }) ?? null)
      : null;

    if (mode === "root" || !active || !activeRelationHub) {
      out.push(...relationHubNodes());
      return out;
    }

    out.push(activeRelationHub);

    if (mode === "relation_values" && relationSupportsValueLayer(active)) {
      out.push(...relationValueHubNodes());
      return out;
    }

    if (mode === "entities" && relationSupportsValueLayer(active) && activeRelationValueNorm()) {
      const activeValueHub = relationValueHubNodes().find((n) => {
        const parsed = relationValueFromHubId(n.artistId);
        return !!parsed && parsed.kind === active && parsed.valueNorm === activeRelationValueNorm();
      });
      if (activeValueHub) out.push(activeValueHub);
    }
    out.push(...fanoutAlbums());
    out.push(...fanoutArtists());
    return out;
  });

  const customEdges = createMemo<GraphEdge[]>(() => {
    const out: GraphEdge[] = [];
    const remotes = remoteHubNodes();
    const relations = relationHubNodes();
    const mode = drillMode();
    const active = activeRelationKind();
    const activeRemote = activeRemoteId();

    // selected remote(s) own the relation scaffold beneath them.
    // unselected remote triangles float free as pickers.
    const selectedIds = selectedRemoteIds();
    const activeRemotes = remotes.filter((r) => {
      const rid = parseRemoteHubId(r.artistId);
      return rid !== null && selectedIds.has(rid);
    });

    // index per-remote relation hubs by (remoteId, kind) for cheap lookups.
    const relationHubByRemoteKind = new Map<string, ArtistNodeData>();
    for (const r of relations) {
      const parsed = parseRelationHubId(r.artistId);
      if (!parsed) continue;
      relationHubByRemoteKind.set(`${parsed.remoteId}::${parsed.kind}`, r);
    }

    // root scaffold: every selected remote splays into its own kind hubs.
    if (mode === "root" || !active) {
      for (const remote of activeRemotes) {
        const rid = parseRemoteHubId(remote.artistId);
        if (!rid) continue;
        for (const kind of RELATION_HUB_KINDS) {
          const hub = relationHubByRemoteKind.get(`${rid}::${kind}`);
          if (!hub) continue;
          out.push({
            source: remote.id,
            target: hub.id,
            kind,
            // keep the root scaffold connected, but loose enough that
            // collide force can maintain clear separation between hubs.
            weight: 0.32,
            label: remote.name,
          });
        }
      }
      return out;
    }

    // drilled past root: connect every selected remote to its own
    // per-remote relation-kind hub so the ancestry stays visible.
    for (const remote of activeRemotes) {
      const rid = parseRemoteHubId(remote.artistId);
      if (!rid) continue;
      const hub = relationHubByRemoteKind.get(`${rid}::${active}`);
      if (!hub) continue;
      out.push({
        source: remote.id,
        target: hub.id,
        kind: active,
        weight: 0.34,
        label: remote.name,
      });
    }

    if (mode === "relation_values" && relationSupportsValueLayer(active)) {
      // every per-remote kind hub fans out into the shared value
      // hubs it has membership for. when the user drilled into a
      // single remote (activeRemote set), only that remote's hub
      // gets wired up; the others stay hung off their remote
      // triangle without value spokes.
      const valueHubs = relationValueHubNodes();
      for (const remote of activeRemotes) {
        const rid = parseRemoteHubId(remote.artistId);
        if (!rid) continue;
        if (activeRemote != null && rid !== activeRemote) continue;
        const hub = relationHubByRemoteKind.get(`${rid}::${active}`);
        if (!hub) continue;
        // values this remote contributes membership for.
        const remoteValues = new Set<string>();
        for (const n of mergedAlbums()) {
          if (n.sourceRemoteId !== rid) continue;
          for (const v of relationValuesForNode(active, n)) remoteValues.add(v);
        }
        for (const valueHub of valueHubs) {
          const parsed = relationValueFromHubId(valueHub.artistId);
          if (!parsed) continue;
          if (!remoteValues.has(parsed.valueNorm)) continue;
          out.push({
            source: hub.id,
            target: valueHub.id,
            kind: active,
            weight: 0.38,
            label: valueHub.name,
          });
        }
      }
      return out;
    }

    // entities tier: at most one value hub is in play; entities hang
    // off that value hub (shared sink) or directly off the kind hubs
    // for non-value-layer kinds (favorite / same_artist / related_artist).
    const activeValueHub = relationValueHubNodes().find((n) => {
      const parsed = relationValueFromHubId(n.artistId);
      return !!parsed && parsed.kind === active && parsed.valueNorm === activeRelationValueNorm();
    });
    const sourceIds: string[] = [];
    if (activeValueHub) {
      // wire every selected remote's kind hub into the shared value hub
      // so the convergence is visible.
      for (const remote of activeRemotes) {
        const rid = parseRemoteHubId(remote.artistId);
        if (!rid) continue;
        const hub = relationHubByRemoteKind.get(`${rid}::${active}`);
        if (!hub) continue;
        const remoteValues = new Set<string>();
        for (const n of mergedAlbums()) {
          if (n.sourceRemoteId !== rid) continue;
          for (const v of relationValuesForNode(active, n)) remoteValues.add(v);
        }
        if (!remoteValues.has(activeValueHub.name)) continue;
        out.push({
          source: hub.id,
          target: activeValueHub.id,
          kind: active,
          weight: 0.4,
          label: activeValueHub.name,
        });
      }
      sourceIds.push(activeValueHub.id);
    } else {
      // no value tier (favorite/same_artist/related_artist) — entities
      // hang off every selected remote's per-remote kind hub directly.
      for (const remote of activeRemotes) {
        const rid = parseRemoteHubId(remote.artistId);
        if (!rid) continue;
        const hub = relationHubByRemoteKind.get(`${rid}::${active}`);
        if (!hub) continue;
        sourceIds.push(hub.id);
      }
    }

    for (const album of fanoutAlbums()) {
      for (const sourceId of sourceIds) {
        out.push({
          source: sourceId,
          target: album.id,
          kind: active,
          weight: 0.9,
          label: album.title,
        });
      }
    }
    for (const artist of fanoutArtists()) {
      for (const sourceId of sourceIds) {
        out.push({
          source: sourceId,
          target: artist.id,
          kind: active,
          weight: 0.9,
          label: artist.name,
        });
      }
    }
    return out;
  });

  const topologyKey = createMemo(() => {
    const remotes = props
      .remotes()
      .map((r) => r.remote_id)
      .sort()
      .join("|");
    // keep topology stable while drilling relation hubs; including
    // activeRelationKind here causes createGraphLibraryView to reset
    // selection on every relation click, which immediately clears the
    // fan-out state again.
    return remotes;
  });
  // compose any caller-supplied extraTools (e.g. the admin-only bulk-tag
  // toggle from the parent) alongside a manual refresh button — the
  // graph query opts out of the 5s mb-lookup re-poll (see
  // RemoteAlbumsLoader), so this is the explicit way to pull in newly-
  // added/updated albums.
  const refreshButton = (
    <button
      type="button"
      title="refresh graph data"
      aria-label="refresh graph data"
      onClick={() => {
        void queryClient.invalidateQueries({ queryKey: ["library-albums"] });
      }}
      class="inline-flex items-center justify-center w-7 h-7 rounded border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 cursor-pointer leading-none text-[14px]"
    >
      <span aria-hidden="true">↻</span>
    </button>
  );
  const composedExtraTools = (
    <div class="inline-flex items-center gap-2">
      {refreshButton}
      {props.extraTools}
    </div>
  );

  // forward ref to the graph view (created below). lets us drive a
  // per-selection `useArtistQuery` from the current artist-node id so
  // the popover can show the bio + favorite state without the parent
  // needing to thread them down a different way.
  const [graphRef, setGraphRef] = createSignal<ReturnType<typeof createGraphLibraryView> | null>(
    null
  );
  const selectedArtistQuery = useArtistQuery(() => {
    const id = graphRef()?.selectedArtistId() ?? null;
    if (!id) return undefined;
    if (isRemoteHubId(id) || isRelationHubId(id) || isRelationValueHubId(id)) return undefined;
    return id;
  });

  // resolve every URL we can pull out of an ImageMetadata + optional
  // pre-resolved url. handles charnel-managed (tauri) and p2p remotes
  // via the blob resolver; falls back to plain `remote_url` for HTTP
  // remotes. returns a deduplicated list.
  const buildImageUrls = async (
    image: ImageMetadata | null | undefined,
    imageUrl: string | null | undefined,
    fallbackRemoteId?: string | null
  ): Promise<string[]> => {
    const urls: string[] = [];
    const add = (u: string | null | undefined) => {
      if (!u) return;
      if (urls.includes(u)) return;
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
            const u = await resolveBlobUrl(blobId, serverId, "image");
            add(u);
          }
        } catch {
          // best-effort; leave the resolved url out and rely on what we have
        }
      }
      // local-only image (no remote server) — resolve via OPFS so it
      // shows up in the carousel instead of being silently dropped.
      if (image.local_blob_id && !image.remote_server_id) {
        try {
          const u = await resolveLocalBlobUrl(image.local_blob_id);
          add(u);
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
    // artist nodes don't have their own image data on the graph
    // `deriveArtistNodes` uses the first album's cover as an avatar
    // fallback (see deriveArtistNodes.ts header). that cover is NOT
    // representative of the artist, so don't seed the carousel with
    // it; pull only from the canonical artist record's images.
    //
    // guard: `selectedArtistQuery` is keyed off the currently-selected
    // artist id, but its data may briefly lag behind a fresh selection.
    // only consume the data when its artist_id matches the clicked
    // artist to avoid mixing in the previous selection's images.
    const urls: string[] = [];
    const queryData = selectedArtistQuery.data;
    const matches = queryData && queryData.artist_id === artist.artistId;
    if (matches && queryData.images?.length) {
      // only the full-res `original` records — `thumbnail` / `preview`
      // are distinct blob ids that visually render as the same image
      // and would clutter the carousel with duplicates.
      for (const img of queryData.images) {
        if (img.blob_type !== "original") continue;
        const more = await buildImageUrls(img, null, null);
        for (const u of more) {
          if (!urls.includes(u)) urls.push(u);
        }
      }
    }
    // last-resort fallback: if the artist has zero real images,
    // show the album-cover avatar (better than an empty modal).
    if (urls.length === 0 && (artist.image || artist.imageUrl)) {
      const more = await buildImageUrls(artist.image, artist.imageUrl, null);
      for (const u of more) {
        if (!urls.includes(u)) urls.push(u);
      }
    }
    if (urls.length === 0) return;
    showImageCarousel({ images: urls, title: formatImageCarouselTitle(artist.name, urls.length) });
  };

  const backOneDrillLevel = (): boolean => {
    const mode = drillMode();
    if (mode === "root") return false;
    const kind = activeRelationKind();
    if (!kind) {
      enterRootMode();
      requestRefitAfterDrill();
      return true;
    }

    if (mode === "entities" && relationSupportsValueLayer(kind) && activeRelationValueNorm()) {
      // stepping up from entities (where activeRemoteId is null) into
      // relation_values requires a remote scope. fall back to any
      // currently selected remote so the value tier still has a
      // valid drill context.
      const fallbackRemote = activeRemoteId() ?? selectedRemoteIds().values().next().value ?? null;
      if (fallbackRemote) {
        enterRelationValuesMode(kind, fallbackRemote);
        requestRefitAfterDrill();
        return true;
      }
    }

    enterRootMode();
    requestRefitAfterDrill();
    return true;
  };

  // after drilling back up the tree the graph swaps its node set
  // (e.g. relation_value octagons disappear, relation hexagons
  // reappear). the force sim keeps the previous positions, which
  // for nodes that survive the swap can leave them flung far across
  // the viewport. force a fit a couple frames after the swap so the
  // remaining nodes recenter. we bypass `fitIfIdle` (which is a
  // no-op once the user has interacted) because this is an
  // explicit response to a user-initiated navigation, not an
  // unsolicited camera jump.
  let refitTimer: ReturnType<typeof setTimeout> | null = null;
  const requestRefitAfterDrill = () => {
    if (refitTimer != null) clearTimeout(refitTimer);
    // wait a tick for the nodes memo + worker to settle, then fit.
    refitTimer = setTimeout(() => {
      refitTimer = null;
      graph.fit();
    }, 250);
  };
  onCleanup(() => {
    if (refitTimer != null) clearTimeout(refitTimer);
  });

  // per-node loading set — every remote hub whose RemoteAlbumsLoader
  // is mid-fetch (initial load OR auto-paging OR manual refetch)
  // gets a comet-trail spinner around its silhouette. mirrors the
  // player-bar play/pause loading ring visual.
  const loadingNodeIds = createMemo<Set<string>>(() => {
    const out = new Set<string>();
    for (const [remoteId, fetching] of fetchingByRemote()) {
      if (fetching) out.add(remoteHubId(remoteId));
    }
    return out;
  });

  const graph = createGraphLibraryView({
    nodes: graphNodes,
    customEdges,
    topologyKey,
    relatedArtists: relatedMap,
    searchQuery,
    paused: () => !props.isActive(),
    lockNodes: true,
    loadingNodeIds,
    getHoverPreview: (node) => {
      // peek-on-hover: ring up to ~12 child albums around a hub so
      // the user can sanity-check what's inside before drilling.
      // applies to relation_value (octagon) hubs always, and to
      // relation (hex) hubs that have no value layer (favorite,
      // same_artist, related_artist) since those are effectively
      // leaf relations with no sub-relation tier to peek through.
      if (node.kind !== "artist") return [];
      const artistId = (node as ArtistNodeData).artistId;
      const previewCap = 12;
      const valueHub = parseRelationValueHubId(artistId);
      if (valueHub) {
        const matches: GraphNodeData[] = [];
        for (const album of mergedAlbums()) {
          if (hasRelationMembership(valueHub.kind, album, valueHub.valueNorm)) {
            matches.push(album);
            if (matches.length >= previewCap + 1) break;
          }
        }
        return matches;
      }
      const relationKind = parseRelationHubId(artistId)?.kind ?? null;
      if (relationKind && !relationSupportsValueLayer(relationKind)) {
        const matches: GraphNodeData[] = [];
        for (const album of mergedAlbums()) {
          if (hasRelationMembership(relationKind, album, null)) {
            matches.push(album);
            if (matches.length >= previewCap + 1) break;
          }
        }
        return matches;
      }
      return [];
    },
    onSelectionChange: (node) => {
      setFocusedNode(node);
      if (!node) {
        backOneDrillLevel();
        return;
      }
      if (node.kind === "artist") {
        // remote hub: always-multi toggle. shift/cmd no longer
        // matters — every remote-hub click flips that remote in or
        // out of the selection set (with a floor of 1 so the user
        // can't end up with zero remotes).
        const remoteId = parseRemoteHubId(node.artistId);
        if (remoteId) {
          setSelectedRemoteIds((prev) => {
            const next = new Set(prev);
            if (next.has(remoteId)) {
              if (next.size > 1) next.delete(remoteId);
            } else {
              next.add(remoteId);
            }
            return next;
          });
          // if we just deselected the remote currently being drilled,
          // step back to root so the drill state stays consistent.
          if (activeRemoteId() === remoteId && !selectedRemoteIds().has(remoteId)) {
            enterRootMode();
          }
          setFocusedNode(null);
          graph.clearSelection();
          return;
        }
        const valueHub = relationValueFromHubId(node.artistId);
        if (valueHub) {
          enterEntitiesMode(valueHub.kind, valueHub.valueNorm);
          // hubs don't open a detail popover — drill and move on.
          // (don't call graph.clearSelection() here: it would re-fire
          // onSelectionChange(null) and trigger backOneDrillLevel,
          // reverting the drill we just performed.)
          setFocusedNode(null);
          return;
        }
        const parsedRelation = parseRelationHubId(node.artistId);
        if (parsedRelation) {
          if (relationSupportsValueLayer(parsedRelation.kind)) {
            enterRelationValuesMode(parsedRelation.kind, parsedRelation.remoteId);
          } else {
            enterEntitiesMode(parsedRelation.kind, null);
          }
          setFocusedNode(null);
          return;
        }
      }
    },
    onPlay: async (album) => {
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
    },
    onShuffle: async (album) => {
      const r = remoteForNode(album);
      if (!r) return;
      try {
        const songs = await fetchAlbumSongs(r, bareAlbumId(album));
        const shuffled = [...songs].sort(() => Math.random() - 0.5);
        await playQueue(shuffled, {
          source: { type: "shuffle", label: album.title, entity_id: bareAlbumId(album) },
        });
      } catch (err) {
        toast.error(`failed to shuffle album: ${(err as Error).message}`);
      }
    },
    onAddToQueue: async (album) => {
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
    },
    onViewAlbum: (album) => {
      const r = remoteForNode(album);
      navigate(routes.albumOn(r?.remote_id ?? null, bareAlbumId(album)));
    },
    onViewArtist: (album) => {
      if (!album.artistId) return;
      const r = remoteForNode(album);
      navigate(routes.artistOn(r?.remote_id ?? null, album.artistId));
    },
    onToggleFavorite: (album) => {
      const r = remoteForNode(album);
      favoriteMutation.mutate(
        {
          targetType: "album",
          targetId: bareAlbumId(album),
          isFavorite: !(album.isFavorite ?? false),
          remote: r,
        },
        {
          // note: no manual invalidation here. `useToggleFavoriteMutation`
          // optimistically patches `["library-albums", remote_id, ...]`
          // via `updateAlbumInCache`, so the graph node + popover heart
          // reflect the new state instantly and persist across re-renders
          // without a refetch flicker.
          onError: (err) => {
            toast.error(`failed to toggle favorite: ${(err as Error).message}`);
          },
        }
      );
    },
    onLassoSelect: (albums) => {
      // bulk-tag mode: forward to parent with the resolved (single)
      // remote + bare album ids. when not in bulk-tag mode this is a
      // no-op for now the canvas already shows the lasso selection.
      if (!props.bulkTagMode?.()) return;
      if (albums.length === 0) return;
      // all lasso'd nodes should share the same remote when bulk-tag
      // is on (we force single-remote at the parent). resolve via the
      // first node's source remote, falling back to all[0].
      const r = remoteForNode(albums[0]);
      if (!r) return;
      // filter to nodes that actually belong to that remote defensive
      // against any stray cross-remote nodes hanging around.
      const ids = albums.filter((a) => (a.sourceRemoteId ?? null) === r.remote_id).map(bareAlbumId);
      if (ids.length === 0) return;
      props.onLassoAlbums?.(r, ids);
    },
    forceTool: () => (props.bulkTagMode?.() ? "lasso" : null),
    extraTools: composedExtraTools,
    // admin-only edit handlers — callbacks are wired unconditionally;
    // each one checks per-remote admin status before opening the
    // editor. (the popover's edit button still appears only when the
    // callback is provided, so for fully non-admin users we omit it
    // entirely via `isAnyRemoteAdmin()` below.)
    onEditAlbum: isAnyRemoteAdmin()
      ? (album) => {
          const r = remoteForNode(album);
          if (!r || !isRemoteAdmin(r.remote_id)) {
            toast.error("admin permission required");
            return;
          }
          showAlbumEditor({ albumId: bareAlbumId(album), remote: r });
        }
      : undefined,
    onEditArtistNode: isAnyRemoteAdmin()
      ? (artist: ArtistNodeData) => {
          if (
            isRemoteHubId(artist.artistId) ||
            isRelationHubId(artist.artistId) ||
            isRelationValueHubId(artist.artistId)
          ) {
            return;
          }
          // artist nodes are cross-remote aggregations — just open the
          // editor by artist_id and let the modal pick its source.
          showArtistEditor({ artistId: artist.artistId });
        }
      : undefined,
    onImageClickAlbum: (album) => {
      void openAlbumCarousel(album);
    },
    onImageClickArtist: (artist) => {
      if (
        isRemoteHubId(artist.artistId) ||
        isRelationHubId(artist.artistId) ||
        isRelationValueHubId(artist.artistId)
      ) {
        return;
      }
      void openArtistCarousel(artist);
    },
    onViewArtistNode: (artist) => {
      if (
        isRemoteHubId(artist.artistId) ||
        isRelationHubId(artist.artistId) ||
        isRelationValueHubId(artist.artistId)
      ) {
        return;
      }
      // artist nodes are cross-remote aggregations navigate to the
      // active source's artist route (null = local / active).
      navigate(routes.artistOn(null, artist.artistId));
    },
    selectedArtistBio: () => selectedArtistQuery.data?.bio ?? null,
    selectedArtistIsFavorite: () => selectedArtistQuery.data?.is_favorite,
    onToggleFavoriteArtist: (artist, next) => {
      if (
        isRemoteHubId(artist.artistId) ||
        isRelationHubId(artist.artistId) ||
        isRelationValueHubId(artist.artistId)
      ) {
        return;
      }
      // artist favorites use the active data source (no per-artist
      // remote since artist nodes are cross-remote aggregations).
      favoriteMutation.mutate(
        {
          targetType: "artist",
          targetId: artist.artistId,
          isFavorite: next,
        },
        {
          onError: (err) => {
            toast.error(`failed to toggle favorite: ${(err as Error).message}`);
          },
        }
      );
    },
  });
  // publish the graph ref so the artist query above can read its
  // `selectedArtistId()` accessor reactively.
  setGraphRef(graph);

  createEffect(() => {
    const kind = activeRelationKind();
    if (!kind) return;
    void activeRelationValueNorm();
    requestAnimationFrame(() => graph.fit());
  });

  // wire the batched-flush hook to the now-instantiated graph. each
  // flush schedules a fit, but successive flushes within ~200ms coalesce
  // into a single fit so the camera doesn't ping around mid-load. once
  // the user has manually zoomed/panned/selected anything, `fitIfIdle`
  // becomes a no-op so we don't yank their viewport when a later page
  // of nodes lands.
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  scheduleFit = () => {
    if (graph.userInteracted()) return;
    if (fitTimer != null) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      fitTimer = null;
      graph.fitIfIdle();
    }, 200);
  };
  onCleanup(() => {
    if (fitTimer != null) clearTimeout(fitTimer);
  });

  // push graph's topnav cluster into the shell slots. onCleanup wiring
  // inside `useTopNavSlots` clears these on unmount. the secondary row
  // wraps the factory's relation chips with library-level chips
  // (multi-remote selection counter, auto-pause indicator, bulk-tag
  // mode indicator) so the user always sees current state at a glance.
  //
  // narrow viewports: the topnav is space-constrained so we keep
  // rightContent free for the parent LibraryView (remote picker +
  // subview toggle) and fold the graph tools down into the second
  // row alongside the chips.
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  onMount(() => {
    const onResize = () => setIsNarrow(isNarrowViewport());
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));

    // graph-active keyboard shortcuts: `f` fit, `r` reset. these are
    // namespaced to the graph subview by `props.isActive()` so they
    // don't fight with table-subview shortcuts. ignored while the user
    // is typing in an input/textarea/contenteditable.
    const onKey = (e: KeyboardEvent) => {
      if (!props.isActive()) return;
      // escape gets first-class treatment: it should clear the canvas
      // selection EVEN when focus is in an input (the search field),
      // but only if there is no modal on the global stack — modals
      // own escape semantics for themselves. without this guard, esc
      // would close the modal AND clear the selection in one keystroke.
      if (e.key === "Escape") {
        if (isAnyModalOpen()) return;
        // when something is selected, clear it first; onSelectionChange(null)
        // will run backOneDrillLevel deterministically.
        if (focusedNode()) {
          graph.clearSelection();
          return;
        }
        // no active selection: still allow hierarchical back-step.
        if (backOneDrillLevel()) return;
        graph.clearSelection();
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "f") {
        e.preventDefault();
        graph.fit();
      } else if (e.key === "r") {
        e.preventDefault();
        graph.reset();
      }
    };
    // capture phase so we see the keystroke before any in-tree handler
    // can stopPropagation it (e.g. the search input's keydown).
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  // reactive slot publishing — re-runs when isNarrow flips so the
  // topnav reflows correctly on viewport changes.
  createEffect(() => {
    const narrow = isNarrow();
    const chips = (
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <Show when={narrow}>{graph.topNavTools}</Show>
          <Show when={graph.autoPaused()}>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] leading-none whitespace-nowrap border border-amber-400/40 bg-amber-400/10 text-amber-200"
              title="large graph auto-paused — interact to wake"
            >
              sim paused — drag to wake
            </span>
          </Show>
          <Show when={props.bulkTagMode?.()}>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] leading-none whitespace-nowrap border border-[var(--color-accent-500,#ff1a9e)]/50 bg-[var(--color-accent-500,#ff1a9e)]/15 text-[var(--color-accent-500,#ff1a9e)]"
              title="bulk-tag mode — lasso albums to tag (esc to exit)"
            >
              bulk-tag mode — lasso albums to tag
            </span>
          </Show>
        </div>
      </div>
    );
    slots.setSecondaryRowContent(chips);
    // on narrow, LibraryView owns rightContent (picker + subview
    // toggle) — don't touch it here or we'd clobber the parent's
    // write. on wide, publish the graph tools.
    if (!narrow) slots.setRightContent(graph.topNavTools);
  });

  return (
    <div class="h-full flex flex-col">
      {/* fan-out: one loader per selected remote. queryClient dedupes
       *  by key so flipping back to the table view doesn't re-fetch. */}
      <For each={selectedRemotes()}>
        {(r) => (
          <RemoteAlbumsLoader
            remote={r}
            search={searchQuery}
            onNodes={setNodesFor}
            onFetchingChange={setFetchingFor}
          />
        )}
      </For>

      <Show when={nodes().length === 0}>
        {/* render nothing while the first batch is in flight — the
         *  remote hub itself shows its own comet-trail spinner via
         *  `loadingNodeIds`, so we don't want a competing full-pane
         *  "loading…" takeover that hides the graph. an a11y status
         *  region keeps screen readers informed without painting any
         *  visible chrome. */}
        <div class="sr-only" data-testid="library-graph-loading" role="status" aria-live="polite">
          <span>loading…</span>
        </div>
      </Show>
      <Show when={nodes().length > 0 || selectedRemotes().length > 0}>
        {/* graph.pane's root is `flex-1 relative overflow-hidden`, so
         *  its parent MUST be a flex container for flex-1 to take
         *  effect. without `flex` here the pane collapses to ~1px
         *  around its absolutely-positioned canvas child. per-remote
         *  fetch progress is surfaced as a comet-trail spinner on the
         *  corresponding remote hub node (see `loadingNodeIds`); we
         *  intentionally don't render a separate corner "loading…"
         *  chip so the graph stays the single source of truth. */}
        <div class="flex-1 min-h-0 flex relative">{graph.pane}</div>
      </Show>
    </div>
  );
}
