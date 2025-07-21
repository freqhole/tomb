/* @jsxImportSource solid-js */
import { createSignal, Show, onMount } from "solid-js";
import { updateSong } from "../services/indexedDBService.js";
import {
  processPlaylistCover,
  validateImageFile,
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
  const [image, setImage] = createSignal<string | undefined>();
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Initialize form with song data when modal opens
  onMount(() => {
    if (props.isOpen && props.song) {
      setTitle(props.song.title);
      setArtist(props.song.artist || "");
      setAlbum(props.song.album || "");
      setImage(props.song.image);
    }
  });

  const handleImageUpload = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || "Invalid image file");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await processPlaylistCover(file);
      if (result.success && result.thumbnailUrl) {
        setImage(result.thumbnailUrl);
      } else {
        setError(result.error || "Failed to process image");
      }
    } catch (err) {
      setError("Error uploading image");
      console.error("Image upload error:", err);
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
        image: image(),
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
      setError("Failed to save changes");
      console.error("Save error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    props.onClose();
  };

  const handleRemoveImage = () => {
    setImage(undefined);
  };

  if (!props.isOpen) return null;

  return (
    <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-900 rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div class="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 class="text-xl font-bold text-white">Edit Song</h2>
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

        {/* Content */}
        <div class="p-6 space-y-6">
          {/* Album Art */}
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-3">
              album art
            </label>
            <div class="flex items-center gap-4">
              <div class="w-20 h-20 rounded-lg overflow-hidden bg-gray-700 flex items-center justify-center">
                <Show
                  when={image()}
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
                    src={image()}
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
                  class="inline-block px-4 py-2 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 text-white rounded-lg cursor-pointer text-sm font-medium transition-colors"
                >
                  choose image
                </label>

                <Show when={image()}>
                  <button
                    onClick={handleRemoveImage}
                    disabled={isLoading()}
                    class="block px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg text-sm font-medium transition-colors"
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
              class="w-full bg-gray-800 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 focus:outline-none transition-colors"
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
              class="w-full bg-gray-800 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 focus:outline-none transition-colors"
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
              class="w-full bg-gray-800 text-white rounded-lg px-4 py-3 border border-gray-600 focus:border-magenta-500 focus:ring-1 focus:ring-magenta-500 focus:outline-none transition-colors"
              placeholder="album name"
            />
          </div>

          {/* File info */}
          <div class="bg-gray-800 rounded-lg p-4">
            <h3 class="text-sm font-medium text-gray-300 mb-2">
              file information
            </h3>
            <div class="text-sm text-gray-400 space-y-1">
              <div>filename: {props.song.file.name}</div>
              <div>
                size:{" "}
                {Math.round((props.song.file.size / 1024 / 1024) * 100) / 100}{" "}
                mb
              </div>
              <div>duration: {formatDuration(props.song.duration)}</div>
            </div>
          </div>

          {/* Error message */}
          <Show when={error()}>
            <div class="bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-3">
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
            class="px-6 py-2 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
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
