import type { JSX, ParentComponent } from "solid-js";
import { splitProps } from "solid-js";
import { solidColors, type SolidColorVariant } from "../../design-system/colors";
import { Icon, type IconName } from "../icons/registry";

export interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "success" | "warning" | "error" | "info" | "outline";
  size?: "sm" | "default";
  icon?: IconName;
  removable?: boolean;
  onRemove?: () => void;
  class?: string;
}

// badge/pill component for tags, labels, and status indicators
export const Badge: ParentComponent<BadgeProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "icon",
    "removable",
    "onRemove",
    "class",
    "children",
  ]);

  const variant = () => local.variant || "default";
  const size = () => local.size || "md";

  const sizeClasses = () => {
    switch (size()) {
      case "sm":
        return "px-2 py-0.5 text-xs gap-1.5";
      default:
        return "px-3 py-1 text-sm gap-2";
    }
  };

  const iconSize = () => {
    switch (size()) {
      case "sm":
        return 12;
      default:
        return 14;
    }
  };

  const variantClasses = () => {
    const base = "inline-flex items-center rounded-full font-medium";

    // use centralized color system for semantic colors
    if (
      variant() === "accent" ||
      variant() === "success" ||
      variant() === "warning" ||
      variant() === "error" ||
      variant() === "info"
    ) {
      const colors = solidColors[variant() as SolidColorVariant];
      return `${base} bg-[${colors.bg}] text-[${colors.text}] border border-[${colors.border}]`;
    }

    switch (variant()) {
      case "outline":
        return `${base} bg-transparent text-[var(--color-text-secondary)] border border-[var(--color-border-default)]`;
      case "default":
      default:
        return `${base} bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)]`;
    }
  };

  return (
    <span class={`${variantClasses()} ${sizeClasses()} ${local.class || ""}`} {...rest}>
      {local.icon && <Icon name={local.icon} size={iconSize()} color="currentColor" />}
      <span>{local.children}</span>
      {local.removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            local.onRemove?.();
          }}
          class="ml-1 hover:bg-[var(--color-overlay-hover)] rounded-full p-0.5 transition-colors"
          aria-label="remove"
        >
          <Icon name="close" size={iconSize() - 2} color="currentColor" />
        </button>
      )}
    </span>
  );
};
