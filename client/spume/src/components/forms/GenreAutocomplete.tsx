// genre autocomplete - multi-select combobox for genres
import { Combobox } from "@kobalte/core/combobox";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useGenresQuery } from "../../music/queries/songs";
import { Icon, IconNames } from "../icons/registry";

export interface GenreAutocompleteProps {
  /** current genre name values (array) */
  value?: string[];
  /** current genre ID values (array) - should correspond 1:1 with value array */
  valueIds?: string[];
  /** callback when genres are selected - returns (allNames, existingIds, newNames) */
  onSelect: (genres: string[], genreIds: string[], newGenreNames: string[]) => void;
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
  const [searchInput, setSearchInput] = createSignal<string | undefined>(undefined);
  const [localValue, setLocalValue] = createSignal<GenreOption[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);

  // sync with external value changes - convert strings to options
  createEffect(() => {
    if (props.value) {
      const options = props.value.map((val, idx) => ({
        value: val,
        label: val,
        id: props.valueIds?.[idx],
      }));
      setLocalValue(options);
    } else {
      setLocalValue([]);
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

    // add currently selected values (ensures they appear in the list)
    const current = localValue();
    current.forEach((opt) => {
      if (!results.some((o) => o.value === opt.value)) {
        results.push(opt);
      }
    });

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
        label: `add "${input}"`,
        id: undefined,
      });
    }

    return results;
  });

  const handleRemove = (value: string) => {
    const newOptions = localValue().filter((opt) => opt.value !== value);
    setLocalValue(newOptions);
    props.onSelect(
      newOptions.map((opt) => opt.value),
      newOptions.map((opt) => opt.id).filter((id): id is string => !!id),
      newOptions.filter((opt) => !opt.id).map((opt) => opt.value)
    );
  };

  return (
    <Combobox<GenreOption>
      multiple
      open={isOpen()}
      onOpenChange={setIsOpen}
      value={localValue()}
      onChange={(options) => {
        setLocalValue(options);
        props.onSelect(
          options.map((opt) => opt.value),
          options.map((opt) => opt.id).filter((id): id is string => !!id),
          options.filter((opt) => !opt.id).map((opt) => opt.value)
        );
        // close dropdown after selection
        setIsOpen(false);
        // clear search input
        setSearchInput(undefined);
      }}
      onInputChange={(value) => {
        setSearchInput(value.trim().length > 0 ? value : undefined);
        // open dropdown when typing
        if (value.trim().length > 0) {
          setIsOpen(true);
        }
      }}
      options={options()}
      optionValue="value"
      optionTextValue="value"
      optionLabel="label"
      placeholder={props.placeholder || "select or type genres"}
      triggerMode="input"
      disabled={props.disabled}
      itemComponent={(itemProps) => (
        <Combobox.Item item={itemProps.item} class="outline-none">
          <div class="px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)] data-[highlighted]:bg-[var(--color-accent-500)] data-[highlighted]:text-[var(--color-text-on-accent)] transition-colors text-sm">
            <Combobox.ItemLabel>{itemProps.item.rawValue.label}</Combobox.ItemLabel>
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
        <div class="w-full min-h-[40px] px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] flex flex-wrap gap-2 items-center focus-within:border-[var(--color-accent-500)] focus-within:ring-2 focus-within:ring-[var(--color-accent-500)] focus-within:ring-opacity-50 transition-colors">
          <Show when={localValue().length > 0}>
            <For each={localValue()}>
              {(option) => (
                <div class="inline-flex items-center gap-1 px-2 py-1 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded text-sm">
                  <span>{option.value}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(option.value);
                    }}
                    class="hover:opacity-80"
                  >
                    <Icon name={IconNames.close} size={12} />
                  </button>
                </div>
              )}
            </For>
          </Show>
          <Combobox.Input class="flex-1 min-w-[120px] bg-transparent border-none outline-none placeholder:text-[var(--color-text-muted)] disabled:opacity-50 disabled:cursor-not-allowed" />
        </div>

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
        <Combobox.Content class="z-[1100] mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg max-h-80 overflow-y-auto animate-in fade-in-0 zoom-in-95">
          <Combobox.Listbox />
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
}
