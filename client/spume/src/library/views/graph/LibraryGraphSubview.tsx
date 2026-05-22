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
import { Icon } from "../../../components/icons/registry";
import type { TagFilter, TagOption } from "../../../components/forms/TagFilterPicker";
import { isNarrowViewport } from "../../../config/breakpoints";
import { setPageInfo, clearPageInfo } from "../../../app/services/pageInfo";
import type { AlbumNodeData } from "../../../components/graph/types";

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
}) {
  // graph wants every album, not the table's 100-row pages. start at
  // a chunky baseline and ramp proportionally once we know `total_count`
  // so a 10k-album library lands in ~8 fetches instead of ~100.
  const INITIAL_PAGE_SIZE = 250;
  const MAX_PAGE_SIZE = 1000;
  const TARGET_PAGE_COUNT = 8;
  const [pageSize, setPageSize] = createSignal(INITIAL_PAGE_SIZE);
  const albumsQuery = useLibraryAlbumsQuery({
    remote: () => props.remote,
    search: () => props.search() || undefined,
    pageSizeFn: pageSize,
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

  // re-publish adapted nodes whenever the pages array changes.
  createEffect(() => {
    const pages = albumsQuery.data?.pages ?? [];
    const id = props.remote.remote_id;
    const out: AlbumNodeData[] = [];
    for (const page of pages) {
      for (const summary of page.items) {
        out.push(adaptAlbum(summary, { remoteId: id }));
      }
    }
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
  const favoriteMutation = useToggleFavoriteMutation();

  // local search signal for the graph (until topnav search is wired
  // globally — phase 6 polish). starts empty = no filter applied.
  // setter is reserved for the upcoming topnav search input.
  const [searchQuery] = createSignal("");

  // per-remote node store, keyed by remote_id. updated by each
  // RemoteAlbumsLoader child as pages arrive. flattened into `nodes()`
  // below for the graph.
  const [nodesByRemote, setNodesByRemote] = createSignal<Map<string, AlbumNodeData[]>>(new Map());

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
  // the graph on the next tick.
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

  const graph = createGraphLibraryView({
    nodes: visibleNodes,
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
      // no-op for now \u2014 the canvas already shows the lasso selection.
      if (!props.bulkTagMode?.()) return;
      if (albums.length === 0) return;
      // all lasso'd nodes should share the same remote when bulk-tag
      // is on (we force single-remote at the parent). resolve via the
      // first node's source remote, falling back to all[0].
      const r = remoteForNode(albums[0]);
      if (!r) return;
      // filter to nodes that actually belong to that remote \u2014 defensive
      // against any stray cross-remote nodes hanging around.
      const ids = albums.filter((a) => (a.sourceRemoteId ?? null) === r.remote_id).map(bareAlbumId);
      if (ids.length === 0) return;
      props.onLassoAlbums?.(r, ids);
    },
    forceTool: () => (props.bulkTagMode?.() ? "lasso" : null),
    extraTools: props.extraTools,
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
      } else if (e.key === "Escape") {
        // clear current album selection (closes the detail popover).
        // `preventDefault` is intentionally skipped so esc still also
        // closes any open menus/dialogs higher in the tree.
        graph.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // reactive slot publishing — re-runs when isNarrow flips so the
  // topnav reflows correctly on viewport changes.
  createEffect(() => {
    const narrow = isNarrow();
    const chips = (
      <div class="flex items-center gap-2 flex-wrap">
        <Show when={narrow}>{graph.topNavTools}</Show>
        <Show when={props.remotes().length > 1}>
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] leading-none whitespace-nowrap border border-white/10 bg-white/5 text-white/70"
            title="selected remotes · loaded albums"
          >
            {props.remotes().length} remotes · {nodes().length} albums
          </span>
        </Show>
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
        {(r) => <RemoteAlbumsLoader remote={r} search={searchQuery} onNodes={setNodesFor} />}
      </For>

      <Show when={nodes().length === 0}>
        <div class="flex flex-col items-center justify-center h-full gap-2 text-[var(--color-text-disabled)]">
          <Icon name="share" size={32} />
          <p class="text-sm m-0">loading albums…</p>
        </div>
      </Show>
      <Show when={nodes().length > 0}>
        {/* graph.pane's root is `flex-1 relative overflow-hidden`, so
         *  its parent MUST be a flex container for flex-1 to take
         *  effect. without `flex` here the pane collapses to ~1px
         *  around its absolutely-positioned canvas child. */}
        <div class="flex-1 min-h-0 flex">{graph.pane}</div>
      </Show>
    </div>
  );
}
