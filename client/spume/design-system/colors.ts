// semantic color utilities - couples background and text colors together
// this prevents bugs where we use a background color with the wrong text color

export interface SemanticColor {
  /** background color variable */
  bg: string;
  /** text color variable for this background */
  text: string;
  /** border color variable */
  border: string;
  /** icon color (usually same as border) */
  icon: string;
}

// solid semantic colors - for badges, buttons, pills
// matches the Colors story - success/warning/info use black, error uses white
export const solidColors = {
  accent: {
    bg: "var(--color-accent-500)",
    text: "var(--color-text-on-accent)", // white
    border: "var(--color-accent-500)",
    icon: "var(--color-text-on-accent)",
  },
  success: {
    bg: "var(--color-success)",
    text: "var(--color-text-on-success)", // black
    border: "var(--color-success)",
    icon: "var(--color-text-on-success)",
  },
  warning: {
    bg: "var(--color-warning)",
    text: "var(--color-text-on-warning)", // black
    border: "var(--color-warning)",
    icon: "var(--color-text-on-warning)",
  },
  error: {
    bg: "var(--color-error)",
    text: "var(--color-text-on-error)", // white
    border: "var(--color-error)",
    icon: "var(--color-text-on-error)",
  },
  info: {
    bg: "var(--color-info)",
    text: "var(--color-text-on-info)", // black
    border: "var(--color-info)",
    icon: "var(--color-text-on-info)",
  },
} as const satisfies Record<string, SemanticColor>;

// translucent semantic colors - for alerts, highlights, inline messages
// ALL use white text because translucent colors on black background need high contrast
export const translucentColors = {
  success: {
    bg: "var(--color-success)",
    bgOpacity: "0.15",
    text: "var(--color-text-primary)", // white text
    border: "var(--color-success)",
    icon: "var(--color-success)", // full color for icons
  },
  warning: {
    bg: "var(--color-warning)",
    bgOpacity: "0.15",
    text: "var(--color-text-primary)", // white text
    border: "var(--color-warning)",
    icon: "var(--color-warning)",
  },
  error: {
    bg: "var(--color-error)",
    bgOpacity: "0.15",
    text: "var(--color-text-primary)", // white text
    border: "var(--color-error)",
    icon: "var(--color-error)",
  },
  info: {
    bg: "var(--color-info)",
    bgOpacity: "0.15",
    text: "var(--color-text-primary)", // white text
    border: "var(--color-info)",
    icon: "var(--color-info)",
  },
} as const;

export type SolidColorVariant = keyof typeof solidColors;
export type TranslucentColorVariant = keyof typeof translucentColors;

// helper to get tailwind classes for solid colors
export function getSolidColorClasses(variant: SolidColorVariant): string {
  const color = solidColors[variant];
  return `bg-[${color.bg}] text-[${color.text}] border-[${color.border}]`;
}

// helper to get tailwind classes for translucent colors
export function getTranslucentColorClasses(
  variant: TranslucentColorVariant,
): string {
  const color = translucentColors[variant];
  return `bg-[${color.bg}] bg-opacity-[${color.bgOpacity}] text-[${color.text}] border-[${color.border}]`;
}

// helper to get inline styles for translucent colors (more reliable than tailwind classes)
export function getTranslucentColorStyles(variant: TranslucentColorVariant): {
  "background-color": string;
  color: string;
  "border-color": string;
} {
  const color = translucentColors[variant];
  return {
    "background-color": `color-mix(in srgb, ${color.bg} ${parseFloat(color.bgOpacity) * 100}%, transparent)`,
    color: color.text,
    "border-color": color.border,
  };
}

// playing indicator classes - for list rows that show currently playing item
// returns classes for playing state or default hover state
export function getPlayingIndicatorClasses(isPlaying: boolean): string {
  if (isPlaying) {
    // accent pink with subtle bg, left border indicator
    return "bg-[#66003b]/20 border-l-2 border-l-[var(--color-accent-500)]";
  }
  // default hover state
  return "hover:bg-[var(--color-bg-tertiary)] active:bg-[var(--color-bg-elevated)]";
}

// playing text color - accent when playing, normal otherwise
export function getPlayingTextClasses(isPlaying: boolean): string {
  return isPlaying
    ? "text-[var(--color-accent-500)]"
    : "text-[var(--color-text-primary)]";
}
