/* @jsxImportSource solid-js */
import { createSignal, Show, onMount } from "solid-js";
import { updatePlaylist } from "../services/indexedDBService.js";
import {
  processPlaylistCover,
  validateImageFile,
  createImageUrlFromData,
} from "../services/imageService.js";
import type { Playlist, Song } from "../types/playlist.js";

interface PlaylistCoverModalProps {
  playlist: Playlist;
  playlistSongs: Song[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedPlaylist: Playlist) => void;
}

export function PlaylistCoverModal(props: PlaylistCoverModalProps) {
  const [selectedImageData, setSelectedImageData] = createSignal<
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

  // Initialize form with playlist data when modal opens
  onMount(() => {
    if (props.isOpen && props.playlist) {
      if (props.playlist.imageData && props.playlist.imageType) {
        setSelectedImageData(props.playlist.imageData);
        setSelectedImageType(props.playlist.imageType);
        // Create temporary display URL
        const url = createImageUrlFromData(
          props.playlist.imageData,
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
      setError(validation.error || "Invalid image file");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      console.log(`🖼️ [DEBUG] PlaylistCoverModal - processing file:`, file);

      const result = await processPlaylistCover(file);
      console.log(`🖼️ [DEBUG] PlaylistCoverModal - process result:`, result);

      if (result.success && result.thumbnailData) {
        console.log(
          `🖼️ [DEBUG] PlaylistCoverModal - thumbnailData size:`,
          result.thumbnailData.byteLength
        );

        // Clean up previous URL if exists
        const prevUrl = selectedImageUrl();
        if (prevUrl) {
          URL.revokeObjectURL(prevUrl);
        }

        setSelectedImageData(result.thumbnailData);
        setSelectedImageType(file.type);

        // Create new display URL
        const newUrl = createImageUrlFromData(result.thumbnailData, file.type);
        console.log(
          `🖼️ [DEBUG] PlaylistCoverModal - created display URL:`,
          newUrl
        );
        setSelectedImageUrl(newUrl);
      } else {
        console.log(
          `🖼️ [DEBUG] PlaylistCoverModal - process failed:`,
          result.error
        );
        setError(result.error || "Failed to process image");
      }
    } catch (err) {
      setError("Error uploading image");
      console.error("Image upload error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseFromSongs = () => {
    // For now, just show error since we need to update this to work with ArrayBuffer data
    // This would need to be updated to work with the new image data format
    setError(
      "Using album art from songs not yet implemented with new image storage"
    );
  };

  const handleSave = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const updates = {
        imageData: selectedImageData(),
        imageType: selectedImageType(),
        updatedAt: Date.now(),
      };

      console.log(`🖼️ [DEBUG] PlaylistCoverModal - saving updates:`, updates);
      console.log(
        `🖼️ [DEBUG] PlaylistCoverModal - imageData size:`,
        updates.imageData?.byteLength
      );
      console.log(
        `🖼️ [DEBUG] PlaylistCoverModal - imageType:`,
        updates.imageType
      );

      await updatePlaylist(props.playlist.id, updates);

      // Create updated playlist object, removing old image property if it exists
      const { image, ...playlistWithoutOldImage } = props.playlist as any;
      const updatedPlaylist: Playlist = {
        ...playlistWithoutOldImage,
        ...updates,
      };

      console.log(
        `🖼️ [DEBUG] PlaylistCoverModal - updatedPlaylist:`,
        updatedPlaylist
      );

      props.onSave(updatedPlaylist);
      props.onClose();
    } catch (err) {
      setError("Failed to save changes");
      console.error("Save error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    // Clean up any temporary URLs
    const url = selectedImageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    setError(null);
    props.onClose();
  };

  const handleRemoveImage = () => {
    const url = selectedImageUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    setSelectedImageData(undefined);
    setSelectedImageType(undefined);
    setSelectedImageUrl(undefined);
  };

  if (!props.isOpen) return null;

  const songsWithArt = props.playlistSongs.filter(
    (song) => song.imageData && song.imageType
  );

  return (
    <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div class="bg-gray-900 rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div class="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 class="text-xl font-bold text-white">playlist cover</h2>
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
          {/* Current Cover Preview */}
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-3">
              cover image
            </label>
            <div class="w-48 h-48 mx-auto rounded-lg overflow-hidden bg-gray-700 flex items-center justify-center">
              <Show
                when={selectedImageUrl()}
                fallback={
                  <div class="text-center">
                    <svg
                      class="w-16 h-16 text-gray-400 mx-auto mb-2"
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
                    <p class="text-gray-400 text-sm">no cover image</p>
                  </div>
                }
              >
                <img
                  src={selectedImageUrl()}
                  alt="Playlist cover"
                  class="w-full h-full object-cover"
                />
              </Show>
            </div>
          </div>

          {/* Upload Options */}
          <div class="space-y-4">
            {/* Upload from file */}
            <div>
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
                class="block w-full px-4 py-3 bg-magenta-500 hover:bg-magenta-600 disabled:bg-magenta-400 text-white rounded-lg cursor-pointer text-center font-medium transition-colors"
              >
                upload image
              </label>
            </div>

            {/* Use from songs */}
            <Show when={songsWithArt.length > 0}>
              <button
                onClick={handleUseFromSongs}
                disabled={isLoading()}
                class="block w-full px-4 py-3 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
              >
                use album art from songs ({songsWithArt.length} available)
              </button>
            </Show>

            {/* Remove image */}
            <Show when={selectedImageData()}>
              <button
                onClick={handleRemoveImage}
                disabled={isLoading()}
                class="block w-full px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg font-medium transition-colors"
              >
                remove cover image
              </button>
            </Show>
          </div>

          {/* Songs with album art preview */}
          <Show when={songsWithArt.length > 0}>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-3">
                available album art
              </label>
              <div class="grid grid-cols-4 gap-3">
                {songsWithArt.slice(0, 8).map((song) => (
                  <button
                    onClick={() => {
                      // This needs to be updated to work with ArrayBuffer data
                      setError(
                        "Selecting from song images not yet implemented with new image storage"
                      );
                    }}
                    disabled={isLoading()}
                    class="aspect-square rounded-lg overflow-hidden bg-gray-700 hover:ring-2 hover:ring-magenta-500 transition-all"
                    title={`${song.title} - ${song.artist}`}
                  >
                    <Show
                      when={song.imageData && song.imageType}
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
                          song.imageData!,
                          song.imageType!
                        )}
                        alt={song.title}
                        class="w-full h-full object-cover"
                      />
                    </Show>
                  </button>
                ))}
              </div>
              <Show when={songsWithArt.length > 8}>
                <p class="text-sm text-gray-400 mt-2 text-center">
                  +{songsWithArt.length - 8} more images available
                </p>
              </Show>
            </div>
          </Show>

          {/* Playlist info */}
          <div class="bg-gray-800 rounded-lg p-4">
            <h3 class="text-sm font-medium text-gray-300 mb-2">
              playlist information
            </h3>
            <div class="text-sm text-gray-400 space-y-1">
              <div>title: {props.playlist.title}</div>
              <div>songs: {props.playlist.songIds.length}</div>
              <div>with album art: {songsWithArt.length}</div>
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
            disabled={isLoading()}
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
            {isLoading() ? "saving..." : "save cover"}
          </button>
        </div>
      </div>
    </div>
  );
}
