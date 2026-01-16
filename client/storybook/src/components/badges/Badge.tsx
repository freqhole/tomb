import type { JSX, ParentComponent } from "solid-js";
import { splitProps } from "solid-js";
import { Icon, type IconName } from "../icons/registry";

export interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "success" | "warning" | "error" | "outline";
  size?: "sm" | "md" | "lg";
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
      case "lg":
        return "px-4 py-2 text-sm gap-2.5";
      default:
        return "px-3 py-1 text-sm gap-2";
    }
  };

  const iconSize = () => {
    switch (size()) {
      case "sm":
        return 12;
      case "lg":
        return 16;
      default:
        return 14;
    }
  };

  const variantClasses = () => {
    const base = "inline-flex items-center rounded-full font-medium";

    switch (variant()) {
      case "accent":
        return `${base} bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] border border-[var(--color-accent-500)]`;
      case "success":
        return `${base} bg-[var(--color-success)] text-[var(--color-text-on-success)] border border-[var(--color-success)]`;
      case "warning":
        return `${base} bg-[var(--color-warning)] text-[var(--color-text-on-warning)] border border-[var(--color-warning)]`;
      case "error":
        return `${base} bg-[var(--color-error)] text-[var(--color-text-on-error)] border border-[var(--color-error)]`;
      case "outline":
        return `${base} bg-transparent text-[var(--color-text-secondary)] border border-[var(--color-border-default)]`;
      case "default":
      default:
        return `${base} bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)]`;
    }
  };

  return (
    <span
      class={`${variantClasses()} ${sizeClasses()} ${local.class || ""}`}
      {...rest}
    >
      {local.icon && (
        <Icon name={local.icon} size={iconSize()} color="currentColor" />
      )}
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
