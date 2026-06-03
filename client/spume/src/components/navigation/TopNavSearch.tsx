// top nav search — expands on hover/click, shows suggestions, navigates on selection
import { createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";
import { isNarrowViewport } from "../../config/breakpoints";
import { getCurrentRemote, getDataSource } from "../../music/data";
import type { SearchSuggestion as APISuggestion } from "../../music/data/types";
import { addToQueue } from "../../music/services/queue/queue";
import { routes, matchRoute } from "../../music/utils/routing";
import { valueNodeId, type RelationKind } from "../graph/data/nodeIds";
import { setHighlightedSongId } from "../../music/state/highlightedSong";
import { Icon } from "../icons/registry";
import type { SearchSuggestion } from "../forms/SearchInput";
import { SearchInput } from "../forms/SearchInput";

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
  /**
   * optional resolver: given a suggestion, return the remoteId it belongs
   * to. when set, navigation uses `routes.*On(remoteId, ...)` so the
   * router's RemoteContextHandler switches the active source on its own.
   * may return a promise so the resolver can prompt the user (e.g. when
   * the suggestion was contributed by multiple remotes). returning
   * `undefined` (sync or async) falls back to current-remote-relative
   * navigation; returning `null` aborts navigation entirely.
   */
  remoteIdFor?: (
    s: SearchSuggestion
  ) => string | null | undefined | Promise<string | null | undefined>;
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

// filterable route keys — used for the "press return to filter X" hint
const FILTERABLE_KEYS = new Set(["songs", "albums", "artists", "playlists", "genres", "library"]);
// routes that filter inline (no autocomplete dropdown, debounced as-you-type)
const FILTER_ONLY_KEYS = new Set(["library"]);

export function TopNavSearch(props: TopNavSearchProps) {
  const [searchValue, setSearchValue] = createSignal("");
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [isLocked, setIsLocked] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [suggestionsOpen, setSuggestionsOpen] = createSignal(false);
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
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
    return key && FILTERABLE_KEYS.has(key) ? key : null;
  });

  // hint message — overridden by parent if `hintOverride` provided,
  // else the default "press return to filter X" focus hint.
  const hintMessage = createMemo(() => {
    const override = props.hintOverride?.();
    if (override) return override.message;
    const view = filterableView();
    if (!view || !isFocused()) return null;
    return `press return to filter ${view}`;
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
    if (isExpanded() && isLocked()) {
      collapse();
    } else {
      setIsExpanded(true);
      setIsLocked(true);
      requestAnimationFrame(() => inputRef?.focus());
    }
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
    setSearchValue(value);
    props.onSearchChange?.(value);
    if (value && !isExpanded()) setIsExpanded(true);
    // filter-only routes (e.g. library): suppress autocomplete + debounce-submit
    const key = currentRouteKey();
    if (key && FILTER_ONLY_KEYS.has(key)) {
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
    if (key && FILTER_ONLY_KEYS.has(key)) return;
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
    if (fullPath.includes("?") && key && FILTERABLE_KEYS.has(key)) {
      props.onNavigate?.(pathname);
    }
  };

  const submitFilter = () => {
    clearTimeout(filterDebounceTimer);
    const q = searchValue();
    const fullPath = props.currentPath || "";
    const pathname = fullPath.split("?")[0];
    const key = matchRoute(fullPath);
    if (!key || !FILTERABLE_KEYS.has(key)) return;
    // empty q on filter-only routes clears the filter; otherwise require >=2 chars
    if (!q) {
      props.onNavigate?.(pathname);
      return;
    }
    if (q.length < 2 && !FILTER_ONLY_KEYS.has(key)) return;
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

    const s = suggestion.data as APISuggestion;
    const meta = s.metadata as any;
    let remoteId: string | null | undefined;
    try {
      remoteId = await props.remoteIdFor?.(suggestion);
    } catch (err) {
      console.error("remoteIdFor failed:", err);
      return;
    }
    // explicit null = user cancelled remote choice; abort navigation.
    if (remoteId === null) return;

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

  // attach play callbacks to suggestions before passing to SearchInput
  const suggestionsWithPlay = (): SearchSuggestion[] => {
    return (props.suggestions || []).map((s) => {
      const apiSuggestion = s.data as APISuggestion | undefined;
      const canPlay =
        apiSuggestion &&
        (apiSuggestion.suggestion_type === "song" ||
          apiSuggestion.suggestion_type === "album" ||
          apiSuggestion.suggestion_type === "playlist");
      return {
        ...s,
        onPlay: canPlay ? () => handlePlay(apiSuggestion) : undefined,
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
