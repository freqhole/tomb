import { Show, splitProps, type JSX } from "solid-js";
import { Icon, type IconName } from "../icons/registry";

export interface StatsCardProps {
  /** stat label (e.g., "songs", "albums", "duration") */
  label: string;
  /** stat value (number or formatted string) */
  value: string | number;
  /** optional icon name */
  icon?: IconName;
  /** optional subtitle or secondary text */
  subtitle?: string;
  /** whether the card is loading */
  loading?: boolean;
  /** variant style */
  variant?: "default" | "compact" | "minimal";
  /** additional classes */
  class?: string;
  /** callback when card is clicked */
  onClick?: () => void;
}

// stats card for displaying metrics (song count, duration, ratings, etc.)
export function StatsCard(props: StatsCardProps) {
  const [local, others] = splitProps(props, [
    "label",
    "value",
    "icon",
    "subtitle",
    "loading",
    "variant",
    "class",
    "onClick",
  ]);

  const variant = () => local.variant || "default";
  const isClickable = () => !!local.onClick;

  const containerClasses = () => {
    const base =
      "rounded-lg transition-all duration-200 flex flex-col justify-center";
    const variants = {
      default: "p-4 bg-[var(--color-bg-secondary)]",
      compact: "p-3 bg-[var(--color-bg-secondary)]",
      minimal: "p-2 bg-transparent",
    };

    const interactive = isClickable()
      ? "cursor-pointer hover:bg-[var(--color-accent-500)]/10 hover:scale-[1.02] active:scale-[0.98]"
      : "";

    return `${base} ${variants[variant()]} ${interactive} ${local.class || ""}`;
  };

  const labelClasses = () => {
    const variants = {
      default: "text-[var(--color-text-secondary)] text-sm mb-1",
      compact: "text-[var(--color-text-secondary)] text-xs mb-0.5",
      minimal: "text-[var(--color-text-tertiary)] text-xs",
    };
    return variants[variant()];
  };

  const valueClasses = () => {
    const variants = {
      default: "text-[var(--color-text-primary)] text-2xl font-semibold",
      compact: "text-[var(--color-text-primary)] text-xl font-semibold",
      minimal: "text-[var(--color-text-primary)] text-lg font-medium",
    };
    return variants[variant()];
  };

  return (
    <div
      class={containerClasses()}
      onClick={() => local.onClick?.()}
      role={isClickable() ? "button" : undefined}
      tabindex={isClickable() ? 0 : undefined}
      {...others}
    >
      <Show when={local.loading}>
        <div class="animate-pulse">
          <div class="h-4 bg-[var(--color-bg-tertiary)] rounded w-16 mb-2" />
          <div class="h-6 bg-[var(--color-bg-tertiary)] rounded w-12" />
        </div>
      </Show>

      <Show when={!local.loading}>
        <div class="flex items-start gap-2">
          <Show when={local.icon}>
            <div class="flex-shrink-0 mt-0.5">
              <Icon
                name={local.icon!}
                size={variant() === "minimal" ? 14 : 16}
                color="var(--color-accent-500)"
              />
            </div>
          </Show>

          <div class="flex-1 min-w-0">
            <div class={labelClasses()}>{local.label}</div>
            <div class={valueClasses()}>{local.value}</div>
            <Show when={local.subtitle}>
              <div class="text-[var(--color-text-tertiary)] text-xs mt-0.5">
                {local.subtitle}
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

// helper to format duration as hours/minutes
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0m";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// helper to format large numbers with commas
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

// stats grid container for grouping multiple stat cards
export interface StatsGridProps {
  /** number of columns (1-6) */
  columns?: 1 | 2 | 3 | 4 | 5 | 6;
  /** gap size between cards */
  gap?: "sm" | "md" | "lg";
  /** additional classes */
  class?: string;
  /** children (typically StatsCard components) */
  children: JSX.Element;
}

export function StatsGrid(props: StatsGridProps) {
  const [local, others] = splitProps(props, [
    "columns",
    "gap",
    "class",
    "children",
  ]);

  const columns = () => local.columns || 3;
  const gap = () => local.gap || "md";

  const gridClasses = () => {
    const colClasses = {
      1: "grid-cols-1",
      2: "grid-cols-1 md:grid-cols-2",
      3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
      4: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
      5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
      6: "grid-cols-2 md:grid-cols-4 lg:grid-cols-6",
    };

    const gapClasses = {
      sm: "gap-2",
      md: "gap-4",
      lg: "gap-6",
    };

    return `grid ${colClasses[columns()]} ${gapClasses[gap()]} ${local.class || ""}`;
  };

  return (
    <div class={gridClasses()} {...others}>
      {local.children}
    </div>
  );
}
