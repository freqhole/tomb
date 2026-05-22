// toggleable color-coded list of relation kinds.
// shows a swatch + label + (optional) edge count per kind.
// designed to stack vertically on narrow widths.

import { For, createMemo } from "solid-js";
import { RELATION_KINDS } from "./relations";
import type { RelationKindLike } from "./types";

export interface RelationKindMeta {
  kind: RelationKindLike;
  label: string;
  color: string;
  description?: string;
}

export interface RelationLegendProps {
  /** currently-enabled relation kinds */
  enabled: Set<string> | string[];
  /** optional edge counts per kind */
  counts?: Record<string, number>;
  onToggle?: (kind: string, next: boolean) => void;
  /**
   * long-press handler — fires when the user holds down on a row for
   * ~500ms. typical use: "solo" that relation kind (parent sets enabled
   * to a singleton set).
   */
  onSolo?: (kind: string) => void;
  /** layout direction; defaults to vertical (mobile-friendly) */
  orientation?: "vertical" | "horizontal";
  /** user-defined taxon kinds to append to the built-in list */
  extraKinds?: RelationKindMeta[];
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 6;

export function RelationLegend(props: RelationLegendProps) {
  const isEnabled = (k: string) => {
    const e = props.enabled;
    return Array.isArray(e) ? e.includes(k) : e.has(k);
  };
  const orientation = () => props.orientation ?? "vertical";
  const allKinds = createMemo<RelationKindMeta[]>(() => [
    ...RELATION_KINDS,
    ...(props.extraKinds ?? []),
  ]);

  // per-button long-press state. each pointerdown starts a timer; if it
  // fires before pointerup / movement, we treat it as "solo" and swallow
  // the subsequent click. otherwise the click handler runs as usual.
  let pressTimer: number | null = null;
  let pressStart: { x: number; y: number } | null = null;
  let pressFired = false;
  const clearPress = () => {
    if (pressTimer !== null) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressStart = null;
  };

  return (
    <div
      class="text-white/90"
      classList={{
        "flex flex-col gap-1": orientation() === "vertical",
        "flex flex-row flex-wrap gap-2": orientation() === "horizontal",
      }}
    >
      <For each={allKinds()}>
        {(meta) => {
          const on = () => isEnabled(meta.kind);
          const count = () => props.counts?.[meta.kind];
          return (
            <button
              type="button"
              class="flex items-center gap-2 px-2 py-1 rounded-md border text-left text-xs transition-colors select-none touch-none"
              classList={{
                "bg-[var(--color-bg-elevated)] border-[var(--color-border)] text-white": on(),
                "bg-transparent border-transparent text-white/70 hover:text-white": !on(),
              }}
              onPointerDown={(e) => {
                pressFired = false;
                pressStart = { x: e.clientX, y: e.clientY };
                if (pressTimer !== null) window.clearTimeout(pressTimer);
                pressTimer = window.setTimeout(() => {
                  pressFired = true;
                  pressTimer = null;
                  props.onSolo?.(meta.kind);
                }, LONG_PRESS_MS);
              }}
              onPointerMove={(e) => {
                if (!pressStart) return;
                if (
                  Math.abs(e.clientX - pressStart.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
                  Math.abs(e.clientY - pressStart.y) > LONG_PRESS_MOVE_TOLERANCE_PX
                ) {
                  clearPress();
                }
              }}
              onPointerUp={clearPress}
              onPointerCancel={clearPress}
              onPointerLeave={clearPress}
              onContextMenu={(e) => {
                // suppress native context menu on long-press (mobile safari)
                if (pressFired) e.preventDefault();
              }}
              onClick={(e) => {
                if (pressFired) {
                  // swallow the click that follows a long-press
                  pressFired = false;
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                props.onToggle?.(meta.kind, !on());
              }}
              aria-pressed={on()}
              title={meta.description ? `${meta.description} (hold to solo)` : "hold to solo"}
            >
              <span
                class="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                style={{
                  "background-color": on() ? meta.color : "transparent",
                  border: `1.5px solid ${meta.color}`,
                }}
              />
              <span class="flex-1 truncate">{meta.label}</span>
              {count() !== undefined && (
                <span class="text-[10px] text-white/65 tabular-nums">{count()}</span>
              )}
            </button>
          );
        }}
      </For>
    </div>
  );
}
