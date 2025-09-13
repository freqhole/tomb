import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import { useAuth } from "../../hooks/auth";
import { useTagManagement } from "../../views/freqhole/store/hooks";
import type { Song } from "../../lib/music/schemas/song";

interface TagSelectorMenuProps {
  songs: Song[];
  onClose: () => void;
  mode: "view" | "manage";
}

export function TagSelectorMenu(props: TagSelectorMenuProps) {
  const auth = useAuth();
  const tagManagement = useTagManagement();

  const [newTagInput, setNewTagInput] = createSignal("");
  const [showNewTagInput, setShowNewTagInput] = createSignal(false);
  const [tagOverrides, setTagOverrides] = createSignal<Map<string, string[]>>(
    new Map()
  );

  // Get all tags from songs, using local overrides when available
  const allSongTags = () => {
    const tagSet = new Set<string>();
    const overrides = tagOverrides();

    props.songs.forEach((song) => {
      // Use local override if available, otherwise use props
      const tags = overrides.has(song.id)
        ? overrides.get(song.id)!
        : song.tags || [];
      tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  };

  // Get recent tags from reactive store
  const getRecentTags = () => {
    const availableTags = tagManagement.availableTags() || [];
    return availableTags.sort((a, b) => b.count - a.count).slice(0, 10);
  };

  const handleRemoveTag = async (tag: string) => {
    if (!auth.isAdmin || tagManagement.loading) return;

    try {
      const songIds = props.songs.map((song) => song.id);
      await tagManagement.removeTagFromSongs(songIds, tag);

      // Update local overrides immediately
      const overrides = new Map(tagOverrides());
      props.songs.forEach((song) => {
        const currentTags = overrides.has(song.id)
          ? overrides.get(song.id)!
          : song.tags || [];
        const newTags = currentTags.filter((t) => t !== tag);
        overrides.set(song.id, newTags);
      });
      setTagOverrides(overrides);
    } catch (error) {
      console.error("failed to remove tag:", error);
    }
  };

  const handleAddNewTag = async () => {
    const tagName = newTagInput().trim();
    if (!tagName || !auth.isAdmin || tagManagement.loading) return;

    try {
      const songIds = props.songs.map((song) => song.id);
      await tagManagement.addTagToSongs(songIds, tagName);

      setNewTagInput("");
      setShowNewTagInput(false);

      // Update local overrides immediately
      const overrides = new Map(tagOverrides());
      props.songs.forEach((song) => {
        const currentTags = overrides.has(song.id)
          ? overrides.get(song.id)!
          : song.tags || [];
        const newTags = [...currentTags, tagName];
        overrides.set(song.id, newTags);
      });
      setTagOverrides(overrides);
    } catch (error) {
      console.error("failed to add tag:", error);
    }
  };

  const handleAddExistingTag = async (tag: string) => {
    if (!auth.isAdmin || tagManagement.loading) return;

    try {
      const songIds = props.songs.map((song) => song.id);
      await tagManagement.addTagToSongs(songIds, tag);

      // Update local overrides immediately
      const overrides = new Map(tagOverrides());
      props.songs.forEach((song) => {
        const currentTags = overrides.has(song.id)
          ? overrides.get(song.id)!
          : song.tags || [];
        if (!currentTags.includes(tag)) {
          overrides.set(song.id, [...currentTags, tag]);
        }
      });
      setTagOverrides(overrides);
    } catch (error) {
      console.error("failed to add tag to songs:", error);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    } else if (e.key === "Enter" && showNewTagInput() && newTagInput().trim()) {
      handleAddNewTag();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  const songCount = props.songs.length;
  const currentTags = allSongTags();
  const isReadOnly = props.mode === "view" || !auth.isAdmin;

  return (
    <div class="w-72 h-96 flex flex-col bg-dark-200 border border-dark-300">
      {/* Header */}
      <div class="p-3 border-b border-dark-300 bg-dark-100 flex-shrink-0">
        <div class="text-white text-sm font-medium">
          {props.mode === "view" ? "tags" : "manage tags"}
        </div>
        <div class="text-gray-400 text-xs">
          {songCount} song{songCount !== 1 ? "s" : ""} selected
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div class="flex-1 overflow-y-auto">
        {/* Current Tags */}
        <Show when={currentTags.length > 0}>
          <div class="p-3 border-b border-dark-300">
            <div class="text-gray-300 text-xs font-medium mb-2">
              current tags
            </div>
            <div class="space-y-1">
              <For each={currentTags}>
                {(tag) => (
                  <div class="flex items-center justify-between px-2 py-1 text-sm text-white hover:bg-dark-300 rounded">
                    <span class="flex-1 truncate">{tag}</span>
                    <Show when={!isReadOnly}>
                      <button
                        class="ml-2 text-red-400 hover:text-red-300 text-xs"
                        onClick={() => handleRemoveTag(tag)}
                        disabled={tagManagement.loading}
                      >
                        ×
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={currentTags.length === 0}>
          <div class="p-3 text-gray-400 text-sm text-center border-b border-dark-300">
            no tags assigned
          </div>
        </Show>

        {/* Admin Actions */}
        <Show when={!isReadOnly}>
          <div>
            {/* Add New Tag Input */}
            <Show when={showNewTagInput()}>
              <div class="p-3 bg-dark-100 border-b border-dark-300">
                <input
                  type="text"
                  value={newTagInput()}
                  onInput={(e) => setNewTagInput(e.target.value)}
                  placeholder="enter new tag name..."
                  class="w-full px-3 py-2 text-sm bg-dark-200 border border-dark-300 text-white placeholder-gray-400 focus:outline-none focus:border-magenta-400 rounded"
                  disabled={tagManagement.loading}
                />
                <div class="flex gap-2 mt-2">
                  <button
                    class="flex-1 px-3 py-1 text-xs bg-magenta-600 text-white hover:bg-magenta-500 disabled:opacity-50 rounded"
                    onClick={handleAddNewTag}
                    disabled={tagManagement.loading || !newTagInput().trim()}
                  >
                    {tagManagement.loading ? "adding..." : "add"}
                  </button>
                  <button
                    class="px-3 py-1 text-xs bg-gray-600 text-white hover:bg-gray-500 rounded"
                    onClick={() => {
                      setShowNewTagInput(false);
                      setNewTagInput("");
                    }}
                    disabled={tagManagement.loading}
                  >
                    cancel
                  </button>
                </div>
              </div>
            </Show>

            {/* Action Buttons */}
            <Show when={!showNewTagInput()}>
              <div class="p-3 border-b border-dark-300">
                <button
                  class="w-full px-3 py-2 text-left text-sm text-white hover:bg-dark-300 rounded flex items-center gap-2 transition-colors"
                  onClick={() => setShowNewTagInput(true)}
                  disabled={tagManagement.loading}
                >
                  <span>+</span>
                  <span>add new tag</span>
                </button>
              </div>
            </Show>

            {/* Recent Tags */}
            <Show when={getRecentTags().length > 0 && !showNewTagInput()}>
              <div class="p-3">
                <div class="text-gray-300 text-xs font-medium mb-2">
                  recent tags
                </div>
                <div class="space-y-1">
                  <For each={getRecentTags()}>
                    {(tagOption) => (
                      <Show when={!currentTags.includes(tagOption.value)}>
                        <button
                          class="w-full px-3 py-2 text-left text-sm text-white hover:bg-dark-300 rounded truncate transition-colors"
                          onClick={() => handleAddExistingTag(tagOption.value)}
                          disabled={tagManagement.loading}
                        >
                          <span>{tagOption.label}</span>
                          <Show when={tagOption.count}>
                            <span class="text-gray-400 text-xs ml-2">
                              ({tagOption.count})
                            </span>
                          </Show>
                        </button>
                      </Show>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
