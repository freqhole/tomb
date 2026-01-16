import type { JSX } from "solid-js";
import { splitProps } from "solid-js";
import { Icon, type IconName } from "../icons/registry";

export interface IconButtonProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  variant?: "default" | "ghost" | "outline" | "accent" | "danger";
  size?: "sm" | "md" | "lg";
  iconSize?: number;
  class?: string;
  "aria-label": string;
}

// icon button with consistent styling and variants
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, [
    "icon",
    "variant",
    "size",
    "iconSize",
    "class",
  ]);

  const variant = () => local.variant || "ghost";
  const size = () => local.size || "md";

  const sizeClasses = () => {
    switch (size()) {
      case "sm":
        return "p-1";
      case "lg":
        return "p-3";
      default:
        return "p-2";
    }
  };

  const iconSizeMap = () => {
    if (local.iconSize) return local.iconSize;
    switch (size()) {
      case "sm":
        return 16;
      case "lg":
        return 24;
      default:
        return 20;
    }
  };

  const variantClasses = () => {
    const base =
      "inline-flex items-center justify-center rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--color-bg-primary)]";

    switch (variant()) {
      case "default":
        return `${base} bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] focus:ring-[var(--color-border-strong)]`;
      case "outline":
        return `${base} border border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] focus:ring-[var(--color-border-strong)]`;
      case "accent":
        return `${base} bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] focus:ring-[var(--color-accent-500)]`;
      case "danger":
        return `${base} hover:bg-[var(--color-bg-hover)] text-[var(--color-error)] focus:ring-[var(--color-error)]`;
      case "ghost":
      default:
        return `${base} hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:ring-[var(--color-border-strong)]`;
    }
  };

  const disabledClasses = () =>
    rest.disabled
      ? "opacity-50 cursor-not-allowed pointer-events-none"
      : "cursor-pointer";

  return (
    <button
      type="button"
      class={`${variantClasses()} ${sizeClasses()} ${disabledClasses()} ${local.class || ""}`}
      {...rest}
    >
      <Icon name={local.icon} size={iconSizeMap()} color="currentColor" />
    </button>
  );
}
