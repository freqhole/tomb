import { Show, createResource, onMount, createEffect } from "solid-js";
import { apiClient } from "../../../../lib/api-client.js";
import type { GenreStatsResponse } from "../../../../lib/music/schemas/genre.js";

interface GenreSelectProps {
  value: string | null;
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: string | null) => void;
  onReset: () => void;
}

export function GenreSelect(props: GenreSelectProps) {
  // critical: use refs to prevent focus loss during reactive updates
  let selectRef: HTMLSelectElement | undefined;

  // fetch genres from api
  const [genres] = createResource<GenreStatsResponse>(async () => {
    try {
      return await apiClient.getGenres();
    } catch (error) {
      console.error("failed to load genres:", error);
      return { genres: [], total: 0 };
    }
  });

  // set initial value and handle updates manually to prevent focus loss
  onMount(() => {
    if (selectRef) {
      selectRef.value = props.value || "";
    }
  });

  // only update select value if it actually changed and select is not focused
  createEffect(() => {
    if (selectRef) {
      const newValue = props.value || "";
      if (
        selectRef.value !== newValue &&
        document.activeElement !== selectRef
      ) {
        selectRef.value = newValue;
      }
    }
  });

  // ensure value is set after genres load
  createEffect(() => {
    if (selectRef && genres() && !genres.loading) {
      const newValue = props.value || "";
      if (selectRef.value !== newValue) {
        selectRef.value = newValue;
      }
    }
  });

  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLSelectElement;
    const value = target.value;
    props.onUpdate(value === "" ? null : value);
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-gray-300">genre</label>
        <Show when={props.isDirty && !props.disabled}>
          <button
            type="button"
            onClick={() => {
              // blur the select before resetting to ensure value updates
              if (selectRef && document.activeElement === selectRef) {
                selectRef.blur();
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

      <select
        ref={(el) => {
          selectRef = el;
        }}
        disabled={props.disabled || genres.loading}
        class={`
          w-full px-3 py-2 bg-gray-800 border text-white
          transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-magenta-500
          ${
            props.isDirty
              ? "border-magenta-500 bg-magenta-900/10"
              : "border-gray-600 focus:border-magenta-500"
          }
          ${props.disabled || genres.loading ? "opacity-50 cursor-not-allowed" : ""}
        `}
        onChange={handleChange}
      >
        <option value="">select genre...</option>
        <Show when={genres()}>
          {(genreData) => (
            <>
              {genreData().genres.map((genre) => (
                <option value={genre.name}>
                  {genre.name} ({genre.song_count} songs)
                </option>
              ))}
            </>
          )}
        </Show>
      </select>

      <Show when={genres.loading}>
        <div class="text-xs text-gray-400">loading genres...</div>
      </Show>

      <Show when={genres.error}>
        <div class="text-xs text-red-400">failed to load genres</div>
      </Show>
    </div>
  );
}
