/* @jsxImportSource solid-js */
import { createSignal, Show, onMount, onCleanup, createEffect } from "solid-js";
import { updateSong } from "../services/indexedDBService.js";
import {
  processPlaylistCover,
  validateImageFile,
  createImageUrlFromData,
} from "../services/imageService.js";
import type { Song } from "../types/playlist.js";

interface SongEditModalProps {
  song: Song;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedSong: Song) => void;
}

export function SongEditModal(props: SongEditModalProps) {
  const [title, setTitle] = createSignal("");
  const [artist, setArtist] = createSignal("");
  const [album, setAlbum] = createSignal("");
  const [imageData, setImageData] = createSignal<ArrayBuffer | undefined>();
  const [imageType, setImageType] = createSignal<string | undefined>();
  const [imageUrl, setImageUrl] = createSignal<string | undefined>();
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Initialize form with song data when modal opens
  onMount(() => {
    if (props.isOpen && props.song) {
      setTitle(props.song.title);
      setArtist(props.song.artist || "");
      setAlbum(props.song.album || "");
      if (props.song.imageData && props.song.imageType) {
        setImageData(props.song.imageData);
        setImageType(props.song.imageType);
        const url = createImageUrlFromData(
          props.song.imageData,
          props.song.imageType
        );
        setImageUrl(url);
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
      if (result.success && result.thumbnailData) {
        // Clean up previous URL if exists
        const prevUrl = imageUrl();
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }

        setImageData(result.thumbnailData);
        setImageType(file.type);

        // Create new display URL
        const newUrl = createImageUrlFromData(result.thumbnailData, file.type);
        setImageUrl(newUrl);
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

  const handleSave = async () => {
    if (!title().trim()) {
      setError("Title is required");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const updates = {
        title: title().trim(),
        artist: artist().trim() || "Unknown Artist",
        album: album().trim() || "Unknown Album",
        imageData: imageData(),
        imageType: imageType(),
        updatedAt: Date.now(),
      };

      await updateSong(props.song.id, updates);

      const updatedSong: Song = {
        ...props.song,
        ...updates,
      };

      props.onSave(updatedSong);
      props.onClose();
    } catch (err) {
      setError("failed to save changes");
      console.error("Save error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    // Clean up any temporary URLs
    const url = imageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    setError(null);
    props.onClose();
  };

  const handleRemoveImage = () => {
    const url = imageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    setImageData(undefined);
    setImageType(undefined);
    setImageUrl(undefined);
  };

  // Handle escape key
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

  return (
    <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-900 shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto relative">
        {/* Header */}
        <div class="flex items-center justify-between p-6 border-b border-gray-700 relative">
          <h2 class="text-xl font-bold text-white font-mono">
            edit<span class="text-magenta-500">z</span>
          </h2>
          <button
            onClick={handleCancel}
            class="text-magenta-200 hover:text-magenta-500 p-1 rounded absolute top-4 right-4"
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

        {/* Content */}
        <div class="p-6 space-y-6">
          {/* Album Art */}
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-3">
              album art
            </label>
            <div class="flex items-center gap-4">
              <div class="w-20 h-20 overflow-hidden bg-gray-700 flex items-center justify-center">
                <Show
                  when={imageUrl()}
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
                    src={imageUrl()}
                    alt="Album art"
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
                  id="image-upload"
                />
                <label
                  for="image-upload"
                  class="inline-block px-4 py-2 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 text-white cursor-pointer text-sm font-medium transition-colors"
                >
                  choose image
                </label>

                <Show when={imageData()}>
                  <button
                    onClick={handleRemoveImage}
                    disabled={isLoading()}
                    class="block px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium transition-colors"
                  >
                    remove image
                  </button>
                </Show>
              </div>
            </div>
          </div>

          {/* Title */}
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              title *
            </label>
            <input
              type="text"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              disabled={isLoading()}
              class="w-full bg-gray-800 text-white px-4 py-3 border border-gray-600 focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 focus:outline-none transition-colors"
              placeholder="song title"
            />
          </div>

          {/* Artist */}
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              artist
            </label>
            <input
              type="text"
              value={artist()}
              onInput={(e) => setArtist(e.currentTarget.value)}
              disabled={isLoading()}
              class="w-full bg-gray-800 text-white px-4 py-3 border border-gray-600 focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 focus:outline-none transition-colors"
              placeholder="artist name"
            />
          </div>

          {/* Album */}
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              album
            </label>
            <input
              type="text"
              value={album()}
              onInput={(e) => setAlbum(e.currentTarget.value)}
              disabled={isLoading()}
              class="w-full bg-gray-800 text-white px-4 py-3 border border-gray-600 focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 focus:outline-none transition-colors"
              placeholder="album name"
            />
          </div>

          {/* File info */}
          <div class="bg-gray-800 p-4">
            <h3 class="text-sm font-medium text-gray-300 mb-2">
              file information
            </h3>
            <div class="text-sm text-gray-400 space-y-1">
              <div>filename: {props.song.originalFilename || "Unknown"}</div>
              <Show when={props.song.fileSize}>
                <div>
                  size:{" "}
                  {Math.round((props.song.fileSize! / 1024 / 1024) * 100) / 100}{" "}
                  mb
                </div>
              </Show>
              <div>duration: {formatDuration(props.song.duration)}</div>
            </div>
          </div>

          {/* Error message */}
          <Show when={error()}>
            <div class="bg-red-900 bg-opacity-30 border border-red-500 p-3">
              <div class="text-red-400 text-sm">{error()}</div>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="flex items-center justify-end gap-3 p-6 border-t border-gray-700">
          <button
            onClick={handleCancel}
            disabled={isLoading()}
            class="px-4 py-2 text-gray-400 hover:text-white disabled:text-gray-600 font-medium transition-colors"
          >
            cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading() || !title().trim()}
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
            {isLoading() ? "saving..." : "save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
