import { createSignal, createResource, Show, For, onMount } from "solid-js";
import { apiClient } from "../../lib/api-client";
import { useAuth } from "../../hooks/auth";
import { useGlobalEvents } from "../../views/freqhole/hooks/useGlobalEvents";
import type { Song } from "../../lib/music/schemas/song";

interface TagSelectorMenuProps {
  songs: Song[];
  onClose: () => void;
  mode: "view" | "manage";
}

export function TagSelectorMenu(props: TagSelectorMenuProps) {
  const auth = useAuth();
  const events = useGlobalEvents();

  const [newTagInput, setNewTagInput] = createSignal("");
  const [showNewTagInput, setShowNewTagInput] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  // Get all tags from the selected songs
  const allSongTags = () => {
    const tagSet = new Set<string>();
    props.songs.forEach((song) => {
      if (song.tags) {
        song.tags.forEach((tag) => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  };

  // Fetch available tags for autocomplete
  const [availableTags] = createResource(async () => {
    try {
      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/filter-options"
      );
      return response?.tags?.items || [];
    } catch (error) {
      console.error("failed to fetch available tags:", error);
      return [];
    }
  });

  const handleRemoveTag = async (tag: string) => {
    if (!auth.isAdmin || loading()) return;

    setLoading(true);
    try {
      const songIds = props.songs.map((song) => song.id);
      await apiClient.removeTagsFromSongs(songIds, [tag]);

      // Emit reload event to refresh song data
      events.emit("data:reload", { type: "songs" });
      props.onClose();
    } catch (error) {
      console.error("failed to remove tag:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNewTag = async () => {
    const tagName = newTagInput().trim();
    if (!tagName || !auth.isAdmin || loading()) return;

    setLoading(true);
    try {
      const songIds = props.songs.map((song) => song.id);
      await apiClient.addTagsToSongs(songIds, [tagName]);
      setNewTagInput("");
      setShowNewTagInput(false);

      // Emit reload event to refresh song data
      events.emit("data:reload", { type: "songs" });
      props.onClose();
    } catch (error) {
      console.error("failed to add tag:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddExistingTag = async (tag: string) => {
    if (!auth.isAdmin || loading()) return;

    setLoading(true);
    try {
      const songIds = props.songs.map((song) => song.id);
      await apiClient.addTagsToSongs(songIds, [tag]);

      // Emit reload event to refresh song data
      events.emit("data:reload", { type: "songs" });
      props.onClose();
    } catch (error) {
      console.error("failed to add tag:", error);
    } finally {
      setLoading(false);
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
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const songCount = props.songs.length;
  const currentTags = allSongTags();
  const isReadOnly = props.mode === "view" || !auth.isAdmin;

  console.log("TagSelectorMenu rendering:", {
    mode: props.mode,
    songCount: props.songs.length,
    currentTags: currentTags.length,
    isReadOnly,
  });

  return (
    <div class="w-64 max-h-96 overflow-y-auto bg-gray-900 border border-gray-700">
      {/* Header */}
      <div class="p-3 border-b border-gray-700 bg-gray-800">
        <div class="text-white text-sm font-medium">
          {props.mode === "view" ? "tags" : "manage tags"}
        </div>
        <div class="text-gray-400 text-xs">
          {songCount} song{songCount !== 1 ? "s" : ""} selected
        </div>
      </div>

      {/* Current Tags */}
      <Show when={currentTags.length > 0}>
        <div class="p-2">
          <div class="text-gray-300 text-xs font-medium mb-2 px-1">
            current tags
          </div>
          <div class="space-y-1">
            <For each={currentTags}>
              {(tag) => (
                <div class="flex items-center justify-between px-2 py-1 text-sm text-white hover:bg-gray-700 rounded">
                  <span class="flex-1 truncate">{tag}</span>
                  <Show when={!isReadOnly}>
                    <button
                      class="ml-2 text-red-400 hover:text-red-300 text-xs"
                      onClick={() => handleRemoveTag(tag)}
                      disabled={loading()}
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
        <div class="p-3 text-gray-500 text-sm text-center">
          no tags assigned
        </div>
      </Show>

      {/* Admin Actions */}
      <Show when={!isReadOnly}>
        <div class="border-t border-gray-700">
          {/* Add New Tag Input */}
          <Show when={showNewTagInput()}>
            <div class="p-2 bg-gray-800">
              <input
                type="text"
                value={newTagInput()}
                onInput={(e) => setNewTagInput(e.target.value)}
                placeholder="enter new tag name..."
                class="w-full px-2 py-1 text-sm bg-black text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-magenta-500"
                disabled={loading()}
              />
              <div class="flex gap-1 mt-2">
                <button
                  class="flex-1 px-2 py-1 text-xs bg-magenta-600 text-white hover:bg-magenta-500 disabled:opacity-50"
                  onClick={handleAddNewTag}
                  disabled={loading() || !newTagInput().trim()}
                >
                  {loading() ? "adding..." : "add"}
                </button>
                <button
                  class="px-2 py-1 text-xs bg-gray-700 text-white hover:bg-gray-600"
                  onClick={() => {
                    setShowNewTagInput(false);
                    setNewTagInput("");
                  }}
                  disabled={loading()}
                >
                  cancel
                </button>
              </div>
            </div>
          </Show>

          {/* Action Buttons */}
          <Show when={!showNewTagInput()}>
            <div class="p-2 space-y-1">
              <button
                class="w-full px-2 py-1 text-left text-sm text-white hover:bg-gray-700 rounded flex items-center gap-2"
                onClick={() => setShowNewTagInput(true)}
                disabled={loading()}
              >
                <span>+</span>
                <span>add new tag</span>
              </button>

              {/* Available Tags */}
              <Show when={availableTags()?.length > 0}>
                <div class="text-gray-400 text-xs font-medium px-1 mt-2 mb-1">
                  available tags
                </div>
                <div class="max-h-32 overflow-y-auto">
                  <For each={availableTags().slice(0, 10)}>
                    {(tagOption) => (
                      <Show when={!currentTags.includes(tagOption.value)}>
                        <button
                          class="w-full px-2 py-1 text-left text-sm text-white hover:bg-gray-700 rounded truncate"
                          onClick={() => handleAddExistingTag(tagOption.value)}
                          disabled={loading()}
                        >
                          {tagOption.label}
                          <Show when={tagOption.count}>
                            <span class="text-gray-400 text-xs ml-1">
                              ({tagOption.count})
                            </span>
                          </Show>
                        </button>
                      </Show>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* Footer */}
      <div class="p-2 border-t border-gray-700 bg-gray-800">
        <button
          class="w-full px-2 py-1 text-sm bg-gray-700 text-white hover:bg-gray-600 rounded"
          onClick={props.onClose}
        >
          close
        </button>
      </div>
    </div>
  );
}
