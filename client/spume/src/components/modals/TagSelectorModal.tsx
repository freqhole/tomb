// generic tag selector modal — supports any entity kind (album, video,
// ...) via a pluggable TagAdapter, with aggregated tag state across one
// or many selected entities.
import { createMemo, createSignal, For, Show } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Modal } from "./Modal";
import type { Tag, TagAdapter } from "./tagAdapters/types";

interface TagSelectorModalProps {
  /** entity id(s) to manage tags for (e.g. album ids, video ids) */
  entityIds: string[];
  /** optional entity title to display (if a single entity) */
  entityTitle?: string;
  /** plural noun used in the multi-select title, e.g. "albums"/"videos" */
  entityKindLabel?: string;
  /** backend that actually reads/writes tags for this entity kind */
  adapter: TagAdapter;
  /** when set, all reads + writes are routed through this remote's
   *  api client rather than the active datasource. needed by views
   *  (e.g. library) that browse a remote which isn't the global
   *  active source. */
  remote?: Remote;
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
  // track how many entities have each tag: tagId -> count
  const [tagCounts, setTagCounts] = createSignal<Map<string, number>>(new Map());
  const [pendingChanges, setPendingChanges] = createSignal<{
    add: Set<string>;
    remove: Set<string>;
  }>({ add: new Set(), remove: new Set() });

  const entityCount = () => props.entityIds.length;

  // load tags on mount
  (async () => {
    setIsLoading(true);
    try {
      const [tags, counts] = await Promise.all([
        props.adapter.listAllTags(props.remote),
        props.adapter.getEntityTagCounts(props.entityIds, props.remote),
      ]);
      setAllTags(tags);
      setTagCounts(counts);
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

  // get the state of a tag across all entities
  const getTagState = (tagId: string): TagState => {
    const changes = pendingChanges();

    // pending changes override current state
    if (changes.add.has(tagId)) return "all";
    if (changes.remove.has(tagId)) return "none";

    const count = tagCounts().get(tagId) || 0;
    if (count === 0) return "none";
    if (count === entityCount()) return "all";
    return "some";
  };

  // toggle tag selection
  const toggleTag = (tagId: string) => {
    const changes = pendingChanges();
    const state = getTagState(tagId);

    if (state === "all" || state === "some") {
      // tag is on some/all entities - toggle means remove
      if (changes.remove.has(tagId)) {
        // already marked for removal, cancel it
        changes.remove.delete(tagId);
      } else {
        // mark for removal from all entities
        changes.remove.add(tagId);
        changes.add.delete(tagId);
      }
    } else {
      // tag is on no entities - toggle means add
      if (changes.add.has(tagId)) {
        // already marked for addition, cancel it
        changes.add.delete(tagId);
      } else {
        // mark for addition to all entities
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

    setIsLoading(true);
    try {
      // collect tag names for tags to add
      const tagNamesToAdd = Array.from(changes.add)
        .map((id) => allTags().find((t) => t.tag_id === id))
        .filter((t) => t !== undefined)
        .map((t) => t!.name);

      // collect tag IDs for tags to remove (filter out temp tags)
      const tagIdsToRemove = Array.from(changes.remove).filter((id) => !id.startsWith("temp_"));

      await props.adapter.addTags(props.entityIds, tagNamesToAdd, props.remote);
      await props.adapter.removeTags(props.entityIds, tagIdsToRemove, props.remote);

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
    if (props.entityIds.length === 1 && props.entityTitle) {
      return `manage tags: ${props.entityTitle}`;
    } else if (props.entityIds.length > 1) {
      return `manage tags: ${props.entityIds.length} ${props.entityKindLabel ?? "items"}`;
    }
    return "manage tags";
  });

  return (
    <Modal
      isOpen={true}
      onClose={() => props.onClose()}
      title={modalTitle()}
      size="sm"
      footer={
        <div class="flex items-center justify-between p-4">
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
      }
    >
      {/* search/create input */}
      <div class="p-4 border-b border-[var(--color-border-default)] flex-shrink-0">
        <Show when={props.entityIds.length > 1}>
          <p class="text-xs text-[var(--color-text-tertiary)] mb-2">
            changes will apply to all selected {props.entityKindLabel ?? "items"}
          </p>
        </Show>
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
                        {/* show count badge for partial state with multiple entities */}
                        <Show when={state() === "some" && entityCount() > 1}>
                          <span class="text-xs bg-yellow-500/20 px-1.5 py-0.5 rounded">
                            {count()}/{entityCount()}
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
    </Modal>
  );
}
