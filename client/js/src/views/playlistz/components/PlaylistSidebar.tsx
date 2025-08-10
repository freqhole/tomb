/* @jsxImportSource solid-js */
import { createSignal, onMount, For, Show } from "solid-js";

import { createRelativeTimeSignal } from "../utils/timeUtils.js";
import { getImageUrlForContext } from "../services/imageService.js";
import {
  getStorageInfo,
  persistentStorageGranted,
} from "../services/offlineService.js";
import type { Playlist } from "../types/playlist.js";

interface PlaylistSidebarProps {
  playlists: Playlist[];
  selectedPlaylist: Playlist | null;
  onPlaylistSelect: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
  isLoading?: boolean;
  onCollapse?: () => void;
  collapsed?: boolean;
  isMobile?: boolean;
}

export function PlaylistSidebar(props: PlaylistSidebarProps) {
  const [isCreating, setIsCreating] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [storageInfo, setStorageInfo] = createSignal<any>({});

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

  // Update storage info periodically
  onMount(async () => {
    const updateStorageInfo = async () => {
      const info = await getStorageInfo();
      setStorageInfo(info);
    };

    // Initial load
    await updateStorageInfo();

    // Update every 30 seconds
    const interval = setInterval(updateStorageInfo, 30000);

    // Cleanup
    return () => clearInterval(interval);
  });

  return (
    <div
      class={`${props.isMobile ? "w-full" : "w-80"} bg-black/50 backdrop-blur-sm flex flex-col h-full`}
    >
      {/* Header */}
      <div class={`p-6 ${props.isMobile ? "text-center" : ""}`}>
        <div class="flex items-center justify-between mb-4">
          <h1
            class={`text-2xl font-mono font-stretch-expanded font-bold text-white ${props.isMobile ? "text-3xl" : ""}`}
          >
            playlist<span class="text-magenta-500">z</span>
          </h1>
          <div class="flex items-center gap-2">
            <div class="text-sm text-magenta-400 font-mono">&nbsp;</div>
          </div>
        </div>

        {/* Search */}
        <div class="relative">
          <input
            type="text"
            placeholder="search..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="w-full bg-black text-white px-4 py-2 pl-10 text-sm border border-magenta-200 focus:border-magenta-500 focus:outline-none focus:ring-1 focus:ring-magenta-500"
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
          class="w-full mt-4 px-4 py-3 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 disabled:cursor-not-allowed text-white transition-colors font-medium flex items-center justify-center gap-2"
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
              <p class="text-gray-400 text-sm">loading playlistz...</p>
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
                      <div class="text-lg mb-2">no playlistz yet</div>
                      <p class="text-sm">
                        create your first playlist (if u want)
                      </p>
                    </div>
                  }
                >
                  <div class="text-gray-400">
                    <div class="text-lg mb-2">no matchez</div>
                    <p class="text-sm">...try a different search?</p>
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
                      class={`w-full text-left p-4 transition-all duration-500 group ${
                        isSelected()
                          ? "bg-magenta-500 bg-opacity-20 shadow-lg"
                          : "bg-black bg-opacity-50 hover:bg-magenta-500"
                      }`}
                    >
                      <div class="flex items-start gap-3">
                        {/* Playlist thumbnail */}
                        <div class="flex-shrink-0 w-12 h-12 overflow-hidden bg-transparent">
                          <Show
                            when={playlist.imageType}
                            fallback={
                              <div class="w-full h-full flex items-center justify-center">
                                <svg
                                  width="100"
                                  height="100"
                                  viewBox="0 0 100 100"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M50 81L25 31L75 31L60.7222 68.1429L50 81Z"
                                    fill="#FF00FF"
                                  />
                                </svg>
                              </div>
                            }
                          >
                            {(() => {
                              const imageUrl = getImageUrlForContext(
                                playlist,
                                "thumbnail"
                              );
                              return imageUrl ? (
                                <img
                                  src={imageUrl}
                                  alt={playlist.title}
                                  class="w-full h-full object-cover"
                                />
                              ) : (
                                <div class="w-full h-full flex items-center justify-center">
                                  <svg
                                    width="100"
                                    height="100"
                                    viewBox="0 0 100 100"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path
                                      d="M50 81L25 31L75 31L60.7222 68.1429L50 81Z"
                                      fill="#FF00FF"
                                    />
                                  </svg>
                                </div>
                              );
                            })()}
                          </Show>
                        </div>

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
                                  : "text-gray-400 group-hover:text-white"
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
                                  : "text-gray-500 group-hover:text-white"
                              }
                            >
                              {getSongCount(playlist)}
                            </span>
                            <span
                              class={
                                isSelected()
                                  ? "text-magenta-300"
                                  : "text-gray-500 group-hover:text-white"
                              }
                            >
                              {relativeTime.signal()}
                            </span>
                          </div>
                        </div>
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
      <div class="p-4 bg-gray-900 bg-opacity-30">
        <div class="text-xs text-gray-400 space-y-1">
          {/* First row: playlists, songs */}
          <Show when={!searchQuery()}>
            <div
              class={`grid gap-2 ${
                persistentStorageGranted() &&
                storageInfo().usageFormatted &&
                !searchQuery()
                  ? "grid-cols-3"
                  : "grid-cols-2"
              }`}
            >
              <div class="text-center">
                <div class="text-magenta-400 font-mono font-semibold">
                  {props.playlists.length}
                </div>
                <div>playlistz</div>
              </div>
              <div class="text-center">
                <div class="text-magenta-400 font-mono font-semibold">
                  {props.playlists.reduce(
                    (total, playlist) =>
                      total + (playlist.songIds?.length || 0),
                    0
                  )}
                </div>
                <div>songz</div>
              </div>
              <Show
                when={
                  persistentStorageGranted() && storageInfo().usageFormatted
                }
              >
                <div class="text-center">
                  <div class="text-magenta-400 font-mono font-semibold text-[10px]">
                    {storageInfo().usagePercent}%
                  </div>
                  <div>storage</div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Second row: storage details or search results */}
          <Show
            when={searchQuery()}
            fallback={
              <Show
                when={
                  persistentStorageGranted() && storageInfo().usageFormatted
                }
              >
                <div class="text-center text-[10px] text-gray-500">
                  {storageInfo().usageFormatted} /{" "}
                  {storageInfo().quotaFormatted}
                </div>
              </Show>
            }
          >
            <div class="text-center text-[10px] text-gray-500">
              {filteredPlaylists().length} filtered
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
