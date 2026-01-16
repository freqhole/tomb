import { JSX, splitProps } from "solid-js";

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** visual style variant */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** size variant */
  size?: "sm" | "md" | "lg";
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
      case "primary":
        return "bg-magenta-500 hover:bg-magenta-600 text-white";
      case "secondary":
        return "bg-gray-700 hover:bg-gray-600 text-white";
      case "ghost":
        return "bg-transparent hover:bg-gray-800 text-gray-300 hover:text-white";
      case "danger":
        return "bg-red-600 hover:bg-red-700 text-white";
      default:
        return "bg-magenta-500 hover:bg-magenta-600 text-white";
    }
  };

  const sizeClasses = () => {
    switch (size()) {
      case "sm":
        return "px-2 py-1 text-xs";
      case "md":
        return "px-3 py-2 text-sm";
      case "lg":
        return "px-4 py-3 text-base";
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
        focus:ring-magenta-500
        focus:ring-offset-2
        focus:ring-offset-dark-900
        disabled:opacity-50
        disabled:cursor-not-allowed
        ${local.class || ""}
      `}
      {...others}
    >
      {local.children}
    </button>
  );
}

export default Button;
