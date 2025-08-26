/* @jsxImportSource solid-js */
import { createSignal, onMount, For, Show } from "solid-js";

import { createRelativeTimeSignal } from "../utils/timeUtils.js";
import { getImageUrlForContext } from "../services/imageService.js";
import {
  getStorageInfo,
  persistentStorageGranted,
} from "../services/offlineService.js";
import type { Playlist } from "../types/playlist.js";
import {
  usePlaylistzManager,
  usePlaylistzUI,
} from "../context/PlaylistzContext.js";

export function PlaylistSidebar() {
  const [isCreating, setIsCreating] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [storageInfo, setStorageInfo] = createSignal<any>({});

  const playlistManager = usePlaylistzManager();
  const uiState = usePlaylistzUI();

  const {
    playlists,
    selectedPlaylist,
    createNewPlaylist,
    selectPlaylist,
    isInitialized,
  } = playlistManager;

  const { isMobile, setSidebarCollapsed } = uiState;

  const filteredPlaylists = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return playlists();

    return playlists().filter(
      (playlist) =>
        playlist.title.toLowerCase().includes(query) ||
        (playlist.description || "").toLowerCase().includes(query)
    );
  };

  const handleCreatePlaylist = async () => {
    if (isCreating()) return;

    setIsCreating(true);
    try {
      const newPlaylist = await createNewPlaylist("New Playlist");
      if (newPlaylist) {
        selectPlaylist(newPlaylist);
        // auto-collapse on mobile when playlist is selected
        if (isMobile()) {
          setSidebarCollapsed(true);
        }
      }
    } finally {
      setIsCreating(false);
    }
  };

  const getSongCount = (playlist: Playlist) => {
    const count = playlist.songIds?.length || 0;
    return count === 1 ? "1 song" : `${count} songz`;
  };

  // update storage info periodically
  onMount(async () => {
    const updateStorageInfo = async () => {
      const info = await getStorageInfo();
      setStorageInfo(info);
    };

    // once on initial load
    await updateStorageInfo();

    // update every 30 secondz
    const interval = setInterval(updateStorageInfo, 30000);

    return () => clearInterval(interval);
  });

  return (
    <div
      class={`${isMobile() ? "w-full" : "w-80"} bg-black/50 backdrop-blur-sm flex flex-col h-full`}
    >
      {/* header */}
      <div class={`p-6 ${isMobile() ? "text-center" : ""}`}>
        <div class="flex items-center justify-between mb-4">
          <h1
            class={`text-2xl font-mono font-stretch-expanded font-bold text-white ${isMobile() ? "text-3xl" : ""}`}
          >
            playlist<span class="text-magenta-500">z</span>
          </h1>
          <div class="flex items-center gap-2">
            <div class="text-sm text-magenta-400 font-mono">&nbsp;</div>
          </div>
        </div>

        {/* search only if more than 10 playlistz */}
        <Show when={playlists().length > 10}>
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
        </Show>

        {/* new playlist button */}
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

      {/* playlistz list */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={isInitialized()}
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
                    selectedPlaylist()?.id === playlist.id;
                  const relativeTime = createRelativeTimeSignal(
                    playlist.updatedAt
                  );

                  return (
                    <button
                      onClick={() => {
                        selectPlaylist(playlist);
                        // auto-collapse on mobile when playlist is selected
                        if (isMobile()) {
                          setSidebarCollapsed(true);
                        }
                      }}
                      class={`w-full text-left p-4 transition-all duration-500 group ${
                        isSelected()
                          ? "bg-magenta-500 bg-opacity-20 shadow-lg"
                          : "bg-black bg-opacity-50 hover:bg-magenta-500"
                      }`}
                    >
                      <div class="flex items-start gap-3">
                        {/* playlist thumbnail */}
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

      {/* footer with statz */}
      <div class="p-4 bg-gray-900 bg-opacity-30">
        <div class="text-xs text-gray-400 space-y-1">
          {/* first row: playlistz, songz */}
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
                  {playlists().length}
                </div>
                <div>playlistz</div>
              </div>
              <div class="text-center">
                <div class="text-magenta-400 font-mono font-semibold">
                  {playlists().reduce(
                    (total: number, playlist: Playlist) =>
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

          {/* second row: storage detailz or search resultz count */}
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
