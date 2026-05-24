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
import {
  useToggleFavoriteMutation,
  useFavoritesInfiniteQuery,
} from "../../../music/queries/favorites";
import { toast } from "../../../components/feedback/Toast";
import type { TagFilter, TagOption } from "../../../components/forms/TagFilterPicker";
import { isNarrowViewport } from "../../../config/breakpoints";
import { setPageInfo, clearPageInfo } from "../../../app/services/pageInfo";
import { useHistoryState } from "../../../utils/historyState";
import type { AlbumNodeData, GraphNodeData } from "../../../components/graph/types";
import { deriveArtistNodes } from "./deriveArtistNodes";
import { useRelatedArtistsByIds } from "../../queries/useRelatedArtistsByIds";
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
import type { ArtistNodeData } from "../../../components/graph/types";

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

  // admin-ness is per-remote. consume the global authStatusStore signal
  // (populated by AppLayout / useRemoteIsAdmin's refresh-on-demand) so
  // we stay in sync with topnav role display. `isAnyRemoteAdmin()`
  // gates whether the popovers offer an edit button at all;
  // `isRemoteAdmin(remoteId)` re-checks per-node before opening the
  // editor (in case multiple remotes are selected with mixed roles).
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

  // when a remote is deselected, prune its entry so its nodes drop from
  // the graph on the next tick. also clean up the per-remote fetching
  // flag so a stale `true` doesn't keep the "refreshing…" chip lit.
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
  });

  const nodes = createMemo<AlbumNodeData[]>(() => {
    const out: AlbumNodeData[] = [];
    for (const list of nodesByRemote().values()) out.push(...list);
    return out;
  });

  // ---- tag filter ------------------------------------------------------
  // wires into the shared `pageInfo` plumbing so the topnav's built-in
  // tag picker (trigger button in row 1, selected badges in their own
  // row below) renders identically to songs/albums views. semantics:
  // includes are OR'd (album passes if it has any of the include tags);
  // excludes are hard rejects (any match drops the album). filter is
  // applied below in `visibleNodes`.
  const [tagFilters, setTagFilters] = createSignal<TagFilter[]>([]);

  const handleAddTag = (tag: string) => {
    if (tagFilters().some((f) => f.tag === tag)) return;
    setTagFilters([...tagFilters(), { tag, mode: "include" }]);
  };
  const handleRemoveTag = (tag: string) => {
    setTagFilters(tagFilters().filter((f) => f.tag !== tag));
  };
  const handleToggleTagMode = (tag: string) => {
    setTagFilters(
      tagFilters().map((f) =>
        f.tag === tag ? { tag: f.tag, mode: f.mode === "include" ? "exclude" : "include" } : f
      )
    );
  };
  const handleClearAllTags = () => setTagFilters([]);

  const tagCounts = createMemo<Map<string, number>>(() => {
    const counts = new Map<string, number>();
    for (const n of nodes()) {
      const seen = new Set<string>();
      for (const t of n.tags) {
        if (seen.has(t.label)) continue;
        seen.add(t.label);
        counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
      }
    }
    return counts;
  });

  const availableTagOptions = createMemo<TagOption[]>(() => {
    const entries = [...tagCounts().entries()];
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.map(([label, count]) => ({ value: label, label, count }));
  });

  const visibleNodes = createMemo<AlbumNodeData[]>(() => {
    const filters = tagFilters();
    if (filters.length === 0) return nodes();
    const includes: string[] = [];
    const excludes = new Set<string>();
    for (const f of filters) {
      if (f.mode === "include") includes.push(f.tag);
      else excludes.add(f.tag);
    }
    return nodes().filter((n) => {
      const labels = new Set(n.tags.map((t) => t.label));
      // excludes are hard rejects — any match drops the album.
      for (const exc of excludes) if (labels.has(exc)) return false;
      // includes are OR'd — album passes if it has at least one of
      // the picked include tags (standard multi-select-filter UX).
      if (includes.length === 0) return true;
      for (const inc of includes) if (labels.has(inc)) return true;
      return false;
    });
  });

  // push tag-filter state into the shared `pageInfo` store so the
  // topnav renders the built-in tag picker (button in the primary row,
  // selected badges in their own row below) — identical UX to the
  // songs/albums views. title/count mirror what `AlbumsTable` pushes
  // for the table subview so the page header stays consistent across
  // subview swaps.
  createEffect(() => {
    setPageInfo({
      title: "library",
      count: visibleNodes().length,
      availableTags: availableTagOptions(),
      selectedTagFilters: tagFilters(),
      onAddTag: handleAddTag,
      onRemoveTag: handleRemoveTag,
      onToggleTagMode: handleToggleTagMode,
      onClearAllTags: handleClearAllTags,
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
    return all[0];
  };

  const fetchAlbumSongs = async (remote: Remote, albumId: string) => {
    const ds = new RemoteMusicDataSource(remote);
    const resp = await ds.getAlbumSongs(albumId);
    return resp.items;
  };

  // ---- content-kind selector ------------------------------------------
  // user-controlled toggle between album-only, artist-only, and both
  // node layers. persisted across navigations via useHistoryState so
  // flipping to another view + back preserves the picked layer. when
  // artists are visible we also fire the per-artist related-artist
  // query so artist↔artist edges can be drawn.
  type ContentKind = "albums" | "artists" | "both";
  const [contentKind, setContentKind] = useHistoryState<ContentKind>(
    "library.graph.contentKind",
    "both"
  );
  const showArtists = createMemo(() => contentKind() === "artists" || contentKind() === "both");
  const showAlbums = createMemo(() => contentKind() === "albums" || contentKind() === "both");

  // derive artist nodes from the album set. one node per unique
  // artistId (in-library only — the source albums are by definition
  // in-library). image / abbreviation / aggregated taxonomy come from
  // the constituent albums (see deriveArtistNodes for the merge rules).
  // favorite state is layered in from a favorites listing so artist
  // nodes can participate in the `favorite` relation alongside albums.
  const favoriteArtistsQuery = useFavoritesInfiniteQuery({
    targetType: () => "artist",
    pageSize: 200,
  });
  // auto-paginate: keep fetching pages until we've loaded every
  // favorited artist. the list is typically small so this is cheap;
  // doing it here means the favorite-relation chain doesn't suddenly
  // grow as the user scrolls another view.
  createEffect(() => {
    if (favoriteArtistsQuery.hasNextPage && !favoriteArtistsQuery.isFetchingNextPage) {
      void favoriteArtistsQuery.fetchNextPage();
    }
  });
  const favoriteArtistIds = createMemo(() => {
    const set = new Set<string>();
    const pages = favoriteArtistsQuery.data?.pages ?? [];
    for (const page of pages) {
      for (const item of page.items) {
        if (item.type === "artist") set.add(item.data.artist_id);
      }
    }
    return set;
  });
  const artistNodes = createMemo(() => deriveArtistNodes(visibleNodes(), favoriteArtistIds()));

  const uniqueArtistIds = createMemo(() => artistNodes().map((a) => a.artistId));

  // fan-out per-artist related-artist queries. only enabled when
  // artists are visible (otherwise we'd issue N http calls for nothing).
  // currently keyed against the first selected remote — related-artist
  // data lives per-remote and merging cross-remote relations is a
  // future enhancement.
  const primaryRemote = createMemo(() => props.remotes()[0]);
  const relatedQuery = useRelatedArtistsByIds({
    remote: primaryRemote,
    artistIds: uniqueArtistIds,
    enabled: showArtists,
  });
  const relatedMap = createMemo(() => relatedQuery.data ?? new Map<string, Set<string>>());

  // final node set passed to the graph factory union of layer
  // toggles. order: albums first, then artists, so initial layout
  // seeds the heavier album cluster before artist circles drop in.
  const graphNodes = createMemo<GraphNodeData[]>(() => {
    const out: GraphNodeData[] = [];
    if (showAlbums()) out.push(...visibleNodes());
    if (showArtists()) out.push(...artistNodes());
    return out;
  });

  const topologyKey = createMemo(() => {
    const remotes = props
      .remotes()
      .map((r) => r.remote_id)
      .sort()
      .join("|");
    return `${remotes}::${contentKind()}`;
  });

  // segmented control rendered inside the topnav cluster. on narrow
  // viewports we drop the labels and show icon-only buttons so the
  // toolbar still fits.
  const CONTENT_KIND_OPTIONS: { value: ContentKind; label: string; title: string }[] = [
    { value: "albums", label: "albums", title: "show albums only" },
    { value: "artists", label: "artists", title: "show artists only" },
    { value: "both", label: "both", title: "show albums and artists" },
  ];
  const contentKindSelector = (
    <div
      class="inline-flex items-center rounded border border-white/10 bg-white/5 overflow-hidden"
      role="radiogroup"
      aria-label="graph content"
    >
      <For each={CONTENT_KIND_OPTIONS}>
        {(opt) => (
          <button
            type="button"
            role="radio"
            aria-checked={contentKind() === opt.value}
            title={opt.title}
            onClick={() => setContentKind(opt.value)}
            class="px-2 py-1 text-[11px] leading-none cursor-pointer border-0 bg-transparent text-white/70 hover:text-white"
            classList={{
              "bg-white/15 text-white": contentKind() === opt.value,
            }}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );

  // compose the content-kind selector ahead of any caller-supplied
  // extraTools (e.g. the admin-only bulk-tag toggle from the parent).
  // also includes a manual refresh button — the graph query opts out
  // of the 5s mb-lookup re-poll (see RemoteAlbumsLoader), so this is
  // the explicit way to pull in newly-added/updated albums.
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
      {contentKindSelector}
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
  const selectedArtistQuery = useArtistQuery(() => graphRef()?.selectedArtistId() ?? undefined);

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

  const graph = createGraphLibraryView({
    nodes: graphNodes,
    topologyKey,
    relatedArtists: relatedMap,
    searchQuery,
    paused: () => !props.isActive(),
    lockNodes: true,
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
          // artist nodes are cross-remote aggregations — just open the
          // editor by artist_id and let the modal pick its source.
          showArtistEditor({ artistId: artist.artistId });
        }
      : undefined,
    onImageClickAlbum: (album) => {
      void openAlbumCarousel(album);
    },
    onImageClickArtist: (artist) => {
      void openArtistCarousel(artist);
    },
    onViewArtistNode: (artist) => {
      // artist nodes are cross-remote aggregations navigate to the
      // active source's artist route (null = local / active).
      navigate(routes.artistOn(null, artist.artistId));
    },
    selectedArtistBio: () => selectedArtistQuery.data?.bio ?? null,
    selectedArtistIsFavorite: () => selectedArtistQuery.data?.is_favorite,
    onToggleFavoriteArtist: (artist, next) => {
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
        {graph.selectedRelationChips}
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

      <Show when={nodes().length === 0}>
        <div
          class="flex items-center justify-center h-full text-[var(--color-text-disabled)] text-xs"
          data-testid="library-graph-loading"
          role="status"
          aria-live="polite"
        >
          <span>loading…</span>
        </div>
      </Show>
      <Show when={nodes().length > 0}>
        {/* graph.pane's root is `flex-1 relative overflow-hidden`, so
         *  its parent MUST be a flex container for flex-1 to take
         *  effect. without `flex` here the pane collapses to ~1px
         *  around its absolutely-positioned canvas child. a tiny chip
         *  in the corner signals ongoing fetches (initial pages still
         *  streaming in, or a manual refresh round-tripping). */}
        <div class="flex-1 min-h-0 flex relative">
          {graph.pane}
          <Show when={isAnyRemoteRefetching()}>
            <div
              class="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-white/10 bg-black/50 text-white/70 text-[10px] backdrop-blur-sm pointer-events-none"
              role="status"
              aria-live="polite"
            >
              <svg
                class="animate-spin"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-opacity="0.25"
                />
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                />
              </svg>
              <span>loading…</span>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
