import {
  For,
  Show,
  createEffect,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";
import { apiClient } from "../../../../../../lib/api-client";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useStore } from "../../../../store";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { createUserPreferences } from "../../../../services/userPreferences";
import { useFreqholeSearch } from "../../../../hooks/useFreqholeSearch";
import {
  SongStarRating,
  SongFavoriteHeart,
  BulkEditControls,
} from "../../../ui";
import { useSongState } from "../../../../services/songState";
import type { Song } from "../../../../../../lib/music/schemas/song";
import { getSortIndicator } from "../../../../hooks/useSorting";

import type { RouteSectionProps } from "@solidjs/router";

interface DesktopSongsViewProps {
  class?: string;
}

export function DesktopSongsView(
  props: RouteSectionProps<unknown> & DesktopSongsViewProps = {} as any
) {
  const [] = useStore();
  const songState = useSongState();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();
  const userPreferences = createUserPreferences();

  // Enhanced search hook with total counts
  const searchHook = useFreqholeSearch(apiClient);

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      console.log(`🎵 Selection changed: ${selectedIds.size} songs selected`);
    },
    onBulkAction: (action, selectedSongs) => {
      console.log(
        `🎵 Bulk action: ${action} for ${selectedSongs.length} songs`
      );
    },
  });

  // Track whether we have selections for bulk context menu
  const [hasSelections, setHasSelections] = createSignal(false);

  createEffect(() => {
    setHasSelections(selection.selectedItems().size >= 2);
  });

  // Listen for selection clear events
  createEffect(() => {
    events.on("selection:clear", () => {
      console.log("🎵 Clearing selection via event");
      selection.clearSelection();
    });
  });

  // Use search hook for songs data
  const songs = () => searchHook.songs();
  const loading = () => searchHook.loading();
  const error = () => searchHook.error();
  const hasMore = () => {
    const pag = searchHook.pagination();
    return pag.hasNext;
  };
  const totalCount = () => searchHook.totalCount();

  // Reload functionality
  const reloadSongs = () => {
    searchHook.refresh();
  };

  // Handle sort changes
  const handleSort = (field: string) => {
    const currentField = searchHook.sortField();
    const currentDirection = searchHook.sortDirection();

    if (currentField === field) {
      // Toggle direction
      const newDirection = currentDirection === "asc" ? "desc" : "asc";
      searchHook.setSort(field, newDirection);
    } else {
      // New field, start with asc
      searchHook.setSort(field, "asc");
    }
  };

  // Update individual song in local state
  const updateSongInState = (songId: string, updates: Partial<Song>) => {
    // For now, just update global state and refresh
    // TODO: optimize by updating local state without full refresh
    songState.updateSong(songId, updates);
    reloadSongs();
  };

  // Listen for data reload events
  createEffect(() => {
    events.on("data:reload", (data) => {
      if (data.type === "songs") {
        reloadSongs();
      }
    });
  });

  // Scroll handler for infinite loading
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLElement;
    const threshold = 200;

    if (
      target.scrollTop + target.clientHeight >=
        target.scrollHeight - threshold &&
      hasMore() &&
      !loading()
    ) {
      searchHook.loadMore();
    }
  };

  // Keyboard shortcuts for preferences
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only handle shortcuts if not typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const selectedSongs = selection.getSelectedSongs(songs());
    if (selectedSongs.length === 0) return;

    const handled = userPreferences.handleKeyboardShortcut(
      e.key,
      selectedSongs
    );
    if (handled) {
      e.preventDefault();
      // Force reload for keyboard shortcuts since they affect multiple items
      reloadSongs();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div
      class={`flex flex-col h-full bg-black text-white overflow-hidden ${props.class || ""}`}
    >
      {/* Fixed Header */}
      <div class="flex-shrink-0 p-6">
        <h1 class="text-2xl font-semibold text-white mb-2">songs</h1>
        <p class="text-gray-400 text-sm">
          {totalCount() > 0 &&
            `${totalCount()} ${totalCount() === 1 ? "song" : "songs"}`}
          {loading() && songs().length === 0 && "loading..."}
          {error() && "error loading songs"}
        </p>
      </div>

      {/* Error State */}
      <Show when={error() && songs().length === 0}>
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="text-red-400 mb-2">⚠️</div>
            <div class="text-white mb-2">failed to load songs</div>
            <div class="text-red-400 text-sm mb-4">{error()}</div>
            <button
              class="px-4 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium text-sm transition-all"
              onClick={reloadSongs}
            >
              try again
            </button>
          </div>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={songs().length === 0 && !loading() && !error()}>
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="text-6xl mb-4">🎵</div>
            <div class="text-white text-xl mb-2">no songs found</div>
            <div class="text-gray-400">add some music to get started</div>
          </div>
        </div>
      </Show>

      {/* Desktop Songs Table - Scrollable */}
      <Show when={!error() || songs().length > 0}>
        <div class="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll}>
          <div class="min-w-full">
            {/* Sticky Table Header */}
            <div class="sticky top-0 bg-black/95 backdrop-blur-sm px-6 py-3 text-xs text-gray-400 uppercase tracking-wider grid grid-cols-[auto_1fr_1fr_1fr_auto_auto_auto] gap-4 z-10">
              <div class="flex items-center gap-2">
                <div class="w-4"></div>
                <div class="flex-1 text-right pl-2">#</div>
              </div>
              <button
                class="pl-2 hover:text-white transition-colors text-left flex items-center gap-1"
                onClick={() => handleSort("title")}
              >
                title
                <Show
                  when={getSortIndicator("title", {
                    field: searchHook.sortField(),
                    direction: searchHook.sortDirection(),
                  })}
                >
                  <span class="text-magenta-400">
                    {getSortIndicator("title", {
                      field: searchHook.sortField(),
                      direction: searchHook.sortDirection(),
                    }) === "asc"
                      ? "↑"
                      : "↓"}
                  </span>
                </Show>
              </button>
              <button
                class="pr-2 hover:text-white transition-colors text-left flex items-center gap-1"
                onClick={() => handleSort("artist")}
              >
                artist
                <Show
                  when={getSortIndicator("artist", {
                    field: searchHook.sortField(),
                    direction: searchHook.sortDirection(),
                  })}
                >
                  <span class="text-magenta-400">
                    {getSortIndicator("artist", {
                      field: searchHook.sortField(),
                      direction: searchHook.sortDirection(),
                    }) === "asc"
                      ? "↑"
                      : "↓"}
                  </span>
                </Show>
              </button>
              <button
                class="pr-2 hover:text-white transition-colors text-left flex items-center gap-1"
                onClick={() => handleSort("album")}
              >
                album
                <Show
                  when={getSortIndicator("album", {
                    field: searchHook.sortField(),
                    direction: searchHook.sortDirection(),
                  })}
                >
                  <span class="text-magenta-400">
                    {getSortIndicator("album", {
                      field: searchHook.sortField(),
                      direction: searchHook.sortDirection(),
                    }) === "asc"
                      ? "↑"
                      : "↓"}
                  </span>
                </Show>
              </button>
              <button
                class="text-center hover:text-white transition-colors flex items-center justify-center gap-1"
                onClick={() => handleSort("year")}
              >
                year
                <Show
                  when={getSortIndicator("year", {
                    field: searchHook.sortField(),
                    direction: searchHook.sortDirection(),
                  })}
                >
                  <span class="text-magenta-400">
                    {getSortIndicator("year", {
                      field: searchHook.sortField(),
                      direction: searchHook.sortDirection(),
                    }) === "asc"
                      ? "↑"
                      : "↓"}
                  </span>
                </Show>
              </button>
              <button
                class="text-center hover:text-white transition-colors flex items-center justify-center gap-1"
                onClick={() => handleSort("rating")}
              >
                rating
                <Show
                  when={getSortIndicator("rating", {
                    field: searchHook.sortField(),
                    direction: searchHook.sortDirection(),
                  })}
                >
                  <span class="text-magenta-400">
                    {getSortIndicator("rating", {
                      field: searchHook.sortField(),
                      direction: searchHook.sortDirection(),
                    }) === "asc"
                      ? "↑"
                      : "↓"}
                  </span>
                </Show>
              </button>
              <button
                class="text-center hover:text-white transition-colors flex items-center justify-center gap-1"
                onClick={() => handleSort("duration_seconds")}
              >
                time
                <Show
                  when={getSortIndicator("duration_seconds", {
                    field: searchHook.sortField(),
                    direction: searchHook.sortDirection(),
                  })}
                >
                  <span class="text-magenta-400">
                    {getSortIndicator("duration_seconds", {
                      field: searchHook.sortField(),
                      direction: searchHook.sortDirection(),
                    }) === "asc"
                      ? "↑"
                      : "↓"}
                  </span>
                </Show>
              </button>
            </div>

            {/* Table Body */}
            <For each={songs()}>
              {(song, index) => (
                <div
                  class={`px-6 py-3 hover:bg-magenta-600/20 transition-colors cursor-pointer grid grid-cols-[auto_1fr_1fr_1fr_auto_auto_auto] gap-4 items-center group border border-transparent min-w-0 ${
                    selection.isSelected(song.id)
                      ? "bg-magenta-600/30 border-magenta-400/50"
                      : ""
                  }`}
                  onClick={(e) => {
                    if (e.detail === 1) {
                      // Single click - handle selection
                      if (e.shiftKey && selection.lastSelectedIndex() >= 0) {
                        selection.selectRange(
                          selection.lastSelectedIndex(),
                          index(),
                          songs()
                        );
                      } else {
                        selection.handleRowClick(song, index(), e);
                      }
                    }
                  }}
                  onDblClick={() => {
                    // Double click - play song (don't handle selection here)
                    songInteractions.playSong(song, false);
                  }}
                  onMouseDown={(e) =>
                    selection.handleRowMouseDown(song, index(), e)
                  }
                  onContextMenu={(e) => {
                    // If right-clicking on unselected song, select it first
                    if (!selection.isSelected(song.id)) {
                      selection.setSelectedItems(new Set([song.id]));
                      selection.setLastSelectedIndex(index());
                    }

                    const selectedSongs = selection.getSelectedSongs(songs());
                    console.log(
                      "🎵 Context menu: selected songs count:",
                      selectedSongs.length
                    );
                    console.log("🎵 Selected songs:", selectedSongs);

                    if (selectedSongs.length > 1) {
                      // Show bulk context menu
                      console.log("🎵 Using bulk context menu");
                      songInteractions.handleBulkRightClick(e, selectedSongs);
                    } else {
                      // Show single song context menu
                      console.log("🎵 Using single context menu");
                      songInteractions.handleRightClick(e, song);
                    }
                  }}
                >
                  {/* Favorite Heart / Track Number/Selection / Play Button */}
                  <div class="flex items-center gap-2">
                    {/* Always show favorite heart on far left */}
                    <SongFavoriteHeart
                      song={songState.getUpdatedSong(song)}
                      size="sm"
                      class={
                        songState.isFavorite(song.id)
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100 transition-opacity"
                      }
                      onToggle={(songId, isFavorite) => {
                        updateSongInState(songId, {
                          user_is_favorite: isFavorite,
                        });
                      }}
                    />

                    {/* Right side: consistent width container for track number/selection */}
                    <div class="flex-1 text-right">
                      <div class="relative inline-flex items-center justify-center w-8 h-8 group">
                        {/* Selection checkbox (when selected and not hovering) */}
                        <Show when={selection.isSelected(song.id)}>
                          <div class="text-magenta-400 text-sm absolute group-hover:invisible">
                            <svg
                              class="w-4 h-4"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          </div>
                        </Show>

                        {/* Track number (when not selected and not hovering) */}
                        <Show when={!selection.isSelected(song.id)}>
                          <div class="group-hover:invisible text-gray-400 text-sm absolute">
                            {index() + 1}
                          </div>
                        </Show>

                        {/* Play button (always available on cell hover) */}
                        <button
                          class="invisible group-hover:visible text-gray-400 hover:text-magenta-400 transition-colors w-full h-full flex items-center justify-center rounded-full hover:bg-magenta-600/20"
                          onClick={(e) => {
                            e.stopPropagation();
                            songInteractions.playSong(song);
                          }}
                        >
                          <svg
                            class="w-5 h-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Title */}
                  <div class="min-w-0">
                    <div
                      class="text-white font-medium truncate"
                      title={song.title}
                    >
                      {song.title}
                    </div>
                  </div>

                  {/* Artist */}
                  <div class="min-w-0">
                    <div
                      class="text-gray-300 text-sm truncate"
                      title={song.artist || ""}
                    >
                      {song.artist || ""}
                    </div>
                  </div>

                  {/* Album */}
                  <div class="min-w-0">
                    <div
                      class="text-gray-300 text-sm truncate"
                      title={song.album || ""}
                    >
                      {song.album || ""}
                    </div>
                  </div>

                  {/* Year */}
                  <div class="min-w-0">
                    <div
                      class="text-gray-300 text-sm truncate text-center"
                      title={song.year ? song.year.toString() : ""}
                    >
                      {song.year || ""}
                    </div>
                  </div>

                  {/* Rating */}
                  <div>
                    <div class="flex justify-center">
                      <SongStarRating
                        song={songState.getUpdatedSong(song)}
                        size="sm"
                        onRate={(songId, rating) => {
                          updateSongInState(songId, {
                            user_rating: rating,
                          });
                        }}
                      />
                    </div>
                  </div>

                  {/* Duration */}
                  <div>
                    <div class="text-gray-400 text-sm text-center">
                      {songInteractions.formatDuration(song.duration_seconds)}
                    </div>
                  </div>
                </div>
              )}
            </For>

            {/* Loading indicator */}
            <Show when={loading()}>
              <div class="p-6 text-center">
                <div class="text-gray-400">loading more songs...</div>
              </div>
            </Show>

            {/* No more songs indicator */}
            <Show when={!hasMore() && songs().length > 0}>
              <div class="p-6 text-center text-gray-500 text-sm">
                — end of songs —
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Selection Toolbar */}
      <Show when={hasSelections()}>
        <div class="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-magenta-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-4 z-40 freqhole-selection-toolbar">
          <span class="text-sm font-medium">
            {selection.selectedItems().size} song
            {selection.selectedItems().size !== 1 ? "s" : ""} selected
          </span>

          <div class="flex space-x-2">
            <button
              class="px-3 py-1 bg-magenta-700 hover:bg-magenta-800 rounded text-sm transition-colors"
              onClick={() => {
                const selectedSongs = selection.getSelectedSongs(songs());
                selectedSongs.forEach((song) =>
                  songInteractions.queueSong(song)
                );
                selection.clearSelection();
              }}
            >
              queue
            </button>

            {/*<button
              class="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors"
              onClick={() => console.log("Add to playlist clicked")}
            >
              Add to Playlist
            </button>*/}

            <BulkEditControls
              selectedSongs={selection.getSelectedSongs(songs())}
              onBulkFavorite={async (isFavorite) => {
                const selectedSongs = selection.getSelectedSongs(songs());
                const songIds = selectedSongs.map((song) => song.id);
                await userPreferences.bulkToggleFavorite(songIds, isFavorite);
                // Update global state for each song
                selectedSongs.forEach((song) => {
                  songState.updateSong(song.id, {
                    user_is_favorite: isFavorite,
                  });
                });
                reloadSongs();
              }}
              onBulkRate={async (rating) => {
                const selectedSongs = selection.getSelectedSongs(songs());
                const songIds = selectedSongs.map((song) => song.id);
                // Convert 0 to null for the API
                const apiRating = rating === 0 ? null : rating;
                await userPreferences.bulkRateSongs(songIds, apiRating);
                // Update global state for each song
                selectedSongs.forEach((song) => {
                  songState.updateRating(song.id, rating);
                });
                reloadSongs();
              }}
            />

            <button
              class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
              onClick={() => selection.clearSelection()}
            >
              clear
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
