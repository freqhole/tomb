import type { JSX } from "solid-js";
import { splitProps } from "solid-js";
import { solidColors } from "../../design-system/colors";
import { Icon, type IconName } from "../icons/registry";

export interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  variant?: "default" | "ghost" | "outline" | "accent" | "danger";
  size?: "sm" | "default";
  iconSize?: number;
  class?: string;
  "aria-label": string;
  /** show a spinner in place of the icon and force the disabled state -
   *  use while an async action triggered by this button is in flight */
  loading?: boolean;
}

// icon button with consistent styling and variants
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, [
    "icon",
    "variant",
    "size",
    "iconSize",
    "class",
    "loading",
    "disabled",
  ]);

  const variant = () => local.variant || "ghost";
  const size = () => local.size || "md";

  const sizeClasses = () => {
    switch (size()) {
      case "sm":
        return "p-1";
      default:
        return "p-2";
    }
  };

  const iconSizeMap = () => {
    if (local.iconSize) return local.iconSize;
    switch (size()) {
      case "sm":
        return 16;
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
      case "accent": {
        const colors = solidColors.accent;
        return `${base} bg-[${colors.bg}] hover:bg-[var(--color-accent-400)] text-[${colors.text}] focus:ring-[${colors.border}]`;
      }
      case "danger":
        return `${base} hover:bg-[var(--color-bg-hover)] text-[var(--color-error)] focus:ring-[var(--color-error)]`;
      case "ghost":
      default:
        return `${base} hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus:ring-[var(--color-border-strong)]`;
    }
  };

  const disabledClasses = () =>
    local.disabled || local.loading
      ? "opacity-50 cursor-not-allowed pointer-events-none"
      : "cursor-pointer";

  return (
    <button
      type="button"
      disabled={local.disabled || local.loading}
      class={`${variantClasses()} ${sizeClasses()} ${disabledClasses()} ${local.class || ""}`}
      {...rest}
    >
      <Icon
        name={local.loading ? "loader" : local.icon}
        size={iconSizeMap()}
        color="currentColor"
        className={local.loading ? "animate-spin" : undefined}
      />
    </button>
  );
}
