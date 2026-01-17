import { Show, splitProps, type JSX } from "solid-js";

export interface HeadingSectionProps {
  /** main heading text */
  title: string;
  /** optional item count to display */
  count?: number;
  /** optional subtitle or description */
  subtitle?: string;
  /** optional sort/filter controls on the right */
  controls?: JSX.Element;
  /** additional actions or buttons */
  actions?: JSX.Element;
  /** loading state */
  loading?: boolean;
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
 *
 * used in: song list, artist list, album grid, any collection view
 */
export function HeadingSection(props: HeadingSectionProps) {
  const [local, others] = splitProps(props, [
    "title",
    "count",
    "subtitle",
    "controls",
    "actions",
    "loading",
    "class",
  ]);

  return (
    <div class={`flex-shrink-0 p-3 ${local.class || ""}`} {...others}>
      {/* header row with title and controls */}
      <div class="flex items-start justify-between mb-4 gap-4">
        {/* left side: title and count */}
        <div class="flex-1 min-w-0">
          <h1 class="text-2xl font-semibold text-[var(--color-text-primary)] mb-2">
            {local.title}
          </h1>
          <Show when={local.loading}>
            <p class="text-[var(--color-text-secondary)] text-sm">loading...</p>
          </Show>
          <Show when={!local.loading && local.count !== undefined}>
            <p class="text-[var(--color-text-secondary)] text-sm">
              {local.count} {local.title.toLowerCase()}
              {local.count !== 1 ? "s" : ""}
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
