import { Accessor, Show, For } from "solid-js";
import type { Playlist } from "../../types/playlist.js";
import { usePlaylistState } from "../../hooks/usePlaylistState.js";
import { useSongState } from "../../hooks/useSongState.js";
import { useUIState } from "../../hooks/useUIState.js";
import { getImageUrlForContext } from "../../services/imageService.js";
import { AudioPlayer } from "../AudioPlayer.js";
import { SongRow } from "../SongRow.js";

export function PlaylistContainer(props: {
  playlist: Accessor<Playlist>;
  onOpenImageModal?: (startIndex?: number) => void;
}) {
  const { playlist } = props;

  // Initialize hooks
  const playlistState = usePlaylistState(playlist());
  const songState = useSongState();
  const uiState = useUIState();

  // Extract needed state and functions
  const {
    playlistSongs,
    setShowPlaylistCover,
    setShowDeleteConfirm,
    isDownloading,
    isCaching,
    allSongsCached,
    handlePlaylistUpdate,
    handleDownloadPlaylist,
    handleCachePlaylist,
    handleRemoveSong,
    handleReorderSongs,
  } = playlistState;

  const { handleEditSong, handlePlaySong, handlePauseSong } = songState;

  const { isMobile } = uiState;

  return (
    <div class={`flex-1 flex flex-col ${isMobile() ? "p-2" : "h-full p-6"}`}>
      {/* Playlist Header */}
      <div
        class={`flex items-center justify-between ${isMobile() ? "p-2 flex-col" : "mb-2 p-6"}`}
      >
        {/* playlist cover image for mobile */}
        <div class={`${isMobile() ? "" : "hidden"}`}>
          <button
            onClick={() => {
              props.onOpenImageModal?.(0);
            }}
            class="w-full h-full overflow-hidden hover:bg-gray-900 flex items-center justify-center transition-colors group"
            title="view playlist images"
          >
            <Show
              when={playlist().imageType}
              fallback={
                <div class="text-center">
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
                const imageUrl = getImageUrlForContext(playlist(), "modal");
                return imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="playlist cover"
                    class="w-full h-full object-cover"
                  />
                ) : (
                  <div class="text-center">
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
          </button>
        </div>

        <div class="flex items-center gap-4 w-full">
          <div class="flex-1">
            <div class={`bg-black bg-opacity-80`}>
              <input
                type="text"
                value={playlist().title}
                onInput={(e) => {
                  handlePlaylistUpdate({
                    title: e.currentTarget.value,
                  });
                }}
                class="text-3xl font-bold text-white bg-transparent border-none outline-none focus:bg-gray-800 px-2 py-1 rounded w-full"
                placeholder="playlist title"
              />
            </div>
            <div class={`bg-black bg-opacity-80`}>
              <input
                type="text"
                value={playlist().description || ""}
                placeholder="add description..."
                onInput={(e) => {
                  handlePlaylistUpdate({
                    description: e.currentTarget.value,
                  });
                }}
                class="text-white bg-transparent border-none focus:bg-gray-800 px-2 py-1 rounded w-full"
              />
            </div>

            {/* 2x2 grid layout with AudioPlayer spanning left side */}
            <div
              class="grid gap-3"
              style="grid-template-columns: auto 1fr; grid-template-areas: 'player info' 'player buttons';"
            >
              {/* AudioPlayer spans 2 rows on the left */}
              <div
                class="flex items-center justify-center"
                style="grid-area: player;"
              >
                <AudioPlayer playlist={playlist()} size="w-12 h-12" />
              </div>

              {/* Top right: song info */}
              <div
                id="song-info"
                class="flex items-center justify-end text-sm gap-0"
                style="grid-area: info;"
              >
                <span class="bg-black bg-opacity-80 p-2">
                  {playlist().songIds?.length || 0} song
                  {(playlist().songIds?.length || 0) !== 1 ? "z" : ""}
                </span>
                <span class="bg-black bg-opacity-80 p-2">
                  {(() => {
                    const totalSeconds = playlistSongs().reduce(
                      (total, song) => total + (song.duration || 0),
                      0
                    );
                    const hours = Math.floor(totalSeconds / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = Math.floor(totalSeconds % 60);
                    return hours > 0
                      ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
                      : `${minutes}:${seconds.toString().padStart(2, "0")}`;
                  })()}
                </span>
              </div>

              {/* Bottom right: action buttons */}
              <div
                class="flex items-center justify-end gap-2"
                style="grid-area: buttons;"
              >
                {/* save offline button */}
                <Show
                  when={
                    (window as any).STANDALONE_MODE &&
                    window.location.protocol !== "file:"
                  }
                >
                  <Show when={!allSongsCached()}>
                    <button
                      onClick={handleCachePlaylist}
                      disabled={isCaching() || playlistSongs().length === 0}
                      class="p-2 text-gray-400 hover:text-magenta-400 hover:bg-gray-700 transition-colors bg-black bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="download songz for offline use"
                    >
                      <Show
                        when={!isCaching()}
                        fallback={
                          <svg
                            class="w-4 h-4 animate-spin"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        }
                      >
                        SAVE OFFLINE
                      </Show>
                    </button>
                  </Show>
                </Show>

                {/* edit playlist image button */}
                <button
                  onClick={() => setShowPlaylistCover(true)}
                  class="p-2 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors bg-black bg-opacity-80"
                  title="change playlist cover"
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
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </button>

                {/* download playlist .zip button */}
                <Show when={window.location.protocol !== "file:"}>
                  <button
                    onClick={handleDownloadPlaylist}
                    disabled={isDownloading()}
                    class="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-700 transition-colors bg-black bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="download playlist as zip"
                  >
                    <Show
                      when={!isDownloading()}
                      fallback={
                        <svg
                          class="w-4 h-4 animate-spin"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                      }
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
                          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    </Show>
                  </button>
                </Show>

                {/* delete playlist button */}
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  class="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors bg-black bg-opacity-80"
                  title="delete playlist"
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
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* playlist cover image */}
        <div class={`${isMobile() ? "hidden" : "ml-4"}`}>
          <button
            onClick={() => {
              props.onOpenImageModal?.(0);
            }}
            class="w-39 h-39 overflow-hidden hover:bg-gray-900 flex items-center justify-center transition-colors group"
            style="filter: blur(3px) contrast(3) brightness(0.4);"
            onMouseEnter={(e) => (e.currentTarget.style.filter = "none")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.filter =
                "blur(3px) contrast(3) brightness(0.4)")
            }
            title="view playlist imagez"
          >
            <Show
              when={playlist().imageType}
              fallback={
                <div class="text-center">
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
                const imageUrl = getImageUrlForContext(playlist(), "modal");
                return imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="playlist cover"
                    class="w-full h-full object-cover"
                  />
                ) : (
                  <div class="text-center">
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
          </button>
        </div>
      </div>

      {/* songz list */}
      <div class={`${isMobile() ? "flex-1" : "flex-1 overflow-y-auto"}`}>
        <div class={`${isMobile() ? "space-y-1" : "p-6 space-y-2"}`}>
          <Show
            when={playlist().songIds && playlist().songIds.length > 0}
            fallback={
              <div class="text-center py-16">
                <div class="text-gray-400 text-xl mb-4">no songz yet</div>
                <p class="text-gray-400 mb-4">
                  drag and drop audio filez (or a .zip file!) here to add them
                  to this playlist
                </p>
                <div class="text-xs text-gray-500 space-y-1">
                  <div>playlist id: {playlist().id}</div>
                  <div>supported formatz: mp3, wav, flac, aiff, ogg, mp4</div>
                </div>
              </div>
            }
          >
            <For each={playlist().songIds}>
              {(songId, index) => (
                <SongRow
                  songId={songId}
                  index={index()}
                  showRemoveButton={true}
                  onRemove={handleRemoveSong}
                  onPlay={handlePlaySong}
                  onPause={handlePauseSong}
                  onEdit={handleEditSong}
                  onReorder={handleReorderSongs}
                />
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}
