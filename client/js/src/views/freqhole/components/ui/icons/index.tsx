/* @jsxImportSource solid-js */

// Base icon props interface
export interface IconProps {
  size?: number | string;
  color?: string;
  className?: string;
  "aria-label"?: string;
}

// Re-export all icon components from organized modules
export * from "./player.js";
export * from "./navigation.js";

// Re-export registry functionality from separate file
export * from "./registry.js";

// Utility type for icon components
export type IconComponent = (props: IconProps) => any;
