import { createSignal, Show, For } from "solid-js";
import type { Song } from "../../../../lib/music/schemas/song";
import { apiClient } from "../../../../lib/api-client";

interface ImageCarouselProps {
  songs: Song[];
  currentSongIndex?: number;
  isBulkMode?: boolean;
}

export function ImageCarousel(props: ImageCarouselProps) {
  const [currentImageIndex, setCurrentImageIndex] = createSignal(0);

  const currentSong = () => {
    if (props.isBulkMode || !props.songs.length) return null;
    return props.songs[props.currentSongIndex || 0];
  };

  const getImageUrl = (blobId: string | null) => {
    if (!blobId) return null;
    return `${apiClient.getBaseUrl()}/api/blobs/${blobId}`;
  };

  // Get all unique blob IDs for the current song or all songs in bulk mode
  const getImageBlobIds = (): string[] => {
    const songs = props.isBulkMode
      ? props.songs
      : [currentSong()].filter(Boolean);
    if (!songs.length) return [];

    const allBlobIds = new Set<string>();

    songs.forEach((song) => {
      if (!song) return;

      // Add primary thumbnail if it exists
      if (song.thumbnail_blob_id) {
        allBlobIds.add(song.thumbnail_blob_id);
      }

      // Add waveform if it exists and is different from thumbnail
      if (
        song.waveform_blob_id &&
        song.waveform_blob_id !== song.thumbnail_blob_id
      ) {
        allBlobIds.add(song.waveform_blob_id);
      }

      // Add any additional thumbnails that aren't duplicates
      song.thumbnail_blob_ids.forEach((blobId) => {
        if (
          blobId !== song.thumbnail_blob_id &&
          blobId !== song.waveform_blob_id
        ) {
          allBlobIds.add(blobId);
        }
      });
    });

    return Array.from(allBlobIds);
  };

  const imageBlobIds = () => getImageBlobIds();
  const hasImages = () => imageBlobIds().length > 0;
  const hasMultipleImages = () => imageBlobIds().length > 1;
  const currentBlobId = () => imageBlobIds()[currentImageIndex()] || null;

  const goToPrevious = () => {
    const ids = imageBlobIds();
    if (ids.length > 1) {
      setCurrentImageIndex((prev) => (prev === 0 ? ids.length - 1 : prev - 1));
    }
  };

  const goToNext = () => {
    const ids = imageBlobIds();
    if (ids.length > 1) {
      setCurrentImageIndex((prev) => (prev === ids.length - 1 ? 0 : prev + 1));
    }
  };

  // Reset image index when songs change
  const resetImageIndex = () => {
    setCurrentImageIndex(0);
  };

  // Watch for song changes and reset image index
  (() => {
    let lastSongId = currentSong()?.id;
    let lastBulkMode = props.isBulkMode;

    const checkForChanges = () => {
      const newSongId = currentSong()?.id;
      const newBulkMode = props.isBulkMode;

      if (newSongId !== lastSongId || newBulkMode !== lastBulkMode) {
        resetImageIndex();
        lastSongId = newSongId;
        lastBulkMode = newBulkMode;
      }
    };

    // Create a derived signal to track changes
    (() => {
      checkForChanges();
    })();
  })();

  return (
    <Show when={hasImages()}>
      <div class="space-y-4">
        {/* Header */}
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-medium text-gray-200">
            {props.isBulkMode ? "images" : "song images"}
          </h3>
          <Show when={hasMultipleImages()}>
            <div class="text-sm text-gray-400">
              {currentImageIndex() + 1} of {imageBlobIds().length}
            </div>
          </Show>
        </div>

        {/* Image Display */}
        <div class="flex items-center gap-4">
          {/* Left arrow */}
          <Show when={hasMultipleImages()}>
            <button
              onClick={goToPrevious}
              class="bg-gray-700 hover:bg-gray-600 text-white p-2 transition-colors"
              title="Previous image"
            >
              ←
            </button>
          </Show>

          {/* Image container */}
          <div class="flex-1 overflow-hidden">
            <Show when={currentBlobId()}>
              <div class="aspect-square max-w-md mx-auto">
                <img
                  src={getImageUrl(currentBlobId()) || ""}
                  alt={
                    props.isBulkMode
                      ? "Song image"
                      : `${currentSong()?.title || "Song"} image`
                  }
                  class="w-full h-full object-cover"
                  onError={(e) => {
                    // Hide broken images
                    const img = e.target as HTMLImageElement;
                    img.style.display = "none";
                  }}
                />
              </div>
            </Show>
          </div>

          {/* Right arrow */}
          <Show when={hasMultipleImages()}>
            <button
              onClick={goToNext}
              class="bg-gray-700 hover:bg-gray-600 text-white p-2 transition-colors"
              title="Next image"
            >
              →
            </button>
          </Show>
        </div>

        {/* Image dots/indicators for multiple images */}
        <Show when={hasMultipleImages()}>
          <div class="flex justify-center gap-2">
            <For each={imageBlobIds()}>
              {(_, index) => (
                <button
                  onClick={() => setCurrentImageIndex(index())}
                  class={`w-2 h-2 rounded-full transition-colors ${
                    index() === currentImageIndex()
                      ? "bg-magenta-500"
                      : "bg-gray-600 hover:bg-gray-500"
                  }`}
                  title={`Image ${index() + 1}`}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
