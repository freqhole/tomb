import { Show, splitProps, type JSX } from "solid-js";
import { createIsMobile } from "../../utils/isMobile";

export interface TwoColumnLayoutProps {
  /** content for the left column (list/navigation) */
  leftColumn: JSX.Element;
  /** content for the right column (detail view) */
  rightColumn: JSX.Element;
  /** optional alphabet navigation on the far left */
  alphabetNav?: JSX.Element;
  /** width of the left column in pixels (default: 320px) */
  leftColumnWidth?: number;
  /** additional CSS classes */
  class?: string;
}

/**
 * two-column layout component for list + detail views
 *
 * - desktop: shows two columns side-by-side with optional alphabet nav
 * - mobile: stacks to single column (shows left column by default)
 * - left column has fixed width, right column fills remaining space
 * - alphabet nav appears on far left when provided
 *
 * used in: artists view, genres view, and similar list+detail patterns
 */
export function TwoColumnLayout(props: TwoColumnLayoutProps) {
  const [local, others] = splitProps(props, [
    "leftColumn",
    "rightColumn",
    "alphabetNav",
    "leftColumnWidth",
    "class",
  ]);

  const isMobile = createIsMobile();

  // calculate left column width style
  const leftWidth = () => local.leftColumnWidth || 320;

  return (
    <div
      class={`flex h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] w-full max-w-full ${local.class || ""}`}
      {...others}
    >
      {/* optional alphabet navigation */}
      <Show when={local.alphabetNav && !isMobile()}>{local.alphabetNav}</Show>

      {/* left column - list view */}
      <Show when={!isMobile()}>
        <div
          class="flex-shrink-0 flex flex-col border-r border-[var(--color-border-default)]"
          style={{ width: `${leftWidth()}px`, "min-width": `${leftWidth()}px` }}
        >
          {local.leftColumn}
        </div>
      </Show>

      {/* mobile: show only left column */}
      <Show when={isMobile()}>
        <div class="flex-1 flex flex-col min-w-0">{local.leftColumn}</div>
      </Show>

      {/* right column - detail view (desktop only) */}
      <Show when={!isMobile()}>
        <div class="flex-1 flex flex-col min-w-0">{local.rightColumn}</div>
      </Show>
    </div>
  );
}
