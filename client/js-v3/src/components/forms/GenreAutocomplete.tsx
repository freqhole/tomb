// genre autocomplete - single-select combobox for genres
import { Combobox } from "@kobalte/core/combobox";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { useGenresQuery } from "../../music/queries/songs";
import { Icon, IconNames } from "../icons/registry";

export interface GenreAutocompleteProps {
  /** current genre name value */
  value?: string;
  /** callback when genre is selected */
  onSelect: (selection: { id?: string; name: string; isNew: boolean }) => void;
  /** label for the input */
  label?: string;
  /** placeholder text */
  placeholder?: string;
  /** whether the input is disabled */
  disabled?: boolean;
  /** hint text below input */
  hint?: string;
  /** additional class names */
  class?: string;
}

interface GenreOption {
  value: string;
  label: string;
  id?: string;
}

export function GenreAutocomplete(props: GenreAutocompleteProps) {
  const [searchInput, setSearchInput] = createSignal<string | undefined>(
    undefined,
  );
  const [localValue, setLocalValue] = createSignal<GenreOption | undefined>(
    undefined,
  );

  // sync with external value changes - find/create option for current value
  createEffect(() => {
    if (props.value) {
      setLocalValue({
        value: props.value,
        label: props.value,
        id: undefined,
      });
    } else {
      setLocalValue(undefined);
    }
  });

  // query genres with search
  const genresQuery = useGenresQuery({
    query: () => searchInput(),
    pageSize: 50,
  });

  // build options from query results
  const options = createMemo((): GenreOption[] => {
    const results: GenreOption[] = [];

    // add current value if set (ensures it appears in the list)
    const current = localValue();
    if (current) {
      results.push(current);
    }

    // add genres from query
    const pages = genresQuery.data?.pages || [];
    pages.forEach((page) => {
      page.items.forEach((genre) => {
        // avoid duplicates
        if (!results.some((o) => o.value === genre.name)) {
          results.push({
            value: genre.name,
            label: genre.name,
            id: genre.genre_id,
          });
        } else {
          // update ID if we found the current value in results
          const existing = results.find((o) => o.value === genre.name);
          if (existing && !existing.id) {
            existing.id = genre.genre_id;
          }
        }
      });
    });

    // if user is typing something new, add it as an option
    const input = searchInput();
    if (
      input &&
      input.trim() &&
      !results.some((o) => o.value.toLowerCase() === input.toLowerCase())
    ) {
      results.push({
        value: input,
        label: `create "${input}"`,
        id: undefined,
      });
    }

    return results;
  });

  return (
    <Combobox<GenreOption>
      value={localValue()}
      onChange={(option) => {
        setLocalValue(option);
        if (option) {
          props.onSelect({
            id: option.id,
            name: option.value,
            isNew: !option.id,
          });
        }
      }}
      onInputChange={(value) => {
        setSearchInput(value.trim().length > 0 ? value : undefined);
      }}
      options={options()}
      optionValue="value"
      optionTextValue="value"
      optionLabel="label"
      placeholder={props.placeholder || "select or type genre name"}
      triggerMode="input"
      disabled={props.disabled}
      itemComponent={(itemProps) => (
        <Combobox.Item item={itemProps.item} class="outline-none">
          <div class="px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)] data-[highlighted]:bg-[var(--color-accent-500)] data-[highlighted]:text-[var(--color-text-on-accent)] transition-colors text-sm">
            <Combobox.ItemLabel>
              {itemProps.item.rawValue.label}
            </Combobox.ItemLabel>
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

        <Show when={genresQuery.isFetching}>
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
