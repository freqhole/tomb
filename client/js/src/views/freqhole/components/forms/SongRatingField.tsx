import { Show, For } from "solid-js";

interface SongRatingFieldProps {
  value: number | null;
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: number | null) => void;
  onReset: () => void;
}

export function SongRatingField(props: SongRatingFieldProps) {
  const currentRating = () => props.value || 0;

  const handleStarClick = (rating: number) => {
    if (props.disabled) return;

    // clicking the same rating clears it (sets to null)
    const newRating = currentRating() === rating ? null : rating;
    props.onUpdate(newRating);
  };

  const handleStarHover = (_rating: number) => {
    // could add hover preview here if needed
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-gray-300">rating</label>
        <Show when={props.isDirty && !props.disabled}>
          <button
            type="button"
            onClick={props.onReset}
            class="text-xs text-gray-400 hover:text-magenta-400 transition-colors px-2 py-1 hover:bg-gray-700"
            title="reset to original value"
          >
            reset
          </button>
        </Show>
      </div>

      <div class="flex items-center gap-1">
        <For each={[1, 2, 3, 4, 5]}>
          {(star) => (
            <button
              type="button"
              onClick={() => handleStarClick(star)}
              onMouseEnter={() => handleStarHover(star)}
              disabled={props.disabled}
              class={`
                w-6 h-6 transition-all duration-150 focus:outline-none
                ${
                  props.disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:scale-110 cursor-pointer"
                }
                ${
                  props.isDirty && star <= currentRating()
                    ? "text-magenta-500 drop-shadow-[0_0_4px_rgba(236,72,153,0.5)]"
                    : star <= currentRating()
                      ? "text-yellow-500"
                      : "text-gray-600 hover:text-yellow-400"
                }
              `}
              title={
                currentRating() === star
                  ? `remove rating (currently ${star} stars)`
                  : `rate ${star} star${star === 1 ? "" : "s"}`
              }
            >
              <svg
                fill="currentColor"
                viewBox="0 0 24 24"
                class="w-full h-full"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          )}
        </For>

        <Show when={currentRating() > 0}>
          <span class="ml-2 text-sm text-gray-400">{currentRating()}/5</span>
        </Show>

        <Show when={currentRating() === 0}>
          <span class="ml-2 text-sm text-gray-500">not rated</span>
        </Show>
      </div>

      <Show when={props.isDirty}>
        <div class="text-xs text-magenta-400">rating will be updated</div>
      </Show>
    </div>
  );
}
