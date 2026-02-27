import {
  Show,
  splitProps,
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  type JSX,
  type Accessor,
} from "solid-js";
import { isNarrowViewport } from "../../config/breakpoints";

export interface TwoColumnLayoutProps {
  /** content for the left column (list/navigation) */
  leftColumn: JSX.Element;
  /** content for the right column (detail view) */
  rightColumn: JSX.Element;
  /** optional alphabet navigation on the far left */
  alphabetNav?: JSX.Element;
  /** width of the left column in pixels (default: 320px) */
  leftColumnWidth?: number;
  /** whether detail is showing on mobile (for back navigation) */
  showDetail?: boolean;
  /** callback when back button is pressed on mobile */
  onBack?: () => void;
  /** additional CSS classes */
  class?: string;
}

/**
 * two-column layout component for list + detail views
 *
 * - desktop (md+): shows two columns side-by-side with optional alphabet nav
 * - mobile (<md): shows list by default, detail slides over when showDetail=true
 * - left column has fixed width, right column fills remaining space
 * - alphabet nav appears on far left when provided (hidden on narrow)
 *
 * used in: artists view, genres view, and similar list+detail patterns
 */
export function TwoColumnLayout(props: TwoColumnLayoutProps) {
  const [local, others] = splitProps(props, [
    "leftColumn",
    "rightColumn",
    "alphabetNav",
    "leftColumnWidth",
    "showDetail",
    "onBack",
    "class",
  ]);

  // calculate left column width style
  const leftWidth = () => local.leftColumnWidth || 320;

  return (
    <div
      class={`flex h-full bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] w-full max-w-full ${local.class || ""}`}
      {...others}
    >
      {/* optional alphabet navigation */}
      {/* on narrow: shown alongside list, hidden when detail showing */}
      {/* on wide: always visible */}
      <Show when={local.alphabetNav}>
        <div class={`flex-shrink-0 ${local.showDetail ? "hidden wide:block" : "block"}`}>
          {local.alphabetNav}
        </div>
      </Show>

      {/* left column - list view */}
      {/* on narrow: fills remaining width, hidden when detail is showing */}
      {/* on wide: fixed width sidebar */}
      <div
        class={`flex-shrink-0 flex flex-col border-r border-[var(--color-border-default)] overflow-hidden
          flex-1 wide:flex-none wide:w-auto
          ${local.showDetail ? "hidden wide:flex" : "flex"}`}
        style={{
          "--left-width": `${leftWidth()}px`,
        }}
      >
        <div class="wide:w-[var(--left-width)] wide:min-w-[var(--left-width)] h-full overflow-hidden">
          {local.leftColumn}
        </div>
      </div>

      {/* right column - detail view */}
      {/* on narrow: full width overlay with slide-in, only when showDetail */}
      {/* on wide: always visible, fills remaining space */}
      {/* back button is now rendered by the detail view itself for better layout control */}
      <div
        class={`flex-1 flex flex-col min-w-0
          ${local.showDetail ? "flex" : "hidden wide:flex"}
          wide:relative`}
      >
        {local.rightColumn}
      </div>
    </div>
  );
}

// ============================================================================
// ResponsiveMasterDetail - self-managing two-column layout with selection state
// ============================================================================

/** context passed to render props */
export interface MasterDetailContext<T> {
  /** currently selected item */
  selectedItem: Accessor<T | null>;
  /** select an item (triggers detail view on narrow) */
  selectItem: (item: T | null) => void;
  /** whether viewport is narrow (<768px) */
  isNarrow: Accessor<boolean>;
  /** whether detail view is showing on narrow */
  showingDetail: Accessor<boolean>;
  /** go back to list view (on narrow) */
  onBack: () => void;
}

export interface ResponsiveMasterDetailProps<T> {
  /** list of items to display */
  items: T[] | Accessor<T[]>;
  /**
   * initially selected item (uncontrolled mode)
   * use this when you don't need external control over selection
   */
  initialSelection?: T | null;
  /**
   * controlled selection - when provided, component uses this value
   * and calls onSelectionChange when user selects items
   */
  selection?: Accessor<T | null>;
  /** get unique key for item comparison */
  getItemKey: (item: T) => string | number;
  /** render the list column - receives context with selection handlers */
  renderList: (ctx: MasterDetailContext<T>) => JSX.Element;
  /** render the detail column - receives context with selected item */
  renderDetail: (ctx: MasterDetailContext<T>) => JSX.Element;
  /** render empty state when nothing selected (optional) */
  renderEmpty?: () => JSX.Element;
  /** optional alphabet navigation */
  alphabetNav?: JSX.Element;
  /** width of left column in pixels (default: 320) */
  leftColumnWidth?: number;
  /** callback when selection changes */
  onSelectionChange?: (item: T | null) => void;
  /** additional CSS classes */
  class?: string;
}

/**
 * responsive master-detail layout that manages selection state internally
 *
 * supports both controlled and uncontrolled selection:
 * - uncontrolled: use `initialSelection` prop, component manages state
 * - controlled: use `selection` accessor + `onSelectionChange` callback
 *
 * on narrow screens (<768px):
 * - shows list by default
 * - when item selected, shows detail view with back button
 * - back button returns to list
 *
 * on wide screens (>=768px):
 * - shows both columns side-by-side
 * - selection updates detail view in place
 *
 * example usage (uncontrolled):
 * ```tsx
 * <ResponsiveMasterDetail
 *   items={artists()}
 *   initialSelection={artists()[0]}
 *   getItemKey={(a) => a.id}
 *   renderList={(ctx) => (
 *     <For each={artists()}>
 *       {(artist) => (
 *         <ListItem
 *           selected={ctx.selectedItem()?.id === artist.id}
 *           onClick={() => ctx.selectItem(artist)}
 *         >
 *           {artist.name}
 *         </ListItem>
 *       )}
 *     </For>
 *   )}
 *   renderDetail={(ctx) => (
 *     <Show when={ctx.selectedItem()}>
 *       {(artist) => <ArtistDetail artist={artist()} />}
 *     </Show>
 *   )}
 * />
 * ```
 *
 * example usage (controlled):
 * ```tsx
 * const [selected, setSelected] = createSignal<Artist | null>(null);
 *
 * <ResponsiveMasterDetail
 *   items={artists()}
 *   selection={selected}
 *   onSelectionChange={setSelected}
 *   getItemKey={(a) => a.id}
 *   // ... render props
 * />
 * ```
 */
export function ResponsiveMasterDetail<T>(props: ResponsiveMasterDetailProps<T>) {
  // track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(isNarrowViewport());
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  // internal selection state (used when uncontrolled)
  const [internalSelection, setInternalSelection] = createSignal<T | null>(
    props.initialSelection ?? null
  );

  // determine if we're in controlled mode
  const isControlled = () => props.selection !== undefined;

  // get current selection (from props if controlled, internal state otherwise)
  const selectedItem = (): T | null => {
    return isControlled() ? props.selection!() : internalSelection();
  };

  // on narrow, track whether we're showing detail (triggered by selection)
  const [showingDetailOnNarrow, setShowingDetailOnNarrow] = createSignal(false);

  // when controlled selection changes externally, show detail on narrow
  createEffect(() => {
    if (isControlled() && props.selection!() !== null && isNarrow()) {
      setShowingDetailOnNarrow(true);
    }
  });

  // when selection changes on narrow, show detail view
  const selectItem = (item: T | null) => {
    if (!isControlled()) {
      setInternalSelection(() => item);
    }
    if (item !== null && isNarrow()) {
      setShowingDetailOnNarrow(true);
    }
    props.onSelectionChange?.(item);
  };

  // back button handler for narrow
  const handleBack = () => {
    setShowingDetailOnNarrow(false);
  };

  // when going from narrow to wide, reset the narrow detail state
  createEffect(() => {
    if (!isNarrow()) {
      setShowingDetailOnNarrow(false);
    }
  });

  // create accessor wrapper for selectedItem
  const selectedItemAccessor: Accessor<T | null> = selectedItem;

  // context object passed to render props
  const ctx: MasterDetailContext<T> = {
    selectedItem: selectedItemAccessor,
    selectItem,
    isNarrow,
    showingDetail: showingDetailOnNarrow,
    onBack: handleBack,
  };

  // render the right column content
  const rightColumnContent = () => {
    const item = selectedItem();
    if (item === null && props.renderEmpty) {
      return props.renderEmpty();
    }
    return props.renderDetail(ctx);
  };

  return (
    <TwoColumnLayout
      leftColumn={props.renderList(ctx)}
      rightColumn={rightColumnContent()}
      alphabetNav={props.alphabetNav}
      leftColumnWidth={props.leftColumnWidth}
      showDetail={showingDetailOnNarrow()}
      onBack={handleBack}
      class={props.class}
    />
  );
}
