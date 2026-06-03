// inline horizontal cluster of graph controls designed to live in the
// topnav's right-side icon row. exposes fit, reset-walk, and
// (conditionally) back. reset-walk also refetches — the caller wires
// the refetch into its onResetWalk handler.
//
// note: the per-kind relation picker (filter + strength chips) used to
// live here. it's been removed — relation kinds are always all
// enabled, and per-kind strength is now controlled by dragging the
// relation hub nodes directly on the canvas.
//
// styling notes:
//   - icon buttons mirror the topnav's white/60 -> white hover idiom.

import { createSignal, onCleanup, onMount, type JSX, Show } from "solid-js";
import { Icon, type IconName } from "../icons/registry";
import { isNarrowViewport } from "../../config/breakpoints";

export interface GraphTopNavToolsProps {
  /** called when the user taps the back arrow (gated: only shown when provided) */
  onBack?: () => void;
  /** called when the user taps the fit button */
  onFit?: () => void;
  /** called when the user taps the reset-walk button */
  onResetWalk?: () => void;

  /** optional trailing slot — rendered after the last control on
   *  the right edge of the cluster. used by LibraryGraphSubview to
   *  surface the admin bulk-tag toggle without the canvas/factory
   *  needing to know anything about library-level concerns. */
  extra?: JSX.Element;
}

export function GraphTopNavTools(props: GraphTopNavToolsProps) {
  // narrow viewports get larger touch-friendly buttons + icons, and
  // all four controls share the same square dimensions for visual
  // consistency (the relations picker matches the other icon buttons
  // when narrow — see GraphRelationsPicker).
  const [narrow, setNarrow] = createSignal(isNarrowViewport());
  onMount(() => {
    const onResize = () => setNarrow(isNarrowViewport());
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });
  const btnSize = () => (narrow() ? "w-9 h-9" : "w-7 h-7");
  const iconPx = () => (narrow() ? 18 : 14);

  return (
    <div class="flex items-center gap-0.5 flex-nowrap flex-shrink-0">
      {/* back arrow — only shown when onBack is provided (breadcrumb depth > 1) */}
      <Show when={props.onBack}>
        <IconBtn
          icon="graphBack"
          label="go back to parent node"
          onClick={props.onBack}
          sizeClass={btnSize()}
          iconPx={iconPx()}
        />
      </Show>

      <IconBtn
        icon="fit"
        label="fit to view"
        onClick={props.onFit}
        sizeClass={btnSize()}
        iconPx={iconPx()}
      />

      <Show when={props.onResetWalk}>
        <IconBtn
          icon="home"
          label="reset graph"
          onClick={props.onResetWalk}
          sizeClass={btnSize()}
          iconPx={iconPx()}
        />
      </Show>

      {/* extra slot */}
      <Show when={props.extra}>{props.extra}</Show>
    </div>
  );
}

function IconBtn(props: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  children?: JSX.Element;
  sizeClass?: string;
  iconPx?: number;
}) {
  return (
    <button
      type="button"
      class={`inline-flex items-center justify-center ${props.sizeClass ?? "w-7 h-7"} rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0`}
      classList={{
        "text-[var(--color-accent-500,#ff1a9e)] bg-[var(--color-accent-500,#ff1a9e)]/15":
          props.active,
        "text-white/65 hover:text-white hover:bg-white/10": !props.active,
      }}
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
    >
      {props.children ?? <Icon name={props.icon} size={props.iconPx ?? 14} />}
    </button>
  );
}
