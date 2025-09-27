import { createSignal, Show, createEffect, onCleanup } from "solid-js";
import { useAuth } from "../../../../hooks/auth";
import { apiClient } from "../../../../lib/api-client";

interface SongImageFieldProps {
  value: string | null | File; // blob ID, File, or null
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: string | null | File) => void;
  onReset: () => void;
}

export function SongImageField(props: SongImageFieldProps) {
  const auth = useAuth();
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [selectedFile, setSelectedFile] = createSignal<File | null>(null);
  let currentBlobUrl: string | null = null;

  // Generate preview URL based on current value - avoid reactive loops
  createEffect(() => {
    const value = props.value;

    // Clean up previous blob URL if it exists
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }

    if (
      value &&
      typeof value === "object" &&
      "name" in value &&
      "size" in value
    ) {
      // Local file preview
      const file = value as File;
      const url = URL.createObjectURL(file);
      currentBlobUrl = url;
      setPreviewUrl(url);
      setSelectedFile(file);
    } else if (typeof value === "string" && value) {
      // Existing blob ID
      const url = `${apiClient.getBaseUrl()}/api/blobs/${value}`;
      setPreviewUrl(url);
      setSelectedFile(null);
    } else {
      // No image
      setPreviewUrl(null);
      setSelectedFile(null);
    }
  });

  // Cleanup blob URL on component unmount
  onCleanup(() => {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
  });

  const handleFileSelect = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      input.value = "";
      return;
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      alert("Image must be smaller than 10MB");
      input.value = "";
      return;
    }

    console.log("Selected file:", file.name, file.size, file.type);
    props.onUpdate(file);
    input.value = ""; // Clear input so same file can be selected again
  };

  const handleRemove = () => {
    console.log("Removing image");
    props.onUpdate(null);
  };

  const handleReset = () => {
    props.onReset();
  };

  // Don't show anything if not admin
  if (!auth.isAdmin) {
    return null;
  }

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="text-sm font-medium text-gray-400">thumbnail image</label>
        <Show when={props.isDirty}>
          <button
            type="button"
            onClick={handleReset}
            class="text-xs text-gray-400 hover:text-white"
            disabled={props.disabled}
          >
            reset
          </button>
        </Show>
      </div>

      <div class="space-y-3">
        {/* Image preview */}
        <Show when={previewUrl()}>
          <div class="relative inline-block">
            <img
              src={previewUrl()!}
              alt="Thumbnail preview"
              class="w-32 h-32 object-cover border border-gray-600 bg-gray-800"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
              }}
            />
            <Show when={selectedFile()}>
              <div class="absolute top-1 right-1 bg-blue-600 text-white text-xs px-1 rounded">
                NEW
              </div>
            </Show>
          </div>
        </Show>

        {/* Upload/Remove buttons */}
        <div class="flex gap-2">
          <label class="cursor-pointer">
            <input
              type="file"
              accept="image/*"
              class="hidden"
              onChange={handleFileSelect}
              disabled={props.disabled}
            />
            <span class="inline-block px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white transition-colors disabled:opacity-50">
              {previewUrl() ? "change image" : "add image"}
            </span>
          </label>

          <Show when={previewUrl()}>
            <button
              type="button"
              onClick={handleRemove}
              class="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white transition-colors"
              disabled={props.disabled}
            >
              remove
            </button>
          </Show>
        </div>

        {/* File info */}
        <Show when={selectedFile()}>
          <div class="text-xs text-gray-400">
            {selectedFile()!.name} ({Math.round(selectedFile()!.size / 1024)}KB)
            <br />
            <span class="text-yellow-400">Will upload when you save</span>
          </div>
        </Show>

        {/* Dirty indicator */}
        <Show when={props.isDirty}>
          <div class="text-xs text-magenta-400 flex items-center gap-1">
            <div class="w-1 h-1 bg-magenta-500"></div>
            modified
          </div>
        </Show>
      </div>
    </div>
  );
}
