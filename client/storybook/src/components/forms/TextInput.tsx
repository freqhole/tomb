import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { Icon } from "../icons/registry";

export interface TextInputProps
  extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "filled";
  leftIcon?: JSX.Element;
  rightIcon?: JSX.Element;
  class?: string;
}

// text input component with label, validation, and icons
export function TextInput(props: TextInputProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "error",
    "hint",
    "size",
    "variant",
    "leftIcon",
    "rightIcon",
    "class",
    "disabled",
  ]);

  const size = () => local.size || "md";
  const variant = () => local.variant || "default";

  const sizeClasses = () => {
    switch (size()) {
      case "sm":
        return "px-3 py-1.5 text-sm";
      case "lg":
        return "px-4 py-3 text-base";
      default:
        return "px-3 py-2 text-sm";
    }
  };

  const variantClasses = () => {
    const base = "w-full rounded border transition-colors";
    const disabled = local.disabled
      ? "opacity-50 cursor-not-allowed bg-[var(--color-bg-tertiary)]"
      : "";

    if (local.error) {
      return `${base} border-[var(--color-error)] focus:ring-2 focus:ring-[var(--color-error)] focus:ring-opacity-50 ${disabled}`;
    }

    switch (variant()) {
      case "filled":
        return `${base} bg-[var(--color-bg-tertiary)] border-transparent focus:bg-[var(--color-bg-primary)] focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 ${disabled}`;
      default:
        return `${base} bg-[var(--color-bg-primary)] border-[var(--color-border-default)] focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 ${disabled}`;
    }
  };

  const textColorClass = () => {
    if (local.disabled) {
      return "text-[var(--color-text-disabled)]";
    }
    return "text-[var(--color-text-primary)]";
  };

  const placeholderClass = () => {
    return "placeholder:text-[var(--color-text-muted)]";
  };

  return (
    <div class={`space-y-1 ${local.class || ""}`}>
      <Show when={local.label}>
        <label class="label text-[var(--color-text-secondary)] block">
          {local.label}
        </label>
      </Show>

      <div class="relative">
        <Show when={local.leftIcon}>
          <div class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {local.leftIcon}
          </div>
        </Show>

        <input
          class={`
            ${variantClasses()}
            ${sizeClasses()}
            ${textColorClass()}
            ${placeholderClass()}
            ${local.leftIcon ? "pl-10" : ""}
            ${local.rightIcon ? "pr-10" : ""}
            focus:outline-none
          `}
          disabled={local.disabled}
          {...rest}
        />

        <Show when={local.rightIcon}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {local.rightIcon}
          </div>
        </Show>

        <Show when={local.error}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Icon name="alertTriangle" size={16} color="var(--color-error)" />
          </div>
        </Show>
      </div>

      <Show when={local.error}>
        <div class="body-xs text-[var(--color-error)]">{local.error}</div>
      </Show>

      <Show when={local.hint && !local.error}>
        <div class="caption">{local.hint}</div>
      </Show>
    </div>
  );
}
