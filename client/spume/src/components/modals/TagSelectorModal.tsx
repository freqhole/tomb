// tag selector modal for managing album tags
// supports single or multiple albums with aggregated tag state
import { createMemo, createSignal, For, Show } from "solid-js";
import { getDataSource } from "../../music/data";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";

interface Tag {
  tag_id: string;
  name: string;
  created_at: number;
}

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

type TagState = "all" | "some" | "none";

export function TagSelectorModal(props: TagSelectorModalProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [allTags, setAllTags] = createSignal<Tag[]>([]);
  // track how many albums have each tag: tagId -> count
  const [tagCounts, setTagCounts] = createSignal<Map<string, number>>(new Map());
  const [pendingChanges, setPendingChanges] = createSignal<{
    add: Set<string>;
    remove: Set<string>;
  }>({ add: new Set(), remove: new Set() });

  const albumCount = () => props.albumIds.length;

  // load tags on mount
  (async () => {
    const datasource = await getDataSource();

    setIsLoading(true);
    try {
      // load all available tags
      const tags = await datasource.getTags?.();
      if (tags) {
        setAllTags(tags);
      }

      // load tags for ALL albums and count occurrences
      if (props.albumIds.length > 0 && datasource.getAlbumTags) {
        const counts = new Map<string, number>();

        for (const albumId of props.albumIds) {
          const tagNames = await datasource.getAlbumTags(albumId);
          if (tagNames) {
            for (const name of tagNames) {
              const tag = tags?.find((t) => t.name === name);
              if (tag) {
                counts.set(tag.tag_id, (counts.get(tag.tag_id) || 0) + 1);
              }
            }
          }
        }

        setTagCounts(counts);
      }
    } catch (err) {
      console.error("failed to load tags:", err);
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

  // get the state of a tag across all albums
  const getTagState = (tagId: string): TagState => {
    const changes = pendingChanges();

    // pending changes override current state
    if (changes.add.has(tagId)) return "all";
    if (changes.remove.has(tagId)) return "none";

    const count = tagCounts().get(tagId) || 0;
    if (count === 0) return "none";
    if (count === albumCount()) return "all";
    return "some";
  };

  // toggle tag selection
  const toggleTag = (tagId: string) => {
    const changes = pendingChanges();
    const state = getTagState(tagId);

    if (state === "all" || state === "some") {
      // tag is on some/all albums - toggle means remove
      if (changes.remove.has(tagId)) {
        // already marked for removal, cancel it
        changes.remove.delete(tagId);
      } else {
        // mark for removal from all albums
        changes.remove.add(tagId);
        changes.add.delete(tagId);
      }
    } else {
      // tag is on no albums - toggle means add
      if (changes.add.has(tagId)) {
        // already marked for addition, cancel it
        changes.add.delete(tagId);
      } else {
        // mark for addition to all albums
        changes.add.add(tagId);
        changes.remove.delete(tagId);
      }
    }

    setPendingChanges({ ...changes });
  };

  // add a new tag by name (backend will find or create)
  const addTagByName = async () => {
    const name = searchQuery().trim();
    if (!name) return;

    // check if tag already exists in our list
    const existing = allTags().find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      // just select it
      toggleTag(existing.tag_id);
      setSearchQuery("");
      return;
    }

    // mark it for addition - backend will create it during save
    // we'll add a temporary tag to show it in the UI
    const tempTag: Tag = {
      tag_id: `temp_${Date.now()}`,
      name,
      created_at: Date.now(),
    };
    setAllTags([...allTags(), tempTag]);
    const changes = pendingChanges();
    changes.add.add(tempTag.tag_id);
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

    const datasource = await getDataSource();

    setIsLoading(true);
    try {
      // collect tag names for tags to add
      const tagNamesToAdd = Array.from(changes.add)
        .map((id) => allTags().find((t) => t.tag_id === id))
        .filter((t) => t !== undefined)
        .map((t) => t!.name);

      // collect tag IDs for tags to remove (filter out temp tags)
      const tagIdsToRemove = Array.from(changes.remove).filter((id) => !id.startsWith("temp_"));

      // add tags (datasource will find or create)
      if (tagNamesToAdd.length > 0) {
        for (const albumId of props.albumIds) {
          await datasource.addTagsToAlbum?.(albumId, tagNamesToAdd);
        }
      }

      // remove tags
      if (tagIdsToRemove.length > 0) {
        for (const albumId of props.albumIds) {
          await datasource.removeTagsFromAlbum?.(albumId, tagIdsToRemove);
        }
      }

      // call onSave callback to invalidate queries
      props.onSave?.();

      props.onClose();
    } catch (err) {
      console.error("failed to save tags:", err);
      toast.error("failed to save tags");
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
      class="flex items-center justify-center bg-black/50"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 50 }}
      onClick={() => props.onClose()}
    >
      <div
        class="bg-[var(--color-bg-primary)] wide:rounded-lg shadow-xl w-full h-full wide:h-auto wide:max-w-md wide:max-h-[80dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <div>
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">{modalTitle()}</h2>
            <Show when={props.albumIds.length > 1}>
              <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                changes will apply to all selected albums
              </p>
            </Show>
          </div>
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
              <Button onClick={addTagByName} disabled={isLoading()} variant="primary">
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
                  <Show when={searchQuery().trim()} fallback={<p>no tags yet</p>}>
                    <p>no tags found</p>
                    <p class="text-sm mt-2">click "add" to add "{searchQuery().trim()}"</p>
                  </Show>
                </div>
              }
            >
              <div class="space-y-1">
                <For each={filteredTags()}>
                  {(tag) => {
                    const state = () => getTagState(tag.tag_id);
                    const isPending = () => {
                      const changes = pendingChanges();
                      return changes.add.has(tag.tag_id) || changes.remove.has(tag.tag_id);
                    };
                    const count = () => tagCounts().get(tag.tag_id) || 0;

                    return (
                      <button
                        onClick={() => toggleTag(tag.tag_id)}
                        class={`
                          w-full flex items-center justify-between px-3 py-2 rounded
                          transition-colors text-left
                          ${
                            state() === "all"
                              ? "bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)]"
                              : state() === "some"
                                ? "bg-yellow-500/10 text-yellow-500"
                                : "hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
                          }
                          ${isPending() ? "ring-2 ring-[var(--color-accent-500)]/50" : ""}
                        `}
                      >
                        <span class="flex items-center gap-2">
                          <Icon name={IconNames.tag} size={14} />
                          {tag.name}
                          {/* show count badge for partial state with multiple albums */}
                          <Show when={state() === "some" && albumCount() > 1}>
                            <span class="text-xs bg-yellow-500/20 px-1.5 py-0.5 rounded">
                              {count()}/{albumCount()}
                            </span>
                          </Show>
                        </span>
                        <Show when={state() === "all"}>
                          <Icon name={IconNames.check} size={16} color="var(--color-accent-500)" />
                        </Show>
                        <Show when={state() === "some"}>
                          <span class="w-2 h-0.5 bg-yellow-500 rounded" />
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
                <span class="text-[var(--color-accent-500)]">+{pendingChanges().add.size}</span>
              )}
              {pendingChanges().add.size > 0 && pendingChanges().remove.size > 0 && " "}
              {pendingChanges().remove.size > 0 && (
                <span class="text-red-400">-{pendingChanges().remove.size}</span>
              )}
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Button onClick={props.onClose} disabled={isLoading()} variant="ghost">
              cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isLoading() || !hasPendingChanges()}
              variant="primary"
            >
              {isLoading() ? "saving..." : "save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
