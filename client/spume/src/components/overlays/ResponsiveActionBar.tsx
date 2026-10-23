// responsive action bar - renders an ordered list of actions inline until
// they run out of horizontal room, then progressively collapses the
// lowest-priority ones into an OverflowMenu's "..." button instead of
// wrapping to a second line or shrinking every button down to an
// uncomfortably small tap target. fully dynamic (ResizeObserver-driven) -
// only collapses as many items as are actually needed for the current
// container width, and re-expands them again if the container grows.
//
// `pinnedStart`/`pinnedEnd` content is always shown in full (e.g. the
// page's primary action button, a favorite toggle) and never collapses -
// it's still measured as part of the same row, so its own width is
// correctly accounted for when deciding how many collapsible `items` fit.
// they're passed as render functions (`() => JSX.Element`), not plain
// `JSX.Element`, because this component instantiates them twice (once
// visible, once in a hidden measuring clone - see below) and Solid's JSX
// nodes are real DOM nodes, not a virtual-dom description, so a single
// already-created JSX.Element can only ever live in one place in the
// document at a time.
//
// IMPORTANT: this does *not* measure by mutating the live, visible row and
// re-reading its own size. an earlier version did exactly that (reset to
// show every item, measure, remove one, remeasure, repeat across several
// animation frames) and it infinite-looped in real pages: the visible row
// had no fixed width of its own, so adding/removing its children changed
// its *own* observed box size on every step, and the ResizeObserver had no
// way to tell that self-inflicted resize apart from a genuine window/
// layout resize - so it just kept re-triggering itself forever. the fix
// is to never mutate the thing being observed:
//   - the visible row is pinned to its parent's width (`w-full min-w-0`),
//     so showing/hiding items never changes the row's own box size, and
//     observing it can only ever fire for genuine external resizes.
//   - a separate, hidden, always-fully-rendered clone (every item, always,
//     regardless of `visibleCount`) is used purely to read natural
//     per-item widths. its own size depends only on `props` (item list/
//     content), never on this component's internal state, so observing
//     *it* for content-driven width changes (e.g. a label changing from
//     "play" to "resume") can't create a feedback loop either.
// with both boxes stable w.r.t. this component's own output, there's
// nothing left to recompute() but a single, synchronous, one-shot width
// budget calculation - no rAF stepping loop required at all.
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { OverflowMenu } from "./OverflowMenu";
import { type MenuAction } from "./ContextMenu";

export interface ActionBarItem {
  /** stable key for <For> - typically the action's own label/id */
  key: string;
  /** full inline rendering (an actual Button/icon button) when there's room */
  render: () => JSX.Element;
  /** fallback representation once this item collapses into the "..." menu */
  action: MenuAction;
}

export interface ResponsiveActionBarProps {
  /** ordered by priority - earlier items collapse last, later items
   *  collapse first (truncated from the end as room runs out). */
  items: ActionBarItem[];
  /** always-visible content before the collapsible items (e.g. the page's
   *  primary play/resume button). a render function, not raw JSX - see
   *  the file-level comment above for why. */
  pinnedStart?: () => JSX.Element;
  /** always-visible content after the collapsible items (e.g. a rating
   *  widget). a render function, not raw JSX - see the file-level comment
   *  above for why. */
  pinnedEnd?: () => JSX.Element;
  class?: string;
  overflowLabel?: string;
}

// shared off-screen styling for every measuring-only element: out of
// normal flow (doesn't affect page layout/scroll), not visible, not
// interactive, but still genuinely laid out so real widths can be read.
const measureStyle = { position: "absolute", top: "-9999px", left: "-9999px" } as const;

export function ResponsiveActionBar(props: ResponsiveActionBarProps) {
  let rowRef: HTMLDivElement | undefined;
  let chainRef: HTMLDivElement | undefined;
  let pinnedStartRef: HTMLDivElement | undefined;
  let pinnedEndRef: HTMLDivElement | undefined;
  let overflowRef: HTMLDivElement | undefined;
  const itemRefs: (HTMLDivElement | undefined)[] = [];

  const [visibleCount, setVisibleCount] = createSignal(props.items.length);

  const recompute = () => {
    const row = rowRef;
    const chain = chainRef;
    if (!row || !chain) return;

    const available = row.clientWidth;
    const chainLeft = chain.getBoundingClientRect().left;
    const gapPx = parseFloat(getComputedStyle(chain).columnGap || "0") || 0;

    const total = props.items.length;
    const itemRights = itemRefs
      .slice(0, total)
      .map((el) => (el ? el.getBoundingClientRect().right - chainLeft : 0));
    const lastItemRight =
      itemRights.length > 0
        ? itemRights[itemRights.length - 1]
        : pinnedStartRef
          ? pinnedStartRef.getBoundingClientRect().right - chainLeft
          : 0;

    const pinnedEndWidth = pinnedEndRef ? pinnedEndRef.getBoundingClientRect().width : 0;
    const overflowWidth = overflowRef ? overflowRef.getBoundingClientRect().width : 0;

    const fullWidth = lastItemRight + (pinnedEndWidth > 0 ? gapPx + pinnedEndWidth : 0);
    if (total === 0 || fullWidth <= available) {
      setVisibleCount(total);
      return;
    }

    const reserve =
      (pinnedEndWidth > 0 ? gapPx + pinnedEndWidth : 0) +
      (overflowWidth > 0 ? gapPx + overflowWidth : 0);
    const budget = available - reserve;

    let count = 0;
    for (let i = 0; i < total; i++) {
      if (itemRights[i] <= budget) count = i + 1;
      else break;
    }
    setVisibleCount(count);
  };

  // re-measure whenever the item list (or its rendered content) changes -
  // e.g. navigating to a different video changes which conditional
  // buttons exist, or a label changes from "play" to "resume".
  createEffect(() => {
    props.items;
    recompute();
  });

  onMount(() => {
    recompute();

    // observes the visible row (pinned to a stable, parent-driven width -
    // see the file-level comment) for genuine external layout changes.
    const rowObserver = new ResizeObserver(() => recompute());
    // observes the hidden measuring clone (sized purely by props content,
    // never by this component's own `visibleCount` state) for natural
    // width changes - e.g. a web font finishing load.
    const chainObserver = new ResizeObserver(() => recompute());
    if (rowRef) rowObserver.observe(rowRef);
    if (chainRef) chainObserver.observe(chainRef);

    onCleanup(() => {
      rowObserver.disconnect();
      chainObserver.disconnect();
    });
  });

  const visibleItems = () => props.items.slice(0, visibleCount());
  const overflowItems = () => props.items.slice(visibleCount());

  return (
    <>
      <div
        ref={rowRef}
        class={`flex items-center gap-2 overflow-hidden w-full min-w-0 ${props.class ?? ""}`}
      >
        {props.pinnedStart?.()}
        <For each={visibleItems()}>{(item) => item.render()}</For>
        <Show when={overflowItems().length > 0}>
          <OverflowMenu
            actions={overflowItems().map((item) => item.action)}
            label={props.overflowLabel}
          />
        </Show>
        {props.pinnedEnd?.()}
      </div>

      {/* hidden measuring clone - see the file-level comment for why this
          exists and why it's safe to observe for resize without looping. */}
      <div
        ref={chainRef}
        aria-hidden="true"
        class={`flex items-center gap-2 invisible pointer-events-none whitespace-nowrap ${props.class ?? ""}`}
        style={measureStyle}
      >
        <Show when={props.pinnedStart}>
          <div ref={pinnedStartRef}>{props.pinnedStart?.()}</div>
        </Show>
        <For each={props.items}>
          {(item, index) => <div ref={(el) => (itemRefs[index()] = el)}>{item.render()}</div>}
        </For>
      </div>
      <Show when={props.pinnedEnd}>
        <div
          ref={pinnedEndRef}
          aria-hidden="true"
          class="invisible pointer-events-none whitespace-nowrap"
          style={measureStyle}
        >
          {props.pinnedEnd?.()}
        </div>
      </Show>
      <div
        ref={overflowRef}
        aria-hidden="true"
        class="invisible pointer-events-none whitespace-nowrap"
        style={measureStyle}
      >
        <OverflowMenu actions={[]} label={props.overflowLabel} />
      </div>
    </>
  );
}

export default ResponsiveActionBar;
