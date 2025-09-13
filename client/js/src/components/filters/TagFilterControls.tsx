import { createSignal, createEffect, Show, For, onMount } from "solid-js";
import { apiClient } from "../../lib/api-client";
import { useFilters, storeActions } from "../../views/freqhole/store";
import { useGlobalEvents } from "../../views/freqhole/hooks/useGlobalEvents";

interface FilterOption {
  value: string;
  label: string;
  count: number;
  percentage: number;
}

interface TagFilterControlsProps {
  compact?: boolean;
  class?: string;
}

export function TagFilterControls(props: TagFilterControlsProps) {
  const [filters] = useFilters();
  const [showTagMenu, setShowTagMenu] = createSignal(false);
  const [availableTags, setAvailableTags] = createSignal<FilterOption[]>([]);
  const [loading, setLoading] = createSignal(false);
  const events = useGlobalEvents();

  // Fetch available tags from the API
  const fetchAvailableTags = async () => {
    try {
      setLoading(true);
      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/filter-options"
      );

      const tags = response?.tags?.items || [];
      setAvailableTags(tags);
    } catch (error) {
      console.error("Failed to fetch available tags:", error);
      setAvailableTags([]);
    } finally {
      setLoading(false);
    }
  };

  // Load tags on mount
  onMount(() => {
    fetchAvailableTags();
  });

  // Filter out already selected tags from available tags
  const unselectedTags = () => {
    const selectedTags = filters.tags;
    return availableTags().filter((tag) => !selectedTags.includes(tag.value));
  };

  const handleAddTag = (tag: string) => {
    storeActions.addTagFilter(tag);
    setShowTagMenu(false);
    // Trigger search manually
    events.emit("data:reload", { type: "songs" });
  };

  const handleRemoveTag = (tag: string) => {
    storeActions.removeTagFilter(tag);
    // Trigger search manually
    events.emit("data:reload", { type: "songs" });
  };

  const handleClearAllTags = () => {
    storeActions.clearTagFilters();
    // Trigger search manually
    events.emit("data:reload", { type: "songs" });
  };

  // Close menu when clicking outside
  let menuRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;

  createEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedOutsideMenu = menuRef && !menuRef.contains(target);
      const clickedOutsideButton = buttonRef && !buttonRef.contains(target);

      if (clickedOutsideMenu && clickedOutsideButton) {
        setShowTagMenu(false);
      }
    };

    if (showTagMenu()) {
      // Use setTimeout to avoid immediate closure from the same click that opened it
      setTimeout(() => {
        document.addEventListener("click", handleClickOutside);
      }, 0);
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  });

  return (
    <div class={`relative ${props.class || ""}`}>
      {/* Active Tag Filters */}
      <div class="flex items-center gap-2 flex-wrap">
        <For each={filters.tags}>
          {(tag) => (
            <div class="inline-flex items-center gap-1 px-2 py-1 bg-magenta-600 text-white text-xs rounded">
              <span>{tag}</span>
              <button
                onClick={() => handleRemoveTag(tag)}
                class="hover:text-magenta-200 transition-colors"
                title={`Remove ${tag} filter`}
              >
                ×
              </button>
            </div>
          )}
        </For>

        {/* Add Tag Button */}
        <button
          ref={buttonRef}
          onClick={(e) => {
            e.stopPropagation();
            setShowTagMenu(!showTagMenu());
          }}
          class="inline-flex items-center gap-1 px-2 py-1 border border-gray-600 hover:border-magenta-400 text-gray-300 hover:text-white text-xs rounded transition-colors"
          title="Add tag filter"
        >
          <svg
            class="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
          <span>tags</span>
          <svg
            class={`w-3 h-3 transition-transform ${showTagMenu() ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
      </div>

      {/* Tag Selection Menu */}
      <Show when={showTagMenu()}>
        <div
          ref={menuRef}
          class="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-48 max-w-64"
        >
          <div class="p-2">
            <div class="border-gray-700 border-b max-h-48 overflow-y-auto">
              <button
                onClick={handleClearAllTags}
                class=" w-full text-left px-2 py-1 text-xs hover:bg-magenta-600 hover:text-white text-gray-300 rounded transition-colors flex items-center justify-between"
                title="clear all tag filters"
              >
                clear all
              </button>
            </div>

            <Show
              when={!loading()}
              fallback={
                <div class="text-xs text-gray-400 py-2">loading tags...</div>
              }
            >
              <Show
                when={unselectedTags().length > 0}
                fallback={
                  <div class="text-xs text-gray-400 py-2">you got 'em all!</div>
                }
              >
                <div class="max-h-48 overflow-y-auto">
                  <For each={unselectedTags()}>
                    {(tag) => (
                      <button
                        onClick={() => handleAddTag(tag.value)}
                        class="w-full text-left px-2 py-1 text-xs hover:bg-magenta-600 hover:text-white text-gray-300 rounded transition-colors flex items-center justify-between"
                      >
                        <span>{tag.label}</span>
                        <span class="text-gray-500 text-xs">({tag.count})</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
