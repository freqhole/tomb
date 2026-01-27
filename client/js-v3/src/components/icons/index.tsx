// Re-export types from types.ts
export type { IconProps, IconComponent } from "./types";

// Re-export all icon components from organized modules
export * from "./navigation";
export * from "./player";

// Re-export registry functionality from separate file
export * from "./registry";

// Utility type for icon components
export type IconComponent = (props: IconProps) => any;
