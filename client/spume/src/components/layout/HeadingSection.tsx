import {
  createSignal,
  onCleanup,
  onMount,
  Show,
  splitProps,
  type JSX,
  type ParentProps,
} from "solid-js";
import { Icon } from "../icons/registry";
import { isNarrowViewport } from "../../config/breakpoints";

export interface HeadingSectionProps extends ParentProps {
  /** main heading text */
  title: string;
  /** custom title element (overrides title text, e.g. MarqueeText) */
  titleElement?: JSX.Element;
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
  /** variant: "list" for collection headers, "detail" for detail panel headers */
  variant?: "list" | "detail";
  /** make header sticky at top */
  sticky?: boolean;
  /** show bottom border */
  border?: boolean;
  /** show back button (for mobile navigation) */
  showBackButton?: boolean;
  /** callback when back button clicked */
  onBack?: () => void;
  /** additional CSS classes */
  class?: string;
}

/**
 * heading section component for list views and detail panels
 *
 * - displays title with optional count
 * - optional subtitle/description
 * - sort and filter controls on the right
 * - action buttons (play all, shuffle, etc)
 * - loading state support
 * - responsive hiding (hideOnNarrow) when title is shown in TopNav
 * - sticky positioning for detail panel headers
 * - back button for mobile navigation
 *
 * variants:
 * - "list" (default): for collection list headers (artists, albums, songs, etc)
 * - "detail": for detail panel headers (artist detail, album detail, etc)
 *
 * used in: song list, artist list, album grid, detail panels, any collection view
 */
export function HeadingSection(props: HeadingSectionProps) {
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(isNarrowViewport());
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  const [local, others] = splitProps(props, [
    "title",
    "titleElement",
    "count",
    "countLabel",
    "subtitle",
    "controls",
    "actions",
    "loading",
    "hideOnNarrow",
    "compact",
    "variant",
    "sticky",
    "border",
    "showBackButton",
    "onBack",
    "class",
    "children",
  ]);

  const isDetail = () => local.variant === "detail";

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

  // build container classes
  const containerClasses = () => {
    const classes = ["flex-shrink-0"];

    // sticky positioning
    if (local.sticky) {
      classes.push("sticky top-0 z-10 bg-[var(--color-bg-primary)]");
    }

    // border
    if (local.border) {
      classes.push("border-b border-[var(--color-border-default)]");
    }

    // padding - detail variant uses responsive padding
    if (isDetail()) {
      classes.push("px-3 wide:px-6 py-2 wide:py-4");
    }
    // else if (local.compact) {
    //   classes.push("p-2");
    // } else {
    //   classes.push("p-3");
    // }

    if (local.class) {
      classes.push(local.class);
    }

    return classes.join(" ");
  };

  // title text size
  const titleClasses = () => {
    if (isDetail()) {
      return "text-xl wide:text-3xl font-bold text-[var(--color-text-primary)] truncate";
    }
    return `${local.compact ? "text-xl" : "text-2xl"} font-semibold text-[var(--color-text-primary)]`;
  };

  // hide on narrow if requested (title/count shown in TopNav instead)
  if (props.hideOnNarrow && isNarrow()) {
    // still render controls/actions on narrow, just not the title
    if (!local.controls && !local.actions) {
      return null;
    }
    return (
      <div class={containerClasses()} {...others}>
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

  // detail variant: horizontal layout with back button + title + controls
  if (isDetail()) {
    return (
      <div class={containerClasses()} {...others}>
        <div class="flex items-center gap-3 ">
          {/* back button */}
          <Show when={local.showBackButton}>
            <button
              class="p-2 -ml-2 rounded-full hover:bg-[var(--color-bg-secondary)] text-[var(--color-accent-500)]"
              onClick={() => local.onBack?.()}
              aria-label="back to list"
            >
              <Icon name="chevronLeft" size={20} />
            </button>
          </Show>

          {/* title */}
          <h2 class={`flex-1 min-w-0 ${titleClasses()}`}>{local.titleElement || local.title}</h2>

          {/* controls on the right */}
          <Show when={local.controls}>
            <div class="flex-shrink-0">{local.controls}</div>
          </Show>
        </div>

        {/* custom content (stats grids, etc) */}
        <Show when={local.children}>
          <div class="mt-4">{local.children}</div>
        </Show>

        {/* actions below content if provided */}
        <Show when={local.actions}>
          <div class="flex items-center gap-2 mt-3">{local.actions}</div>
        </Show>
      </div>
    );
  }

  // list variant: traditional vertical layout
  return (
    <div class={containerClasses()} {...others}>
      {/* header row with title and controls */}
      <div class={`flex items-start justify-between gap-4`}>
        {/* left side: title and count */}
        <div class="flex-1 min-w-0">
          <h1 class={titleClasses()}>{local.titleElement || local.title}</h1>
          <Show when={local.loading}>
            <p class="text-[var(--color-text-secondary)] text-sm">loading...</p>
          </Show>
          <Show when={!local.loading && local.count !== undefined}>
            <p class="text-[var(--color-text-secondary)] text-sm">{countText()}</p>
          </Show>
          <Show when={!local.loading && local.subtitle}>
            <p class="text-[var(--color-text-secondary)] text-sm">{local.subtitle}</p>
          </Show>
        </div>

        {/* right side: sort controls */}
        <Show when={local.controls}>
          <div class="flex-shrink-0">{local.controls}</div>
        </Show>
      </div>

      {/* custom content (stats grids, etc) */}
      <Show when={local.children}>{local.children}</Show>

      {/* action buttons row */}
      <Show when={local.actions}>
        <div class="flex items-center gap-2">{local.actions}</div>
      </Show>
    </div>
  );
}
