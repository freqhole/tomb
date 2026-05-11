// album autocomplete - lightweight typeahead with "create new" option.
//
// rewritten during the taxonomy refactor to drop the kobalte combobox
// in favor of the same plain-input + absolute popover pattern used by
// TaxonAutocomplete and ArtistAutocomplete. props/onSelect signature
// is unchanged, so existing call sites still work.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type Accessor,
} from "solid-js";
import type { ImageMetadata } from "../../music/services/storage/types";
import { useAlbumAutocompleteQuery } from "../../music/queries/autocomplete";
import { MediaImage } from "../media/MediaImage";

export interface AlbumAutocompleteProps {
  /** current album title value */
  value?: string;
  /** callback when album is selected */
  onSelect: (selection: { id?: string; title: string; isNew: boolean }) => void;
  /** optional artist id to filter albums by artist */
  artistId?: Accessor<string | undefined>;
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

interface AlbumOption {
  id: string;
  title: string;
  artistName?: string;
  songCount?: number;
  images?: ImageMetadata[];
  thumbnailUrl?: string;
  isFavorite?: boolean;
}

const DEBOUNCE_MS = 180;

export function AlbumAutocomplete(props: AlbumAutocompleteProps) {
  let inputEl: HTMLInputElement | undefined;
  let containerEl: HTMLDivElement | undefined;

  const [text, setText] = createSignal(props.value ?? "");
  const [debounced, setDebounced] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  // sync local text when props.value changes externally (eg. reset).
  // skip while focused so the user's typing isn't clobbered.
  createEffect(() => {
    const v = props.value ?? "";
    if (document.activeElement !== inputEl) setText(v);
  });

  // debounce the query string
  createEffect(
    on(text, (t) => {
      const timer = window.setTimeout(() => setDebounced(t.trim()), DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    })
  );

  const debouncedAccessor = () => (debounced().length > 0 ? debounced() : undefined);
  const albumQuery = useAlbumAutocompleteQuery(debouncedAccessor, props.artistId);

  const options = createMemo<AlbumOption[]>(() => {
    const items = albumQuery.data?.items || [];
    return items.map((item) => ({
      id: item.album_id,
      title: item.title,
      artistName: item.artist_name,
      songCount: item.song_count,
      images: item.images,
      thumbnailUrl: undefined,
      isFavorite: item.is_favorite === true,
    }));
  });

  const exactMatch = createMemo<AlbumOption | undefined>(() => {
    const q = text().trim().toLowerCase();
    if (!q) return undefined;
    return options().find((o) => o.title.toLowerCase() === q);
  });
  // we always allow create-new (even when an exact title match exists),
  // because albums with duplicate titles are common (eg. self-titled re-
  // releases) — the create row sits below existing matches in that case.
  const canCreate = createMemo(() => text().trim().length > 0);

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

  const pickExisting = (opt: AlbumOption) => {
    setText(opt.title);
    setOpen(false);
    setHighlight(0);
    props.onSelect({ id: opt.id, title: opt.title, isNew: false });
  };

  const pickNew = () => {
    const trimmed = text().trim();
    if (!trimmed) return;
    setOpen(false);
    setHighlight(0);
    props.onSelect({ id: undefined, title: trimmed, isNew: true });
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
      // when there's an exact match in options, prefer picking it.
      const m = exactMatch();
      if (m && opts[idx]?.id === m.id) {
        pickExisting(opts[idx]);
      } else if (opts[idx]) {
        pickExisting(opts[idx]);
      } else if (canCreate()) {
        pickNew();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const newLabel = (input: string) => {
    if (props.newLabel) return props.newLabel(input);
    return exactMatch() ? `create new album: ${input}` : `create new: ${input}`;
  };

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
          placeholder={props.placeholder || "search or type album title..."}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Show when={albumQuery.isFetching}>
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
                {albumQuery.isFetching ? "searching…" : "no matches"}
              </div>
            }
          >
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
                    domainType="album"
                    thumbnailSize={50}
                  />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm truncate">{opt.title}</div>
                    <div
                      class={`text-xs ${
                        i() === highlight() ? "opacity-90" : "text-[var(--color-text-tertiary)]"
                      }`}
                    >
                      {opt.artistName}
                      {" · "}
                      {opt.songCount || 0} song{opt.songCount === 1 ? "" : "s"}
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

            <Show when={canCreate()}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickNew();
                }}
                class="w-full text-left px-4 py-2 text-sm border-t border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] flex items-center gap-2 text-[var(--color-text-secondary)]"
              >
                <span class="font-medium">{newLabel(text().trim())}</span>
              </button>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
