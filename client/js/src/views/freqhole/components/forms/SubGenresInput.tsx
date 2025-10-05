import { onMount, createEffect } from "solid-js";

interface SubGenresInputProps {
  value: string[] | null | undefined;
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: string[]) => void;
  onReset: () => void;
}

export function SubGenresInput(props: SubGenresInputProps) {
  // critical: use refs to prevent focus loss during reactive updates
  let inputRef: HTMLInputElement | undefined;

  // convert array to comma-separated string for display
  const formatValue = (genres: string[] | null | undefined) => {
    if (!genres || !Array.isArray(genres)) {
      return "";
    }
    return genres.join(", ");
  };

  // parse comma-separated string to array
  const parseValue = (input: string): string[] => {
    return input
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.toLowerCase());
  };

  // set initial value and handle updates manually to prevent focus loss
  onMount(() => {
    if (inputRef) {
      const formatted = formatValue(props.value);
      console.log("SubGenresInput onMount:", {
        propsValue: props.value,
        propsValueType: typeof props.value,
        isArray: Array.isArray(props.value),
        isDirty: props.isDirty,
        formatted,
      });
      inputRef.value = formatted;
    }
  });

  // also update when props.value changes (for when editing existing songs)
  createEffect(() => {
    if (inputRef && document.activeElement !== inputRef) {
      const formatted = formatValue(props.value);
      if (inputRef.value !== formatted) {
        inputRef.value = formatted;
      }
    }
  });

  // only update input value if it actually changed and input is not focused
  createEffect(() => {
    if (inputRef) {
      const newValue = formatValue(props.value ?? []);
      if (inputRef.value !== newValue && document.activeElement !== inputRef) {
        inputRef.value = newValue;
      }
    }
  });

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const value = target.value;

    // parse the input and update parent
    const parsed = parseValue(value);
    console.log("SubGenresInput handleInput:", { value, parsed });
    props.onUpdate(parsed.length > 0 ? parsed : []);
  };

  const handleBlur = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const value = target.value;

    // clean up formatting on blur
    const parsed = parseValue(value);
    const formatted = formatValue(parsed);

    console.log("SubGenresInput handleBlur:", { value, parsed, formatted });

    if (value !== formatted) {
      target.value = formatted;
    }
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-gray-300">
          sub genres
          <span class="text-xs text-gray-400 ml-2">(comma-separated)</span>
        </label>
        {props.isDirty && !props.disabled && (
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
        )}
      </div>

      <input
        ref={(el) => {
          inputRef = el;
        }}
        type="text"
        placeholder="rock, pop, alternative..."
        disabled={props.disabled}
        class={`
          w-full px-3 py-2 bg-gray-800 border text-white placeholder-gray-500
          transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-magenta-500
          ${
            props.isDirty
              ? "border-magenta-500 bg-magenta-900/10"
              : "border-gray-600 focus:border-magenta-500"
          }
          ${props.disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
        onInput={handleInput}
        onBlur={handleBlur}
      />

      <div class="text-xs text-gray-400">
        enter sub-genres separated by commas. they will be automatically
        lowercased and cleaned up.
      </div>
    </div>
  );
}
