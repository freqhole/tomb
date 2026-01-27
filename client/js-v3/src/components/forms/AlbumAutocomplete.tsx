// album autocomplete component using kobalte combobox
// provides search-as-you-type with proper value syncing and "create new" option
// optionally filters by artist_id to show only albums by that artist

import { Combobox } from "@kobalte/core/combobox";
import {
  createEffect,
  createMemo,
  createSignal,
  Show,
  type Accessor,
} from "solid-js";
import { useAlbumAutocompleteQuery } from "../../music/queries/autocomplete";

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
}

interface AlbumOption {
  value: string;
  label: string;
  id?: string;
  artistName?: string;
  songCount?: number;
  thumbnailUrl?: string;
  isFavorite?: boolean;
  isNew?: boolean;
}

export function AlbumAutocomplete(props: AlbumAutocompleteProps) {
  // local controlled value that syncs with props.value
  const [localValue, setLocalValue] = createSignal<AlbumOption | undefined>(
    props.value && props.value.trim().length > 0
      ? { value: props.value, label: props.value }
      : undefined,
  );

  // sync local value when props.value changes (e.g., on reset)
  createEffect(() => {
    const value = props.value;
    if (value && value.trim().length > 0) {
      setLocalValue({ value: value, label: value });
    } else {
      setLocalValue(undefined);
    }
  });

  // track what user is typing for query purposes
  const [searchInput, setSearchInput] = createSignal<string | undefined>(
    undefined,
  );

  // query albums based on what user types, optionally filtered by artist
  const albumQuery = useAlbumAutocompleteQuery(searchInput, props.artistId);

  // build options from query results
  const options = createMemo((): AlbumOption[] => {
    const results: AlbumOption[] = [];
    const items = albumQuery.data?.items || [];

    // add existing albums - thumbnail_url already resolved
    for (const item of items) {
      results.push({
        value: item.title,
        label: item.title,
        id: item.album_id,
        artistName: item.artist_name,
        songCount: item.song_count,
        thumbnailUrl: item.thumbnail_url,
        isFavorite: item.is_favorite === true,
      });
    }

    // if we have a current value that's not in the results, add it
    // so the combobox can display it even before user searches
    const currentVal = localValue();
    if (currentVal && !results.find((r) => r.value === currentVal.value)) {
      results.unshift(currentVal);
    }

    // add "create new" option if no exact match
    const input = searchInput();
    if (input && input.trim().length > 0) {
      const exactMatch = items.find(
        (item) => item.title.toLowerCase() === input.trim().toLowerCase(),
      );
      if (!exactMatch) {
        results.unshift({
          value: input.trim(),
          label: `create new: ${input.trim()}`,
          isNew: true,
        });
      }
    }

    return results;
  });

  return (
    <Combobox<AlbumOption>
      value={localValue()}
      onChange={(option) => {
        setLocalValue(option);
        if (option) {
          props.onSelect({
            id: option.id,
            title: option.value,
            isNew: option.isNew || false,
          });
        }
      }}
      onInputChange={(value) => {
        // update search query as user types
        setSearchInput(value.trim().length > 0 ? value : undefined);
      }}
      options={options()}
      optionValue="value"
      optionTextValue="value"
      optionLabel="value"
      placeholder={props.placeholder || "search or type album title..."}
      triggerMode="input"
      disabled={props.disabled}
      itemComponent={(props) => (
        <Combobox.Item item={props.item} class="outline-none">
          <div class="px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)] data-[highlighted]:bg-[var(--color-accent-500)] data-[highlighted]:text-[var(--color-text-on-accent)] transition-colors flex items-center gap-3">
            <Show
              when={props.item.rawValue.thumbnailUrl}
              fallback={
                <div class="w-10 h-10 bg-[var(--color-bg-tertiary)] rounded flex items-center justify-center text-[var(--color-text-muted)] text-xs flex-shrink-0">
                  {props.item.rawValue.value[0]?.toUpperCase() || "?"}
                </div>
              }
            >
              <img
                src={props.item.rawValue.thumbnailUrl}
                alt=""
                class="w-10 h-10 object-cover rounded flex-shrink-0"
              />
            </Show>

            <div class="flex-1 min-w-0">
              <Show when={props.item.rawValue.isNew}>
                <div class="text-sm font-medium">
                  <Combobox.ItemLabel>
                    {props.item.rawValue.label}
                  </Combobox.ItemLabel>
                </div>
              </Show>
              <Show when={!props.item.rawValue.isNew}>
                <div class="text-sm">
                  <Combobox.ItemLabel>
                    {props.item.rawValue.value}
                  </Combobox.ItemLabel>
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
