import { JSX } from "solid-js";

export interface IconToggleProps {
  /** current toggle state */
  active: boolean;
  /** callback when toggle is clicked */
  onToggle: () => void;
  /** icon to show when active (svg path data) */
  activeIcon: JSX.Element;
  /** icon to show when inactive (svg path data) */
  inactiveIcon: JSX.Element;
  /** tooltip text when active */
  activeTitle?: string;
  /** tooltip text when inactive */
  inactiveTitle?: string;
  /** additional css classes */
  class?: string;
  /** whether the button is disabled */
  disabled?: boolean;
}

export function IconToggle(props: IconToggleProps) {
  return (
    <button
      class={`
        flex items-center justify-center w-full h-full transition-colors
        ${props.active ? "text-[var(--color-accent-500)]" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"}
        ${props.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${props.class || ""}
      `}
      onClick={() => props.onToggle?.()}
      disabled={props.disabled}
      title={props.active ? props.activeTitle : props.inactiveTitle}
    >
      {props.active ? props.activeIcon : props.inactiveIcon}
    </button>
  );
}

export default IconToggle;
