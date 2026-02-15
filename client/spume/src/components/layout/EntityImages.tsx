// entity images - reusable image grid for managing entity images
import { Show, For } from "solid-js";
import { Icon } from "../icons/registry";
import MediaImage from "../media/MediaImage";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface EntityImagesProps {
  images: ImageMetadata[];
  onUpload?: (file: File) => void | Promise<void>;
  onDelete?: (index: number) => void | Promise<void>;
  onSetPrimary?: (index: number) => void | Promise<void>;
  uploading?: boolean;
  uploadProgress?: number;
  disabled?: boolean;
  compact?: boolean; // use smaller grid (3-5 cols vs 2-3)
  title?: string; // custom heading (default: "images")
}

export function EntityImages(props: EntityImagesProps) {
  const handleFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && props.onUpload) {
      await props.onUpload(file);
    }
    // reset input so same file can be selected again
    input.value = "";
  };

  const imageSize = () => (props.compact ? "w-24 h-24" : "w-32 h-32");

  return (
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
        {props.title ?? "images"}
      </h3>

      <div class="flex gap-2 overflow-x-auto pb-2">
        {/* existing images */}
        <For each={props.images}>
          {(image, index) => (
            <div class={`relative group flex-shrink-0 ${imageSize()}`}>
              <MediaImage
                blobId={image.local_blob_id}
                imageUrl={image.remote_url}
                alt={`image ${index() + 1}`}
                class="w-full h-full object-cover rounded"
              />

              {/* primary badge */}
              <Show when={image.is_primary}>
                <div class="absolute top-1 left-1 z-40 bg-[var(--color-accent-500)] text-white text-xs px-1.5 py-0.5 rounded">
                  primary
                </div>
              </Show>

              {/* action buttons - show on hover */}
              <Show when={!props.disabled}>
                <div class="absolute top-1 right-1 z-40 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Show when={!image.is_primary && props.onSetPrimary}>
                    <button
                      class="p-1.5 bg-black/70 hover:bg-[var(--color-accent-500)] rounded transition-colors"
                      onClick={() => props.onSetPrimary?.(index())}
                      title="set as primary"
                      aria-label="set as primary"
                    >
                      <Icon name="star" className="w-3.5 h-3.5 text-white" />
                    </button>
                  </Show>
                  <Show when={props.onDelete}>
                    <button
                      class="p-1.5 bg-black/70 hover:bg-red-500 rounded transition-colors"
                      onClick={() => props.onDelete?.(index())}
                      title="remove image"
                      aria-label="remove image"
                    >
                      <Icon name="delete" className="w-3.5 h-3.5 text-white" />
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>

        {/* upload button */}
        <Show when={props.onUpload && !props.disabled}>
          <label
            class={`relative flex-shrink-0 ${imageSize()} border-2 border-dashed border-[var(--color-border-default)] rounded flex flex-col items-center justify-center cursor-pointer hover:border-[var(--color-accent-500)] hover:bg-[var(--color-bg-secondary)] transition-colors ${
              props.uploading ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <Show
              when={!props.uploading}
              fallback={
                <div class="flex flex-col items-center gap-2">
                  <div class="w-8 h-8 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full animate-spin" />
                  <Show when={props.uploadProgress !== undefined}>
                    <span class="text-xs text-[var(--color-text-secondary)]">
                      {Math.round(props.uploadProgress!)}%
                    </span>
                  </Show>
                </div>
              }
            >
              <Icon name="upload" className="w-6 h-6 text-[var(--color-text-tertiary)] mb-1" />
              <span class="text-xs text-[var(--color-text-tertiary)]">
                {props.compact ? "add" : "add image"}
              </span>
            </Show>
            <input
              type="file"
              accept="image/*"
              class="hidden"
              onChange={handleFileSelect}
              disabled={props.uploading}
            />
          </label>
        </Show>
      </div>

      <Show when={props.images.length === 0 && !props.uploading}>
        <p class="text-xs text-[var(--color-text-tertiary)] text-center py-2">no images yet</p>
      </Show>
    </div>
  );
}
