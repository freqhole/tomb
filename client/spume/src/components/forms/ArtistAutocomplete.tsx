// artist autocomplete - lightweight typeahead with "create new" option.
//
// rewritten during the taxonomy refactor to drop the kobalte combobox
// dependency in favor of the same plain-input + absolute popover
// pattern used by TaxonAutocomplete. the public api (props/onSelect
// shape) is unchanged, so existing call sites do not need updates.
//
// behavior:
//   * shows `props.value` as the input's text (synced via createEffect)
//   * debounced async query for matches
//   * arrow keys navigate; enter picks the highlighted row, or — when
//     the typed text has no exact match — fires onSelect with isNew
//   * mousedown on a row picks; click outside closes the popover

import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { ImageMetadata } from "../../music/services/storage/types";
import { useArtistAutocompleteQuery } from "../../music/queries/autocomplete";
import { MediaImage } from "../media/MediaImage";

export interface ArtistAutocompleteProps {
  /** current artist name value */
  value?: string;
  /** callback when artist is selected */
  onSelect: (selection: { id?: string; name: string; isNew: boolean }) => void;
  /** label for the input */
  label?: string;
  /** placeholder text */
  placeholder?: string;
  /** whether the input is disabled */
  disabled?: boolean;
  /** additional classes */
  class?: string;
  /** hint text */
  hint?: string;
  /** custom label for the "create new" option (default: "create new: {input}") */
  newLabel?: (input: string) => string;
}

interface ArtistOption {
  id: string;
  name: string;
  songCount?: number;
  albumCount?: number;
  images?: ImageMetadata[];
  thumbnailUrl?: string;
  isFavorite?: boolean;
}

const DEBOUNCE_MS = 180;

export function ArtistAutocomplete(props: ArtistAutocompleteProps) {
  let inputEl: HTMLInputElement | undefined;
  let containerEl: HTMLDivElement | undefined;

  const [text, setText] = createSignal(props.value ?? "");
  const [debounced, setDebounced] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  // sync local text whenever props.value changes (eg. parent reset).
  // we only push the prop value in when the input is not focused, so
  // typing isn't clobbered mid-stream.
  createEffect(() => {
    const v = props.value ?? "";
    if (document.activeElement !== inputEl) setText(v);
  });

  // debounce the query string so we don't hammer the server
  createEffect(
    on(text, (t) => {
      const timer = window.setTimeout(() => setDebounced(t.trim()), DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    })
  );

  // pull results via the existing autocomplete query hook (same source
  // of truth as the prior kobalte version).
  const debouncedAccessor = () => (debounced().length > 0 ? debounced() : undefined);
  const artistQuery = useArtistAutocompleteQuery(debouncedAccessor);

  const options = createMemo<ArtistOption[]>(() => {
    const items = artistQuery.data?.items || [];
    return items.map((item) => ({
      id: item.artist_id,
      name: item.name,
      songCount: item.song_count,
      albumCount: item.album_count,
      images: item.images,
      thumbnailUrl: undefined,
      isFavorite: item.is_favorite === true,
    }));
  });

  // can we offer a "create new" row? only when the typed text doesn't
  // exactly match any existing option label.
  const exactMatch = createMemo<ArtistOption | undefined>(() => {
    const q = text().trim().toLowerCase();
    if (!q) return undefined;
    return options().find((o) => o.name.toLowerCase() === q);
  });
  const canCreate = createMemo(() => text().trim().length > 0 && !exactMatch());

  // keep highlight in range as the option list shrinks/grows.
  createEffect(() => {
    const max = options().length - 1;
    if (highlight() > Math.max(0, max)) setHighlight(0);
  });

  const onDocClick = (e: MouseEvent) => {
    if (!containerEl) return;
    if (!containerEl.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  const pickExisting = (opt: ArtistOption) => {
    setText(opt.name);
    setOpen(false);
    setHighlight(0);
    props.onSelect({ id: opt.id, name: opt.name, isNew: false });
  };

  const pickNew = () => {
    const trimmed = text().trim();
    if (!trimmed) return;
    setOpen(false);
    setHighlight(0);
    props.onSelect({ id: undefined, name: trimmed, isNew: true });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const max = options().length - 1;
      setHighlight((h) => Math.min(h + 1, Math.max(0, max)));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opts = options();
      const idx = highlight();
      if (opts[idx]) {
        pickExisting(opts[idx]);
      } else if (canCreate()) {
        pickNew();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const newLabel = (input: string) =>
    props.newLabel ? props.newLabel(input) : `create new: ${input}`;

  return (
    <div ref={containerEl} class={`relative ${props.class ?? ""}`}>
      <Show when={props.label}>
        <label class="block text-sm text-[var(--color-text-secondary)] mb-1">{props.label}</label>
      </Show>

      <div class="relative">
        <input
          ref={inputEl}
          type="text"
          value={text()}
          disabled={props.disabled}
          placeholder={props.placeholder || "search or type artist name..."}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Show when={artistQuery.isFetching}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <div class="animate-spin w-4 h-4 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
          </div>
        </Show>
      </div>

      <Show when={props.hint}>
        <p class="text-xs text-[var(--color-text-tertiary)] mt-1">{props.hint}</p>
      </Show>

      <Show when={open() && !props.disabled}>
        <div class="absolute left-0 right-0 top-full mt-1 z-[1100] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg max-h-80 overflow-y-auto">
          <Show
            when={options().length > 0 || canCreate()}
            fallback={
              <div class="px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
                {artistQuery.isFetching ? "searching…" : "no matches"}
              </div>
            }
          >
            <Show when={canCreate()}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickNew();
                }}
                class="w-full text-left px-4 py-2 text-sm border-b border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] flex items-center gap-2 text-[var(--color-text-secondary)]"
              >
                <span class="font-medium">{newLabel(text().trim())}</span>
              </button>
            </Show>

            <For each={options()}>
              {(opt, i) => (
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i())}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickExisting(opt);
                  }}
                  class={`w-full text-left px-4 py-2 transition-colors flex items-center gap-3 ${
                    i() === highlight()
                      ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                      : "hover:bg-[var(--color-bg-hover)]"
                  }`}
                >
                  <MediaImage
                    images={opt.images}
                    imageUrl={opt.thumbnailUrl || null}
                    alt=""
                    class="w-10 h-10 object-cover rounded flex-shrink-0"
                    domainType="artist"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm truncate">{opt.name}</div>
                    <div
                      class={`text-xs ${
                        i() === highlight() ? "opacity-90" : "text-[var(--color-text-tertiary)]"
                      }`}
                    >
                      {opt.songCount || 0} song{opt.songCount === 1 ? "" : "s"}
                      {" · "}
                      {opt.albumCount || 0} album{opt.albumCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Show when={opt.isFavorite}>
                    <div
                      class={`flex-shrink-0 ${
                        i() === highlight() ? "" : "text-[var(--color-accent-500)]"
                      }`}
                    >
                      ♥
                    </div>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
