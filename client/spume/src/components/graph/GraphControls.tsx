// graph viewport controls — zoom in / out / fit / reset, a single
// pan/lasso mode toggle, and an optional collapsible relations panel.
// all callbacks are optional so the parent decides what to wire up.

import { Show, createSignal, type JSX } from "solid-js";
import { Icon, type IconName } from "../icons/registry";

export type GraphTool = "pan" | "lasso";

export interface GraphControlsProps {
  tool: GraphTool;
  onToolChange?: (next: GraphTool) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFit?: () => void;
  /** show on a narrow column / mobile layout */
  compact?: boolean;

  // optional relations sub-panel (rendered below the button row)
  /** slot for the relation legend / toggles */
  relationsContent?: JSX.Element;
  /** is the relations panel currently expanded? */
  relationsOpen?: boolean;
  /** toggle expand/collapse */
  onToggleRelations?: () => void;
  /** select-all relation kinds */
  onSelectAllRelations?: () => void;
  /** deselect-all relation kinds */
  onDeselectAllRelations?: () => void;

  /** wire tension (0–1). 0 = perfectly straight, 1 = max sag. */
  wireTension?: number;
  /** called continuously while dragging the tension control + on release. */
  onWireTensionChange?: (next: number) => void;
}

export function GraphControls(props: GraphControlsProps) {
  const toggleTool = () => props.onToolChange?.(props.tool === "pan" ? "lasso" : "pan");
  const hasRelations = () => props.relationsContent !== undefined;

  return (
    <div class="inline-flex flex-col gap-1 p-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border)] shadow-sm">
      <div class="inline-flex gap-1" classList={{ "flex-col": props.compact }}>
        <ToolButton icon="zoomIn" label="zoom in" onClick={props.onZoomIn} />
        <ToolButton icon="zoomOut" label="zoom out" onClick={props.onZoomOut} />
        <ToolButton icon="album" label="fit to view" onClick={props.onFit} />
        <Divider compact={props.compact} />
        <ToolButton
          icon={props.tool === "pan" ? "drag" : "check"}
          label={
            props.tool === "pan"
              ? "pan mode (click to switch to lasso)"
              : "lasso mode (click to switch to pan)"
          }
          active
          onClick={toggleTool}
        />
        <Show when={hasRelations()}>
          <Divider compact={props.compact} />
          <ToolButton
            icon={props.relationsOpen ? "eye" : "eyeOff"}
            label={props.relationsOpen ? "hide relations" : "show relations"}
            active={props.relationsOpen}
            onClick={props.onToggleRelations}
          />
        </Show>
        <Show when={props.onWireTensionChange}>
          <Divider compact={props.compact} />
          <WireTensionButton
            tension={props.wireTension ?? 0}
            onTension={props.onWireTensionChange!}
          />
        </Show>
      </div>

      <Show when={hasRelations() && props.relationsOpen}>
        <div class="flex flex-col gap-1 pt-1 border-t border-[var(--color-border)]">
          <div class="flex items-center justify-between px-1">
            <span class="text-xs uppercase tracking-wide text-white/80">relations</span>
            <div class="inline-flex gap-1">
              <ToolButton
                icon="check"
                label="select all"
                onClick={props.onSelectAllRelations}
                size="sm"
              />
              <ToolButton
                icon="close"
                label="deselect all"
                onClick={props.onDeselectAllRelations}
                size="sm"
              />
            </div>
          </div>
          <div class="px-1 pb-1">{props.relationsContent}</div>
        </div>
      </Show>
    </div>
  );
}

function ToolButton(props: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  size?: "sm" | "md";
}) {
  const small = () => props.size === "sm";
  return (
    <button
      type="button"
      class="inline-flex items-center justify-center rounded transition-colors"
      classList={{
        "w-8 h-8": !small(),
        "w-6 h-6": small(),
        "bg-[var(--color-accent-500,#ff1a9e)] text-white": props.active,
        "text-[var(--color-text)] hover:bg-[var(--color-bg)]": !props.active,
      }}
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
    >
      <Icon name={props.icon} size={small() ? 14 : 16} />
    </button>
  );
}

function Divider(props: { compact?: boolean }) {
  return (
    <div
      class="bg-[var(--color-border)] flex-shrink-0"
      classList={{
        "w-px h-6 self-center mx-0.5": !props.compact,
        "h-px w-6 self-center my-0.5": props.compact,
      }}
    />
  );
}

// wire tension control: a press-and-drag pad. while the pointer is
// down the button captures motion on both axes — dragging up/right
// raises tension, down/left lowers it. the icon is replaced with the
// live tension value (0–100) for the duration of the drag and clears
// on release. clicking without moving is a no-op so a quick tap won't
// nudge the value.
function WireTensionButton(props: { tension: number; onTension: (next: number) => void }) {
  // px of combined (dx + -dy) travel that spans the full 0–1 range.
  const RANGE_PX = 140;
  const [dragging, setDragging] = createSignal(false);
  const [preview, setPreview] = createSignal(props.tension);
  let origin: { x: number; y: number } | null = null;
  let base = 0;

  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const computeNext = (e: PointerEvent) => {
    if (!origin) return base;
    const dx = e.clientX - origin.x;
    const dy = origin.y - e.clientY; // invert so up is positive
    return clamp(base + (dx + dy) / RANGE_PX);
  };

  // build a sinewave path whose sag scales with the current tension.
  // at t=0 it collapses to a flat midline.
  const curvePath = (t: number) => {
    const amp = t * 5;
    return `M3 12 C 7 ${12 - amp}, 7 ${12 + amp}, 12 ${12 + amp} S 17 ${12 - amp}, 21 ${12 - amp}`;
  };

  const label = () => `wire tension: ${Math.round(props.tension * 100)} (drag to adjust)`;

  return (
    <button
      type="button"
      class="inline-flex items-center justify-center rounded transition-colors w-8 h-8 text-[var(--color-text)] hover:bg-[var(--color-bg)] select-none touch-none"
      classList={{
        "bg-[var(--color-accent-500,#ff1a9e)]/20 ring-1 ring-[var(--color-accent-500,#ff1a9e)]/60":
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
          // ignore — capture may already be released
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
            width="18"
            height="18"
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
        <span class="text-[11px] font-mono tabular-nums leading-none">
          {Math.round(preview() * 100)}
        </span>
      </Show>
    </button>
  );
}
