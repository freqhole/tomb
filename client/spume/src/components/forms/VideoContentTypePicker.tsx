// content type pill picker shared by EditVideoModal.tsx and the import
// review's ImportVideoEditorPanel.tsx.
import { For } from "solid-js";
import { VIDEO_CONTENT_TYPES, contentTypeLabel } from "../../video/utils/contentType";

export interface VideoContentTypePickerProps {
  value: string;
  onChange: (type: (typeof VIDEO_CONTENT_TYPES)[number]) => void;
  disabled?: boolean;
}

export function VideoContentTypePicker(props: VideoContentTypePickerProps) {
  return (
    <div class="flex flex-wrap gap-2">
      <For each={VIDEO_CONTENT_TYPES}>
        {(type) => (
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(type)}
            class={`px-3 py-1.5 text-sm rounded disabled:opacity-50 ${
              props.value === type
                ? "bg-[var(--color-accent-500)] text-white"
                : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]"
            }`}
          >
            {contentTypeLabel(type)}
          </button>
        )}
      </For>
    </div>
  );
}
