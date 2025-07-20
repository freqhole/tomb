/* @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";

import { createRelativeTimeSignal } from "../utils/timeUtils.js";
import type { Playlist } from "../types/playlist.js";

interface PlaylistSidebarProps {
  playlists: Playlist[];
  selectedPlaylist: Playlist | null;
  onPlaylistSelect: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
  isLoading?: boolean;
}

export function PlaylistSidebar(props: PlaylistSidebarProps) {
  const [isCreating, setIsCreating] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");

  // Filter playlists based on search
  const filteredPlaylists = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return props.playlists;

    return props.playlists.filter(
      (playlist) =>
        playlist.title.toLowerCase().includes(query) ||
        (playlist.description || "").toLowerCase().includes(query)
    );
  };

  const handleCreatePlaylist = async () => {
    if (isCreating()) return;

    setIsCreating(true);
    try {
      await props.onCreatePlaylist();
    } finally {
      setIsCreating(false);
    }
  };

  const getSongCount = (playlist: Playlist) => {
    const count = playlist.songIds?.length || 0;
    return count === 1 ? "1 song" : `${count} songs`;
  };

  return (
    <div class="w-80 bg-gray-900 bg-opacity-50 backdrop-blur-sm border-r border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div class="p-6 border-b border-gray-700">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-2xl font-bold text-white">playlistz</h1>
          <div class="text-sm text-magenta-400 font-mono">
            {props.playlists.length}
          </div>
        </div>

        {/* Search */}
        <div class="relative">
          <input
            type="text"
            placeholder="search playlists..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="w-full bg-gray-800 text-white rounded-lg px-4 py-2 pl-10 text-sm border border-gray-600 focus:border-magenta-500 focus:outline-none focus:ring-1 focus:ring-magenta-500"
          />
          <div class="absolute left-3 top-2.5 text-gray-400">
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
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* Create new playlist button */}
        <button
          onClick={handleCreatePlaylist}
          disabled={isCreating()}
          class="w-full mt-4 px-4 py-3 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
        >
          <Show
            when={!isCreating()}
            fallback={
              <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            }
          >
            <svg
              class="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v16m8-8H4"
              />
            </svg>
          </Show>
          <span>{isCreating() ? "creating..." : "new playlist"}</span>
        </button>
      </div>

      {/* Playlists list */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!props.isLoading}
          fallback={
            <div class="p-6 text-center">
              <div class="inline-block w-6 h-6 border-2 border-magenta-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p class="text-gray-400 text-sm">loading playlists...</p>
            </div>
          }
        >
          <Show
            when={filteredPlaylists().length > 0}
            fallback={
              <div class="p-6 text-center">
                <Show
                  when={searchQuery()}
                  fallback={
                    <div class="text-gray-400">
                      <div class="text-lg mb-2">no playlists yet</div>
                      <p class="text-sm">
                        create your first playlist to get started
                      </p>
                    </div>
                  }
                >
                  <div class="text-gray-400">
                    <div class="text-lg mb-2">no matches</div>
                    <p class="text-sm">try a different search term</p>
                  </div>
                </Show>
              </div>
            }
          >
            <div class="p-4 space-y-2">
              <For each={filteredPlaylists()}>
                {(playlist) => {
                  const isSelected = () =>
                    props.selectedPlaylist?.id === playlist.id;
                  const relativeTime = createRelativeTimeSignal(
                    playlist.updatedAt
                  );

                  return (
                    <button
                      onClick={() => props.onPlaylistSelect(playlist)}
                      class={`w-full text-left p-4 rounded-lg transition-all duration-200 group ${
                        isSelected()
                          ? "bg-magenta-500 bg-opacity-20 border border-magenta-500 shadow-lg"
                          : "bg-gray-800 bg-opacity-50 hover:bg-gray-700 border border-transparent hover:border-gray-600"
                      }`}
                    >
                      <div class="flex items-start justify-between">
                        <div class="flex-1 min-w-0">
                          <div
                            class={`font-medium mb-1 truncate ${
                              isSelected()
                                ? "text-white"
                                : "text-gray-200 group-hover:text-white"
                            }`}
                          >
                            {playlist.title}
                          </div>

                          <Show when={playlist.description}>
                            <div
                              class={`text-sm mb-2 line-clamp-2 ${
                                isSelected()
                                  ? "text-magenta-100"
                                  : "text-gray-400"
                              }`}
                            >
                              {playlist.description}
                            </div>
                          </Show>

                          <div class="flex items-center justify-between text-xs">
                            <span
                              class={
                                isSelected()
                                  ? "text-magenta-200"
                                  : "text-gray-500"
                              }
                            >
                              {getSongCount(playlist)}
                            </span>
                            <span
                              class={
                                isSelected()
                                  ? "text-magenta-300"
                                  : "text-gray-500"
                              }
                            >
                              {relativeTime.signal()}
                            </span>
                          </div>
                        </div>

                        <Show when={isSelected()}>
                          <div class="ml-2 flex-shrink-0">
                            <div class="w-2 h-2 bg-magenta-400 rounded-full"></div>
                          </div>
                        </Show>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* Footer with stats */}
      <div class="p-4 border-t border-gray-700 bg-gray-900 bg-opacity-30">
        <div class="text-xs text-gray-400 space-y-1">
          <div class="flex justify-between">
            <span>total playlists:</span>
            <span class="text-magenta-400 font-mono">
              {props.playlists.length}
            </span>
          </div>
          <div class="flex justify-between">
            <span>total songs:</span>
            <span class="text-magenta-400 font-mono">
              {props.playlists.reduce(
                (total, playlist) => total + (playlist.songIds?.length || 0),
                0
              )}
            </span>
          </div>
          <Show when={searchQuery()}>
            <div class="flex justify-between">
              <span>filtered:</span>
              <span class="text-magenta-400 font-mono">
                {filteredPlaylists().length}
              </span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
