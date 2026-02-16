// top nav search component with suggestions and navigation
// uses hover-to-preview + click-to-lock pattern matching sort/tag controls
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { getCurrentRemote, getDataSource } from "../../music/data";
import type { SearchSuggestion } from "../../music/data/types";
import { addToQueue } from "../../music/services/queue/queue";
import { routes } from "../../music/utils/routing";
import { Icon } from "../icons/registry";
import type { SearchSuggestion as SearchInputSuggestion } from "../forms/SearchInput";
import { SearchInput } from "../forms/SearchInput";

export interface TopNavSearchProps {
  /** placeholder text */
  placeholder?: string;
  /** callback when search is collapsed */
  onCollapse?: () => void;
  /** callback for navigation - if not provided, navigation is disabled */
  onNavigate?: (path: string) => void;
  /** current pathname for filtering logic */
  currentPath?: string;
  /** search suggestions - if not provided, suggestions are disabled */
  suggestions?: SearchInputSuggestion[];
  /** callback when search value changes - parent should fetch suggestions */
  onSearchChange?: (value: string) => void;
  /** whether more suggestions are available */
  hasMoreSuggestions?: boolean;
  /** whether suggestions are loading */
  isLoadingSuggestions?: boolean;
  /** callback to load more suggestions */
  onLoadMoreSuggestions?: () => void;
  /** callback when expanded state changes */
  onExpandedChange?: (expanded: boolean) => void;
}

// top nav search with suggestions and navigation (presentational)
export function TopNavSearch(props: TopNavSearchProps) {
  const [searchValue, setSearchValue] = createSignal("");
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [isLocked, setIsLocked] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [suggestionsOpen, setSuggestionsOpen] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let preventReopen = false;
  let closeTimeout: ReturnType<typeof setTimeout> | undefined;

  // whether search should stay open (has value, is focused, or is locked)
  const shouldStayOpen = () => searchValue().length > 0 || isFocused() || isLocked();

  // collapse search and clear state
  const collapse = () => {
    setIsExpanded(false);
    setIsLocked(false);
    setIsFocused(false);
    setSuggestionsOpen(false);
    handleClear();
    props.onCollapse?.();
  };

  // notify parent when expanded state changes
  createEffect(() => {
    props.onExpandedChange?.(isExpanded());
  });

  // get current filterable view name
  const currentFilterableView = createMemo(() => {
    const pathname = props.currentPath || "";
    const filterableRoutes = ["songs", "albums", "artists", "playlists", "genres"];
    return filterableRoutes.find((route) => pathname.endsWith(`/${route}`));
  });

  // cmd+k keyboard shortcut to focus search
  createEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsExpanded(true);
        setIsLocked(true);
        setTimeout(() => inputRef?.focus(), 0);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleGlobalKeyDown));
  });

  // use suggestions from props
  const suggestions = () => props.suggestions || [];

  // create hint message for enter key action
  const enterHintMessage = createMemo(() => {
    const view = currentFilterableView();
    if (!view || !searchValue() || searchValue().length < 2) return null;
    return `press enter to filter ${view}`;
  });

  // handle loading more suggestions
  const handleEndReached = () => {
    if (props.hasMoreSuggestions && !props.isLoadingSuggestions) {
      props.onLoadMoreSuggestions?.();
    }
  };

  const handleInputChange = (value: string) => {
    setSearchValue(value);
    props.onSearchChange?.(value);
    if (value && !isExpanded()) {
      setIsExpanded(true);
    }
    if (value.length >= 2) {
      setSuggestionsOpen(true);
    } else {
      setSuggestionsOpen(false);
    }
  };

  // hover handlers - expand on enter, collapse on leave unless locked/focused/has value
  const handleMouseEnter = () => {
    clearTimeout(closeTimeout);
    if (!isExpanded()) setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    if (shouldStayOpen()) return;
    closeTimeout = setTimeout(() => {
      if (!shouldStayOpen()) {
        setIsExpanded(false);
      }
    }, 150);
  };

  // click-lock toggle on the search icon button
  const handleIconClick = () => {
    if (isExpanded() && isLocked()) {
      // already locked and open — clear and collapse
      collapse();
    } else {
      // lock open and focus
      setIsExpanded(true);
      setIsLocked(true);
      setTimeout(() => inputRef?.focus(), 0);
    }
  };

  const handleClear = () => {
    setSearchValue("");
    props.onSearchChange?.("");
    // if on a filterable view with query param, clear it
    const fullPath = props.currentPath || "";
    const pathname = fullPath.split("?")[0];
    const hasQueryParams = fullPath.includes("?");
    const filterableRoutes = ["songs", "albums", "artists", "playlists", "genres"];
    const currentRoute = filterableRoutes.find((route) => pathname.endsWith(`/${route}`));
    if (currentRoute && hasQueryParams) {
      props.onNavigate?.(pathname);
    }
  };

  const handleThumbnailClick = async (suggestion: SearchSuggestion) => {
    const dataSource = getDataSource();

    try {
      switch (suggestion.suggestion_type) {
        case "song":
          await handlePlaySong(suggestion.entity_id);
          break;

        case "album": {
          const albumSongs = await dataSource.getAlbumSongs?.(suggestion.entity_id);
          if (albumSongs && albumSongs.items.length > 0) {
            await addToQueue(albumSongs.items, {
              startPlaying: true,
              source: { type: "album", label: suggestion.display, entity_id: suggestion.entity_id },
            });
          }
          break;
        }

        case "playlist": {
          const playlistSongs = await dataSource.getPlaylistSongs?.(suggestion.entity_id);
          if (playlistSongs && playlistSongs.items.length > 0) {
            await addToQueue(playlistSongs.items, {
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
    } catch (error) {
      console.error("failed to play:", error);
    }

    // collapse search after playing
    collapse();
  };

  const handleSelect = (suggestion: SearchInputSuggestion) => {
    if (!suggestion || !suggestion.data) {
      return;
    }

    // collapse search BEFORE navigation to prevent blur handler from interfering
    setSearchValue("");
    setIsExpanded(false);
    setIsLocked(false);
    setSuggestionsOpen(false);

    const s = suggestion.data as SearchSuggestion;
    const meta = s.metadata as any;

    // delay navigation to let state changes complete
    setTimeout(() => {
      switch (s.suggestion_type) {
        case "song":
          if (meta?.album_id) {
            props.onNavigate?.(routes.album(meta.album_id));
          }
          break;

        case "artist":
          props.onNavigate?.(routes.artist(s.entity_id));
          break;

        case "album":
          props.onNavigate?.(routes.album(s.entity_id));
          break;

        case "genre":
          props.onNavigate?.(routes.genre(s.entity_id));
          break;

        case "playlist":
          props.onNavigate?.(routes.playlist(s.entity_id));
          break;

        default:
          break;
      }
    }, 0);
  };

  const handleSearchSubmit = () => {
    const query = searchValue();
    if (query.length < 2) return;

    const fullPath = props.currentPath || "";
    const pathname = fullPath.split("?")[0];
    const filterableRoutes = ["songs", "albums", "artists", "playlists", "genres"];
    const currentRoute = filterableRoutes.find((route) => pathname.endsWith(`/${route}`));

    if (currentRoute) {
      props.onNavigate?.(`${pathname}?q=${encodeURIComponent(query)}`);
    }
  };

  const handlePlaySong = async (songId: string) => {
    const remote = getCurrentRemote();
    if (!remote) return;

    try {
      const dataSource = getDataSource();
      const song = await dataSource.getSongById(songId);

      if (!song) {
        console.error("song not found:", songId);
        return;
      }

      await addToQueue([song], { startPlaying: true, source: { type: "song", label: song.title } });
    } catch (error) {
      console.error("failed to play song:", error);
    }
  };

  // handle keydown: enter submits, esc clears then collapses
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      preventReopen = true;
      setSuggestionsOpen(false);
      handleSearchSubmit();

      setTimeout(() => {
        preventReopen = false;
      }, 100);
    } else if (e.key === "Escape") {
      if (searchValue()) {
        // first esc: clear text
        handleClear();
      } else {
        // second esc (no text): collapse and blur
        collapse();
        inputRef?.blur();
      }
    }
  };

  // handle focus to show suggestions
  const handleFocus = () => {
    setIsFocused(true);
    if (preventReopen) return;
    if (searchValue().length >= 2) {
      setSuggestionsOpen(true);
    }
  };

  // handle blur - collapse if nothing keeps it open
  const handleBlur = (e: FocusEvent) => {
    setIsFocused(false);

    // don't process blur if clicking on a suggestion
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget?.closest('[role="listbox"]')) return;

    setSuggestionsOpen(false);

    // if not locked and no value, collapse after a short delay
    // (delay lets click events on the icon button fire first)
    if (!isLocked() && !searchValue()) {
      closeTimeout = setTimeout(() => {
        if (!isFocused() && !isLocked() && !searchValue()) {
          setIsExpanded(false);
        }
      }, 150);
    }
  };

  return (
    <div
      class="relative flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        class="p-1.5 rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0"
        classList={{
          "text-[var(--color-accent-500)]": isExpanded(),
          "text-white/60 hover:text-white": !isExpanded(),
        }}
        onClick={handleIconClick}
        title="search"
      >
        <Icon name="search" size={16} />
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
            ref={inputRef}
            placeholder={props.placeholder || "search songs, artists, albums..."}
            loading={props.isLoadingSuggestions}
            suggestions={suggestions()}
            open={suggestionsOpen()}
            onOpenChange={setSuggestionsOpen}
            onInputChange={handleInputChange}
            onSelect={handleSelect}
            onClear={handleClear}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            onEndReached={handleEndReached}
            loadingMore={props.isLoadingSuggestions}
            hintMessage={enterHintMessage()}
            onHintClick={handleSearchSubmit}
            onBlur={handleBlur}
            class="w-64"
            variant="filled"
          />
        </div>
      </div>
    </div>
  );
}
