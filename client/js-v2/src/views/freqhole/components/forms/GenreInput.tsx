import {
  Show,
  createResource,
  onMount,
  createEffect,
  createSignal,
  For,
} from "solid-js";
import { apiClient } from "../../../../lib/api-client.js";

interface GenreInputProps {
  value: string | null;
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: string | null) => void;
  onReset: () => void;
}

export function GenreInput(props: GenreInputProps) {
  // critical: use refs to prevent focus loss during reactive updates
  let inputRef: HTMLInputElement | undefined;

  // state for autocomplete
  const [showSuggestions, setShowSuggestions] = createSignal(false);
  const [filteredGenres, setFilteredGenres] = createSignal<string[]>([]);

  // fetch individual genres for autocomplete
  const [genres] = createResource<string[]>(async () => {
    try {
      const response = await apiClient.getGenreAutocomplete();
      return response.genres || [];
    } catch (error) {
      console.error("failed to load genres for autocomplete:", error);
      return [];
    }
  });

  // set initial value and handle updates manually to prevent focus loss
  onMount(() => {
    if (inputRef) {
      inputRef.value = props.value || "";
    }
  });

  // only update input value if it actually changed and input is not focused
  createEffect(() => {
    if (inputRef) {
      const newValue = props.value || "";
      if (inputRef.value !== newValue && document.activeElement !== inputRef) {
        inputRef.value = newValue;
      }
    }
  });

  // filter genres based on input
  const filterGenres = (inputValue: string) => {
    const allGenres = genres() || [];
    if (!inputValue.trim()) {
      setFilteredGenres(allGenres.slice(0, 10)); // show first 10 by default
      return;
    }

    const filtered = allGenres
      .filter((genre) => genre.toLowerCase().includes(inputValue.toLowerCase()))
      .slice(0, 10); // limit to 10 suggestions

    setFilteredGenres(filtered);
  };

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const value = target.value.trim(); // trim whitespace

    // update filtered suggestions
    filterGenres(value);
    setShowSuggestions(true);

    // update value
    props.onUpdate(value === "" ? null : value);
  };

  const handleFocus = () => {
    filterGenres(inputRef?.value || "");
    setShowSuggestions(true);
  };

  const handleBlur = () => {
    // delay hiding suggestions to allow click on suggestion
    setTimeout(() => setShowSuggestions(false), 150);
  };

  const selectSuggestion = (genre: string) => {
    if (inputRef) {
      inputRef.value = genre;
    }
    props.onUpdate(genre);
    setShowSuggestions(false);
    inputRef?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowSuggestions(false);
      inputRef?.blur();
    }
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-gray-300">genre</label>
        <Show when={props.isDirty && !props.disabled}>
          <button
            type="button"
            onClick={() => {
              // blur the input before resetting to ensure value updates
              if (inputRef && document.activeElement === inputRef) {
                inputRef.blur();
              }
              props.onReset();
            }}
            class="text-xs text-gray-400 hover:text-magenta-400 transition-colors px-2 py-1 hover:bg-gray-700"
            title="reset to original value"
          >
            reset
          </button>
        </Show>
      </div>

      <div class="relative">
        <input
          ref={(el) => {
            inputRef = el;
          }}
          type="text"
          placeholder="enter genre name..."
          disabled={props.disabled || genres.loading}
          class={`
            w-full px-3 py-2 bg-gray-800 border text-white placeholder-gray-500
            transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-magenta-500
            ${
              props.isDirty
                ? "border-magenta-500 bg-magenta-900/10"
                : "border-gray-600 focus:border-magenta-500"
            }
            ${props.disabled || genres.loading ? "opacity-50 cursor-not-allowed" : ""}
          `}
          onInput={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />

        {/* Autocomplete suggestions */}
        <Show when={showSuggestions() && !props.disabled && !genres.loading}>
          <div class="absolute z-50 w-full mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
            <Show when={filteredGenres().length > 0}>
              <For each={filteredGenres()}>
                {(genre) => (
                  <button
                    type="button"
                    class="w-full px-3 py-2 text-left text-white hover:bg-magenta-600/20 focus:bg-magenta-600/20 focus:outline-none transition-colors"
                    onClick={() => selectSuggestion(genre)}
                  >
                    {genre}
                  </button>
                )}
              </For>
            </Show>
            <Show
              when={
                filteredGenres().length === 0 && (inputRef?.value || "").trim()
              }
            >
              <div class="px-3 py-2 text-gray-400 text-sm">
                no matching genres
              </div>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={genres.loading}>
        <div class="text-xs text-gray-400">loading genres...</div>
      </Show>

      <Show when={genres.error}>
        <div class="text-xs text-red-400">failed to load genres</div>
      </Show>
    </div>
  );
}
