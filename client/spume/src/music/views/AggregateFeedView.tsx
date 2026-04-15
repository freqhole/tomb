// aggregate feed view — merges activity feeds from all connected remotes
import { useNavigate } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Icon, IconNames } from "../../components/icons/registry";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import { VirtualFeedList } from "../../components/virtualized/VirtualFeedList";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo, type FeedTypeFilter } from "../../app/services/pageInfo";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import { getClientForRemote } from "../../app/api/client";
import { getRemoteMediaUrl } from "../../utils/urls";
import type { FeedItem, FeedResponse, ImageMetadata } from "../data/types";
import { permissions } from "../../app/api/client";
import type { UserRoleName } from "../../app/api/client";
import { ALL_FEED_TYPES, FEED_TYPE_LABELS } from "../queries/analytics";
import { toast } from "../../components/feedback/Toast";
import { showImageCarousel } from "../hooks/modals";
import { setHighlightedSongId } from "../state/highlightedSong";
import { type Remote, isP2PRemote } from "../../app/services/storage/schemas/remote";
import { resolveBlobUrl } from "../services/storage/blobResolver";

// adapt raw API images to app-level ImageMetadata (same as analytics.ts)
function adaptFeedImages(
  images: Array<{ blob_id: string; is_primary: number; blob_type: string }> | null | undefined,
  baseUrl: string | undefined,
  remoteId?: string
): ImageMetadata[] | null {
  if (!images || images.length === 0) return null;
  return images.map((img) => ({
    remote_blob_id: img.blob_id,
    remote_url: baseUrl ? getRemoteMediaUrl(baseUrl, img.blob_id) : undefined,
    remote_server_id: remoteId,
    is_primary: img.is_primary === 1,
    blob_type: (img.blob_type as ImageMetadata["blob_type"]) ?? "thumbnail",
  }));
}

function adaptFeedResponse(
  data: any,
  baseUrl: string | undefined,
  remoteId: string,
  remoteName: string
): FeedResponse {
  return {
    items: (data.items ?? []).map(
      (item: any): FeedItem => ({
        id: item.id,
        feed_type: item.feed_type,
        song_id: item.song_id ?? null,
        album_id: item.album_id ?? null,
        artist_id: item.artist_id ?? null,
        playlist_id: item.playlist_id ?? null,
        title: item.title,
        subtitle: item.subtitle ?? null,
        images: adaptFeedImages(item.images, baseUrl, remoteId),
        created_at: item.created_at,
        user_id: item.user_id ?? null,
        username: item.username ?? null,
        play_count: item.play_count ?? null,
        rating: item.rating ?? null,
        target_type: item.target_type ?? null,
        session_id: item.session_id ?? null,
        session_type: item.session_type ?? null,
        session_status: item.session_status ?? null,
        progress_percent: item.progress_percent ?? null,
        songs_completed: item.songs_completed ?? null,
        total_songs: item.total_songs ?? null,
        artist_name: item.artist_name ?? null,
        album_title: item.album_title ?? null,
        genre: item.genre ?? null,
        genre_id: item.genre_id ?? null,
        year: item.year ?? null,
        song_count: item.song_count ?? null,
        songs_added: item.songs_added ?? null,
        total_duration_ms: item.total_duration_ms ?? null,
        image_count: item.image_count ?? null,
        urls: item.urls ?? null,
        description: item.description ?? null,
        tags: item.tags ?? null,
        is_favorite: item.is_favorite ?? false,
        is_initial_add: item.is_initial_add ?? true,
        collage_images: adaptFeedImages(item.collage_images, baseUrl, remoteId),
        entity_created_at: item.entity_created_at ?? null,
        remote_id: remoteId,
        remote_name: remoteName,
      })
    ),
    total: data.total ?? 0,
  };
}

const PAGE_SIZE = 50;
const MAX_CACHED_ITEMS = 5000;
const SETTLE_WINDOW_MS = 2000;
const STAGGER_INTERVAL_MS = 60_000;

// ============================================================================
// module-level feed cache — survives navigation, cleared on full page reload
// ============================================================================
const [cachedItems, setCachedItems] = createSignal<FeedItem[]>([]);
const [cachedCursors, setCachedCursors] = createSignal<Record<string, number>>({});
const [cachedRemoteHasItems, setCachedRemoteHasItems] = createSignal<Set<string>>(new Set());
let cacheInitialized = false;
let cachedScrollTop = 0;

// per-remote authenticated user cache (populated via whoami during load)
const cachedRemoteUsers = new Map<string, { userId: string; role: UserRoleName }>();

// get cached user for a specific remote
function getUserForRemote(
  remoteId: string | null | undefined
): { userId: string; role: UserRoleName } | null {
  if (!remoteId) return null;
  return cachedRemoteUsers.get(remoteId) ?? null;
}

// check if user is admin on a specific remote
function isAdminOnRemote(remoteId: string | null | undefined): boolean {
  const user = getUserForRemote(remoteId);
  return user ? permissions.isAdmin(user.role) : false;
}

// merge new items into cache: replace existing items by id, add new ones, sort, cap
function mergeIntoCache(newItems: FeedItem[]): void {
  if (newItems.length === 0) return;
  const incoming = new Map(newItems.map((i) => [i.id, i]));
  // replace existing items if they appear in incoming, keep others as-is
  const updated = cachedItems().map((i) => incoming.get(i.id) ?? i);
  // add truly new items (not already in cache)
  const existingIds = new Set(updated.map((i) => i.id));
  const brandNew = newItems.filter((i) => !existingIds.has(i.id));
  const merged = [...brandNew, ...updated].sort((a, b) => b.created_at - a.created_at);
  setCachedItems(merged.length > MAX_CACHED_ITEMS ? merged.slice(0, MAX_CACHED_ITEMS) : merged);
}

// remove items from cache by predicate
function removeFromCache(predicate: (item: FeedItem) => boolean): void {
  setCachedItems((prev) => prev.filter((i) => !predicate(i)));
}

export function AggregateFeedView() {
  const navigate = useNavigate();

  // load all remotes
  const [remotes] = createResource(getAllRemotes);

  // toggle which remotes are visible
  const [activeRemoteIds, setActiveRemoteIds] = createSignal<Set<string>>(new Set());

  // initialize active set when remotes load
  createEffect(() => {
    const r = remotes();
    if (r && r.length > 0 && activeRemoteIds().size === 0) {
      setActiveRemoteIds(new Set(r.map((rem) => rem.remote_id)));
    }
  });

  const toggleRemote = (remoteId: string) => {
    setActiveRemoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(remoteId)) {
        if (next.size <= 1) return prev; // don't toggle off last one
        next.delete(remoteId);
      } else {
        next.add(remoteId);
      }
      return next;
    });
  };

  // long press to solo a remote (toggle all others off)
  const createLongPressHandlers = (remoteId: string) => {
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let didLongPress = false;
    const startPress = (e: Event) => {
      e.stopPropagation();
      didLongPress = false;
      pressTimer = setTimeout(() => {
        didLongPress = true;
        setActiveRemoteIds(new Set([remoteId]));
      }, 500);
    };
    const endPress = (e: Event) => {
      e.stopPropagation();
      clearTimeout(pressTimer);
    };
    const handleClick = (e: Event) => {
      e.stopPropagation();
      if (!didLongPress) {
        toggleRemote(remoteId);
      }
    };
    return {
      onMouseDown: startPress,
      onMouseUp: endPress,
      onMouseLeave: endPress,
      onTouchStart: startPress,
      onTouchEnd: endPress,
      onClick: handleClick,
      onContextMenu: (e: Event) => e.preventDefault(),
    };
  };

  // ---- loading state ----
  // isLoading: only true on very first load (no cache). false once we have anything to show
  const [isLoading, setIsLoading] = createSignal(!cacheInitialized);
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(true);
  // revalidation progress: "checking remote 2 of 5..."
  const [revalidationProgress, setRevalidationProgress] = createSignal<string | null>(null);

  // sorted remotes: remotes with items first, offline/empty last
  const sortedRemotes = createMemo(() => {
    const r = remotes();
    if (!r) return [];
    const hasItems = cachedRemoteHasItems();
    return [...r].sort((a, b) => {
      const aHas = hasItems.has(a.remote_id) && !a.is_offline;
      const bHas = hasItems.has(b.remote_id) && !b.is_offline;
      if (aHas === bHas) return 0;
      return aHas ? -1 : 1;
    });
  });

  // ---- fetch helper ----
  async function fetchRemotePage(remote: Remote, offset: number): Promise<FeedResponse> {
    try {
      const client = await getClientForRemote(remote);

      // cache user info for this remote (only on first page / if not cached yet)
      if (offset === 0 && !cachedRemoteUsers.has(remote.remote_id)) {
        try {
          const whoami = await client.auth.whoami();
          if (whoami.success && whoami.data) {
            cachedRemoteUsers.set(remote.remote_id, {
              userId: whoami.data.user_id,
              role: whoami.data.role as UserRoleName,
            });
          }
        } catch {
          // whoami failed — user not authenticated on this remote
        }
      }

      const result = await client.music.activityFeed({
        limit: PAGE_SIZE,
        offset,
        feed_types: null,
        user_id: null,
      });
      if (!result.success) return { items: [], total: 0 };
      return adaptFeedResponse(result.data, remote.base_url, remote.remote_id, remote.name);
    } catch {
      return { items: [], total: 0 };
    }
  }

  // ---- initial load with settle window ----
  // fires all remote fetches in parallel, renders after settle window or all complete
  async function loadInitial(r: Remote[]) {
    setIsLoading(true);

    let settled = false;
    const results: Array<{ remoteId: string; items: FeedItem[] }> = [];

    const settlePromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        settled = true;
        // render whatever we have so far
        if (results.length > 0) {
          flushResults(results);
          setIsLoading(false);
        }
        resolve();
      }, SETTLE_WINDOW_MS);
    });

    const fetchPromises = r.map(async (remote) => {
      const response = await fetchRemotePage(remote, 0);
      const entry = { remoteId: remote.remote_id, items: response.items };
      results.push(entry);

      // update cursors for this remote
      setCachedCursors((prev) => ({ ...prev, [remote.remote_id]: response.items.length }));

      // if we've settled, merge this late arrival immediately
      if (settled && response.items.length > 0) {
        mergeIntoCache(response.items);
        setCachedRemoteHasItems((prev) => new Set([...prev, remote.remote_id]));
        setIsLoading(false);
      }
    });

    // wait for all fetches or settle window
    await Promise.all([
      settlePromise,
      Promise.all(fetchPromises).then(() => {
        // all done — final flush if settle hasn't rendered yet, or merge stragglers
        flushResults(results);
      }),
    ]);

    cacheInitialized = true;
    setIsLoading(false);

    // check if any remote returned a full page
    const anyFull = results.some((r) => r.items.length >= PAGE_SIZE);
    setHasMore(anyFull);
  }

  function flushResults(results: Array<{ remoteId: string; items: FeedItem[] }>) {
    const allNew: FeedItem[] = [];
    for (const { items } of results) {
      allNew.push(...items);
    }
    if (allNew.length > 0) {
      mergeIntoCache(allNew);
    }

    // track which remotes returned items
    const withItems = new Set(cachedRemoteHasItems());
    for (const { remoteId, items } of results) {
      if (items.length > 0) withItems.add(remoteId);
    }
    setCachedRemoteHasItems(withItems);

    // set cursors for all remotes
    const cursors: Record<string, number> = { ...cachedCursors() };
    for (const { remoteId, items } of results) {
      cursors[remoteId] = items.length;
    }
    setCachedCursors(cursors);
  }

  // ---- revalidation: fetch page 0 from all remotes sequentially with progress ----
  async function revalidateAll(r: Remote[]) {
    const nonOffline = r.filter((rem) => !rem.is_offline);
    if (nonOffline.length === 0) return;

    for (let i = 0; i < nonOffline.length; i++) {
      setRevalidationProgress(`checking remote ${i + 1} of ${nonOffline.length}...`);
      const remote = nonOffline[i];
      const response = await fetchRemotePage(remote, 0);
      if (response.items.length > 0) {
        mergeIntoCache(response.items);
        setCachedRemoteHasItems((prev) => new Set([...prev, remote.remote_id]));
      }
      // update cursor to max of existing and new
      setCachedCursors((prev) => ({
        ...prev,
        [remote.remote_id]: Math.max(prev[remote.remote_id] ?? 0, response.items.length),
      }));
    }
    setRevalidationProgress(null);
  }

  // ---- staggered background refresh: one remote every 60s ----
  let staggerIndex = 0;
  let staggerIntervalId: ReturnType<typeof setInterval> | undefined;

  function startStaggeredRefresh(r: Remote[]) {
    if (staggerIntervalId) return; // already running
    const nonOffline = r.filter((rem) => !rem.is_offline);
    if (nonOffline.length === 0) return;

    staggerIntervalId = setInterval(async () => {
      const remote = nonOffline[staggerIndex % nonOffline.length];
      staggerIndex++;
      try {
        const response = await fetchRemotePage(remote, 0);
        if (response.items.length > 0) {
          mergeIntoCache(response.items);
          setCachedRemoteHasItems((prev) => new Set([...prev, remote.remote_id]));
        }
      } catch {
        // silent fail for background refresh
      }
    }, STAGGER_INTERVAL_MS);
  }

  function stopStaggeredRefresh() {
    if (staggerIntervalId) {
      clearInterval(staggerIntervalId);
      staggerIntervalId = undefined;
    }
  }

  // ---- orchestrate loading on mount ----
  createEffect(
    on(remotes, (r) => {
      if (!r || r.length === 0) return;

      if (!cacheInitialized) {
        // first ever load — use settle window
        void loadInitial(r).then(() => startStaggeredRefresh(r));
      } else {
        // returning to feed — show cached data immediately, revalidate in background
        setIsLoading(false);
        void revalidateAll(r).then(() => startStaggeredRefresh(r));
      }
    })
  );

  // clean up interval when leaving feed view
  onCleanup(() => {
    stopStaggeredRefresh();
  });

  // save scroll position on cleanup
  onCleanup(() => {
    const scrollEl = feedListRef?.querySelector(".overflow-auto") as HTMLElement | null;
    if (scrollEl) {
      cachedScrollTop = scrollEl.scrollTop;
    }
  });

  // ---- load more (pagination) ----
  async function loadMore() {
    if (isLoadingMore() || !hasMore()) return;
    setIsLoadingMore(true);

    const r = remotes();
    if (!r) {
      setIsLoadingMore(false);
      return;
    }

    const cursors = cachedCursors();
    const active = activeRemoteIds();

    const fetches: Promise<{ remoteId: string; response: FeedResponse }>[] = [];
    for (const remote of r) {
      if (!active.has(remote.remote_id)) continue;
      const offset = cursors[remote.remote_id] ?? 0;
      if (offset % PAGE_SIZE !== 0 && offset > 0) continue; // this remote is exhausted
      fetches.push(
        fetchRemotePage(remote, offset).then((response) => ({
          remoteId: remote.remote_id,
          response,
        }))
      );
    }

    if (fetches.length === 0) {
      setHasMore(false);
      setIsLoadingMore(false);
      return;
    }

    const results = await Promise.all(fetches);

    let newItems: FeedItem[] = [];
    const newCursors = { ...cursors };
    let anyFull = false;

    for (const { remoteId, response } of results) {
      newItems = newItems.concat(response.items);
      newCursors[remoteId] = (newCursors[remoteId] ?? 0) + response.items.length;
      if (response.items.length >= PAGE_SIZE) anyFull = true;
    }

    if (newItems.length === 0) {
      setHasMore(false);
      setIsLoadingMore(false);
      return;
    }

    mergeIntoCache(newItems);
    setCachedCursors(newCursors);
    setHasMore(anyFull);
    setIsLoadingMore(false);
  }

  // filtered items based on active remote toggles, feed type filters, and my items
  const [feedTypeFilters, setFeedTypeFilters] = createSignal<FeedTypeFilter[]>([]);
  const [myItemsOnly, setMyItemsOnly] = createSignal(false);

  const filteredItems = createMemo(() => {
    const active = activeRemoteIds();
    let items = cachedItems();

    // filter by active remotes
    if (active && active.size > 0) {
      items = items.filter((item) => !item.remote_id || active.has(item.remote_id));
    }

    // filter by feed type
    const filters = feedTypeFilters();
    if (filters.length > 0) {
      const includes = filters.filter((f) => f.mode === "include").map((f) => f.type);
      const excludes = filters.filter((f) => f.mode === "exclude").map((f) => f.type);
      if (includes.length > 0) {
        items = items.filter((item) => includes.includes(item.feed_type));
      } else if (excludes.length > 0) {
        items = items.filter((item) => !excludes.includes(item.feed_type));
      }
    }

    // filter by current user (check all remotes the user is authenticated on)
    if (myItemsOnly()) {
      const myUserIds = new Set<string>();
      for (const [, user] of cachedRemoteUsers) {
        myUserIds.add(user.userId);
      }
      if (myUserIds.size > 0) {
        items = items.filter((item) => item.user_id && myUserIds.has(item.user_id));
      }
    }

    return items;
  });

  // page info
  const [showBackToTop, setShowBackToTop] = createSignal(false);

  const handleScroll = (scrollTop: number) => {
    setShowBackToTop(scrollTop > viewportHeight() * 3);
  };

  let feedListRef: HTMLDivElement | undefined;
  const handleBackToTop = () => {
    const scrollEl = feedListRef?.querySelector(".overflow-auto") as HTMLElement | null;
    scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
  };

  createEffect(() => {
    setPageInfo({
      title: "all feeds",
      count: filteredItems().length,
      showBackToTop: showBackToTop(),
      onBackToTop: handleBackToTop,
      feedTypeOptions: ALL_FEED_TYPES.map((t) => ({
        value: t,
        label: FEED_TYPE_LABELS[t],
      })),
      selectedFeedTypes: feedTypeFilters(),
      onToggleFeedType: (type: string) => {
        setFeedTypeFilters((prev) => {
          const existing = prev.find((f) => f.type === type);
          if (existing) return prev.filter((f) => f.type !== type);
          return [...prev, { type, mode: "include" }];
        });
      },
      onToggleFeedTypeMode: (type: string) => {
        setFeedTypeFilters((prev) =>
          prev.map((f) =>
            f.type === type ? { ...f, mode: f.mode === "include" ? "exclude" : "include" } : f
          )
        );
      },
      onRemoveFeedType: (type: string) => {
        setFeedTypeFilters((prev) => prev.filter((f) => f.type !== type));
      },
      onClearFeedTypes: () => setFeedTypeFilters([]),
      myItemsOnly: myItemsOnly(),
      onToggleMyItems: () => setMyItemsOnly((prev) => !prev),
    });
  });
  onCleanup(() => clearPageInfo());

  // responsive height
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const listHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  // play handler
  const handlePlayItem = async (item: FeedItem) => {
    // navigate to the remote context for playback
    if (item.remote_id && item.album_id) {
      navigate(`/${item.remote_id}/albums/${item.album_id}`);
    } else if (item.remote_id && item.artist_id) {
      navigate(`/${item.remote_id}/artists/${item.artist_id}`);
    } else if (item.remote_id && item.playlist_id) {
      navigate(`/${item.remote_id}/playlists/${item.playlist_id}`);
    }
  };

  // helper: get the remote object for a feed item
  const getRemoteForItem = (item: FeedItem): Remote | undefined => {
    if (!item.remote_id) return undefined;
    return (remotes() ?? []).find((r) => r.remote_id === item.remote_id);
  };

  // delete a feed item and remove from local state
  const handleDeleteFeedItem = async (item: FeedItem) => {
    const remote = getRemoteForItem(item);
    if (!remote) {
      toast.error("remote not found for this item");
      return;
    }
    try {
      const client = await getClientForRemote(remote);
      await client.music.deleteFeedEvent(item.id);
      removeFromCache((i) => i.id === item.id);
    } catch {
      toast.error("failed to delete item");
    }
  };

  // delete a listening session and remove its items from local state
  const handleDeleteSession = async (item: FeedItem) => {
    const remote = getRemoteForItem(item);
    if (!remote) {
      toast.error("remote not found for this item");
      return;
    }
    try {
      const client = await getClientForRemote(remote);
      const remoteUser = getUserForRemote(item.remote_id);
      const isOwnSession = remoteUser && item.user_id === remoteUser.userId;
      if (isOwnSession) {
        await client.music.deleteListenSession(item.session_id!);
        // own session deletion removes all items for that session
        removeFromCache((i) => i.session_id === item.session_id);
      } else {
        await client.music.deleteFeedEvent(item.id);
        // admin feed event deletion only removes the single item
        removeFromCache((i) => i.id === item.id);
      }
    } catch {
      toast.error("failed to delete session");
    }
  };

  // context menu
  const getContextMenuActions = (item: FeedItem): MenuAction[] => {
    if (!item) return [];
    const actions: MenuAction[] = [];
    const prefix = item.remote_id ? `/${item.remote_id}` : "";

    // navigation actions
    if (item.album_id) {
      actions.push({
        label: "go to album",
        icon: IconNames.album,
        onClick: () => {
          if (item.song_id) setHighlightedSongId(item.song_id);
          navigate(`${prefix}/albums/${item.album_id}`);
        },
      });
    }
    if (item.artist_id) {
      actions.push({
        label: "go to artist",
        icon: IconNames.artist,
        onClick: () => navigate(`${prefix}/artists/${item.artist_id}`),
      });
    }
    if (item.playlist_id) {
      actions.push({
        label: "go to playlist",
        icon: IconNames.playlist,
        onClick: () => navigate(`${prefix}/playlists/${item.playlist_id}`),
      });
    }

    // delete session (own sessions, or admin can delete any)
    const remoteUser = getUserForRemote(item.remote_id);
    const isOwnSession = remoteUser && item.user_id === remoteUser.userId;
    const adminOnRemote = isAdminOnRemote(item.remote_id);
    // console.log("[ctx-menu] item:", {
    //   feed_type: item.feed_type,
    //   session_id: item.session_id,
    //   user_id: item.user_id,
    //   remote_id: item.remote_id,
    // });
    // console.log(
    //   "[ctx-menu] remoteUser:",
    //   remoteUser,
    //   "isOwnSession:",
    //   isOwnSession,
    //   "isAdmin:",
    //   adminOnRemote
    // );
    if (item.session_id && (isOwnSession || adminOnRemote)) {
      actions.push({ type: "separator" });
      actions.push({
        label: "delete session",
        icon: IconNames.delete,
        onClick: () => void handleDeleteSession(item),
      });
    }

    // admin can delete any feed item
    if (adminOnRemote && !item.session_id) {
      actions.push({ type: "separator" });
      actions.push({
        label: "delete feed item",
        icon: IconNames.delete,
        onClick: () => void handleDeleteFeedItem(item),
      });
    }

    return actions;
  };

  // restore scroll position when returning to cached feed
  onMount(() => {
    if (cacheInitialized && cachedScrollTop > 0) {
      requestAnimationFrame(() => {
        const scrollEl = feedListRef?.querySelector(".overflow-auto") as HTMLElement | null;
        if (scrollEl) {
          scrollEl.scrollTop = cachedScrollTop;
        }
      });
    }
  });

  return (
    <div class="flex flex-col h-full relative" ref={feedListRef}>
      {/* revalidation progress — shown when checking remotes on return */}
      <Show when={revalidationProgress()}>
        <div style={{ "padding-top": (remotes() ?? []).length > 1 ? "50px" : "0" }}>
          <LoadingMoreIndicator isLoading={true} text={revalidationProgress()!} debounceMs={300} />
        </div>
      </Show>
      {/* remote toggle strip — floats above feed */}
      <Show when={(remotes() ?? []).length > 1}>
        <div
          class={`flex gap-2 overflow-x-auto scrollbar-hide py-2 px-4 absolute top-0 right-0 z-50 flex-nowrap bg-transparent pointer-events-none ${showBackToTop() ? "wide:ml-[180px]" : "wide:ml-[140px]"}`}
          style={{ left: "0" }}
        >
          <div class="flex-1 shrink-0" />
          <For each={sortedRemotes()}>
            {(remote) => {
              const isActive = () => activeRemoteIds().has(remote.remote_id);
              const isP2P = () => isP2PRemote(remote);
              const remoteImageUrl = () => {
                if (!remote.image_url) return null;
                if (
                  remote.image_url.startsWith("http://") ||
                  remote.image_url.startsWith("https://") ||
                  remote.image_url.startsWith("asset://")
                ) {
                  return remote.image_url;
                }
                // relative url — prepend base_url for HTTP remotes
                if (!isP2P() && remote.base_url) {
                  return `${remote.base_url}${remote.image_url}`;
                }
                return null;
              };
              // for P2P remotes with blob_id, resolve async
              const [resolvedBlobUrl] = createResource(
                () =>
                  isP2P() && remote.image_blob_id
                    ? { blobId: remote.image_blob_id, remoteId: remote.remote_id }
                    : null,
                async (params) => {
                  if (!params) return null;
                  try {
                    return await resolveBlobUrl(params.blobId, params.remoteId);
                  } catch {
                    return null;
                  }
                }
              );
              const imageUrl = () => (isP2P() ? resolvedBlobUrl() : remoteImageUrl());
              const [imgError, setImgError] = createSignal(false);
              const longPress = createLongPressHandlers(remote.remote_id);
              return (
                <button
                  class={`text-sm rounded-lg transition-all whitespace-nowrap flex items-center justify-center gap-1.5 cursor-pointer shrink-0 pointer-events-auto overflow-hidden ${imageUrl() && !imgError() ? "pl-0 pr-3 py-0" : "px-3 py-1.5"} ${
                    isActive()
                      ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                      : "bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]"
                  }`}
                  onMouseDown={longPress.onMouseDown}
                  onMouseUp={longPress.onMouseUp}
                  onMouseLeave={longPress.onMouseLeave}
                  onTouchStart={longPress.onTouchStart}
                  onTouchEnd={longPress.onTouchEnd}
                  onClick={longPress.onClick}
                  onContextMenu={longPress.onContextMenu}
                  title={`${remote.name}${remote.is_charnel_managed ? "" : isP2P() ? "" : " (http)"}\nlong press to solo`}
                  style={{ height: "32px" }}
                >
                  <Show
                    when={imageUrl() && !imgError()}
                    fallback={<Icon name={IconNames.recent} size={14} />}
                  >
                    <img
                      src={imageUrl()!}
                      alt=""
                      class="h-full rounded-l-lg object-cover flex-shrink-0"
                      style={{ width: "auto" }}
                      onError={() => setImgError(true)}
                    />
                  </Show>
                  <span>{remote.name}</span>
                  <Show when={remote.is_charnel_managed}>
                    <Icon
                      name="home"
                      size={12}
                      color={isActive() ? "var(--color-text-on-accent)" : "var(--color-text-muted)"}
                    />
                  </Show>
                  <Show when={!isP2P() && !remote.is_charnel_managed}>
                    <span
                      class={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        isActive()
                          ? "bg-[var(--color-text-on-accent)]/20"
                          : "bg-blue-600/20 text-blue-400"
                      }`}
                    >
                      http
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      {/* feed list */}
      <Show
        when={!isLoading()}
        fallback={
          <div style={{ "padding-top": (remotes() ?? []).length > 1 ? "50px" : "0" }}>
            <LoadingState text="loading feed..." />
          </div>
        }
      >
        <Show
          when={filteredItems().length > 0}
          fallback={
            <div
              class="flex items-center justify-center h-full text-[var(--color-text-disabled)]"
              style={{ "padding-top": (remotes() ?? []).length > 1 ? "50px" : "0" }}
            >
              no feed items
            </div>
          }
        >
          <div style={{ "padding-top": (remotes() ?? []).length > 1 ? "50px" : "0" }}>
            <VirtualFeedList
              items={filteredItems()}
              height={listHeight() - ((remotes() ?? []).length > 1 ? 50 : 0)}
              scrollPaddingTop={0}
              onItemClick={handlePlayItem}
              onScroll={handleScroll}
              onImageClick={(item) => {
                if (item.images && item.images.length > 0) {
                  const urls = item.images
                    .map((img) => img.remote_url ?? "")
                    .filter((u) => u.length > 0);
                  if (urls.length > 0) {
                    showImageCarousel({ images: urls });
                  }
                }
              }}
              onAddToQueue={() => {
                toast.info("navigate to the remote to add to queue");
              }}
              getContextMenuActions={getContextMenuActions}
              onNearEnd={() => void loadMore()}
              onGenreClick={() => {
                // genre navigation needs remote context
              }}
            />
            <Show when={isLoadingMore()}>
              <LoadingMoreIndicator isLoading={isLoadingMore()} />
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
