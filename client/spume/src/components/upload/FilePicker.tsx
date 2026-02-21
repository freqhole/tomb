import { FileField } from "@kobalte/core/file-field";
import { Show, splitProps } from "solid-js";
import { Icon } from "../icons/registry";

export interface FilePickerProps {
  /** label for the file picker */
  label?: string;
  /** hint text below the dropzone */
  hint?: string;
  /** error message */
  error?: string;
  /** whether multiple files can be selected */
  multiple?: boolean;
  /** maximum number of files */
  maxFiles?: number;
  /** accepted file types (e.g., "image/*", ".pdf", etc.) */
  accept?: string | string[];
  /** maximum file size in bytes */
  maxFileSize?: number;
  /** minimum file size in bytes */
  minFileSize?: number;
  /** whether drag and drop is enabled */
  allowDragAndDrop?: boolean;
  /** whether the picker is disabled */
  disabled?: boolean;
  /** callback when files are accepted */
  onFileAccept?: (files: File[]) => void;
  /** callback when files are rejected */
  onFileReject?: (rejections: any[]) => void;
  /** callback when file list changes */
  onFileChange?: (details: any) => void;
  /** custom file validation */
  validateFile?: (file: File) => any[] | null;
  /** name for form submission */
  name?: string;
  /** additional classes */
  class?: string;
}

// format file size for display
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// file picker component with drag & drop using kobalte primitives
export function FilePicker(props: FilePickerProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "hint",
    "error",
    "multiple",
    "maxFiles",
    "accept",
    "maxFileSize",
    "minFileSize",
    "allowDragAndDrop",
    "disabled",
    "onFileAccept",
    "onFileReject",
    "onFileChange",
    "validateFile",
    "name",
    "class",
  ]);

  const allowDragAndDrop = () => local.allowDragAndDrop ?? true;

  return (
    <div class={`space-y-2 ${local.class || ""}`}>
      <FileField
        multiple={local.multiple}
        maxFiles={local.maxFiles}
        accept={local.accept}
        maxFileSize={local.maxFileSize}
        minFileSize={local.minFileSize}
        allowDragAndDrop={allowDragAndDrop()}
        disabled={local.disabled}
        onFileAccept={local.onFileAccept}
        onFileReject={local.onFileReject}
        onFileChange={local.onFileChange}
        validationState={local.error ? "invalid" : "valid"}
        {...rest}
      >
        <Show when={local.label}>
          <FileField.Label class="label text-[var(--color-text-secondary)] block mb-2">
            {local.label}
          </FileField.Label>
        </Show>

        {/* dropzone */}
        <FileField.Dropzone
          class="
            relative
            p-8
            border-2 border-dashed rounded-lg
            bg-[var(--color-bg-secondary)]
            transition-all
            data-[invalid]:border-[var(--color-error)]
            data-[valid]:border-[var(--color-border-default)]
            data-[valid]:hover:border-[var(--color-accent-500)]
            data-[valid]:hover:bg-[var(--color-bg-tertiary)]
            data-[dragging]:border-[var(--color-accent-500)]
            data-[dragging]:bg-[var(--color-bg-tertiary)]
            data-[disabled]:opacity-50
            data-[disabled]:cursor-not-allowed
          "
        >
          <div class="flex flex-col items-center justify-center text-center">
            <div class="mb-4">
              <Icon name="upload" size={48} color="var(--color-text-muted)" />
            </div>

            <div class="space-y-2">
              <FileField.Trigger
                class="
                  inline-flex items-center gap-2
                  px-4 py-2
                  bg-[var(--color-accent-500)]
                  hover:bg-[var(--color-accent-400)]
                  text-[var(--color-text-on-accent)]
                  rounded
                  transition-colors
                  disabled:opacity-50
                  disabled:cursor-not-allowed
                  focus:outline-none
                  focus:ring-2
                  focus:ring-[var(--color-accent-500)]
                  focus:ring-offset-2
                  focus:ring-offset-[var(--color-bg-primary)]
                "
              >
                <Icon name="add" size={16} />
                <span class="body-sm font-medium">choose files</span>
              </FileField.Trigger>

              <Show when={allowDragAndDrop()}>
                <p class="body-sm text-[var(--color-text-tertiary)]">or drag and drop files here</p>
              </Show>

              <Show when={local.maxFiles}>
                <p class="caption text-[var(--color-text-muted)]">
                  maximum {local.maxFiles} file{local.maxFiles! > 1 ? "s" : ""}
                </p>
              </Show>

              <Show when={local.accept}>
                <p class="caption text-[var(--color-text-muted)]">
                  {Array.isArray(local.accept) ? local.accept.join(", ") : local.accept}
                </p>
              </Show>

              <Show when={local.maxFileSize}>
                <p class="caption text-[var(--color-text-muted)]">
                  max size: {formatFileSize(local.maxFileSize!)}
                </p>
              </Show>
            </div>
          </div>
        </FileField.Dropzone>

        <FileField.HiddenInput name={local.name} />

        {/* file list */}
        <FileField.ItemList class="space-y-2 mt-4">
          {(_file) => (
            <FileField.Item
              class="
                flex items-center gap-3
                p-3
                bg-[var(--color-bg-secondary)]
                border border-[var(--color-border-default)]
                rounded
                group
              "
            >
              {/* preview */}
              <FileField.ItemPreview
                type="image/*"
                class="flex-shrink-0 w-12 h-12 rounded overflow-hidden bg-[var(--color-bg-tertiary)] flex items-center justify-center"
              >
                <FileField.ItemPreviewImage class="w-full h-full object-cover" />
                {/* fallback icon when no preview available */}
                <div class="text-[var(--color-text-muted)]">
                  <Icon name="upload" size={24} />
                </div>
              </FileField.ItemPreview>

              {/* file info */}
              <div class="flex-1 min-w-0">
                <FileField.ItemName class="body-sm text-[var(--color-text-primary)] truncate block" />
                <FileField.ItemSize precision={2} class="caption text-[var(--color-text-muted)]" />
              </div>

              {/* delete button */}
              <FileField.ItemDeleteTrigger
                class="
                  flex-shrink-0
                  p-2
                  text-[var(--color-text-muted)]
                  hover:text-[var(--color-error)]
                  hover:bg-[var(--color-bg-hover)]
                  rounded
                  transition-colors
                  opacity-0
                  group-hover:opacity-100
                  focus:opacity-100
                  focus:outline-none
                  focus:ring-2
                  focus:ring-[var(--color-accent-500)]
                "
                aria-label="remove file"
              >
                <Icon name="close" size={18} />
              </FileField.ItemDeleteTrigger>
            </FileField.Item>
          )}
        </FileField.ItemList>

        {/* hint text */}
        <Show when={local.hint && !local.error}>
          <FileField.Description class="caption text-[var(--color-text-muted)]">
            {local.hint}
          </FileField.Description>
        </Show>

        {/* error message */}
        <Show when={local.error}>
          <FileField.ErrorMessage class="body-xs text-[var(--color-error)] flex items-center gap-1">
            <Icon name="alertTriangle" size={14} />
            <span>{local.error}</span>
          </FileField.ErrorMessage>
        </Show>
      </FileField>
    </div>
  );
}
