// inline horizontal cluster of graph controls designed to live in the
// topnav's right-side icon row. exposes the same affordances as the
// floating GraphControls panel (zoom in/out/fit, pan/lasso tool toggle,
// wire-tension drag pad, relation-kind picker) but with a flat,
// borderless look that blends with the topnav's other icon buttons.
//
// styling notes:
//   - icon buttons mirror the topnav's white/60 -> white hover idiom.
//   - the wire-tension button is the same press-and-drag pad as in
//     GraphControls; reproduced here rather than imported so we can
//     tune sizing/colors independently for the topnav context.

import { createSignal, onCleanup, onMount, type JSX, Show } from "solid-js";
import { Icon, type IconName } from "../icons/registry";
import { GraphRelationsPicker, type GraphRelationsPickerProps } from "./GraphRelationsPicker";
import { isNarrowViewport } from "../../config/breakpoints";

export type GraphTool = "pan" | "lasso";

export interface GraphTopNavToolsProps {
  tool: GraphTool;
  onToolChange?: (next: GraphTool) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFit?: () => void;

  /** wire tension (0–1) and live setter */
  wireTension?: number;
  onWireTensionChange?: (next: number) => void;

  /** relation picker bindings — passed straight through */
  relations: GraphRelationsPickerProps;

  /** narrow-viewport mode — hides labels, tightens spacing */
  compact?: boolean;

  /** optional trailing slot — rendered after the relations picker on
   *  the right edge of the cluster. used by LibraryGraphSubview to
   *  surface the admin bulk-tag toggle without the canvas/factory
   *  needing to know anything about library-level concerns. */
  extra?: JSX.Element;
}

export function GraphTopNavTools(props: GraphTopNavToolsProps) {
  const toggleTool = () => props.onToolChange?.(props.tool === "pan" ? "lasso" : "pan");

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
    // flex-nowrap + flex-shrink-0 so fit/lasso/tension/relations stay
    // on a single row even when the parent surface (e.g. the topnav
    // secondary row) wraps its other children.
    <div class="flex items-center gap-0.5 flex-nowrap flex-shrink-0">
      {/* zoom in/out intentionally omitted from the topnav cluster:
          pinch + wheel cover zoom already, and the buttons added
          clutter to the narrow mobile layout. fit + reset remain. */}
      <IconBtn
        icon="fit"
        label="fit to view"
        onClick={props.onFit}
        sizeClass={btnSize()}
        iconPx={iconPx()}
      />
      <Divider />
      <IconBtn
        icon={props.tool === "pan" ? "drag" : "lasso"}
        label={props.tool === "pan" ? "pan mode (click for lasso)" : "lasso mode (click for pan)"}
        active={props.tool === "lasso"}
        onClick={toggleTool}
        sizeClass={btnSize()}
        iconPx={iconPx()}
      />
      <Show when={props.onWireTensionChange}>
        <Divider />
        <WireTensionButton
          tension={props.wireTension ?? 0}
          onTension={props.onWireTensionChange!}
          sizeClass={btnSize()}
          iconPx={iconPx()}
        />
      </Show>
      <Divider />
      <GraphRelationsPicker
        {...props.relations}
        compact={props.compact}
        triggerSizeClass={btnSize()}
        triggerIconPx={iconPx()}
      />
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
