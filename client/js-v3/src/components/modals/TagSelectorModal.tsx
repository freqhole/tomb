// tag selector modal for managing album tags
import * as apiClient from "freqhole-api-client";
import { createMemo, createSignal, For, Show } from "solid-js";
import { getCurrentRemote } from "../../music/data";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";

interface TagSelectorModalProps {
  /** album id(s) to manage tags for */
  albumIds: string[];
  /** optional album title to display (if single album) */
  albumTitle?: string;
  /** callback when modal should close */
  onClose: () => void;
  /** callback after successful save to invalidate queries */
  onSave?: () => void;
}

export function TagSelectorModal(props: TagSelectorModalProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [allTags, setAllTags] = createSignal<apiClient.Tag[]>([]);
  const [currentTags, setCurrentTags] = createSignal<Set<string>>(new Set());
  const [pendingChanges, setPendingChanges] = createSignal<{
    add: Set<string>;
    remove: Set<string>;
  }>({ add: new Set(), remove: new Set() });

  // load tags on mount
  (async () => {
    const remote = getCurrentRemote();
    if (!remote) return;

    setIsLoading(true);
    try {
      // load all tags
      const tagsResult = await apiClient.music.listTags(remote.base_url);
      if (tagsResult.success) {
        setAllTags(tagsResult.data);
      }

      // load current tags for the album(s) - returns union of all tags
      const albumIds = props.albumIds;
      const currentTagsResult = await apiClient.music.getAlbumsTags(
        remote.base_url,
        { album_ids: albumIds },
      );
      if (currentTagsResult.success) {
        setCurrentTags(new Set(currentTagsResult.data.map((t) => t.id)));
      }
    } catch (error) {
      console.error("failed to load tags:", error);
      toast.error("failed to load tags");
    } finally {
      setIsLoading(false);
    }
  })();

  // filter tags based on search query
  const filteredTags = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return allTags();
    return allTags().filter((tag) => tag.name.toLowerCase().includes(query));
  });

  // check if a tag is currently applied (including pending changes)
  const isTagApplied = (tagId: string) => {
    const changes = pendingChanges();
    if (changes.add.has(tagId)) return true;
    if (changes.remove.has(tagId)) return false;
    return currentTags().has(tagId);
  };

  // toggle tag selection
  const toggleTag = (tagId: string) => {
    const changes = pendingChanges();
    const isCurrentlyApplied = currentTags().has(tagId);

    if (isCurrentlyApplied) {
      // removing a tag that's currently applied
      if (changes.remove.has(tagId)) {
        // already marked for removal, cancel it
        changes.remove.delete(tagId);
      } else {
        // mark for removal
        changes.remove.add(tagId);
      }
      // remove from add set if it was there
      changes.add.delete(tagId);
    } else {
      // adding a tag that's not currently applied
      if (changes.add.has(tagId)) {
        // already marked for addition, cancel it
        changes.add.delete(tagId);
      } else {
        // mark for addition
        changes.add.add(tagId);
      }
      // remove from remove set if it was there
      changes.remove.delete(tagId);
    }

    setPendingChanges({ ...changes });
  };

  // add a new tag by name (backend will find or create)
  const addTagByName = async () => {
    const name = searchQuery().trim();
    if (!name) return;

    // check if tag already exists in our list
    const existing = allTags().find(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      // just select it
      toggleTag(existing.id);
      setSearchQuery("");
      return;
    }

    // mark it for addition - backend will create it during save
    // we'll add a temporary tag to show it in the UI
    const tempTag: apiClient.Tag = {
      id: `temp_${Date.now()}`,
      name,
      created_at: Date.now(),
    };
    setAllTags([...allTags(), tempTag]);
    const changes = pendingChanges();
    changes.add.add(tempTag.id);
    setPendingChanges({ ...changes });
    setSearchQuery("");
  };

  // apply changes and close modal
  const handleSave = async () => {
    const changes = pendingChanges();
    if (changes.add.size === 0 && changes.remove.size === 0) {
      props.onClose();
      return;
    }

    const remote = getCurrentRemote();
    if (!remote) return;

    setIsLoading(true);
    try {
      // collect tag names for tags to add (backend will find or create)
      const tagNamesToAdd = Array.from(changes.add)
        .map((id) => allTags().find((t) => t.id === id))
        .filter((t) => t !== undefined)
        .map((t) => t!.name);

      // collect tag IDs for tags to remove (filter out temp tags)
      const tagIdsToRemove = Array.from(changes.remove).filter(
        (id) => !id.startsWith("temp_"),
      );

      // add tags using tag_names (backend will find or create)
      if (tagNamesToAdd.length > 0) {
        await apiClient.music.addAlbumsTags(remote.base_url, {
          album_ids: props.albumIds,
          tag_ids: [],
          tag_names: tagNamesToAdd,
        });
      }

      // remove tags
      if (tagIdsToRemove.length > 0) {
        await apiClient.music.removeAlbumsTags(remote.base_url, {
          album_ids: props.albumIds,
          tag_ids: tagIdsToRemove,
        });
      }

      const albumText =
        props.albumIds.length === 1
          ? props.albumTitle || "album"
          : `${props.albumIds.length} albums`;
      toast.success(`updated tags for ${albumText}`);

      // call onSave callback to invalidate queries
      props.onSave?.();

      props.onClose();
    } catch (error) {
      console.error("failed to update tags:", error);
      toast.error("failed to update tags");
    } finally {
      setIsLoading(false);
    }
  };

  const hasPendingChanges = createMemo(() => {
    const changes = pendingChanges();
    return changes.add.size > 0 || changes.remove.size > 0;
  });

  const modalTitle = createMemo(() => {
    if (props.albumIds.length === 1 && props.albumTitle) {
      return `manage tags: ${props.albumTitle}`;
    } else if (props.albumIds.length > 1) {
      return `manage tags: ${props.albumIds.length} albums`;
    }
    return "manage tags";
  });

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => props.onClose()}
    >
      <div
        class="bg-[var(--color-bg-primary)] rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
            {modalTitle()}
          </h2>
          <button
            onClick={() => props.onClose()}
            class="p-1 hover:bg-[var(--color-bg-hover)] rounded transition-colors"
          >
            <Icon name={IconNames.close} size={20} />
          </button>
        </div>

        {/* search/create input */}
        <div class="p-4 border-b border-[var(--color-border-default)]">
          <div class="flex gap-2">
            <TextInput
              value={searchQuery()}
              oninput={(e) => setSearchQuery(e.currentTarget.value)}
              placeholder="search or create tag..."
              class="flex-1"
              disabled={isLoading()}
            />
            <Show when={searchQuery().trim() && !filteredTags().length}>
              <Button
                onClick={addTagByName}
                disabled={isLoading()}
                variant="primary"
              >
                add
              </Button>
            </Show>
          </div>
        </div>

        {/* tag list */}
        <div class="flex-1 overflow-y-auto p-4">
          <Show
            when={!isLoading()}
            fallback={
              <div class="flex items-center justify-center py-8 text-[var(--color-text-secondary)]">
                loading tags...
              </div>
            }
          >
            <Show
              when={filteredTags().length > 0}
              fallback={
                <div class="text-center py-8 text-[var(--color-text-secondary)]">
                  <Show
                    when={searchQuery().trim()}
                    fallback={<p>no tags yet</p>}
                  >
                    <p>no tags found</p>
                    <p class="text-sm mt-2">
                      click "add" to add "{searchQuery().trim()}"
                    </p>
                  </Show>
                </div>
              }
            >
              <div class="space-y-1">
                <For each={filteredTags()}>
                  {(tag) => {
                    const applied = () => isTagApplied(tag.id);
                    const isPending = () => {
                      const changes = pendingChanges();
                      return (
                        changes.add.has(tag.id) || changes.remove.has(tag.id)
                      );
                    };

                    return (
                      <button
                        onClick={() => toggleTag(tag.id)}
                        class={`
                          w-full flex items-center justify-between px-3 py-2 rounded
                          transition-colors text-left
                          ${
                            applied()
                              ? "bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)]"
                              : "hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
                          }
                          ${isPending() ? "ring-2 ring-[var(--color-accent-500)]/50" : ""}
                        `}
                      >
                        <span class="flex items-center gap-2">
                          <Icon name={IconNames.tag} size={14} />
                          {tag.name}
                        </span>
                        <Show when={applied()}>
                          <Icon
                            name={IconNames.check}
                            size={16}
                            color="var(--color-accent-500)"
                          />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        {/* footer */}
        <div class="flex items-center justify-between p-4 border-t border-[var(--color-border-default)]">
          <div class="text-sm text-[var(--color-text-secondary)]">
            <Show when={hasPendingChanges()}>
              {pendingChanges().add.size > 0 && (
                <span class="text-[var(--color-accent-500)]">
                  +{pendingChanges().add.size}
                </span>
              )}
              {pendingChanges().add.size > 0 &&
                pendingChanges().remove.size > 0 && <span> / </span>}
              {pendingChanges().remove.size > 0 && (
                <span class="text-red-500">
                  -{pendingChanges().remove.size}
                </span>
              )}
            </Show>
          </div>
          <div class="flex gap-2">
            <Button onClick={props.onClose} variant="ghost">
              cancel
            </Button>
            <Button
              onClick={handleSave}
              variant="primary"
              disabled={isLoading() || !hasPendingChanges()}
            >
              save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
