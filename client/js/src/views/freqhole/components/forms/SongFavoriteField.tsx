import { Show } from "solid-js";

interface SongFavoriteFieldProps {
  value: boolean;
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: boolean) => void;
  onReset: () => void;
}

export function SongFavoriteField(props: SongFavoriteFieldProps) {
  const isFavorite = () => props.value;

  const handleToggle = () => {
    if (props.disabled) return;
    props.onUpdate(!isFavorite());
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-gray-300">
          favorite
        </label>
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

      <div class="flex items-center gap-3">
        <button
          type="button"
          onClick={handleToggle}
          disabled={props.disabled}
          class={`
            w-8 h-8 transition-all duration-150 focus:outline-none flex items-center justify-center
            ${props.disabled
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:scale-110 cursor-pointer'
            }
            ${props.isDirty && isFavorite()
              ? 'text-magenta-500 drop-shadow-[0_0_6px_rgba(236,72,153,0.6)]'
              : isFavorite()
              ? 'text-red-500'
              : 'text-gray-600 hover:text-red-400'
            }
          `}
          title={isFavorite() ? "remove from favorites" : "add to favorites"}
        >
          {isFavorite() ? (
            // filled heart when favorited
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          ) : (
            // outlined heart when not favorited
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          )}
        </button>

        <span class="text-sm text-gray-400">
          {isFavorite() ? "favorited" : "not favorited"}
        </span>
      </div>

      <Show when={props.isDirty}>
        <div class="text-xs text-magenta-400">
          favorite status will be updated
        </div>
      </Show>
    </div>
  );
}
