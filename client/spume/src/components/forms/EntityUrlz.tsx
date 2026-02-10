// entity URL list editor - manages a collection of name/url pairs for any entity
import { createSignal, For, Index, Show } from "solid-js";
import { Icon, IconNames } from "../icons/registry";

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
  /** hide the label (default false) */
  hideLabel?: boolean;
}

/** inline url editor row - uses local state to avoid focus issues */
function UrlEditor(props: {
  url: EntityUrl;
  index: number;
  onUpdate: (index: number, field: "name" | "url", value: string) => void;
  onDelete: (index: number) => void;
  onDone: () => void;
}) {
  // use local state for the input fields to prevent re-render on every keystroke
  const [localName, setLocalName] = createSignal(props.url.name);
  const [localUrl, setLocalUrl] = createSignal(props.url.url);

  // sync to parent on blur or done
  const syncChanges = () => {
    if (localName() !== props.url.name) {
      props.onUpdate(props.index, "name", localName());
    }
    if (localUrl() !== props.url.url) {
      props.onUpdate(props.index, "url", localUrl());
    }
  };

  return (
    <div class="p-3 space-y-2">
      <div class="flex gap-2">
        <div class="flex-1">
          <input
            type="text"
            value={localName()}
            onInput={(e) => setLocalName(e.currentTarget.value)}
            onBlur={syncChanges}
            placeholder="label (e.g. wikipedia, discogs)"
            class="w-full px-3 py-2 text-sm bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 focus:outline-none placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      </div>
      <div>
        <input
          type="text"
          value={localUrl()}
          onInput={(e) => setLocalUrl(e.currentTarget.value)}
          onBlur={syncChanges}
          placeholder="https://..."
          class="w-full px-3 py-2 text-sm bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 focus:outline-none placeholder:text-[var(--color-text-muted)]"
        />
      </div>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => props.onDelete(props.index)}
          class="text-xs text-[var(--color-danger-500)] hover:text-[var(--color-danger-400)] px-2 py-1"
        >
          delete
        </button>
        <button
          type="button"
          onClick={() => {
            syncChanges();
            props.onDone();
          }}
          class="text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] px-2 py-1"
        >
          done
        </button>
      </div>
    </div>
  );
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
    const newIndex = props.urls.length;
    props.onChange([...props.urls, newUrl]);
    // set editing to the new item (auto edit mode)
    setEditingIndex(newIndex);
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
        <Show when={!props.hideLabel}>
          <label class="block text-sm text-[var(--color-text-secondary)]">links</label>
        </Show>
        <Show when={props.hideLabel}>
          {/* empty div to maintain flex layout when label hidden */}
          <div />
        </Show>
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
        when={visibleUrls().length > 0 || editingIndex() !== null}
        fallback={
          <div class="text-sm text-[var(--color-text-tertiary)] italic py-2">no links added</div>
        }
      >
        <div class="space-y-2">
          {/* use Index instead of For to preserve element identity during updates */}
          <Index each={props.urls}>
            {(url, index) => (
              <Show when={!url().isDeleted}>
                <div
                  class="group bg-[var(--color-bg-elevated)] rounded-md border border-[var(--color-border-default)] overflow-hidden"
                  classList={{
                    "border-[var(--color-accent-500)]": url().isNew,
                  }}
                >
                  <Show
                    when={editingIndex() === index}
                    fallback={
                      <div class="flex items-center gap-2 p-2">
                        <div class="flex-1 min-w-0">
                          <div class="text-sm text-[var(--color-text-primary)] truncate">
                            {url().name || "(unnamed)"}
                          </div>
                          <a
                            href={url().url}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-xs text-[var(--color-accent-500)] hover:underline truncate block"
                          >
                            {url().url || "(no url)"}
                          </a>
                        </div>
                        <Show when={!props.disabled}>
                          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => setEditingIndex(index)}
                              class="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                              title="edit"
                            >
                              <Icon name={IconNames.edit} size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(index)}
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
                    {/* editing mode - use separate component with local state */}
                    <UrlEditor
                      url={url()}
                      index={index}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onDone={() => setEditingIndex(null)}
                    />
                  </Show>
                </div>
              </Show>
            )}
          </Index>
        </div>
      </Show>

      {/* show deleted items that will be removed on save */}
      <Show when={props.urls.some((u) => u.isDeleted)}>
        <div class="mt-4 pt-4 border-t border-[var(--color-border-default)]">
          <label class="block text-xs text-[var(--color-text-tertiary)] mb-2">
            will be removed on save:
          </label>
          <For each={props.urls.filter((u) => u.isDeleted)}>
            {(url) => {
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
