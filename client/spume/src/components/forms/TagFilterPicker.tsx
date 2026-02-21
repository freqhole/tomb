import { createSignal, For, Show, splitProps } from "solid-js";
import { TagStrokeIcon, ChevronDownStrokeIcon } from "../icons/registry";
import { Badge } from "../badges/Badge";

export type TagFilterMode = "include" | "exclude";

export interface TagFilter {
  tag: string;
  mode: TagFilterMode;
}

export interface TagOption {
  value: string;
  label: string;
  count?: number;
}

export interface TagFilterPickerProps {
  /** list of available tags with counts */
  availableTags: TagOption[];
  /** currently selected tag filters */
  selectedFilters: TagFilter[];
  /** callback when a tag is added (defaults to 'include' mode) */
  onAddTag: (tag: string) => void;
  /** callback when a tag is removed */
  onRemoveTag: (tag: string) => void;
  /** callback when a tag's mode is toggled (include <-> exclude) */
  onToggleMode: (tag: string) => void;
  /** callback when all tags are cleared */
  onClearAll: () => void;
  /** loading state for available tags */
  loading?: boolean;
  /** compact mode (smaller buttons) */
  compact?: boolean;
  /** additional CSS classes */
  class?: string;
}

/**
 * tag filter picker with include/exclude functionality
 *
 * - dropdown menu to select tags
 * - each tag can be "include" (green) or "exclude" (red)
 * - click tag badge to toggle between include/exclude
 * - remove tag with × button
 * - shows tag counts in dropdown
 * - "clear all" option
 *
 * usage:
 * - include: show items WITH this tag
 * - exclude: show items WITHOUT this tag
 */
export function TagFilterPicker(props: TagFilterPickerProps) {
  const [local, others] = splitProps(props, [
    "availableTags",
    "selectedFilters",
    "onAddTag",
    "onRemoveTag",
    "onToggleMode",
    "onClearAll",
    "loading",
    "compact",
    "class",
  ]);

  const [menuOpen, setMenuOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;

  // filter out already selected tags from available list
  const unselectedTags = () => {
    const selectedTagValues = new Set(local.selectedFilters.map((f) => f.tag));
    return local.availableTags.filter((tag) => !selectedTagValues.has(tag.value));
  };

  const handleAddTag = (tag: string) => {
    local.onAddTag(tag);
    setMenuOpen(false);
  };

  const handleToggleMenu = (e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen());
  };

  // close menu when clicking outside
  // THIS IS EXPENSIVE!
  // #TODO: deal with it!
  const handleClickOutside = (e: MouseEvent) => {
    if (
      menuRef &&
      !menuRef.contains(e.target as Node) &&
      buttonRef &&
      !buttonRef.contains(e.target as Node)
    ) {
      setMenuOpen(false);
    }
  };

  // setup click outside listener
  document.addEventListener("click", handleClickOutside);

  return (
    <div class={`relative ${local.class || ""}`} {...others}>
      {/* selected tag filters + add button */}
      <div class="flex items-center gap-2 flex-wrap">
        {/* add tag button */}
        <button
          ref={buttonRef}
          onClick={handleToggleMenu}
          class={`
            inline-flex items-center gap-1
            px-2 py-1
            border border-[var(--color-border-default)]
            hover:border-[var(--color-accent-400)]
            text-[var(--color-text-secondary)]
            hover:text-[var(--color-text-primary)]
            ${local.compact ? "text-xs" : "text-sm"}
            rounded
            transition-colors
          `}
          title="add tag filter"
          aria-label="add tag filter"
        >
          <TagStrokeIcon size={12} />
          <span>tags</span>
          <span class={`transition-transform ${menuOpen() ? "rotate-180" : ""}`}>
            <ChevronDownStrokeIcon size={12} />
          </span>
        </button>

        {/* active tag filter badges */}
        <For each={local.selectedFilters}>
          {(filter) => (
            <button
              onClick={() => local.onToggleMode(filter.tag)}
              title={
                filter.mode === "include"
                  ? `include: ${filter.tag} (click to exclude)`
                  : `exclude: ${filter.tag} (click to include)`
              }
              class="cursor-pointer hover:opacity-90 transition-opacity"
            >
              <Badge
                variant={filter.mode === "include" ? "success" : "error"}
                size={local.compact ? "sm" : "default"}
                removable={true}
                onRemove={() => local.onRemoveTag(filter.tag)}
              >
                {filter.tag}
              </Badge>
            </button>
          )}
        </For>
      </div>

      {/* dropdown menu */}
      <Show when={menuOpen()}>
        <div
          ref={menuRef}
          class="absolute top-full left-0 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg z-50 min-w-[200px] max-w-[320px]"
        >
          <div class="p-2">
            {/* clear all button */}
            <Show when={local.selectedFilters.length > 0}>
              <div class="border-b border-[var(--color-border-subtle)] pb-2 mb-2">
                <button
                  onClick={() => {
                    local.onClearAll();
                    setMenuOpen(false);
                  }}
                  class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded transition-colors"
                >
                  clear all
                </button>
              </div>
            </Show>

            {/* loading state */}
            <Show when={local.loading}>
              <div class="text-xs text-[var(--color-text-tertiary)] py-2 px-2">loading tags...</div>
            </Show>

            {/* no unselected tags */}
            <Show when={!local.loading && unselectedTags().length === 0}>
              <div class="text-xs text-[var(--color-text-tertiary)] py-2 px-2">
                {local.availableTags.length === 0 ? "no tags available" : "all tags selected"}
              </div>
            </Show>

            {/* available tags list */}
            <Show when={!local.loading && unselectedTags().length > 0}>
              <div class="max-h-64 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--color-border-default)]">
                <For each={unselectedTags()}>
                  {(tag) => (
                    <button
                      onClick={() => handleAddTag(tag.value)}
                      class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded transition-colors flex items-center justify-between"
                    >
                      <span>{tag.label}</span>
                      <Show when={tag.count !== undefined}>
                        <span class="text-[var(--color-text-tertiary)] text-xs">({tag.count})</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
