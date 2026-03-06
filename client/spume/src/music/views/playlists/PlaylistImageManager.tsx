// playlist image upload and management component
import { createSignal, For, Show } from "solid-js";
import { Icon, IconNames } from "../../../components/icons/registry";
import MediaImage from "../../../components/media/MediaImage";
import { toast } from "../../../components/feedback/Toast";
import { getDataSource, getCurrentRemote } from "../../data";
import { pollJobUntilComplete } from "../../../app/services/jobs/jobService";
import type { ImageMetadata } from "../../services/storage/types";
import { useQueryClient } from "@tanstack/solid-query";

interface PlaylistImageManagerProps {
  playlistId: string;
  images: ImageMetadata[];
  onImagesChange: (images: ImageMetadata[]) => void;
}

export function PlaylistImageManager(props: PlaylistImageManagerProps) {
  const queryClient = useQueryClient();
  const [uploadingImage, setUploadingImage] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);

  const handleImageUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("please select an image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("image must be smaller than 10MB");
      return;
    }

    setUploadingImage(true);
    setUploadProgress(0);

    try {
      const datasource = getDataSource();
      const result = await datasource.uploadImage?.({
        file,
        entityType: "playlist",
        entityId: props.playlistId,
      });

      if (!result) {
        toast.error("failed to upload image");
        return;
      }

      const { blob_id, job_id } = result;

      // poll for job completion if remote
      const remote = getCurrentRemote();
      if (remote && job_id) {
        const pollResult = await pollJobUntilComplete(remote, job_id, 10000);
        if (pollResult === "failed") {
          toast.error("image processing failed");
          return;
        }
        if (pollResult === "timeout") {
          toast.info("image processing taking a long time — check back later", {
            title: "processing queued",
          });
          return;
        }
      }

      const newImage: ImageMetadata = {
        local_blob_id: blob_id,
        is_primary: props.images.length === 0,
        blob_type: "thumbnail",
      };
      const updatedImages = [...props.images, newImage];
      props.onImagesChange(updatedImages);

      toast.success("image uploaded successfully");

      await queryClient.invalidateQueries({
        queryKey: ["playlists"],
      });
    } catch (error) {
      console.error("failed to upload image:", error);
      toast.error("failed to upload image");
    } finally {
      setUploadingImage(false);
      setUploadProgress(0);
      input.value = "";
    }
  };

  const handleTogglePrimary = async (index: number) => {
    const updated = props.images.map((img, i) => ({
      ...img,
      is_primary: i === index,
    }));
    props.onImagesChange(updated);

    // TODO: implement setPrimaryImage API endpoint
    try {
      toast.success("primary image updated");

      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    const updated = props.images.filter((_, i) => i !== index);

    if (updated.length > 0 && !updated.some((img) => img.is_primary)) {
      updated[0].is_primary = true;
    }

    props.onImagesChange(updated);

    // TODO: implement removeImage API endpoint for playlists
    try {
      toast.success("image removed");

      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  return (
    <div class="space-y-4">
      {/* existing images grid */}
      <Show when={props.images.length > 0}>
        <div class="space-y-2">
          <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
            playlist images ({props.images.length})
          </h3>
          <div class="grid grid-cols-3 sm:grid-cols-4 wide:grid-cols-5 gap-2">
            <For each={props.images}>
              {(image, index) => (
                <div class="relative group">
                  <MediaImage
                    images={[image]}
                    alt={`playlist image ${index() + 1}`}
                    domainType="playlist"
                    class="w-full aspect-square object-cover rounded"
                  />
                  <div class="absolute top-1 left-1 flex gap-1">
                    <Show when={image.blob_type}>
                      <span class="px-1.5 py-0.5 text-xs bg-black/70 text-white rounded">
                        {image.blob_type}
                      </span>
                    </Show>
                    <Show when={image.is_primary}>
                      <span class="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded">
                        primary
                      </span>
                    </Show>
                  </div>
                  <div class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Show when={!image.is_primary}>
                      <button
                        onClick={() => handleTogglePrimary(index())}
                        class="p-1 bg-black/70 hover:bg-black/90 text-white rounded"
                        title="set as primary"
                      >
                        <Icon name={IconNames.star} size={14} />
                      </button>
                    </Show>
                    <button
                      onClick={() => handleRemoveImage(index())}
                      class="p-1 bg-black/70 hover:bg-black/90 text-white rounded"
                      title="remove image"
                    >
                      <Icon name={IconNames.delete} size={14} />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* upload section */}
      <div class="space-y-2">
        <h3 class="text-sm font-medium text-[var(--color-text-primary)]">add new image</h3>
        <Show
          when={!uploadingImage()}
          fallback={
            <div class="p-3 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)] text-center">
              <div class="text-sm text-[var(--color-text-secondary)]">
                uploading... {uploadProgress()}%
              </div>
            </div>
          }
        >
          <label class="block">
            <input type="file" accept="image/*" onChange={handleImageUpload} class="hidden" />
            <div class="p-4 border-2 border-dashed border-[var(--color-border-default)] rounded hover:border-[var(--color-primary)] transition-colors cursor-pointer text-center">
              <Icon
                name={IconNames.upload}
                size={20}
                className="mx-auto mb-1 text-[var(--color-text-tertiary)]"
              />
              <div class="text-xs text-[var(--color-text-primary)]">click to upload</div>
              <div class="text-xs text-[var(--color-text-tertiary)] mt-0.5">max 10mb</div>
            </div>
          </label>
        </Show>
      </div>
    </div>
  );
}
