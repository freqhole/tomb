// sub-genre autocomplete - multi-select combobox for sub-genres
import { Combobox } from "@kobalte/core/combobox";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useGenresQuery } from "../../music/queries/songs";
import { Icon, IconNames } from "../icons/registry";

export interface SubGenreAutocompleteProps {
  /** current sub-genre name values (array) */
  value?: string[];
  /** parent genre name (required - sub-genres belong to a genre) */
  genre?: string;
  /** callback when sub-genres are selected - returns (names, ids) */
  onSelect: (subGenres: string[], subGenreIds: string[]) => void;
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

interface SubGenreOption {
  value: string;
  label: string;
  id?: string;
}

export function SubGenreAutocomplete(props: SubGenreAutocompleteProps) {
  const [searchInput, setSearchInput] = createSignal<string | undefined>(
    undefined,
  );
  const [localValue, setLocalValue] = createSignal<SubGenreOption[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);

  // sync with external value changes - convert strings to options
  createEffect(() => {
    if (props.value) {
      const options = props.value.map((val) => ({
        value: val,
        label: val,
        id: undefined,
      }));
      setLocalValue(options);
    } else {
      setLocalValue([]);
    }
  });

  // query sub-genres for the parent genre
  // TODO: this needs a proper sub-genre query filtered by genre
  // for now, we'll just allow typing comma-separated values
  const genresQuery = useGenresQuery({
    query: () => props.genre || "",
    pageSize: 50,
  });

  // build options from query results
  const options = createMemo((): SubGenreOption[] => {
    const results: SubGenreOption[] = [];

    // add currently selected values (ensures they appear in the list)
    const current = localValue();
    current.forEach((opt) => {
      if (!results.some((o) => o.value === opt.value)) {
        results.push(opt);
      }
    });

    // TODO: add sub-genres from query when API supports it
    // for now, if user is typing something new, add it as an option
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
    );
  };

  return (
    <Combobox<SubGenreOption>
      multiple
      open={isOpen()}
      onOpenChange={setIsOpen}
      value={localValue()}
      onChange={(options) => {
        setLocalValue(options);
        props.onSelect(
          options.map((opt) => opt.value),
          options.map((opt) => opt.id).filter((id): id is string => !!id),
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
      placeholder={props.placeholder || "select or type sub-genres"}
      triggerMode="input"
      disabled={props.disabled || !props.genre}
      itemComponent={(itemProps) => (
        <Combobox.Item item={itemProps.item} class="outline-none">
          <div class="px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-hover)] data-[highlighted]:bg-[var(--color-accent-500)] data-[highlighted]:text-[var(--color-text-on-accent)] transition-colors">
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
        <div class="w-full min-h-[40px] px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] flex flex-wrap gap-2 items-center">
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

      <Show when={!props.genre}>
        <div class="text-xs text-[var(--color-text-tertiary)] mt-1">
          select a genre first to choose sub-genres
        </div>
      </Show>

      <Combobox.Portal>
        <Combobox.Content class="z-50 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg max-h-80 overflow-y-auto animate-in fade-in-0 zoom-in-95">
          <Combobox.Listbox />
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
}
