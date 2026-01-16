import { createSignal, Show, onCleanup, createEffect } from "solid-js";
import { FileUploadHandler } from "../../../../lib/file-upload";
import { apiClient } from "../../../../lib/api-client";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import type { Song } from "../../../../lib/music/schemas/song";

interface MusicBrainzImagePreviewProps {
  coverArtUrl: string | null;
  songs: Song[];
  onImageApplied: (blobId: string) => void;
  onReset: () => void;
}

export function MusicBrainzImagePreview(props: MusicBrainzImagePreviewProps) {
  const events = useGlobalEvents();
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [downloadError, setDownloadError] = createSignal<string | null>(null);
  const [previewBlob, setPreviewBlob] = createSignal<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);

  // get existing image for comparison
  const existingImageUrl = () => {
    const song = props.songs[0];
    if (!song?.thumbnail_blob_id) return null;
    return `${apiClient.getBaseUrl()}/api/blobs/${song.thumbnail_blob_id}`;
  };

  const downloadAndPreviewImage = async () => {
    if (!props.coverArtUrl) return;

    try {
      setIsDownloading(true);
      setDownloadError(null);

      // download image from musicbrainz cover art archive
      const response = await fetch(props.coverArtUrl, {
        mode: "cors",
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("cover art not available for this release");
        }
        throw new Error(`failed to download image: ${response.statusText}`);
      }

      const blob = await response.blob();

      // create preview url
      const url = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewUrl(url);
    } catch (err) {
      console.error("failed to download cover art:", err);
      setDownloadError(
        err instanceof Error ? err.message : "failed to download image"
      );
    } finally {
      setIsDownloading(false);
    }
  };

  // auto-load image when cover art URL is available
  createEffect(() => {
    if (
      props.coverArtUrl &&
      !previewUrl() &&
      !isDownloading() &&
      !downloadError()
    ) {
      downloadAndPreviewImage();
    }
  });

  const applyImage = async () => {
    const blob = previewBlob();
    if (!blob) return;

    try {
      setIsDownloading(true);
      setDownloadError(null);

      // convert blob to file for upload
      const file = new File([blob], "cover-art.jpg", { type: blob.type });

      // upload using existing pattern
      const fileUploader = new FileUploadHandler({
        baseUrl: apiClient.getBaseUrl(),
        minFileSize: 0,
        maxFileSize: 10 * 1024 * 1024, // 10MB
      });

      const uploadResult = await fileUploader.uploadMediaBlob(file, {
        type: "song-thumbnail",
        songIds: props.songs.map((s) => s.id),
      });

      // immediately update songs with new thumbnail
      const updateResult = await apiClient.bulkUpdateSongsFromChanges({
        song_ids: props.songs.map((s) => s.id),
        updates: {
          thumbnail_blob_id: uploadResult.id,
        },
      });

      // emit events to update UI components
      if (updateResult.updated_songs && updateResult.updated_songs.length > 0) {
        events.emit("songs:updated", {
          songs: updateResult.updated_songs,
          operation: props.songs.length > 1 ? "bulk-update" : "single-update",
        });
      } else {
        events.emit("data:reload", { type: "songs" });
      }

      // notify parent that image was applied and saved
      props.onImageApplied(uploadResult.id);
    } catch (err) {
      console.error("failed to upload image:", err);
      setDownloadError(
        err instanceof Error ? err.message : "failed to upload image"
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const reset = () => {
    // clean up blob url
    const url = previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    setPreviewBlob(null);
    setPreviewUrl(null);
    setDownloadError(null);
    props.onReset();
  };

  // cleanup on unmount
  onCleanup(() => {
    const url = previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  });

  return (
    <div class="space-y-4">
      <h4 class="text-sm font-medium text-gray-300">cover art</h4>

      {/* image comparison */}
      <div class="grid grid-cols-2 gap-4">
        {/* existing image */}
        <div class="space-y-2">
          <div class="text-xs text-gray-400">current</div>
          <div class="aspect-square bg-gray-800 border border-gray-700 rounded overflow-hidden">
            <Show
              when={existingImageUrl()}
              fallback={
                <div class="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                  no image
                </div>
              }
            >
              <img
                src={existingImageUrl()!}
                alt="current thumbnail"
                class="w-full h-full object-cover"
              />
            </Show>
          </div>
        </div>

        {/* musicbrainz image */}
        <div class="space-y-2">
          <div class="text-xs text-gray-400">musicbrainz</div>
          <div class="aspect-square bg-gray-800 border border-gray-700 rounded overflow-hidden">
            <Show
              when={previewUrl()}
              fallback={
                <div class="w-full h-full flex items-center justify-center text-gray-500 text-xs text-center p-2">
                  {isDownloading()
                    ? "downloading..."
                    : downloadError()
                      ? downloadError()
                      : "no cover art url"}
                </div>
              }
            >
              <img
                src={previewUrl()!}
                alt="musicbrainz cover art"
                class="w-full h-full object-cover"
              />
            </Show>
          </div>
        </div>
      </div>

      {/* error display */}
      <Show when={downloadError()}>
        <div class="p-3 bg-red-900/20 border border-red-600 text-red-200 text-xs">
          {downloadError()}
        </div>
      </Show>

      {/* action buttons */}
      <Show when={previewUrl()}>
        <div class="flex gap-2">
          <button
            onClick={applyImage}
            class="px-4 py-2 bg-magenta-600 text-white text-sm hover:bg-magenta-700 transition-colors disabled:opacity-50"
            disabled={isDownloading()}
          >
            {isDownloading() ? "uploading..." : "apply this image"}
          </button>
          <button
            onClick={reset}
            class="px-4 py-2 text-gray-300 hover:text-white text-sm transition-colors"
            disabled={isDownloading()}
          >
            reset
          </button>
        </div>
      </Show>
    </div>
  );
}
