// top nav search component with suggestions and navigation
import { useLocation, useNavigate } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { getCurrentRemote, getDataSource } from "../../music/data";
import type { SearchField, SearchSuggestion } from "../../music/data/types";
import { useSearchSuggestions } from "../../music/queries/search";
import { addToQueue } from "../../music/services/audio/player";
import { routes } from "../../music/utils/routing";
import { IconButton } from "../buttons/IconButton";
import type { SearchSuggestion as SearchInputSuggestion } from "../forms/SearchInput";
import { SearchInput } from "../forms/SearchInput";

interface TopNavSearchProps {
  /** placeholder text */
  placeholder?: string;
  /** callback when search is collapsed */
  onCollapse?: () => void;
}

// top nav search with suggestions and navigation
export function TopNavSearch(props: TopNavSearchProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchValue, setSearchValue] = createSignal("");
  const [isExpanded, setIsExpanded] = createSignal(false);
  const [suggestionsOpen, setSuggestionsOpen] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let preventReopen = false;

  // get current filterable view name
  const currentFilterableView = createMemo(() => {
    const pathname = location.pathname;
    const filterableRoutes = [
      "songs",
      "albums",
      "artists",
      "playlists",
      "genres",
    ];
    return filterableRoutes.find((route) => pathname.endsWith(`/${route}`));
  });

  // cmd+k keyboard shortcut to focus search
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsExpanded(true);
        // focus input after it's rendered
        setTimeout(() => {
          inputRef?.focus();
        }, 0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // suggestions query with infinite scroll
  const suggestionsQuery = useSearchSuggestions({
    field: () => "all",
    partial: searchValue,
    pageSize: 20,
    enabled: () => searchValue().length >= 2,
  });

  // flatten paginated suggestions
  const suggestions = createMemo((): SearchInputSuggestion[] => {
    const pages = suggestionsQuery.data?.pages;
    if (!pages) return [];

    const remote = getCurrentRemote();
    const baseUrl = remote?.base_url || "";

    return pages
      .flatMap((page) => page.suggestions)
      .map((s) => {
        // extract thumbnail and metadata
        let thumbnailUrl: string | undefined;
        let albumId: string | undefined;

        if (s.metadata) {
          const meta = s.metadata as any;
          if (meta.thumbnail_blob_id) {
            thumbnailUrl = `${baseUrl}/api/blobs/${meta.thumbnail_blob_id}`;
          }
          if (meta.album_id) {
            albumId = meta.album_id;
          }
        }

        // only add thumbnail click for playable types (songs, albums, playlists)
        const isPlayable =
          s.suggestion_type === "song" ||
          s.suggestion_type === "album" ||
          s.suggestion_type === "playlist";

        return {
          id: s.entity_id,
          text: s.display,
          category: s.suggestion_type,
          highlight: s.highlight,
          count: s.count > 0 ? s.count : undefined,
          thumbnailUrl,
          isFavorite: s.is_favorite,
          data: s,
          onThumbnailClick: isPlayable
            ? () => handleThumbnailClick(s, albumId)
            : undefined,
        };
      });
  });

  // create hint message for enter key action
  const enterHintMessage = createMemo(() => {
    const view = currentFilterableView();
    if (!view || !searchValue() || searchValue().length < 2) return null;
    return `press enter to filter ${view}`;
  });

  // handle loading more suggestions
  const handleEndReached = () => {
    if (suggestionsQuery.hasNextPage && !suggestionsQuery.isFetchingNextPage) {
      suggestionsQuery.fetchNextPage();
    }
  };

  const handleInputChange = (value: string) => {
    setSearchValue(value);
    // don't collapse if value is empty - keep expanded while focused
    if (value && !isExpanded()) {
      setIsExpanded(true);
    }
    // open suggestions when user types enough text
    if (value.length >= 2) {
      setSuggestionsOpen(true);
    } else {
      setSuggestionsOpen(false);
    }
  };

  const handleToggle = () => {
    if (isExpanded()) {
      // collapsing - clear everything
      handleClear();
      setIsExpanded(false);
      props.onCollapse?.();
    } else {
      // expanding - just open
      setIsExpanded(true);
    }
  };

  const handleClear = () => {
    setSearchValue("");
    // if on a filterable view with query param, clear it by navigating to the route without query
    const pathname = location.pathname;
    const filterableRoutes = [
      "songs",
      "albums",
      "artists",
      "playlists",
      "genres",
    ];
    const currentRoute = filterableRoutes.find((route) =>
      pathname.endsWith(`/${route}`),
    );
    if (currentRoute && location.search) {
      navigate(pathname, { replace: true });
    }
    // keep expanded even after clearing
  };

  const handleThumbnailClick = async (
    suggestion: SearchSuggestion,
    albumId?: string,
  ) => {
    const dataSource = getDataSource();

    try {
      // add to queue and play based on suggestion type
      switch (suggestion.suggestion_type) {
        case "song":
          await handlePlaySong(suggestion.entity_id);
          break;

        case "album":
          // fetch and add all songs in the album to queue
          const albumSongs = await dataSource.getAlbumSongs?.(
            suggestion.entity_id,
          );
          if (albumSongs && albumSongs.items.length > 0) {
            await addToQueue(albumSongs.items, { startPlaying: true });
          }
          break;

        case "playlist":
          // fetch and add all songs in the playlist to queue
          const playlistSongs = await dataSource.getPlaylistSongs?.(
            suggestion.entity_id,
          );
          if (playlistSongs && playlistSongs.items.length > 0) {
            await addToQueue(playlistSongs.items, { startPlaying: true });
          }
          break;
      }
    } catch (error) {
      console.error("failed to play:", error);
    }

    // collapse search after playing
    setSearchValue("");
    setIsExpanded(false);
  };

  const handleSelect = (suggestion: SearchInputSuggestion) => {
    if (!suggestion || !suggestion.data) {
      return;
    }

    // collapse search BEFORE navigation to prevent blur handler from interfering
    setSearchValue("");
    setIsExpanded(false);
    setSuggestionsOpen(false);

    const s = suggestion.data as SearchSuggestion;
    const meta = s.metadata as any;

    // delay navigation to let state changes complete
    setTimeout(() => {
      // row click navigates to detail page using route helpers
      switch (s.suggestion_type) {
        case "song":
          // for songs, navigate to album detail page if we have album_id
          if (meta?.album_id) {
            navigate(routes.album(meta.album_id));
          }
          break;

        case "artist":
          navigate(routes.artist(s.entity_id));
          break;

        case "album":
          navigate(routes.album(s.entity_id));
          break;

        case "genre":
          navigate(routes.genre(s.entity_id));
          break;

        case "playlist":
          navigate(routes.playlist(s.entity_id));
          break;

        default:
          // no fallback needed
          break;
      }
    }, 0);
  };

  const handleSearchSubmit = () => {
    const query = searchValue();
    if (query.length < 2) return;

    // apply filter to current view
    const pathname = location.pathname;
    const filterableRoutes = [
      "songs",
      "albums",
      "artists",
      "playlists",
      "genres",
    ];
    const currentRoute = filterableRoutes.find((route) =>
      pathname.endsWith(`/${route}`),
    );

    if (currentRoute) {
      // add query param to current view (don't clear search input)
      navigate(`${pathname}?q=${encodeURIComponent(query)}`);
    }
    // if not on a filterable view, do nothing (suggestions already work)
  };

  const handlePlaySong = async (songId: string) => {
    const remote = getCurrentRemote();
    if (!remote) return;

    // fetch full song data from the data source
    try {
      const dataSource = getDataSource();
      const song = await dataSource.getSongById(songId);

      if (!song) {
        console.error("song not found:", songId);
        return;
      }

      // add song to queue and play it
      await addToQueue([song], { startPlaying: true });
    } catch (error) {
      console.error("failed to play song:", error);
    }
  };

  // handle enter key to submit search
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      // prevent suggestions from reopening when Kobalte restores focus
      preventReopen = true;
      setSuggestionsOpen(false);
      handleSearchSubmit();

      // clear the flag after Kobalte's auto-focus restoration completes
      setTimeout(() => {
        preventReopen = false;
      }, 100);
    }
  };

  // handle focus to show suggestions
  const handleFocus = () => {
    // don't reopen if we just closed via Enter (Kobalte auto-focuses on unmount)
    if (preventReopen) {
      return;
    }
    if (searchValue().length >= 2) {
      setSuggestionsOpen(true);
    }
  };

  return (
    <div class="flex items-center gap-2">
      <Show
        when={isExpanded() || searchValue()}
        fallback={
          <IconButton
            icon="search"
            aria-label="search"
            onClick={handleToggle}
            variant="ghost"
          />
        }
      >
        <div class="flex items-center gap-2 transition-all duration-300">
          <SearchInput
            ref={inputRef}
            placeholder={
              props.placeholder || "search songs, artists, albums..."
            }
            loading={suggestionsQuery.isFetching}
            suggestions={suggestions()}
            open={suggestionsOpen()}
            onOpenChange={setSuggestionsOpen}
            onInputChange={handleInputChange}
            onSelect={handleSelect}
            onClear={handleClear}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            onEndReached={handleEndReached}
            loadingMore={suggestionsQuery.isFetchingNextPage}
            hintMessage={enterHintMessage()}
            onHintClick={handleSearchSubmit}
            onBlur={(e) => {
              // check if we're blurring to something outside the search component
              const relatedTarget = e.relatedTarget as HTMLElement | null;
              const isBlurringToSuggestion =
                relatedTarget?.closest('[role="listbox"]');

              // don't process blur if clicking on a suggestion
              if (isBlurringToSuggestion) {
                return;
              }

              // just close suggestions on blur
              setSuggestionsOpen(false);
            }}
            class="w-64"
            variant="filled"
          />
          <IconButton
            icon="close"
            aria-label="close search"
            onClick={handleToggle}
            variant="ghost"
          />
        </div>
      </Show>
    </div>
  );
}
