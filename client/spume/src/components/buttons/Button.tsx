import { JSX, splitProps } from "solid-js";
import { solidColors } from "../../../design-system/colors";

export interface ButtonProps
  extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** visual style variant */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** size variant */
  size?: "sm" | "default";
  /** whether button spans full width */
  fullWidth?: boolean;
  /** children/content */
  children?: JSX.Element;
}

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, [
    "variant",
    "size",
    "fullWidth",
    "class",
    "children",
  ]);

  const variant = () => local.variant || "primary";
  const size = () => local.size || "md";

  const variantClasses = () => {
    switch (variant()) {
      case "primary": {
        const colors = solidColors.accent;
        return `bg-[${colors.bg}] hover:bg-[var(--color-accent-400)] text-[${colors.text}]`;
      }
      case "secondary":
        return "bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]";
      case "ghost":
        return "bg-transparent hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]";
      case "danger": {
        const colors = solidColors.error;
        return `bg-[${colors.bg}] hover:bg-[${colors.bg}] hover:brightness-90 text-[${colors.text}]`;
      }
      default: {
        const colors = solidColors.accent;
        return `bg-[${colors.bg}] hover:bg-[var(--color-accent-400)] text-[${colors.text}]`;
      }
    }
  };

  const sizeClasses = () => {
    switch (size()) {
      case "sm":
        return "px-2 py-1 text-xs";
      default:
        return "px-3 py-2 text-sm";
    }
  };

  return (
    <button
      class={`
        ${variantClasses()}
        ${sizeClasses()}
        ${local.fullWidth ? "w-full" : ""}
        rounded
        font-medium
        transition-colors
        focus:outline-none
        focus:ring-2
        focus:ring-[var(--color-accent-500)]
        focus:ring-offset-2
        focus:ring-offset-[var(--color-bg-primary)]
        disabled:opacity-50
        disabled:cursor-not-allowed
        flex
        items-center
        justify-center
        gap-2
        ${local.class || ""}
      `}
      {...others}
    >
      {local.children}
    </button>
  );
}

export default Button;
