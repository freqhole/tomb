// entity images - reusable image grid for managing entity images
import { Show, For } from "solid-js";
import { Icon } from "../icons/registry";
import MediaImage from "../media/MediaImage";
import type { ImageMetadata } from "../../music/services/storage/types";
import { isCharnelMode } from "../../app/services/charnel/mode";
import { getCurrentRemote } from "../../music/data";

// type for tauri dialog plugin's open function (dynamically imported when available)
type TauriDialogOpenFn = (options?: {
  multiple?: boolean;
  directory?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
  title?: string;
}) => Promise<string | string[] | null>;

export interface EntityImagesProps {
  images: ImageMetadata[];
  onUpload?: (file: File) => void | Promise<void>;
  /** called when uploading by file path (tauri dialog) - if provided, tauri-managed remotes use dialog picker */
  onUploadPath?: (filePath: string) => void | Promise<void>;
  onDelete?: (index: number) => void | Promise<void>;
  onSetPrimary?: (index: number) => void | Promise<void>;
  uploading?: boolean;
  uploadProgress?: number;
  disabled?: boolean;
  compact?: boolean; // use smaller grid (3-5 cols vs 2-3)
  title?: string; // custom heading (default: "images")
}

export function EntityImages(props: EntityImagesProps) {
  // DEBUG: log images passed to EntityImages
  console.log(
    "[EntityImages] images:",
    props.images.map((img) => ({
      local_blob_id: img.local_blob_id,
      remote_blob_id: img.remote_blob_id,
      remote_url: img.remote_url,
      remote_server_id: img.remote_server_id,
      is_primary: img.is_primary,
      blob_type: img.blob_type,
    }))
  );

  const handleFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && props.onUpload) {
      await props.onUpload(file);
    }
    // reset input so same file can be selected again
    input.value = "";
  };

  // check if we should use tauri dialog picker
  const useCharnelDialog = () => {
    if (!isCharnelMode() || !props.onUploadPath) return false;
    const remote = getCurrentRemote();
    return remote?.is_charnel_managed === true;
  };

  const handleUploadClick = async () => {
    if (!useCharnelDialog()) return; // will use file input instead

    try {
      // dynamically import dialog plugin (only available in tauri runtime)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dialogModule = (await import("@tauri-apps/plugin-dialog" as any)) as {
        open: TauriDialogOpenFn;
      };
      const selected = await dialogModule.open({
        multiple: false,
        filters: [{ name: "images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }],
        title: "select image",
      });
      if (selected && typeof selected === "string" && props.onUploadPath) {
        await props.onUploadPath(selected);
      }
    } catch (err) {
      console.error("failed to open file dialog:", err);
    }
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
                remoteBlobId={image.remote_blob_id}
                remoteServerId={image.remote_server_id}
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

        {/* upload button - uses tauri dialog when tauri-managed, otherwise file input */}
        <Show when={(props.onUpload || props.onUploadPath) && !props.disabled}>
          <Show
            when={useCharnelDialog()}
            fallback={
              // standard file input for browser/non-tauri-managed
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
            }
          >
            {/* tauri dialog button for tauri-managed remotes */}
            <button
              class={`relative flex-shrink-0 ${imageSize()} border-2 border-dashed border-[var(--color-border-default)] rounded flex flex-col items-center justify-center cursor-pointer hover:border-[var(--color-accent-500)] hover:bg-[var(--color-bg-secondary)] transition-colors ${
                props.uploading ? "opacity-50 pointer-events-none" : ""
              }`}
              onClick={handleUploadClick}
              disabled={props.uploading}
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
            </button>
          </Show>
        </Show>
      </div>

      <Show when={props.images.length === 0 && !props.uploading}>
        <p class="text-xs text-[var(--color-text-tertiary)] text-center py-2">no images yet</p>
      </Show>
    </div>
  );
}
