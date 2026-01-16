import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { Icon } from "../icons/registry";

export interface TextAreaProps
  extends JSX.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  variant?: "default" | "filled";
  resize?: "none" | "vertical" | "horizontal" | "both";
  class?: string;
}

// textarea component with label, validation, and auto-resize support
export function TextArea(props: TextAreaProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "error",
    "hint",
    "variant",
    "resize",
    "class",
    "disabled",
  ]);

  const variant = () => local.variant || "default";
  const resize = () => local.resize || "vertical";

  const resizeClass = () => {
    switch (resize()) {
      case "none":
        return "resize-none";
      case "horizontal":
        return "resize-x";
      case "both":
        return "resize";
      default:
        return "resize-y";
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
        <textarea
          class={`
            ${variantClasses()}
            ${resizeClass()}
            ${textColorClass()}
            ${placeholderClass()}
            px-3 py-2 text-sm
            focus:outline-none
            min-h-[80px]
          `}
          disabled={local.disabled}
          {...rest}
        />

        <Show when={local.error}>
          <div class="absolute right-3 top-3 pointer-events-none">
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
