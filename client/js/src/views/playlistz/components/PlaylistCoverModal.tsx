/* @jsxImportSource solid-js */
import { createSignal, Show, onMount, onCleanup, createEffect } from "solid-js";
import {
  updatePlaylist,
  deletePlaylist,
} from "../services/indexedDBService.js";
import {
  processPlaylistCover,
  validateImageFile,
  createImageUrlFromData,
} from "../services/imageService.js";
import { downloadPlaylistAsZip } from "../services/playlistDownloadService.js";
import type { Playlist, Song } from "../types/playlist.js";

interface PlaylistCoverModalProps {
  playlist: Playlist;
  playlistSongs: Song[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedPlaylist: Playlist) => void;
  onDelete?: () => void;
}

export function PlaylistCoverModal(props: PlaylistCoverModalProps) {
  const [selectedImageData, setSelectedImageData] = createSignal<
    ArrayBuffer | undefined
  >();
  const [selectedThumbnailData, setSelectedThumbnailData] = createSignal<
    ArrayBuffer | undefined
  >();
  const [selectedImageType, setSelectedImageType] = createSignal<
    string | undefined
  >();
  const [selectedImageUrl, setSelectedImageUrl] = createSignal<
    string | undefined
  >();
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);

  onMount(() => {
    if (props.isOpen && props.playlist) {
      if (props.playlist.imageData && props.playlist.imageType) {
        setSelectedImageData(props.playlist.imageData);
        setSelectedThumbnailData(props.playlist.thumbnailData);
        setSelectedImageType(props.playlist.imageType);
        // temporary display URL using thumbnail if available, otherwise full size
        const displayData =
          props.playlist.thumbnailData || props.playlist.imageData;
        const url = createImageUrlFromData(
          displayData,
          props.playlist.imageType
        );
        setSelectedImageUrl(url);
      }
    }
  });

  const handleImageUpload = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || "invalid image file");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await processPlaylistCover(file);

      if (result.success && result.thumbnailData && result.imageData) {
        // trash previous URL if exists
        const prevUrl = selectedImageUrl();
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }

        setSelectedImageData(result.imageData);
        setSelectedThumbnailData(result.thumbnailData);
        setSelectedImageType(file.type);

        const newUrl = createImageUrlFromData(result.thumbnailData, file.type);

        setSelectedImageUrl(newUrl);
      } else {
        setError(result.error || "failed to process image");
      }
    } catch (err) {
      setError("error uploading image");
      console.error("image upload error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadPlaylist = async () => {
    setIsDownloading(true);
    try {
      await downloadPlaylistAsZip(props.playlist, {
        includeMetadata: true,
        includeImages: true,
        generateM3U: true,
        includeHTML: true,
      });
    } catch (err) {
      setError("failed to download playlist");
      console.error("download error:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDeletePlaylist = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await deletePlaylist(props.playlist.id);
      setShowDeleteConfirm(false);
      props.onDelete?.();
      props.onClose();
    } catch (err) {
      setError("failed to delete playlist");
      console.error("delete error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const updates = {
        imageData: selectedImageData(),
        thumbnailData: selectedThumbnailData(),
        imageType: selectedImageType(),
        updatedAt: Date.now(),
      };

      await updatePlaylist(props.playlist.id, updates);

      // create updated playlist object, removing old image property if it exists
      const { image, ...playlistWithoutOldImage } = props.playlist as any;
      const updatedPlaylist: Playlist = {
        ...playlistWithoutOldImage,
        ...updates,
      };

      props.onSave(updatedPlaylist);
      props.onClose();
    } catch (err) {
      setError("failed to save");
      console.error("save error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    // trash any temporary URLs
    const url = selectedImageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    setError(null);
    setShowDeleteConfirm(false);
    props.onClose();
  };

  const handleRemoveImage = () => {
    const url = selectedImageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    setSelectedImageData(undefined);
    setSelectedThumbnailData(undefined);
    setSelectedImageType(undefined);
    setSelectedImageUrl(undefined);
  };

  createEffect(() => {
    if (props.isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          handleCancel();
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
    }
  });

  if (!props.isOpen) return null;

  const songsWithArt = props.playlistSongs.filter(
    (song) => song.imageType && (song.imageData || song.thumbnailData)
  );

  return (
    <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-900 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* header */}
        <div class="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 class="text-xl font-bold text-white font-mono">
            cover<span class="text-magenta-500">z</span>
          </h2>
          <button
            onClick={handleCancel}
            class="text-gray-400 hover:text-white p-1 rounded"
            disabled={isLoading()}
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
        </div>

        {/* content */}
        <div class="p-6 space-y-6">
          <div class="flex items-center gap-4">
            <div class="w-25 h-25 overflow-hidden bg-gray-700 flex items-center justify-center">
              <Show
                when={selectedImageUrl()}
                fallback={
                  <svg
                    class="w-8 h-8 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                    />
                  </svg>
                }
              >
                <img
                  src={selectedImageUrl()}
                  alt="playlist cover"
                  class="w-full h-full object-cover"
                />
              </Show>
            </div>

            <div class="flex-1 space-y-2">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={isLoading()}
                class="hidden"
                id="cover-upload"
              />
              <label
                for="cover-upload"
                class="block w-full px-4 py-3 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 text-white cursor-pointer text-center font-medium transition-colors"
              >
                upload image
              </label>

              <Show when={selectedImageData()}>
                <button
                  onClick={handleRemoveImage}
                  disabled={isLoading()}
                  class="block w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium transition-colors"
                >
                  remove cover image
                </button>
              </Show>
            </div>
          </div>

          {/* playlist actions */}
          <div class="space-y-3">
            {/* download playlist */}
            <Show when={window.location.protocol !== "file:"}>
              <button
                onClick={handleDownloadPlaylist}
                disabled={isDownloading() || isLoading()}
                class="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Show
                  when={!isDownloading()}
                  fallback={
                    <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
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
                {isDownloading() ? "downloading..." : "download playlist"}
              </button>
            </Show>
          </div>

          {/* playlist info */}
          <div class="bg-gray-800 p-4">
            <h3 class="text-sm font-medium text-gray-300 mb-2">
              playlist information
            </h3>
            <div class="text-sm text-gray-400 space-y-1">
              <div>title: {props.playlist.title}</div>
              <div>id: {props.playlist.id}</div>
              <div>rev: {props.playlist.rev || 0}</div>
              <div>songz: {props.playlist.songIds.length}</div>
              <div>with album art: {songsWithArt.length}</div>
            </div>
          </div>

          {/* songz with album art preview */}
          <Show when={songsWithArt.length > 0}>
            <div>
              <div class="grid grid-cols-4 gap-3">
                {songsWithArt.map((song) => (
                  <button
                    onClick={() => {
                      // #TODO: this needz to be updated to work with ArrayBuffer data
                      // setError(
                      //   "selecting from song imagez not yet implemented with new image storage"
                      // );
                    }}
                    disabled={isLoading()}
                    class="aspect-square overflow-hidden bg-gray-700" //hover:ring-2 hover:ring-magenta-500 transition-all
                    title={`${song.title} - ${song.artist}`}
                  >
                    <Show
                      when={
                        song.imageType && (song.imageData || song.thumbnailData)
                      }
                      fallback={
                        <div class="w-full h-full flex items-center justify-center">
                          <svg
                            class="w-6 h-6 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                            />
                          </svg>
                        </div>
                      }
                    >
                      <img
                        src={createImageUrlFromData(
                          song.thumbnailData || song.imageData!,
                          song.imageType!
                        )}
                        alt={song.title}
                        class="w-full h-full object-cover"
                      />
                    </Show>
                  </button>
                ))}
              </div>
            </div>
          </Show>

          {/* delete playlist */}
          <div class="space-y-3">
            <Show
              when={!showDeleteConfirm()}
              fallback={
                <div class="bg-red-900 bg-opacity-30 border border-red-500 p-4 space-y-3">
                  <p class="text-white text-sm">
                    are you sure you want to delete this playlist? this action
                    cannot be undone.
                  </p>
                  <div class="flex gap-2">
                    <button
                      onClick={handleDeletePlaylist}
                      disabled={isLoading()}
                      class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium transition-colors"
                    >
                      yes, delete
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isLoading()}
                      class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white font-medium transition-colors"
                    >
                      cancel
                    </button>
                  </div>
                </div>
              }
            >
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isLoading()}
                class="w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium transition-colors flex items-center justify-center gap-2"
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
                delete playlist
              </button>
            </Show>
          </div>

          {/* error message */}
          <Show when={error()}>
            <div class="bg-red-900 bg-opacity-30 border border-red-500 p-3">
              <div class="text-red-400 text-sm">{error()}</div>
            </div>
          </Show>
        </div>

        {/* footer */}
        <div class="flex items-center justify-end gap-3 p-6 border-t border-gray-700 sticky bottom-0 z-10 bg-gray-900">
          <button
            onClick={handleCancel}
            disabled={isLoading() || isDownloading()}
            class="px-4 py-2 text-gray-400 hover:text-white disabled:text-gray-600 font-medium transition-colors"
          >
            close
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading() || isDownloading()}
            class="px-6 py-2 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 text-white font-medium transition-colors flex items-center gap-2"
          >
            <Show
              when={!isLoading()}
              fallback={
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </Show>
            {isLoading() ? "saving..." : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}
