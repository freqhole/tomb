/* @jsxImportSource solid-js */
import { Show } from "solid-js";

import {
  PlaylistzProvider,
  usePlaylistzManager,
  usePlaylistzState,
  usePlaylistzSongs,
  usePlaylistzUI,
  usePlaylistzDragDrop,
  usePlaylistzImageModal,
} from "../context/PlaylistzContext.js";

import { PlaylistSidebar } from "./PlaylistSidebar.js";
import { SongEditModal } from "./SongEditModal.js";
import { PlaylistCoverModal } from "./PlaylistCoverModal.js";
import { PlaylistContainer } from "./playlist/index.js";

// global fn registration for standalone mode
if (typeof window !== "undefined" && (window as any).STANDALONE_MODE) {
  // define the fn early so it's available for HTML initialization
  (window as any).initializeStandalonePlaylist = function (playlistData: any) {
    // store the data and defer to the real function when it's ready
    (window as any).DEFERRED_PLAYLIST_DATA = playlistData;
  };
}

function PlaylistzInner() {
  // Use context hooks
  const playlistManager = usePlaylistzManager();
  const playlistState = usePlaylistzState();
  const songState = usePlaylistzSongs();
  const uiState = usePlaylistzUI();
  const dragAndDrop = usePlaylistzDragDrop();
  const imageModal = usePlaylistzImageModal();

  // Extract state and functions from hooks
  const {
    playlists,
    selectedPlaylist,
    playlistSongs,
    isInitialized,
    error: managerError,
    backgroundImageUrl,
    selectPlaylist,
  } = playlistManager;

  const {
    showPlaylistCover,
    setShowPlaylistCover,
    showDeleteConfirm,
    setShowDeleteConfirm,
    handleDeletePlaylist,
  } = playlistState;

  const {
    editingSong,
    setEditingSong,
    handleSongSaved,
    error: songError,
  } = songState;

  const { isMobile, sidebarCollapsed, setSidebarCollapsed } = uiState;

  const {
    isDragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    error: dragError,
  } = dragAndDrop;

  const {
    showImageModal,
    closeImageModal,
    handleNextImage,
    handlePrevImage,
    getCurrentImageUrl,
    getImageCount,
    getCurrentImageNumber,
    hasMultipleImages,
  } = imageModal;

  // Combine errors from all hooks
  const error = () => managerError() || songError() || dragError();

  // handle file drop here i guess.
  const handleFileDrop = async (e: DragEvent) => {
    await handleDrop(e, {
      selectedPlaylist: selectedPlaylist(),
      playlists: playlists(),
      onPlaylistCreated: () => {
        // hmm, i guess playlist will be automatically added via reactive query...
      },
      onPlaylistSelected: (playlist) => {
        selectPlaylist(playlist);
      },
    });
  };

  return (
    <div
      class={`relative bg-black text-white ${isMobile() ? "min-h-screen" : "h-screen overflow-hidden"}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleFileDrop}
    >
      {/* background image cover */}
      <Show when={backgroundImageUrl()}>
        <div
          class="absolute inset-0 bg-cover bg-top bg-no-repeat transition-opacity duration-1000 ease-out"
          style={{
            "background-image": `url(${backgroundImageUrl()})`,
            filter: "blur(3px) contrast(3) brightness(0.4)",
            "z-index": "0",
          }}
        />
        <div class="absolute inset-0 bg-black/20" style={{ "z-index": "1" }} />
      </Show>

      {/* background pattern (when no song playing) */}
      <Show when={!backgroundImageUrl()}>
        <div
          class="absolute inset-0 opacity-5"
          style={{
            "background-image":
              "radial-gradient(circle at 25% 25%, #ff00ff 2px, transparent 2px)",
            "background-size": "50px 50px",
            "z-index": "0",
          }}
        />
      </Show>

      {/* main app content */}
      <Show
        when={isInitialized()}
        fallback={
          <div class="flex items-center justify-center h-full">
            <div class="text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8"></div>
              <p class="text-lg">loading playlistz...</p>
            </div>
          </div>
        }
      >
        {/* main content wrapper with sidebar layout */}
        <div
          class={`relative flex ${isMobile() ? "min-h-screen" : "h-full"}`}
          style={{ "z-index": "2" }}
        >
          {/* left side nav */}
          <div
            class={`transition-all duration-300 ease-out ${isMobile() ? "" : "overflow-hidden"} ${
              sidebarCollapsed()
                ? "w-0 opacity-0"
                : isMobile()
                  ? "w-full opacity-100"
                  : "w-80 opacity-100"
            }`}
          >
            <div
              class={`${isMobile() ? "w-full" : "w-80"} h-full transform transition-transform duration-300 ease-out ${
                sidebarCollapsed() ? "-translate-x-full" : "translate-x-0"
              }`}
            >
              <PlaylistSidebar />
            </div>
          </div>

          {/* main playlist content */}
          <div
            class={`${isMobile() && !sidebarCollapsed() ? "hidden" : "flex-1"} flex flex-col ${isMobile() ? "" : "h-full"}`}
          >
            <Show when={selectedPlaylist()}>
              {(playlist) => <PlaylistContainer playlist={playlist} />}
            </Show>
          </div>
        </div>
      </Show>

      {/* sidebar toggle button */}
      <div
        class={`fixed top-0 inset-0 bg-black bg-opacity-80 flex items-center justify-center z-10 transition-all duration-300 ease-in-out w-10 h-10 ${sidebarCollapsed() ? "left-0" : isMobile() ? "left-[calc(100vw-40px)]" : "left-72"}`}
      >
        <button
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          class="p-2 text-magenta-200 hover:text-magenta-500 hover:bg-gray-800 transition-colors bg-black bg-opacity-80"
          title={`${sidebarCollapsed() ? "show" : "hide"} playlist sidebar`}
        >
          <svg
            class={`w-8 h-8 transform transition-transform duration-600 ease-in-out ${sidebarCollapsed() ? "rotate-0" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* drag'n'drop overlay */}
      <Show when={isDragOver()}>
        <div class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 backdrop-blur-sm">
          <div class="text-center">
            <div class="text-4xl mb-6 font-bold">drop zone</div>
            <h2 class="text-4xl font-light mb-4 text-magenta-400">
              drop your filez here
            </h2>
            <p class="text-xl text-gray-300">
              release to add filez to{" "}
              {selectedPlaylist()?.title || "a new playlist"}
            </p>
          </div>
        </div>
      </Show>

      {/* error notifications */}
      <Show when={error()}>
        <div class="fixed bottom-4 right-4 z-50 max-w-sm">
          <div class="bg-red-900 bg-opacity-90 border border-red-500 p-4 shadow-lg">
            <div class="text-red-200 text-sm">{error()}</div>
          </div>
        </div>
      </Show>

      {/* delete confirmation modal */}
      <Show when={showDeleteConfirm()}>
        <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div class="bg-gray-900 border border-gray-600 p-6 max-w-md w-full mx-4">
            <h3 class="text-lg font-semibold text-white mb-4">
              delete playlist?
            </h3>
            <p class="text-gray-300 mb-6">
              are you sure you want to delete "{selectedPlaylist()?.title}"?
              this action cannot be undone.
            </p>
            <div class="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                class="px-4 py-2 text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleDeletePlaylist}
                class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              >
                delete
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* song edit modal */}
      <Show when={editingSong()}>
        <SongEditModal
          song={editingSong()!}
          isOpen={!!editingSong()}
          onClose={() => setEditingSong(null)}
          onSave={handleSongSaved}
        />
      </Show>

      {/* playlist cover modal */}
      <Show when={showPlaylistCover()}>
        <PlaylistCoverModal
          playlist={selectedPlaylist()!}
          playlistSongs={playlistSongs()}
          isOpen={showPlaylistCover()}
          onClose={() => setShowPlaylistCover(false)}
          onSave={selectPlaylist}
          onDelete={handleDeletePlaylist}
        />
      </Show>

      {/* image modal */}
      <Show when={showImageModal()}>
        <div class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
          <button
            onClick={closeImageModal}
            class="absolute top-4 right-4 text-white hover:text-magenta-400 transition-colors z-10 p-2 bg-black bg-opacity-50 rounded"
            title="close (esc)"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <Show when={getCurrentImageUrl()}>
            <div class="relative w-full h-full flex items-center justify-center p-4">
              <img
                src={getCurrentImageUrl()!}
                alt="playlist image"
                class="max-w-full max-h-full object-contain"
              />

              {/* navigation arrows */}
              <Show when={hasMultipleImages()}>
                <button
                  onClick={handlePrevImage}
                  class="absolute left-4 top-1/2 transform -translate-y-1/2 text-white hover:text-magenta-400 transition-colors p-2 bg-black bg-opacity-50 rounded"
                  title="previous image (←)"
                >
                  <svg
                    class="w-8 h-8"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
                <button
                  onClick={handleNextImage}
                  class="absolute right-4 top-1/2 transform -translate-y-1/2 text-white hover:text-magenta-400 transition-colors p-2 bg-black bg-opacity-50 rounded"
                  title="next image (→)"
                >
                  <svg
                    class="w-8 h-8"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
                {currentImage.title} {/* image counter */}
                <div class="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white bg-black bg-opacity-50 px-3 py-1 rounded">
                  {getCurrentImageNumber()} / {getImageCount()}
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function Playlistz() {
  return (
    <PlaylistzProvider>
      <PlaylistzInner />
    </PlaylistzProvider>
  );
}
