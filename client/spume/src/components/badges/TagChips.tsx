// tag chip strip — renders a flat list of tag names as pill chips.
// mirrors TaxonChips.tsx's wrapper/visual style but simpler (tags have
// no kind grouping/colour banding, just a plain "#name" pill).

import { For, Show } from "solid-js";

export interface TagChipsProps {
  tags: string[] | null | undefined;
  onTagClick?: (tag: string) => void;
  /** optional extra classes appended to the wrapper flex container */
  class?: string;
}

export function TagChips(props: TagChipsProps) {
  const visible = () => props.tags ?? [];
  return (
    <Show when={visible().length > 0}>
      <div class={`flex flex-wrap gap-1.5 ${props.class ?? ""}`}>
        <For each={visible()}>
          {(tag) => {
            const baseClasses =
              "px-2 py-0.5 rounded-full text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)]";
            return props.onTagClick ? (
              <button
                type="button"
                class={`${baseClasses} cursor-pointer hover:text-[var(--color-text-secondary)] border-none`}
                onClick={() => props.onTagClick?.(tag)}
              >
                #{tag}
              </button>
            ) : (
              <span class={baseClasses}>#{tag}</span>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
