// inline horizontal cluster of graph controls designed to live in the
// topnav's right-side icon row. exposes fit, reset-walk, refresh, and
// (conditionally) back. the refresh button is dual-action: tap = reset
// view position, long-press = refetch data.
//
// note: the per-kind relation picker (filter + strength chips) used to
// live here. it's been removed — relation kinds are always all
// enabled, and per-kind strength is now controlled by dragging the
// relation hub nodes directly on the canvas.
//
// note: wireTension + lasso toggle props are kept for backward compatibility
// with the legacy graph stack (createGraphLibraryView). the new graph2
// subview (LibraryGraphSubview) does not pass them.
//
// styling notes:
//   - icon buttons mirror the topnav's white/60 -> white hover idiom.
//   - the wire-tension button is the same press-and-drag pad as in
//     GraphControls; reproduced here rather than imported so we can
//     tune sizing/colors independently for the topnav context.

import { createSignal, onCleanup, onMount, type JSX, Show } from "solid-js";
import { Icon, type IconName } from "../icons/registry";
import { isNarrowViewport } from "../../config/breakpoints";

export type GraphTool = "pan" | "lasso";

const LONG_PRESS_MS = 450;

export interface GraphTopNavToolsProps {
  // --- legacy props (kept for createGraphLibraryView backward compat) ---
  tool?: GraphTool;
  onToolChange?: (next: GraphTool) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  /** wire tension (0-1) and live setter (legacy graph stack only) */
  wireTension?: number;
  onWireTensionChange?: (next: number) => void;
  /** narrow-viewport mode — hides labels, tightens spacing */
  compact?: boolean;

  // --- new graph2 actions ---
  /** called when the user taps the back arrow (gated: only shown when provided) */
  onBack?: () => void;
  /** called when the user taps the fit button */
  onFit?: () => void;
  /** called when the user taps the reset-walk button */
  onResetWalk?: () => void;
  /** called when the user short-presses the refresh button (reset view position only) */
  onResetView?: () => void;
  /** called when the user long-presses the refresh button (refetch data) */
  onRefetch?: () => void;
  /** when true, dims the refresh button to indicate an in-flight refetch */
  isRefetching?: () => boolean;

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
          icon="chevronLeft"
          label="go back"
          onClick={props.onBack}
          sizeClass={btnSize()}
          iconPx={iconPx()}
        />
        <Divider />
      </Show>

      <IconBtn
        icon="fit"
        label="fit to view"
        onClick={props.onFit}
        sizeClass={btnSize()}
        iconPx={iconPx()}
      />

      <Show when={props.onResetWalk}>
        <Divider />
        <IconBtn
          icon="home"
          label="reset walk to root"
          onClick={props.onResetWalk}
          sizeClass={btnSize()}
          iconPx={iconPx()}
        />
      </Show>

      <Show when={props.onResetView || props.onRefetch}>
        <Divider />
        <RefreshButton
          onResetView={props.onResetView}
          onRefetch={props.onRefetch}
          isRefetching={props.isRefetching}
          sizeClass={btnSize()}
          iconPx={iconPx()}
        />
      </Show>

      {/* legacy wire-tension pad — only shown when wired up (old graph stack) */}
      <Show when={props.onWireTensionChange}>
        <Divider />
        <WireTensionButton
          tension={props.wireTension ?? 0}
          onTension={props.onWireTensionChange!}
          sizeClass={btnSize()}
          iconPx={iconPx()}
        />
      </Show>

      <Show when={props.extra}>
        <Divider />
        {props.extra}
      </Show>
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

function Divider() {
  return <div class="w-px h-5 bg-white/10 mx-0.5 self-center" />;
}

// dual-action refresh button: tap = reset view position, long-press = refetch data.
function RefreshButton(props: {
  onResetView?: () => void;
  onRefetch?: () => void;
  isRefetching?: () => boolean;
  sizeClass?: string;
  iconPx?: number;
}) {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const cancel = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return (
    <button
      type="button"
      class={`inline-flex items-center justify-center ${props.sizeClass ?? "w-7 h-7"} rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0`}
      classList={{
        "text-white/35 pointer-events-none": props.isRefetching?.() ?? false,
        "text-white/65 hover:text-white hover:bg-white/10": !(props.isRefetching?.() ?? false),
      }}
      title="refresh (hold for refetch)"
      aria-label="refresh"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        fired = false;
        timerId = setTimeout(() => {
          fired = true;
          timerId = null;
          props.onRefetch?.();
        }, LONG_PRESS_MS);
        e.preventDefault();
      }}
      onPointerUp={() => {
        cancel();
        if (!fired) {
          props.onResetView?.();
        }
        fired = false;
      }}
      onPointerCancel={() => {
        cancel();
        fired = false;
      }}
    >
      <svg
        width={props.iconPx ?? 14}
        height={props.iconPx ?? 14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    </button>
  );
}

// press-and-drag pad — duplicated from GraphControls so the topnav copy
// can use a smaller footprint without affecting the floating panel.
function WireTensionButton(props: {
  tension: number;
  onTension: (next: number) => void;
  sizeClass?: string;
  iconPx?: number;
}) {
  const RANGE_PX = 140;
  const [dragging, setDragging] = createSignal(false);
  const [preview, setPreview] = createSignal(props.tension);
  let origin: { x: number; y: number } | null = null;
  let base = 0;

  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const computeNext = (e: PointerEvent) => {
    if (!origin) return base;
    const dx = e.clientX - origin.x;
    const dy = origin.y - e.clientY;
    return clamp(base + (dx + dy) / RANGE_PX);
  };
  const curvePath = (t: number) => {
    const amp = t * 5;
    return `M3 12 C 7 ${12 - amp}, 7 ${12 + amp}, 12 ${12 + amp} S 17 ${12 - amp}, 21 ${12 - amp}`;
  };

  const label = () => `wire tension: ${Math.round(props.tension * 100)} (drag to adjust)`;

  return (
    <button
      type="button"
      class={`inline-flex items-center justify-center ${props.sizeClass ?? "w-7 h-7"} rounded transition-colors border-none bg-transparent text-white/65 hover:text-white hover:bg-white/10 select-none touch-none cursor-pointer flex-shrink-0`}
      classList={{
        "bg-[var(--color-accent-500,#ff1a9e)]/20 text-white ring-1 ring-[var(--color-accent-500,#ff1a9e)]/60":
          dragging(),
      }}
      title={label()}
      aria-label={label()}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        origin = { x: e.clientX, y: e.clientY };
        base = props.tension;
        setPreview(props.tension);
        setDragging(true);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!dragging()) return;
        const next = computeNext(e);
        setPreview(next);
        props.onTension(next);
      }}
      onPointerUp={(e) => {
        if (!dragging()) return;
        const next = computeNext(e);
        props.onTension(next);
        origin = null;
        setDragging(false);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // capture may already be released
        }
      }}
      onPointerCancel={() => {
        origin = null;
        setDragging(false);
      }}
    >
      <Show
        when={dragging()}
        fallback={
          <svg
            width={props.iconPx ?? 16}
            height={props.iconPx ?? 16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d={curvePath(props.tension)} />
          </svg>
        }
      >
        <span class="text-[10px] font-mono tabular-nums leading-none">
          {Math.round(preview() * 100)}
        </span>
      </Show>
    </button>
  );
}
