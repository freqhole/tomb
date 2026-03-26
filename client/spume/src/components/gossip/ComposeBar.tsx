import { createSignal, For, Show, type JSX } from "solid-js";
import type { MusicReference } from "../../../stories/gossip/mockGossipData";
import { MusicIcon } from "../icons/registry";
import { AlbumIcon, ArtistIcon, PlaylistIcon, GenreIcon, ArrowUpIcon } from "../icons/navigation";

export interface ComposeBarProps {
  onSend: (text: string, attachments: MusicReference[]) => void;
  onSearchMusic?: (query: string) => void;
  /** stubbed search results for storybook */
  searchResults?: MusicReference[];
  placeholder?: string;
  disabled?: boolean;
  /** whether text input is allowed (default true) — if false, only music attachments */
  allowText?: boolean;
}

/** format ref type icon */
function refIcon(type: string): JSX.Element {
  switch (type) {
    case "Song":
      return <MusicIcon size={12} />;
    case "Album":
      return <AlbumIcon size={12} />;
    case "Artist":
      return <ArtistIcon size={12} />;
    case "Playlist":
      return <PlaylistIcon size={12} />;
    case "Genre":
      return <GenreIcon size={12} />;
    default:
      return <MusicIcon size={12} />;
  }
}

/** get display title for a music ref */
function refTitle(item: MusicReference): string {
  return item.title ?? item.name ?? "untitled";
}

export function ComposeBar(props: ComposeBarProps) {
  const [text, setText] = createSignal("");
  const [attachments, setAttachments] = createSignal<MusicReference[]>([]);
  const [showSearch, setShowSearch] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");

  const textAllowed = () => props.allowText !== false;
  const canSend = () =>
    ((textAllowed() && text().trim().length > 0) || attachments().length > 0) && !props.disabled;

  const handleSend = () => {
    if (!canSend()) return;
    props.onSend(text().trim(), attachments());
    setText("");
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const addAttachment = (item: MusicReference) => {
    // don't add duplicates
    if (
      attachments().some(
        (a) => a.remote_id === item.remote_id && a.source_node_id === item.source_node_id
      )
    )
      return;
    setAttachments((prev) => [...prev, item]);
    setShowSearch(false);
    setSearchQuery("");
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSearchInput = (query: string) => {
    setSearchQuery(query);
    props.onSearchMusic?.(query);
  };

  return (
    <div class="bg-[var(--color-bg-secondary)] p-3">
      {/* attachment chips */}
      <Show when={attachments().length > 0}>
        <div class="flex flex-wrap gap-1.5 mb-2">
          <For each={attachments()}>
            {(item, i) => (
              <span class="inline-flex items-center gap-1 px-2 py-1 bg-[var(--color-bg-tertiary)] rounded-md text-xs text-[var(--color-text-secondary)]">
                <span>{refIcon(item.ref_type)}</span>
                <span class="max-w-[120px] truncate">{refTitle(item)}</span>
                <button
                  class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] ml-0.5"
                  onClick={() => removeAttachment(i())}
                >
                  ×
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* search dropdown */}
      <Show when={showSearch()}>
        <div class="mb-2 bg-[var(--color-bg-elevated)] rounded-lg p-2">
          <input
            type="text"
            class="w-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)]"
            placeholder="search music to attach..."
            value={searchQuery()}
            onInput={(e) => handleSearchInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowSearch(false);
            }}
            autofocus
          />
          <Show when={props.searchResults && props.searchResults.length > 0}>
            <div class="mt-1.5 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              <For each={props.searchResults}>
                {(item) => (
                  <button
                    class="flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[var(--color-bg-tertiary)] transition-colors"
                    onClick={() => addAttachment(item)}
                  >
                    <span class="text-xs">{refIcon(item.ref_type)}</span>
                    <span class="text-sm text-[var(--color-text-primary)] truncate">
                      {refTitle(item)}
                    </span>
                    <span class="text-[10px] text-[var(--color-text-tertiary)] ml-auto">
                      {item.ref_type}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show
            when={
              props.searchResults && props.searchResults.length === 0 && searchQuery().length > 0
            }
          >
            <p class="text-xs text-[var(--color-text-tertiary)] mt-1.5 px-2">no results</p>
          </Show>
        </div>
      </Show>

      {/* input row */}
      <div class="flex items-end gap-2">
        <button
          class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] hover:bg-[var(--color-bg-tertiary)] transition-colors text-sm"
          onClick={() => setShowSearch((v) => !v)}
          title="attach music"
          classList={{ "text-[var(--color-accent-500)]": showSearch() }}
        >
          <MusicIcon size={16} />
        </button>

        <Show when={textAllowed()}>
          <textarea
            class="flex-1 bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-base rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)] resize-none min-h-[44px] max-h-[120px]"
            placeholder={props.placeholder ?? "share something..."}
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={props.disabled}
            rows={1}
          />
        </Show>

        <Show when={!textAllowed()}>
          <div class="flex-1 text-xs text-[var(--color-text-tertiary)] self-center">
            {attachments().length === 0 ? "select music to share" : ""}
          </div>
        </Show>

        <button
          class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors text-sm"
          classList={{
            "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-400)]":
              canSend(),
            "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed":
              !canSend(),
          }}
          onClick={handleSend}
          disabled={!canSend()}
          title="send"
        >
          <ArrowUpIcon size={14} />
        </button>
      </div>
    </div>
  );
}
