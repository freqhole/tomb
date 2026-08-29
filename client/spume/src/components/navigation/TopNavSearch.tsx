// top nav search — expands on hover/click, shows suggestions, navigates on selection
import { createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";
import { isNarrowViewport } from "../../config/breakpoints";
import { getCurrentRemote, getDataSource } from "../../music/data";
import type { SearchSuggestion as APISuggestion } from "../../music/data/types";
import { addToQueue, playQueue } from "../../music/services/queue/queue";
import { routes, matchRoute, buildRoute } from "../../music/utils/routing";
import { valueNodeId, type RelationKind } from "../graph/data/nodeIds";
import { setHighlightedSongId } from "../../music/state/highlightedSong";
import { Icon } from "../icons/registry";
import type { SearchSuggestion } from "../forms/SearchInput";
import { SearchInput } from "../forms/SearchInput";
import type { MenuAction } from "../overlays/ContextMenu";
import { extractShareTokenFromAnyText, SHARE_HASH_PARAM } from "../../utils/permalink";
import { extractAddRemoteValue } from "../../utils/addRemoteLink";
import { requestAddRemote } from "../../app/services/remotes/addRemoteRequest";
import { recordSharedItemFromToken } from "../../app/services/storage/sharedItems";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { showPlaylistSelector } from "../../music/hooks/playlistSelectorState";
import { showStationSelector } from "../../music/hooks/stationSelectorState";
import { isCharnelMode } from "../../app/services/charnel";
import { isP2PRemote } from "../../app/services/storage/schemas/remote";
import { createShareMenuAction } from "../../music/hooks/contextMenu";
import { useToggleFavoriteMutation } from "../../music/queries/favorites";
import { RemoteMusicDataSource } from "../../music/data/remote/remoteSource";
import {
  getSearchFilterRegistration,
  isFilterableRoute,
  isFilterOnlyRoute,
} from "./searchFilterRegistry";

export interface TopNavSearchProps {
  placeholder?: string;
  onCollapse?: () => void;
  onNavigate?: (path: string) => void;
  currentPath?: string;
  suggestions?: SearchSuggestion[];
  onSearchChange?: (value: string) => void;
  hasMoreSuggestions?: boolean;
  isLoadingSuggestions?: boolean;
  onLoadMoreSuggestions?: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  /** whether the parent nav is being hovered */
  navHovered?: boolean;
  /** optional element to mount the suggestions flyout into (for shadow-root embeds) */
  flyoutMount?: Node;
  /**
   * optional resolver: given a suggestion, return the remoteId it belongs
   * to. when set, navigation uses `routes.*On(remoteId, ...)` so the
   * router's RemoteContextHandler switches the active source on its own.
   * may return a promise so the resolver can prompt the user (e.g. when
   * the suggestion was contributed by multiple remotes). returning
   * `undefined` (sync or async) falls back to current-remote-relative
   * navigation; returning `null` aborts navigation entirely.
   *
   * may also return `{ remoteId, data }` to override which APISuggestion
   * the navigation uses — required when the same logical item exists on
   * multiple remotes under different entity_ids (the picked remote's
   * own `entity_id`/`metadata.album_id` must be used, not the primary's).
   */
  remoteIdFor?: (
    s: SearchSuggestion
  ) =>
    | string
    | { remoteId: string; data?: APISuggestion }
    | null
    | undefined
    | Promise<string | { remoteId: string; data?: APISuggestion } | null | undefined>;
  /** optional content rendered at the bottom of the dropdown */
  footerContent?: JSX.Element;
  /**
   *  optional intercept for row selection. when set, the parent owns the
   *  click/Enter-on-highlight handling (e.g. graph search-mode repivots
   *  to the matching node instead of route-navigating). returning `true`
   *  short-circuits the default `routes.*` navigation; returning `false`
   *  or `undefined` falls through to the default flow.
   */
  onSelectOverride?: (s: SearchSuggestion) => boolean | void | Promise<boolean | void>;
  /**
   *  optional intercept for Enter-without-highlight. when set AND the
   *  current route is not in `FILTERABLE_KEYS` (so `submitFilter` is a
   *  no-op anyway), this is invoked with the current query string.
   *  return `true` to declare the submission handled (suppresses the
   *  default no-op filter path entirely; the caller is expected to do
   *  whatever rendering they need).
   */
  onSubmit?: (q: string) => boolean | void;
  /** optional override for the hint message rendered between the input
   *  field and the suggestions flyout. when present, replaces the
   *  default "press return to filter X" hint. used by graph-search to
   *  surface a clickable "explore in graph" affordance in the same
   *  visual slot as the default hint. */
  hintOverride?: () => { message: string; onClick?: () => void } | null;
}

// filterable route keys, and the "press return to filter X" hint copy,
// are registered per-view in `searchFilterRegistry.ts` — see that file
// instead of growing a hardcoded Set/switch here.

export function TopNavSearch(props: TopNavSearchProps) {
  const [searchValue, setSearchValue] = createSignal("");
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [isLocked, setIsLocked] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [suggestionsOpen, setSuggestionsOpen] = createSignal(false);
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  // called at component level so the mutation's reactive state lives in
  // this component's scope, not inside suggestionsWithPlay().
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  let inputRef: HTMLInputElement | undefined;
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;
  let filterDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  // track narrow viewport for touch-friendly icon sizing
  if (typeof window !== "undefined") {
    const onResize = () => setIsNarrow(isNarrowViewport());
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  }

  const shouldStayOpen = () => searchValue().length > 0 || isFocused() || isLocked();

  // which filterable view are we on (if any)?
  const currentRouteKey = createMemo(() => matchRoute(props.currentPath || ""));
  const filterableView = createMemo(() => {
    const key = currentRouteKey();
    return isFilterableRoute(key) ? key : null;
  });

  // hint message — overridden by parent if `hintOverride` provided,
  // else the default "press return to filter X" focus hint.
  const hintMessage = createMemo(() => {
    const override = props.hintOverride?.();
    if (override) return override.message;
    const view = filterableView();
    if (!view || !isFocused()) return null;
    return `press return to filter ${getSearchFilterRegistration(view)?.label ?? view}`;
  });

  const hintClick = () => {
    const override = props.hintOverride?.();
    if (override?.onClick) {
      override.onClick();
      return;
    }
    submitFilter();
  };

  // initialize search value from ?q= query param (e.g., on page reload)
  createEffect(
    on(
      () => props.currentPath,
      (path) => {
        if (!path) return;
        const qMatch = path.match(/[?&]q=([^&]*)/);
        const q = qMatch ? decodeURIComponent(qMatch[1]) : "";
        if (q && !searchValue()) {
          setSearchValue(q);
          props.onSearchChange?.(q);
          setIsExpanded(true);
          setIsLocked(true);
        }
      },
      { defer: false }
    )
  );

  // --- expand / collapse ---

  const collapse = () => {
    setIsExpanded(false);
    setIsLocked(false);
    setIsFocused(false);
    setSuggestionsOpen(false);
    setSearchValue("");
    props.onSearchChange?.("");
    clearFilterQueryParam();
    props.onCollapse?.();
  };

  createEffect(() => props.onExpandedChange?.(isExpanded()));

  // collapse when nav is no longer hovered (unless locked/focused/has value)
  createEffect(
    on(
      () => props.navHovered,
      (hovered, prev) => {
        if (prev && !hovered && !shouldStayOpen()) {
          collapseTimer = setTimeout(() => {
            if (!shouldStayOpen()) setIsExpanded(false);
          }, 150);
        }
      }
    )
  );

  onCleanup(() => {
    clearTimeout(collapseTimer);
    clearTimeout(filterDebounceTimer);
  });

  const handleMouseEnter = () => {
    clearTimeout(collapseTimer);
    if (!isExpanded()) setIsExpanded(true);
  };

  const handleIconClick = () => {
    // any click on the icon while the input is visible collapses it.
    // ignoring isLocked here matters on touch: tapping the icon fires a
    // synthetic mouseenter first (sets expanded but not locked), so the
    // tap-to-close path used to land on the else-branch and re-lock
    // instead of collapsing.
    if (isExpanded()) {
      collapse();
      return;
    }
    setIsExpanded(true);
    setIsLocked(true);
    // focus synchronously inside the gesture handler. wrapping this in
    // requestAnimationFrame breaks the user-activation chain on ios
    // safari, so the soft keyboard never appears on first tap.
    inputRef?.focus();
  };

  // --- cmd+k and / shortcuts ---
  createEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsExpanded(true);
        setIsLocked(true);
        requestAnimationFrame(() => inputRef?.focus());
      }
      // "/" opens search unless user is typing in an input/textarea
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable)
          return;
        e.preventDefault();
        setIsExpanded(true);
        setIsLocked(true);
        requestAnimationFrame(() => inputRef?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // --- input / keyboard ---

  const handleInputChange = (value: string) => {
    // share-link interception: if the input contains a valid share token
    // (in any form — full url, hash, or bare base64), route to the share
    // resolver instead of treating it as a search query. only run the
    // scan on suspiciously long inputs to avoid scanning every keystroke.
    if (value.length >= 80) {
      const token = extractShareTokenFromAnyText(value);
      if (token) {
        void recordSharedItemFromToken(token);
        // App.tsx listens for hashchange and opens ResolveShareModal.
        window.location.hash = `#?${SHARE_HASH_PARAM}=${token}`;
        collapse();
        return;
      }
    }
    // add-remote link interception: a pasted `?r=<node_id>` url (or bare
    // node_id) opens AddRemoteModal pre-filled instead of searching.
    if (value.length >= 20) {
      const addRemoteValue = extractAddRemoteValue(value);
      if (addRemoteValue) {
        requestAddRemote(addRemoteValue);
        collapse();
        return;
      }
    }
    setSearchValue(value);
    props.onSearchChange?.(value);
    if (value && !isExpanded()) setIsExpanded(true);
    // filter-only routes (e.g. library): suppress autocomplete + debounce-submit
    const key = currentRouteKey();
    if (isFilterOnlyRoute(key)) {
      setSuggestionsOpen(false);
      clearTimeout(filterDebounceTimer);
      filterDebounceTimer = setTimeout(() => submitFilter(), 250);
      return;
    }
    setSuggestionsOpen(value.length >= 2);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      // "enter" with no highlighted suggestion → either parent-provided
      // submit handler (graph search-mode) or default route-filter path.
      // SearchInput swallows Enter when a row is highlighted, so this
      // branch is safe to use for non-row submissions.
      setSuggestionsOpen(false);
      const handled = props.onSubmit?.(searchValue());
      if (handled === true) return;
      submitFilter();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (searchValue()) {
        // first escape: clear text but keep input expanded/focused
        setSearchValue("");
        props.onSearchChange?.("");
        setSuggestionsOpen(false);
        clearFilterQueryParam();
      } else {
        // second escape (or no text): collapse everything
        collapse();
        inputRef?.blur();
      }
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    const key = currentRouteKey();
    if (isFilterOnlyRoute(key)) return;
    // reopen suggestions if there's a query (results may still be cached from previous search)
    if (searchValue().length >= 2 || (props.suggestions?.length ?? 0) > 0) {
      setSuggestionsOpen(true);
    }
  };

  const handleBlur = (e: FocusEvent) => {
    setIsFocused(false);
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest('[role="listbox"]')) return;
    setSuggestionsOpen(false);
    if (!isLocked() && !searchValue()) {
      collapseTimer = setTimeout(() => {
        if (!isFocused() && !isLocked() && !searchValue()) setIsExpanded(false);
      }, 150);
    }
  };

  // --- clear / filter ---

  const clearFilterQueryParam = () => {
    const fullPath = props.currentPath || "";
    const pathname = fullPath.split("?")[0];
    const key = matchRoute(fullPath);
    if (fullPath.includes("?") && isFilterableRoute(key)) {
      props.onNavigate?.(pathname);
    }
  };

  const submitFilter = () => {
    clearTimeout(filterDebounceTimer);
    const q = searchValue();
    const fullPath = props.currentPath || "";
    const pathname = fullPath.split("?")[0];
    const key = matchRoute(fullPath);
    if (!isFilterableRoute(key)) return;
    // empty q on filter-only routes clears the filter; otherwise require >=2 chars
    if (!q) {
      props.onNavigate?.(pathname);
      return;
    }
    if (q.length < 2 && !isFilterOnlyRoute(key)) return;
    props.onNavigate?.(`${pathname}?q=${encodeURIComponent(q)}`);
  };

  // --- selection (row click or keyboard Enter on highlighted item) ---

  const handleSelect = async (suggestion: SearchSuggestion) => {
    if (!suggestion?.data) return;

    // give the parent a chance to fully intercept selection (e.g. graph
    // search-mode repivots the walker instead of navigating routes).
    if (props.onSelectOverride) {
      try {
        const handled = await props.onSelectOverride(suggestion);
        if (handled === true) {
          setSuggestionsOpen(false);
          setIsFocused(false);
          return;
        }
      } catch (err) {
        console.error("onSelectOverride failed:", err);
        return;
      }
    }

    const originalData = suggestion.data as APISuggestion;
    let remoteId: string | null | undefined;
    let resolvedData: APISuggestion | undefined;
    try {
      const resolved = await props.remoteIdFor?.(suggestion);
      if (resolved && typeof resolved === "object") {
        remoteId = resolved.remoteId;
        resolvedData = resolved.data;
      } else {
        remoteId = resolved;
      }
    } catch (err) {
      console.error("remoteIdFor failed:", err);
      return;
    }
    // explicit null = user cancelled remote choice; abort navigation.
    if (remoteId === null) return;

    // when the resolver gave us an alternate per-remote suggestion (e.g.
    // multi-remote picker chose a non-primary remote), use that for
    // entity_id / metadata so navigation uses the picked remote's ids.
    const s = resolvedData ?? originalData;
    const meta = s.metadata as any;

    // navigate based on type. when remoteIdFor returns an id, use the
    // *On(remoteId, ...) variants so the router's RemoteContextHandler
    // switches the active data source on the :remoteId param change.
    switch (s.suggestion_type) {
      case "song":
        if (meta?.album_id) {
          setHighlightedSongId(s.entity_id);
          props.onNavigate?.(
            remoteId ? routes.albumOn(remoteId, meta.album_id) : routes.album(meta.album_id)
          );
        }
        break;
      case "artist":
        props.onNavigate?.(
          remoteId ? routes.artistOn(remoteId, s.entity_id) : routes.artist(s.entity_id)
        );
        break;
      case "album":
        props.onNavigate?.(
          remoteId ? routes.albumOn(remoteId, s.entity_id) : routes.album(s.entity_id)
        );
        break;
      case "playlist":
        props.onNavigate?.(
          remoteId ? routes.playlistOn(remoteId, s.entity_id) : routes.playlist(s.entity_id)
        );
        break;
      // FEDERATION-COMPAT-LEGACY-GENRE-TYPE: legacy "genre" falls
      // through to the taxon case. taxon hits deep-link into the
      // graph viz view focused on the picked taxon. requires a
      // remote id; if remoteIdFor returned undefined (single-source
      // local), skip nav. when the backend can't tell us which
      // taxon kind matched, there's no safe default — bail out
      // rather than guess.
      case "genre":
      case "taxon": {
        if (!remoteId) break;
        const kindSlug = meta?.kind_slug as string | undefined;
        if (!kindSlug) break;
        const nodeId = valueNodeId(remoteId, kindSlug as RelationKind, s.display);
        props.onNavigate?.(`/explore?graph=${encodeURIComponent(nodeId)}`);
        break;
      }
      case "video":
        props.onNavigate?.(buildRoute(`/video/${s.entity_id}`));
        break;
      case "video_series":
        props.onNavigate?.(buildRoute(`/video/series/${s.entity_id}`));
        break;
    }

    // close dropdown and clear focus so hint doesn't linger
    setSuggestionsOpen(false);
    setIsFocused(false);
  };

  // --- play actions (thumbnail click) ---

  const handlePlay = async (suggestion: APISuggestion) => {
    const dataSource = getDataSource();
    try {
      switch (suggestion.suggestion_type) {
        case "song":
          await playSong(suggestion.entity_id);
          break;
        case "album": {
          const songs = await dataSource.getAlbumSongs?.(suggestion.entity_id);
          if (songs?.items.length) {
            await addToQueue(songs.items, {
              startPlaying: true,
              source: { type: "album", label: suggestion.display, entity_id: suggestion.entity_id },
            });
          }
          break;
        }
        case "playlist": {
          const songs = await dataSource.getPlaylistSongs?.(suggestion.entity_id);
          if (songs?.items.length) {
            await addToQueue(songs.items, {
              startPlaying: true,
              source: {
                type: "playlist",
                label: suggestion.display,
                entity_id: suggestion.entity_id,
              },
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error("failed to play:", err);
    }
    // don't collapse — keep suggestions open so user can keep browsing
  };

  const playSong = async (songId: string) => {
    if (!getCurrentRemote()) return;
    const song = await getDataSource().getSongById(songId);
    if (song) {
      await addToQueue([song], { startPlaying: true, source: { type: "song", label: song.title } });
    }
  };

  // --- infinite scroll ---

  const handleEndReached = () => {
    if (props.hasMoreSuggestions && !props.isLoadingSuggestions) {
      props.onLoadMoreSuggestions?.();
    }
  };

  // attach play callbacks and context menu actions to suggestions before passing to SearchInput
  const suggestionsWithPlay = (): SearchSuggestion[] => {
    // resolve remote id for a suggestion, then navigate to the built path.
    // mirrors what handleSelect does but lets each action pick its own route.
    const resolveAndNavigate = async (
      suggestion: SearchSuggestion,
      buildPath: (remoteId: string | undefined) => string
    ) => {
      let remoteId: string | undefined;
      try {
        const resolved = await props.remoteIdFor?.(suggestion);
        if (resolved === null) return; // user cancelled remote picker
        if (resolved && typeof resolved === "object") {
          remoteId = resolved.remoteId;
        } else {
          remoteId = resolved ?? undefined;
        }
      } catch {
        // fall through with no remote — navigation uses current remote
      }
      props.onNavigate?.(buildPath(remoteId));
    };

    return (props.suggestions || []).map((s) => {
      const apiSuggestion = s.data as APISuggestion | undefined;
      const canPlay =
        apiSuggestion &&
        (apiSuggestion.suggestion_type === "song" ||
          apiSuggestion.suggestion_type === "album" ||
          apiSuggestion.suggestion_type === "playlist");

      const contextMenuActions: MenuAction[] = [];
      if (apiSuggestion) {
        const meta = apiSuggestion.metadata as any;
        const isFav = !!s.isFavorite;

        // helper: resolve the remote for this suggestion, then return the
        // data source scoped to it (or the active source as fallback).
        const resolveDs = async () => {
          try {
            const resolved = await props.remoteIdFor?.(s);
            if (resolved === null) return null;
            const remoteId =
              resolved && typeof resolved === "object" ? resolved.remoteId : resolved;
            if (!remoteId || remoteId === "local")
              return { ds: getDataSource(), remote: undefined };
            const remote = await getRemoteById(remoteId);
            return {
              ds: remote ? new RemoteMusicDataSource(remote) : getDataSource(),
              remote: remote ?? undefined,
            };
          } catch {
            return { ds: getDataSource(), remote: undefined };
          }
        };

        // helper: resolve remoteId string only (for station / share actions)
        const resolveRemoteId = async (): Promise<string | undefined> => {
          try {
            const resolved = await props.remoteIdFor?.(s);
            if (resolved === null) return undefined;
            if (resolved && typeof resolved === "object") return resolved.remoteId;
            return resolved ?? undefined;
          } catch {
            return undefined;
          }
        };

        switch (apiSuggestion.suggestion_type) {
          case "song": {
            contextMenuActions.push({
              label: "play now",
              icon: "play",
              onClick: () => void handlePlay(apiSuggestion),
            });
            contextMenuActions.push({
              label: "play next",
              icon: "queue",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const song = await r.ds.getSongById?.(apiSuggestion.entity_id);
                if (song)
                  await addToQueue([song], {
                    position: "next",
                    source: { type: "song", label: song.title },
                  });
              },
            });
            contextMenuActions.push({
              label: "add to queue",
              icon: "queue",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const song = await r.ds.getSongById?.(apiSuggestion.entity_id);
                if (song) await addToQueue([song], { source: { type: "song", label: song.title } });
              },
            });
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: isFav ? "remove from favorites" : "add to favorites",
              icon: isFav ? "favorite" : "favoriteOutline",
              onClick: async () => {
                const r = await resolveDs();
                toggleFavoriteMutation.mutate({
                  targetType: "song",
                  targetId: apiSuggestion.entity_id,
                  isFavorite: !isFav,
                  remote: r?.remote ?? undefined,
                });
              },
            });
            contextMenuActions.push({
              label: "add to playlist...",
              icon: "playlist",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                void showPlaylistSelector([apiSuggestion.entity_id], r.remote);
              },
            });
            if (isCharnelMode() || meta?.remote_server_id) {
              contextMenuActions.push({
                label: "add to station...",
                icon: "headphones",
                onClick: async () => {
                  const remoteId = await resolveRemoteId();
                  void showStationSelector(
                    { kind: "songs", songIds: [apiSuggestion.entity_id] },
                    remoteId
                  );
                },
              });
            }
            contextMenuActions.push(
              createShareMenuAction(
                { kind: "song", id: apiSuggestion.entity_id, displayTitle: apiSuggestion.display },
                undefined,
                undefined
              )
            );
            if (meta?.album_id) {
              contextMenuActions.push({ type: "separator" });
              contextMenuActions.push({
                label: "go to album",
                icon: "album",
                onClick: () =>
                  void resolveAndNavigate(s, (rid) =>
                    rid ? routes.albumOn(rid, meta.album_id) : routes.album(meta.album_id)
                  ),
              });
            }
            const firstArtistId = (() => {
              try {
                const ids =
                  typeof meta?.artist_ids === "string"
                    ? JSON.parse(meta.artist_ids)
                    : meta?.artist_ids;
                return Array.isArray(ids) ? ids[0] : undefined;
              } catch {
                return undefined;
              }
            })();
            if (firstArtistId) {
              contextMenuActions.push({
                label: "go to artist",
                icon: "artist",
                onClick: () =>
                  void resolveAndNavigate(s, (rid) =>
                    rid ? routes.artistOn(rid, firstArtistId) : routes.artist(firstArtistId)
                  ),
              });
            }
            break;
          }
          case "album": {
            contextMenuActions.push({
              label: "play album",
              icon: "play",
              onClick: () => void handlePlay(apiSuggestion),
            });
            contextMenuActions.push({
              label: "shuffle album",
              icon: "shuffle",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getAlbumSongs?.(apiSuggestion.entity_id);
                if (res) {
                  const shuffled = [...res.items].sort(() => Math.random() - 0.5);
                  await playQueue(shuffled, {
                    source: { type: "shuffle", label: apiSuggestion.display },
                  });
                }
              },
            });
            contextMenuActions.push({
              label: "add to queue",
              icon: "queue",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getAlbumSongs?.(apiSuggestion.entity_id);
                if (res)
                  await addToQueue(res.items, {
                    source: { type: "album", label: apiSuggestion.display },
                  });
              },
            });
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: isFav ? "remove from favorites" : "add to favorites",
              icon: isFav ? "favorite" : "favoriteOutline",
              onClick: async () => {
                const r = await resolveDs();
                toggleFavoriteMutation.mutate({
                  targetType: "album",
                  targetId: apiSuggestion.entity_id,
                  isFavorite: !isFav,
                  remote: r?.remote ?? undefined,
                });
              },
            });
            contextMenuActions.push({
              label: "add to playlist...",
              icon: "playlist",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getAlbumSongs?.(apiSuggestion.entity_id);
                if (res)
                  void showPlaylistSelector(
                    res.items.map((s) => s.id),
                    r.remote
                  );
              },
            });
            const currentRemote = getCurrentRemote();
            const stationCapable =
              isCharnelMode() || (!!currentRemote && isP2PRemote(currentRemote as any));
            if (stationCapable) {
              contextMenuActions.push({
                label: "add to station...",
                icon: "headphones",
                onClick: async () => {
                  const remoteId = await resolveRemoteId();
                  void showStationSelector(
                    {
                      kind: "album",
                      albumId: apiSuggestion.entity_id,
                      albumTitle: apiSuggestion.display,
                    },
                    remoteId ?? currentRemote?.remote_id
                  );
                },
              });
            }
            contextMenuActions.push(
              createShareMenuAction(
                {
                  kind: "album",
                  id: apiSuggestion.entity_id,
                  displayTitle: apiSuggestion.display,
                  artistName: meta?.artist_name,
                },
                undefined,
                undefined
              )
            );
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: "go to album",
              icon: "album",
              onClick: () =>
                void resolveAndNavigate(s, (rid) =>
                  rid
                    ? routes.albumOn(rid, apiSuggestion.entity_id)
                    : routes.album(apiSuggestion.entity_id)
                ),
            });
            if (meta?.artist_id) {
              contextMenuActions.push({
                label: "go to artist",
                icon: "artist",
                onClick: () =>
                  void resolveAndNavigate(s, (rid) =>
                    rid ? routes.artistOn(rid, meta.artist_id) : routes.artist(meta.artist_id)
                  ),
              });
            }
            break;
          }
          case "artist": {
            contextMenuActions.push({
              label: "play all",
              icon: "play",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getArtistSongs?.(apiSuggestion.entity_id);
                if (res)
                  await playQueue(res.items, {
                    source: { type: "artist", label: apiSuggestion.display },
                  });
              },
            });
            contextMenuActions.push({
              label: "shuffle all",
              icon: "shuffle",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getArtistSongs?.(apiSuggestion.entity_id);
                if (res) {
                  const shuffled = [...res.items].sort(() => Math.random() - 0.5);
                  await playQueue(shuffled, {
                    source: { type: "shuffle", label: apiSuggestion.display },
                  });
                }
              },
            });
            contextMenuActions.push({
              label: "add to queue",
              icon: "queue",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getArtistSongs?.(apiSuggestion.entity_id);
                if (res)
                  await addToQueue(res.items, {
                    source: { type: "artist", label: apiSuggestion.display },
                  });
              },
            });
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: isFav ? "remove from favorites" : "add to favorites",
              icon: isFav ? "favorite" : "favoriteOutline",
              onClick: async () => {
                const r = await resolveDs();
                toggleFavoriteMutation.mutate({
                  targetType: "artist",
                  targetId: apiSuggestion.entity_id,
                  isFavorite: !isFav,
                  remote: r?.remote ?? undefined,
                });
              },
            });
            if (isCharnelMode() || !!getCurrentRemote()) {
              contextMenuActions.push({
                label: "add to station...",
                icon: "headphones",
                onClick: async () => {
                  const remoteId = await resolveRemoteId();
                  void showStationSelector(
                    {
                      kind: "artist",
                      artistId: apiSuggestion.entity_id,
                      artistName: apiSuggestion.display,
                    },
                    remoteId ?? getCurrentRemote()?.remote_id
                  );
                },
              });
            }
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: "go to artist",
              icon: "artist",
              onClick: () =>
                void resolveAndNavigate(s, (rid) =>
                  rid
                    ? routes.artistOn(rid, apiSuggestion.entity_id)
                    : routes.artist(apiSuggestion.entity_id)
                ),
            });
            break;
          }
          case "playlist": {
            contextMenuActions.push({
              label: "play playlist",
              icon: "play",
              onClick: () => void handlePlay(apiSuggestion),
            });
            contextMenuActions.push({
              label: "shuffle playlist",
              icon: "shuffle",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getPlaylistSongs?.(apiSuggestion.entity_id);
                if (res) {
                  const shuffled = [...res.items].sort(() => Math.random() - 0.5);
                  await playQueue(shuffled, {
                    source: { type: "shuffle", label: apiSuggestion.display },
                  });
                }
              },
            });
            contextMenuActions.push({
              label: "add to queue",
              icon: "queue",
              onClick: async () => {
                const r = await resolveDs();
                if (!r) return;
                const res = await r.ds.getPlaylistSongs?.(apiSuggestion.entity_id);
                if (res)
                  await addToQueue(res.items, {
                    source: { type: "playlist", label: apiSuggestion.display },
                  });
              },
            });
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: isFav ? "remove from favorites" : "add to favorites",
              icon: isFav ? "favorite" : "favoriteOutline",
              onClick: async () => {
                toggleFavoriteMutation.mutate({
                  targetType: "playlist",
                  targetId: apiSuggestion.entity_id,
                  isFavorite: !isFav,
                });
              },
            });
            contextMenuActions.push(
              createShareMenuAction(
                {
                  kind: "playlist",
                  id: apiSuggestion.entity_id,
                  displayTitle: apiSuggestion.display,
                },
                undefined,
                undefined
              )
            );
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: "go to playlist",
              icon: "playlist",
              onClick: () =>
                void resolveAndNavigate(s, (rid) =>
                  rid
                    ? routes.playlistOn(rid, apiSuggestion.entity_id)
                    : routes.playlist(apiSuggestion.entity_id)
                ),
            });
            break;
          }
          case "video": {
            contextMenuActions.push({
              label: "play video",
              icon: "play",
              onClick: () => props.onNavigate?.(buildRoute(`/video/${apiSuggestion.entity_id}`)),
            });
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: isFav ? "remove from favorites" : "add to favorites",
              icon: isFav ? "favorite" : "favoriteOutline",
              onClick: async () => {
                const r = await resolveDs();
                toggleFavoriteMutation.mutate({
                  targetType: "video",
                  targetId: apiSuggestion.entity_id,
                  isFavorite: !isFav,
                  remote: r?.remote ?? undefined,
                });
              },
            });
            contextMenuActions.push({ type: "separator" });
            contextMenuActions.push({
              label: "go to video",
              icon: "video",
              onClick: () => props.onNavigate?.(buildRoute(`/video/${apiSuggestion.entity_id}`)),
            });
            if (meta?.series_id) {
              contextMenuActions.push({
                label: "go to series",
                icon: "list",
                onClick: () => props.onNavigate?.(buildRoute(`/video/series/${meta.series_id}`)),
              });
            }
            break;
          }
          case "video_series": {
            contextMenuActions.push({
              label: "go to series",
              icon: "list",
              onClick: () =>
                props.onNavigate?.(buildRoute(`/video/series/${apiSuggestion.entity_id}`)),
            });
            break;
          }
        }
      }

      return {
        ...s,
        onPlay: canPlay ? () => handlePlay(apiSuggestion) : undefined,
        contextMenuActions: contextMenuActions.length > 0 ? contextMenuActions : undefined,
      };
    });
  };

  // --- render ---

  return (
    <div class="relative flex items-center" onMouseEnter={handleMouseEnter}>
      <button
        class={`${isNarrow() ? "p-2.5" : "p-1.5"} rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0`}
        classList={{
          "text-[var(--color-accent-500)]": isExpanded(),
          "text-white/60 hover:text-white": !isExpanded(),
        }}
        onClick={handleIconClick}
        title="search (⌘K)"
      >
        <Icon name="search" size={isNarrowViewport() ? 22 : 16} />
      </button>

      <div
        class="overflow-hidden transition-all duration-200 ease-in-out"
        style={{
          "max-width": isExpanded() ? "280px" : "0px",
          opacity: isExpanded() ? "1" : "0",
        }}
      >
        <div class="ml-2">
          <SearchInput
            ref={(el) => (inputRef = el)}
            placeholder={props.placeholder || "search songs, artists, albums..."}
            value={searchValue()}
            loading={props.isLoadingSuggestions}
            suggestions={suggestionsWithPlay()}
            open={suggestionsOpen()}
            onOpenChange={setSuggestionsOpen}
            onInputChange={handleInputChange}
            onSelect={handleSelect}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            onEndReached={handleEndReached}
            loadingMore={!!props.hasMoreSuggestions && !!props.isLoadingSuggestions}
            hintMessage={hintMessage()}
            flyoutMount={props.flyoutMount}
            onHintClick={hintClick}
            footerContent={props.footerContent}
            class="w-64"
            variant="filled"
          />
        </div>
      </div>
    </div>
  );
}
