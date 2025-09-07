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
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { createUserPreferences } from "../../../../services/userPreferences";
import { StarRating, FavoriteHeart } from "../../../ui";
import type { Song } from "../../../../../../lib/music/schemas/song";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

import type { RouteSectionProps } from "@solidjs/router";

interface DesktopSongsViewProps {
  class?: string;
}

export function DesktopSongsView(
  props: RouteSectionProps<unknown> & DesktopSongsViewProps = {} as any
) {
  const [] = useStore();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();
  const userPreferences = createUserPreferences();

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

  // Create fetch function for infinite scroll
  const fetchSongs = async (
    page: number
  ): Promise<{ items: Song[]; pagination: PaginationMetadata }> => {
    console.log(`🎵 Loading songs page ${page}`);

    const response = await apiClient.getSongs({
      page,
      page_size: 50,
    });

    console.log(`🎵 Loaded ${response.songs.length} songs`, response);

    // Debug: Log the structure of the first song to see what fields are available
    if (response.songs.length > 0) {
      console.log(`🎵 First song structure:`, response.songs[0]);
      console.log(
        `🎵 First song user_is_favorite:`,
        response.songs[0]?.user_is_favorite
      );
      console.log(`🎵 First song user_rating:`, response.songs[0]?.user_rating);
    }

    return {
      items: response.songs,
      pagination: response.pagination,
    };
  };

  // Use infinite scroll hook
  const infiniteScroll = useInfiniteScroll(fetchSongs, {
    threshold: 200,
    enabled: true,
  });

  // Extract state and actions
  const songs = infiniteScroll.state.items;
  const loading = infiniteScroll.state.loading;
  const error = infiniteScroll.state.error;
  const hasMore = infiniteScroll.state.hasMore;
  const pagination = infiniteScroll.state.pagination;

  // Reload functionality
  const reloadSongs = () => {
    infiniteScroll.actions.reset();
  };

  // Update individual song in local state
  const updateSongInState = (songId: string, updates: Partial<Song>) => {
    const currentItems = songs();
    const updatedItems = currentItems.map((song) =>
      song.id === songId ? { ...song, ...updates } : song
    );
    infiniteScroll.actions.setItems(updatedItems);
  };

  // Listen for data reload events
  events.on("data:reload", (data) => {
    if (data.type === "songs") {
      reloadSongs();
    }
  });

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
          {pagination()?.total !== undefined &&
            `${pagination()!.total} ${pagination()!.total === 1 ? "song" : "songs"}`}
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
        <div
          class="flex-1 overflow-y-auto min-h-0"
          ref={infiniteScroll.containerRef}
        >
          <div class="min-w-full">
            {/* Sticky Table Header */}
            <div class="sticky top-0 bg-black/95 backdrop-blur-sm px-6 py-3 text-xs text-gray-400 uppercase tracking-wider grid grid-cols-[auto_1fr_1fr_1fr_auto_auto_auto] gap-4 z-10">
              <div class="flex items-center gap-2">
                <div class="w-4"></div>
                <div class="flex-1 text-right pl-2">#</div>
              </div>
              <div class="pl-2">title</div>
              <div class="pr-2">artist</div>
              <div class="pr-2">album</div>
              <div class="text-center">year</div>
              <div class="text-center">rating</div>
              <div class="text-center">time</div>
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
                  {/* Favorite Heart / Selection Checkbox / Track Number / Play Button */}
                  <div class="flex items-center gap-2">
                    {/* Always show favorite heart on far left */}
                    <Show when={!selection.isSelected(song.id)}>
                      <FavoriteHeart
                        isFavorite={song.user_is_favorite}
                        onToggle={async (isFavorite) => {
                          console.log(
                            `🎵 FAVORITE HEART CLICKED! ${song.display_title} - isFavorite param:`,
                            isFavorite
                          );
                          console.log(
                            `🎵 Current song.user_is_favorite:`,
                            song.user_is_favorite
                          );

                          // Optimistically update local state
                          updateSongInState(song.id, {
                            user_is_favorite: isFavorite,
                          });
                          console.log(
                            `🎵 Optimistically updated favorite state for ${song.id} to:`,
                            isFavorite
                          );

                          try {
                            const result =
                              await userPreferences.toggleSongFavorite(
                                song.id,
                                !isFavorite
                              );
                            console.log(
                              `🎵 API response for favorite ${song.id}:`,
                              result
                            );

                            // Update with actual API response data
                            if (result) {
                              updateSongInState(song.id, {
                                user_is_favorite: result.is_favorite,
                                preference_updated_at: result.updated_at,
                              });
                            }
                          } catch (error) {
                            // Revert on error
                            console.error(
                              `🎵 API error for favorite ${song.id}:`,
                              error
                            );
                            updateSongInState(song.id, {
                              user_is_favorite: !isFavorite,
                            });
                            console.log(
                              `🎵 Reverted favorite for ${song.id} to ${!isFavorite}`
                            );
                          }
                        }}
                        size="sm"
                        class={
                          song.user_is_favorite
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 transition-opacity"
                        }
                      />
                    </Show>

                    {/* Right side: selection indicator or track number/play */}
                    <div class="flex-1 text-right">
                      {/* Selection indicator */}
                      <Show when={selection.isSelected(song.id)}>
                        <div class="text-magenta-400 text-sm inline-flex justify-end">
                          <svg
                            class="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                          </svg>
                        </div>
                      </Show>

                      {/* Track number and play button (when not selected) */}
                      <Show when={!selection.isSelected(song.id)}>
                        <div class="relative inline-flex items-center justify-center w-8 h-8">
                          <div class="group-hover:invisible text-gray-400 text-sm absolute">
                            {index() + 1}
                          </div>
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
                      </Show>
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
                      <StarRating
                        rating={song.user_rating}
                        onRatingChange={async (rating) => {
                          const previousRating = song.user_rating;
                          console.log(
                            `🎵 Rating change: ${song.display_title} from ${previousRating} to ${rating}`
                          );
                          console.log(
                            `🎵 Current song.user_rating:`,
                            song.user_rating
                          );

                          // Optimistically update local state
                          updateSongInState(song.id, {
                            user_rating: rating || null,
                          });
                          console.log(
                            `🎵 Optimistically updated rating for ${song.id} to:`,
                            rating || null
                          );

                          try {
                            const result = await userPreferences.rateSong(
                              song.id,
                              rating || null
                            );
                            console.log(
                              `🎵 API response for rating ${song.id}:`,
                              result
                            );

                            // Update with actual API response data
                            if (result) {
                              updateSongInState(song.id, {
                                user_rating: result.rating,
                                user_is_favorite: result.is_favorite,
                                preference_updated_at: result.updated_at,
                              });
                            }
                          } catch (error) {
                            // Revert on error
                            console.error(
                              `🎵 API error for rating ${song.id}:`,
                              error
                            );
                            updateSongInState(song.id, {
                              user_rating: previousRating,
                            });
                            console.log(
                              `🎵 Reverted rating for ${song.id} to ${previousRating}`
                            );
                          }
                        }}
                        size="sm"
                        class={
                          song.user_rating
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 transition-opacity"
                        }
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
              Add to Queue
            </button>

            <button
              class="px-3 py-1 bg-magenta-700 hover:bg-magenta-800 rounded text-sm transition-colors"
              onClick={(e) => {
                const selectedSongs = selection.getSelectedSongs(songs());
                songInteractions.handlePlaylistSelectorClick(e, selectedSongs);
              }}
            >
              Add to Playlist
            </button>

            <button
              class="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-sm transition-colors"
              onClick={async () => {
                const selectedSongs = selection.getSelectedSongs(songs());
                const songIds = selectedSongs.map((song) => song.id);
                const anyNotFavorited = selectedSongs.some(
                  (song) => !song.user_is_favorite
                );
                await userPreferences.bulkToggleFavorite(
                  songIds,
                  anyNotFavorited
                );
                reloadSongs();
              }}
              title="Press 'f' to toggle favorites"
            >
              ♥ Favorite
            </button>

            <button
              class="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-sm transition-colors"
              onClick={async () => {
                const selectedSongs = selection.getSelectedSongs(songs());
                const songIds = selectedSongs.map((song) => song.id);
                await userPreferences.bulkRateSongs(songIds, 5);
                reloadSongs();
              }}
              title="Press '1-5' to rate songs"
            >
              ⭐ Rate 5
            </button>

            <button
              class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
              onClick={() => selection.clearSelection()}
            >
              Clear
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
