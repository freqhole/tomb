import { For, Show } from "solid-js";
import { apiClient } from "../../../../../lib/api-client";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { useStore } from "../../../store";
import { useInfiniteScroll } from "../../../hooks/useInfiniteScroll";
import { useSongInteractions } from "../../../services/songInteractions";
import type { Song } from "../../../../../lib/music/schemas/song";
import type { PaginationMetadata } from "../../../hooks/useInfiniteScroll";

import type { RouteSectionProps } from "@solidjs/router";

interface SongTableViewProps {
  class?: string;
}

export function SongTableView(
  props: RouteSectionProps<unknown> & SongTableViewProps = {} as any
) {
  const [] = useStore();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

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

  // Reload functionality
  const reloadSongs = () => {
    infiniteScroll.actions.reset();
  };

  // Listen for data reload events
  events.on("data:reload", (data) => {
    if (data.type === "songs") {
      reloadSongs();
    }
  });

  return (
    <div
      class={`flex flex-col h-full bg-black text-white ${props.class || ""}`}
    >
      {/* Fixed Header */}
      <div class="flex-shrink-0 p-6">
        <h1 class="text-2xl font-semibold text-white mb-2">songs</h1>
        <p class="text-gray-400 text-sm">
          {songs().length > 0 &&
            `${songs().length} ${songs().length === 1 ? "song" : "songs"}`}
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

      {/* Songs Table - Scrollable */}
      <Show when={!error() || songs().length > 0}>
        <div class="flex-1 overflow-y-auto" ref={infiniteScroll.containerRef}>
          <div class="min-w-full">
            {/* Sticky Table Header */}
            <div class="sticky top-0 bg-black/95 backdrop-blur-sm px-6 py-3 text-xs text-gray-400 uppercase tracking-wider grid grid-cols-12 gap-4 z-10">
              <div class="col-span-1 text-center">#</div>
              <div class="col-span-5">title</div>
              <div class="col-span-2">artist</div>
              <div class="col-span-2">album</div>
              <div class="col-span-1">year</div>
              <div class="col-span-1 text-right">duration</div>
            </div>

            {/* Table Body */}
            <For each={songs()}>
              {(song, index) => (
                <div
                  class="px-6 py-3 hover:bg-magenta-600/20 transition-colors cursor-pointer grid grid-cols-12 gap-4 items-center group border border-transparent"
                  onDblClick={() => songInteractions.playSong(song)}
                  onContextMenu={(e) =>
                    songInteractions.handleRightClick(e, song)
                  }
                >
                  {/* Track Number / Play Button */}
                  <div class="col-span-1 text-center">
                    <div class="group-hover:hidden text-gray-400 text-sm">
                      {index() + 1}
                    </div>
                    <button
                      class="hidden group-hover:block text-gray-400 hover:text-magenta-400 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        songInteractions.playSong(song);
                      }}
                    >
                      <svg
                        class="w-4 h-4 mx-auto"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>

                  {/* Title */}
                  <div class="col-span-5">
                    <div class="flex items-center space-x-3">
                      {/* Album Art Placeholder */}
                      <div class="w-10 h-10 bg-fuchsia-800/30 rounded flex-shrink-0 flex items-center justify-center">
                        <svg
                          class="w-5 h-5 text-fuchsiamagenta-400"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                        </svg>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-white font-medium truncate">
                          {song.display_title}
                        </div>
                        {song.detailed_display_title !== song.display_title && (
                          <div class="text-gray-400 text-sm truncate">
                            {song.detailed_display_title}
                          </div>
                        )}
                      </div>
                      {/* Favorite indicator */}
                      <Show when={song.is_favorite}>
                        <div class="text-magenta-500">
                          <svg
                            class="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                          </svg>
                        </div>
                      </Show>
                      {/* Add to Queue Button */}
                      <button
                        class="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-magenta-400 hover:bg-magenta-600/30 rounded transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          songInteractions.queueSong(song);
                        }}
                        title="Add to queue"
                      >
                        <svg
                          class="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Artist */}
                  <div class="col-span-2">
                    <div class="text-gray-300 text-sm truncate">
                      {song.artist || "unknown artist"}
                    </div>
                  </div>

                  {/* Album */}
                  <div class="col-span-2">
                    <div class="text-gray-300 text-sm truncate">
                      {song.album || "unknown album"}
                    </div>
                  </div>

                  {/* Year */}
                  <div class="col-span-1">
                    <div class="text-gray-400 text-sm">
                      {songInteractions.formatYear(song.year)}
                    </div>
                  </div>

                  {/* Duration */}
                  <div class="col-span-1 text-right">
                    <div class="text-gray-400 text-sm">
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
    </div>
  );
}
