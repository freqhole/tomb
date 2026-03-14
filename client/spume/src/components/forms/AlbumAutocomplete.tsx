// album autocomplete component using kobalte combobox
// provides search-as-you-type with proper value syncing and "create new" option
// optionally filters by artist_id to show only albums by that artist

import { Combobox } from "@kobalte/core/combobox";
import { createEffect, createMemo, createSignal, Show, type Accessor } from "solid-js";
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
  /** unique key - album_id for existing, "new:title" for create new, "temp:title" for unresolved */
  key: string;
  /** album title */
  title: string;
  /** label shown in dropdown (may include "create new:" prefix) */
  label: string;
  /** album id if this is an existing album */
  id?: string;
  artistName?: string;
  songCount?: number;
  thumbnailUrl?: string;
  images?: ImageMetadata[];
  isFavorite?: boolean;
  isNew?: boolean;
}

export function AlbumAutocomplete(props: AlbumAutocompleteProps) {
  // local controlled value that syncs with props.value
  const [localValue, setLocalValue] = createSignal<AlbumOption | undefined>(
    props.value && props.value.trim().length > 0
      ? { key: `temp:${props.value}`, title: props.value, label: props.value }
      : undefined
  );

  // sync local value when props.value changes (e.g., on reset)
  createEffect(() => {
    const value = props.value;
    if (value && value.trim().length > 0) {
      setLocalValue({ key: `temp:${value}`, title: value, label: value });
    } else {
      setLocalValue(undefined);
    }
  });

  // track what user is typing for query purposes
  const [searchInput, setSearchInput] = createSignal<string | undefined>(undefined);

  // query albums based on what user types, optionally filtered by artist
  const albumQuery = useAlbumAutocompleteQuery(searchInput, props.artistId);

  // build options from query results
  const options = createMemo((): AlbumOption[] => {
    const results: AlbumOption[] = [];
    const items = albumQuery.data?.items || [];

    // add existing albums - use album_id as key for uniqueness
    // this allows multiple albums with the same title to appear separately
    for (const item of items) {
      results.push({
        key: item.album_id,
        title: item.title,
        label: item.title,
        id: item.album_id,
        artistName: item.artist_name,
        songCount: item.song_count,
        thumbnailUrl: undefined,
        images: item.images,
        isFavorite: item.is_favorite === true,
      });
    }

    // if we have a current value that's not in the results, add it
    // so the combobox can display it even before user searches
    const currentVal = localValue();
    if (currentVal && !results.find((r) => r.key === currentVal.key)) {
      results.unshift(currentVal);
    }

    // add "create new" option if user has typed something
    // always show it so user can create albums with duplicate titles if needed
    const input = searchInput();
    if (input && input.trim().length > 0) {
      const trimmed = input.trim();
      const exactMatch = items.find((item) => item.title === trimmed);
      const label = exactMatch ? `create new album: ${trimmed}` : `create new: ${trimmed}`;
      results.unshift({
        key: `new:${trimmed}`,
        title: trimmed,
        label,
        isNew: true,
      });
    }

    return results;
  });

  return (
    <Combobox<AlbumOption>
      value={localValue()}
      onChange={(option) => {
        setLocalValue(option ?? undefined);
        if (option) {
          props.onSelect({
            id: option.id,
            title: option.title,
            isNew: option.isNew || false,
          });
        }
      }}
      onInputChange={(value) => {
        // update search query as user types
        setSearchInput(value.trim().length > 0 ? value : undefined);
      }}
      options={options()}
      optionValue="key"
      optionTextValue="title"
      optionLabel="title"
      placeholder={props.placeholder || "search or type album title..."}
      triggerMode="input"
      disabled={props.disabled}
      itemComponent={(props) => (
        <Combobox.Item item={props.item} class="outline-none">
          <div class="px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)] data-[highlighted]:bg-[var(--color-accent-500)] data-[highlighted]:text-[var(--color-text-on-accent)] transition-colors flex items-center gap-3">
            <MediaImage
              images={props.item.rawValue.images}
              imageUrl={props.item.rawValue.thumbnailUrl || null}
              alt=""
              class="w-10 h-10 object-cover rounded flex-shrink-0"
              domainType="album"
              thumbnailSize={50}
            />

            <div class="flex-1 min-w-0">
              <Show when={props.item.rawValue.isNew}>
                <div class="text-sm font-medium">
                  <Combobox.ItemLabel>{props.item.rawValue.label}</Combobox.ItemLabel>
                </div>
              </Show>
              <Show when={!props.item.rawValue.isNew}>
                <div class="text-sm">
                  <Combobox.ItemLabel>{props.item.rawValue.title}</Combobox.ItemLabel>
                </div>
                <div class="text-xs text-[var(--color-text-tertiary)]">
                  {props.item.rawValue.artistName}
                  {" · "}
                  {props.item.rawValue.songCount || 0} song
                  {props.item.rawValue.songCount === 1 ? "" : "s"}
                </div>
              </Show>
            </div>

            <Show when={props.item.rawValue.isFavorite}>
              <div class="text-[var(--color-accent-500)] flex-shrink-0">♥</div>
            </Show>
          </div>
        </Combobox.Item>
      )}
      class={props.class}
    >
      <Show when={props.label}>
        <Combobox.Label class="block text-sm text-[var(--color-text-secondary)] mb-1">
          {props.label}
        </Combobox.Label>
      </Show>

      <Combobox.Control class="relative">
        <Combobox.Input class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" />

        <Show when={albumQuery.isFetching}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <div class="animate-spin w-4 h-4 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
          </div>
        </Show>
      </Combobox.Control>

      <Show when={props.hint}>
        <Combobox.Description class="text-xs text-[var(--color-text-tertiary)] mt-1">
          {props.hint}
        </Combobox.Description>
      </Show>

      <Combobox.Portal>
        <Combobox.Content class="z-50 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg max-h-80 overflow-y-auto animate-in fade-in-0 zoom-in-95">
          <Combobox.Listbox />
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
}
