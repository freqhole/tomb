import { Show, onMount, createEffect } from "solid-js";
import {
  getFieldConfig,
  type EditableSongFields,
} from "../../../../lib/music/schemas/form-schemas.js";
import { SongRatingField } from "./SongRatingField.js";
import { SongFavoriteField } from "./SongFavoriteField.js";
import { SongImageField } from "./SongImageField.js";
import { GenreSelect } from "./GenreSelect.js";
import { SubGenresInput } from "./SubGenresInput.js";

interface SongFormFieldProps {
  field: keyof EditableSongFields;
  value: any;
  placeholder?: string;
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: any) => void;
  onReset: () => void;
}

export function SongFormField(props: SongFormFieldProps) {
  const config = getFieldConfig(props.field);

  // critical: use refs to prevent focus loss during reactive updates
  let inputRef: HTMLInputElement | undefined;

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
      if (inputRef.value !== newValue) {
        inputRef.value = newValue;
        // if the input is focused and we're resetting, blur it first
        if (document.activeElement === inputRef && !props.isDirty) {
          inputRef.blur();
        }
      }
    }
  });

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const value = target.value;

    let processedValue: any;
    if (config.type === "number") {
      processedValue = value === "" ? null : parseInt(value, 10);
    } else {
      processedValue = value === "" ? null : value;
    }

    props.onUpdate(processedValue);
  };

  const renderInput = () => {
    switch (config.type) {
      case "text":
      case "number":
        return (
          <input
            ref={(el) => {
              inputRef = el;
            }}
            type={config.type}
            placeholder={props.placeholder}
            disabled={props.disabled}
            data-field={props.field}
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
          />
        );

      case "select":
        return (
          <GenreSelect
            value={props.value}
            isDirty={props.isDirty}
            disabled={props.disabled}
            onUpdate={props.onUpdate}
            onReset={props.onReset}
          />
        );

      case "sub_genres":
        return (
          <SubGenresInput
            value={props.value}
            isDirty={props.isDirty}
            disabled={props.disabled}
            onUpdate={props.onUpdate}
            onReset={props.onReset}
          />
        );

      case "rating":
        return (
          <SongRatingField
            value={props.value}
            isDirty={props.isDirty}
            disabled={props.disabled}
            onUpdate={props.onUpdate}
            onReset={props.onReset}
          />
        );

      case "favorite":
        return (
          <SongFavoriteField
            value={props.value}
            isDirty={props.isDirty}
            disabled={props.disabled}
            onUpdate={props.onUpdate}
            onReset={props.onReset}
          />
        );

      case "image":
        return (
          <SongImageField
            value={props.value}
            isDirty={props.isDirty}
            disabled={props.disabled}
            onUpdate={props.onUpdate}
            onReset={props.onReset}
          />
        );

      default:
        return (
          <div class="text-red-500">
            unknown field type: {(config as any).type}
          </div>
        );
    }
  };

  // rating, favorite, image, select, and sub_genres components handle their own layout
  if (
    config.type === "rating" ||
    config.type === "favorite" ||
    config.type === "image" ||
    config.type === "select" ||
    config.type === "sub_genres"
  ) {
    return renderInput();
  }

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-gray-300">
          {config.label}
          {"required" in config && config.required && (
            <span class="text-red-400 ml-1">*</span>
          )}
        </label>
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

      {renderInput()}
    </div>
  );
}
