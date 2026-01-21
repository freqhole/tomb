// top nav search component with suggestions and navigation
import { useLocation, useNavigate } from "@solidjs/router";
import { createMemo, createSignal, Show } from "solid-js";
import { getCurrentRemote, getDataSource } from "../../music/data";
import type { SearchField, SearchSuggestion } from "../../music/data/types";
import { useSearchSuggestions } from "../../music/queries/search";
import { playQueue } from "../../music/services/audio/player";
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

  // suggestions query
  const suggestionsQuery = useSearchSuggestions({
    field: () => "all",
    partial: searchValue,
    pageSize: 10,
    enabled: () => searchValue().length >= 2,
  });

  // convert API suggestions to SearchInput format
  const suggestions = createMemo((): SearchInputSuggestion[] => {
    const data = suggestionsQuery.data;
    if (!data) return [];

    const remote = getCurrentRemote();
    const baseUrl = remote?.base_url || "";

    return data.suggestions.map((s) => {
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
        data: s,
        onThumbnailClick: isPlayable
          ? () => handleThumbnailClick(s, albumId)
          : undefined,
      };
    });
  });

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
      // play based on suggestion type
      switch (suggestion.suggestion_type) {
        case "song":
          await handlePlaySong(suggestion.entity_id);
          break;

        case "album":
          // fetch and play all songs in the album
          const albumSongs = await dataSource.getAlbumSongs?.(
            suggestion.entity_id,
          );
          if (albumSongs && albumSongs.items.length > 0) {
            await playQueue(albumSongs.items);
          }
          break;

        case "playlist":
          // fetch and play all songs in the playlist
          const playlistSongs = await dataSource.getPlaylistSongs?.(
            suggestion.entity_id,
          );
          if (playlistSongs && playlistSongs.items.length > 0) {
            await playQueue(playlistSongs.items);
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
    if (!suggestion || !suggestion.data) return;

    const s = suggestion.data as SearchSuggestion;
    const remote = getCurrentRemote();
    const baseRoute = remote ? `/${remote.remote_id}` : "/local";
    const meta = s.metadata as any;

    // row click navigates to detail page
    switch (s.suggestion_type) {
      case "song":
        // for songs, navigate to album detail page if we have album_id
        if (meta?.album_id) {
          navigate(`${baseRoute}/albums/${meta.album_id}`);
        } else {
          // fallback: go to search results
          handleSearchSubmit();
        }
        break;

      case "artist":
        navigate(`${baseRoute}/artists/${s.entity_id}`);
        break;

      case "album":
        navigate(`${baseRoute}/albums/${s.entity_id}`);
        break;

      case "genre":
        navigate(`${baseRoute}/genres/${s.entity_id}`);
        break;

      case "playlist":
        navigate(`${baseRoute}/playlists/${s.entity_id}`);
        break;

      default:
        // fallback: go to search results
        handleSearchSubmit();
        break;
    }

    // collapse search after selection
    setSearchValue("");
    setIsExpanded(false);
  };

  const handleSearchSubmit = () => {
    const query = searchValue();
    if (query.length < 2) return;

    const remote = getCurrentRemote();
    const baseRoute = remote ? `/${remote.remote_id}` : "/local";

    // detect if on a filterable view route
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
    } else {
      // navigate to search results page
      navigate(`${baseRoute}/search?q=${encodeURIComponent(query)}`);
      // collapse search after navigating to search results page
      setSearchValue("");
      setIsExpanded(false);
    }
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

      // play the song with full data
      await playQueue([song]);
    } catch (error) {
      console.error("failed to play song:", error);
    }
  };

  // handle enter key to submit search
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearchSubmit();
      // close suggestions and blur input
      setSuggestionsOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  };

  // handle focus to show suggestions
  const handleFocus = () => {
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
            onBlur={(e) => {
              // check if we're blurring to something outside the search component
              const relatedTarget = e.relatedTarget as HTMLElement | null;
              const isBlurringToSuggestion =
                relatedTarget?.closest('[role="listbox"]');

              // don't process blur if clicking on a suggestion
              if (isBlurringToSuggestion) {
                return;
              }

              // close suggestions
              setSuggestionsOpen(false);

              const query = searchValue();
              // if there's a search value, submit the search on blur
              if (query && query.length >= 2) {
                handleSearchSubmit();
              } else if (!query) {
                // if empty, clear the query param if on a filterable view
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
                // collapse if there's no search value when focus is lost
                setIsExpanded(false);
              }
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
