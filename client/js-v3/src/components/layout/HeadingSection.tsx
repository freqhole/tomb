import { createSignal, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";

export interface HeadingSectionProps {
  /** main heading text */
  title: string;
  /** optional item count to display */
  count?: number;
  /** custom label for count (e.g. "favorites" instead of auto-pluralized title) */
  countLabel?: string;
  /** optional subtitle or description */
  subtitle?: string;
  /** optional sort/filter controls on the right */
  controls?: JSX.Element;
  /** additional actions or buttons */
  actions?: JSX.Element;
  /** loading state */
  loading?: boolean;
  /** hide entire section on narrow viewports (title shown in TopNav instead) */
  hideOnNarrow?: boolean;
  /** compact mode - less padding, smaller text */
  compact?: boolean;
  /** additional CSS classes */
  class?: string;
}

/**
 * heading section component for list views
 *
 * - displays title with optional count
 * - optional subtitle/description
 * - sort and filter controls on the right
 * - action buttons (play all, shuffle, etc)
 * - loading state support
 * - responsive hiding (hideOnNarrow) when title is shown in TopNav
 *
 * used in: song list, artist list, album grid, any collection view
 */
export function HeadingSection(props: HeadingSectionProps) {
  const NARROW_BREAKPOINT = 768;
  const [isNarrow, setIsNarrow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false
  );

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  const [local, others] = splitProps(props, [
    "title",
    "count",
    "countLabel",
    "subtitle",
    "controls",
    "actions",
    "loading",
    "hideOnNarrow",
    "compact",
    "class",
  ]);

  // generate count text
  const countText = () => {
    if (local.count === undefined) return null;
    if (local.countLabel) {
      return `${local.count} ${local.countLabel}`;
    }
    // auto-pluralize based on title
    const label = local.title.toLowerCase();
    return `${local.count} ${label}${local.count !== 1 ? "" : ""}`;
  };

  // hide on narrow if requested (title/count shown in TopNav instead)
  if (props.hideOnNarrow && isNarrow()) {
    // still render controls/actions on narrow, just not the title
    if (!local.controls && !local.actions) {
      return null;
    }
    return (
      <div class={`flex-shrink-0 ${local.compact ? "p-2" : "p-3"} ${local.class || ""}`} {...others}>
        <div class="flex items-center justify-between gap-4">
          <Show when={local.controls}>
            <div class="flex-shrink-0">{local.controls}</div>
          </Show>
          <Show when={local.actions}>
            <div class="flex items-center gap-2">{local.actions}</div>
          </Show>
        </div>
      </div>
    );
  }

  return (
    <div class={`flex-shrink-0 ${local.compact ? "p-2" : "p-3"} ${local.class || ""}`} {...others}>
      {/* header row with title and controls */}
      <div class={`flex items-start justify-between ${local.compact ? "mb-2" : "mb-4"} gap-4`}>
        {/* left side: title and count */}
        <div class="flex-1 min-w-0">
          <h1 class={`${local.compact ? "text-xl" : "text-2xl"} font-semibold text-[var(--color-text-primary)] ${local.compact ? "mb-1" : "mb-2"}`}>
            {local.title}
          </h1>
          <Show when={local.loading}>
            <p class="text-[var(--color-text-secondary)] text-sm">loading...</p>
          </Show>
          <Show when={!local.loading && local.count !== undefined}>
            <p class="text-[var(--color-text-secondary)] text-sm">
              {countText()}
            </p>
          </Show>
          <Show when={!local.loading && local.subtitle}>
            <p class="text-[var(--color-text-secondary)] text-sm">
              {local.subtitle}
            </p>
          </Show>
        </div>

        {/* right side: sort controls */}
        <Show when={local.controls}>
          <div class="flex-shrink-0">{local.controls}</div>
        </Show>
      </div>

      {/* action buttons row */}
      <Show when={local.actions}>
        <div class="flex items-center gap-2">{local.actions}</div>
      </Show>
    </div>
  );
}
