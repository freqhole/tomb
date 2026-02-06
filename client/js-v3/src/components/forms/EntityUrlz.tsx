// entity URL list editor - manages a collection of name/url pairs for any entity
import { createSignal, For, Show } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import { TextInput } from "./TextInput";
import { Button } from "../buttons/Button";

export interface EntityUrl {
  id?: string;
  name: string;
  url: string;
  isNew?: boolean;
  isDeleted?: boolean;
}

interface EntityUrlzProps {
  urls: EntityUrl[];
  onChange: (urls: EntityUrl[]) => void;
  disabled?: boolean;
  /** max number of URLs allowed (default unlimited) */
  maxUrls?: number;
}

export function EntityUrlz(props: EntityUrlzProps) {
  const [editingIndex, setEditingIndex] = createSignal<number | null>(null);

  const visibleUrls = () => props.urls.filter((u) => !u.isDeleted);
  const canAddMore = () => !props.maxUrls || visibleUrls().length < props.maxUrls;

  const handleAdd = () => {
    if (!canAddMore()) return;
    const newUrl: EntityUrl = {
      name: "",
      url: "",
      isNew: true,
    };
    props.onChange([...props.urls, newUrl]);
    // set editing to the new item
    setEditingIndex(props.urls.length);
  };

  const handleUpdate = (index: number, field: "name" | "url", value: string) => {
    const updated = [...props.urls];
    updated[index] = { ...updated[index], [field]: value };
    props.onChange(updated);
  };

  const handleDelete = (index: number) => {
    const url = props.urls[index];
    if (url.isNew) {
      // new items can be removed entirely
      const updated = props.urls.filter((_, i) => i !== index);
      props.onChange(updated);
    } else {
      // existing items get marked as deleted
      const updated = [...props.urls];
      updated[index] = { ...updated[index], isDeleted: true };
      props.onChange(updated);
    }
    if (editingIndex() === index) {
      setEditingIndex(null);
    }
  };

  const handleRestore = (index: number) => {
    const updated = [...props.urls];
    updated[index] = { ...updated[index], isDeleted: false };
    props.onChange(updated);
  };

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <label class="block text-sm text-[var(--color-text-secondary)]">links</label>
        <Show when={!props.disabled && canAddMore()}>
          <button
            type="button"
            onClick={handleAdd}
            class="flex items-center gap-1 text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] transition-colors"
          >
            <Icon name={IconNames.add} size={14} />
            add link
          </button>
        </Show>
      </div>

      <Show
        when={visibleUrls().length > 0}
        fallback={
          <div class="text-sm text-[var(--color-text-tertiary)] italic py-2">no links added</div>
        }
      >
        <div class="space-y-2">
          <For each={props.urls}>
            {(url, index) => (
              <Show when={!url.isDeleted}>
                <div
                  class="group bg-[var(--color-bg-elevated)] rounded-md border border-[var(--color-border-default)] overflow-hidden"
                  classList={{
                    "border-[var(--color-accent-500)]": url.isNew,
                  }}
                >
                  <Show
                    when={editingIndex() === index()}
                    fallback={
                      <div class="flex items-center gap-2 p-2">
                        <div class="flex-1 min-w-0">
                          <div class="text-sm text-[var(--color-text-primary)] truncate">
                            {url.name || "(unnamed)"}
                          </div>
                          <a
                            href={url.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-xs text-[var(--color-accent-500)] hover:underline truncate block"
                          >
                            {url.url || "(no url)"}
                          </a>
                        </div>
                        <Show when={!props.disabled}>
                          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => setEditingIndex(index())}
                              class="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                              title="edit"
                            >
                              <Icon name={IconNames.edit} size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(index())}
                              class="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger-500)]"
                              title="delete"
                            >
                              <Icon name={IconNames.delete} size={14} />
                            </button>
                          </div>
                        </Show>
                      </div>
                    }
                  >
                    {/* editing mode */}
                    <div class="p-3 space-y-2">
                      <div class="flex gap-2">
                        <div class="flex-1">
                          <TextInput
                            value={url.name}
                            oninput={(e) => handleUpdate(index(), "name", e.currentTarget.value)}
                            placeholder="label (e.g. wikipedia, discogs)"
                            class="text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <TextInput
                          value={url.url}
                          oninput={(e) => handleUpdate(index(), "url", e.currentTarget.value)}
                          placeholder="https://..."
                          class="text-sm"
                        />
                      </div>
                      <div class="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(index())}
                          class="text-xs text-[var(--color-danger-500)] hover:text-[var(--color-danger-400)] px-2 py-1"
                        >
                          delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingIndex(null)}
                          class="text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] px-2 py-1"
                        >
                          done
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
            )}
          </For>
        </div>
      </Show>

      {/* show deleted items that will be removed on save */}
      <Show when={props.urls.some((u) => u.isDeleted)}>
        <div class="mt-4 pt-4 border-t border-[var(--color-border-default)]">
          <label class="block text-xs text-[var(--color-text-tertiary)] mb-2">
            will be removed on save:
          </label>
          <For each={props.urls.filter((u) => u.isDeleted)}>
            {(url, index) => {
              const originalIndex = props.urls.findIndex((u) => u === url);
              return (
                <div class="flex items-center justify-between py-1 px-2 bg-[var(--color-bg-elevated)] rounded text-sm opacity-50">
                  <span class="line-through">{url.name || url.url}</span>
                  <Show when={!props.disabled}>
                    <button
                      type="button"
                      onClick={() => handleRestore(originalIndex)}
                      class="text-xs text-[var(--color-accent-500)] hover:underline"
                    >
                      restore
                    </button>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
