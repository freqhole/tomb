import type { JSX } from "solid-js";
import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
} from "solid-js";
import { Icon } from "../icons/registry";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  variant?: "default" | "filled";
  options: SelectOption[];
  placeholder?: string;
  class?: string;
}

// select/dropdown component with label, validation, and styling
export function Select(props: SelectProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "error",
    "hint",
    "variant",
    "options",
    "placeholder",
    "class",
    "disabled",
  ]);

  const variant = () => local.variant || "default";

  const variantClasses = () => {
    const base = "w-full rounded border transition-colors appearance-none";
    const disabled = local.disabled
      ? "opacity-50 cursor-not-allowed bg-[var(--color-bg-tertiary)]"
      : "cursor-pointer";

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

  return (
    <div class={`space-y-1 ${local.class || ""}`}>
      <Show when={local.label}>
        <label class="label text-[var(--color-text-secondary)] block">
          {local.label}
        </label>
      </Show>

      <div class="relative">
        <select
          class={`
            ${variantClasses()}
            px-3 py-2 text-sm
            ${textColorClass()}
            pr-10
            focus:outline-none
          `}
          disabled={local.disabled}
          {...rest}
        >
          <Show when={local.placeholder}>
            <option value="" disabled selected>
              {local.placeholder}
            </option>
          </Show>
          <For each={local.options}>
            {(option) => (
              <option value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            )}
          </For>
        </select>

        {/* custom dropdown arrow */}
        <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center">
          <Show
            when={local.error}
            fallback={
              <Icon
                name="chevronDown"
                size={16}
                color="var(--color-text-tertiary)"
              />
            }
          >
            <Icon name="alertTriangle" size={16} color="var(--color-error)" />
          </Show>
        </div>
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
