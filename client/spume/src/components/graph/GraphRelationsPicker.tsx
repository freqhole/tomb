// relation-kind picker styled to match the topnav's tag-filter dropdown.
//
// renders an inline trigger button ("relations") that opens a popover
// listing every relation kind (color swatch + label + count + toggle).
// clicking a row flips the kind on/off; long-pressing a row "solos" it
// (parent collapses the active set to just that one). a row of compact
// badges next to the trigger reflects the currently-enabled kinds and
// supports per-kind quick remove + click-to-solo.
//
// designed for topnav embedding so it uses flat/translucent surfaces
// rather than the bordered panel look of GraphControls.

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ChevronDownStrokeIcon, Icon } from "../icons/registry";
// note: "filter" is used as the trigger glyph (closest available match
// for "relation kinds"); the registry has no dedicated graph/branch icon.
import { RELATION_KINDS, type RelationKindMeta } from "./relations";
import { isNarrowViewport } from "../../config/breakpoints";

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 6;

export interface GraphRelationsPickerProps {
  /** currently enabled relation kinds */
  enabled: Set<string> | string[];
  /** optional per-kind edge counts shown in the dropdown */
  counts?: Record<string, number>;
  /** extra user-defined taxon kinds appended to the built-in list */
  extraKinds?: RelationKindMeta[];
  /** flip a kind on or off */
  onToggle?: (kind: string, next: boolean) => void;
  /** solo gesture — collapse the active set to just this kind */
  onSolo?: (kind: string) => void;
  /** enable every known kind */
  onSelectAll?: () => void;
  /** disable every kind */
  onDeselectAll?: () => void;
  /** compact mode (smaller paddings, used on narrow viewports) */
  compact?: boolean;
  /** suppress the inline active-kind chips next to the trigger. used
      when the parent surface (e.g. topnav second row) already renders
      its own chip list and we don't want the picker to duplicate it. */
  hideActiveChips?: boolean;
  /** override the trigger button's size class. when set, the trigger
      renders as a borderless square icon button matching sibling
      icon buttons (used by GraphTopNavTools so all four controls in
      the cluster share the same dimensions). */
  triggerSizeClass?: string;
  /** override the trigger icon size in px. defaults to 12. */
  triggerIconPx?: number;
}

export function GraphRelationsPicker(props: GraphRelationsPickerProps) {
  const [open, setOpen] = createSignal(false);
  // narrow viewports get an icon-only trigger (no "relations" label,
  // no chevron) to free horizontal space in the mobile topnav.
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  // on narrow the menu is positioned via JS against the viewport so
  // it can't clip past the screen edge (the absolute `right-0`
  // strategy used on wide assumes the trigger is near the right side
  // of its container, which isn't true when the picker sits inside
  // the topnav's wrapping secondary row).
  const [menuRect, setMenuRect] = createSignal<{ top: number; left: number; right: number } | null>(
    null
  );
  let menuRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  const updateMenuRect = () => {
    if (!triggerRef || !isNarrow()) {
      setMenuRect(null);
      return;
    }
    const r = triggerRef.getBoundingClientRect();
    setMenuRect({
      top: Math.round(r.bottom + 4),
      // 8px inset from each viewport edge keeps the sheet onscreen
      // regardless of where the trigger sits in the row.
      left: 8,
      right: 8,
    });
  };

  const allKinds = (): RelationKindMeta[] => [...RELATION_KINDS, ...(props.extraKinds ?? [])];
  const visibleKinds = (): RelationKindMeta[] => {
    // when counts are provided, hide kinds that currently have zero edges.
    if (!props.counts) return allKinds();
    return allKinds().filter((m) => (props.counts?.[m.kind] ?? 0) > 0);
  };
  const isEnabled = (k: string) => {
    const e = props.enabled;
    return Array.isArray(e) ? e.includes(k) : e.has(k);
  };
  const enabledKinds = () => visibleKinds().filter((m) => isEnabled(m.kind));

  // close on outside click
  const onDocClick = (e: MouseEvent) => {
    if (!open()) return;
    const t = e.target as Node;
    if (menuRef?.contains(t) || triggerRef?.contains(t)) return;
    setOpen(false);
  };
  onMount(() => {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
    const onResize = () => {
      setIsNarrow(isNarrowViewport());
      if (open()) updateMenuRect();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    });
  });

  return (
    <div class="relative">
      <div class="flex items-center gap-1.5 flex-wrap">
        <Show
          when={props.triggerSizeClass && isNarrow()}
          fallback={
            <button
              ref={triggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((v) => {
                  const next = !v;
                  if (next) queueMicrotask(updateMenuRect);
                  return next;
                });
              }}
              class="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/15 hover:border-[var(--color-accent-500,#ff1a9e)]/60 text-white/80 hover:text-white transition-colors"
              classList={{
                "text-xs": props.compact,
                "text-sm": !props.compact,
              }}
              title="relation kinds"
              aria-label="relation kinds"
              aria-expanded={open()}
            >
              <Icon name="filter" size={props.triggerIconPx ?? 12} />
              <Show when={!isNarrow()}>
                <span>relations</span>
                <span class={`transition-transform ${open() ? "rotate-180" : ""}`}>
                  <ChevronDownStrokeIcon size={12} />
                </span>
              </Show>
            </button>
          }
        >
          {/* narrow: borderless square icon button so the trigger
              matches sibling IconBtn dimensions in GraphTopNavTools. */}
          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => {
                const next = !v;
                if (next) queueMicrotask(updateMenuRect);
                return next;
              });
            }}
            class={`inline-flex items-center justify-center ${props.triggerSizeClass} rounded transition-colors border-none bg-transparent text-white/65 hover:text-white hover:bg-white/10 cursor-pointer flex-shrink-0`}
            title="relation kinds"
            aria-label="relation kinds"
            aria-expanded={open()}
          >
            <Icon name="filter" size={props.triggerIconPx ?? 18} />
          </button>
        </Show>

        {/* active-kind chips: click toggles off, long-press solos.
            suppressed when the parent renders its own chip row. */}
        <Show when={!props.hideActiveChips}>
          <For each={enabledKinds()}>
            {(meta) => <ActiveKindChip meta={meta} compact={props.compact} {...props} />}
          </For>
        </Show>
      </div>

      <Show when={open()}>
        <div
          ref={menuRef}
          class={
            isNarrow()
              ? "fixed z-50 max-h-[60vh] overflow-y-auto rounded-md border border-white/15 bg-[var(--color-bg-elevated,#1a1a1a)] shadow-lg p-1"
              : "absolute right-0 top-full mt-1 z-50 min-w-[220px] max-h-[60vh] overflow-y-auto rounded-md border border-white/15 bg-[var(--color-bg-elevated,#1a1a1a)] shadow-lg p-1"
          }
          style={
            isNarrow() && menuRect()
              ? {
                  top: `${menuRect()!.top}px`,
                  left: `${menuRect()!.left}px`,
                  right: `${menuRect()!.right}px`,
                }
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center justify-between px-2 py-1">
            <span class="text-[10px] uppercase tracking-wide text-white/60">relations</span>
            <div class="inline-flex gap-1">
              <button
                type="button"
                class="px-1.5 py-0.5 text-[10px] rounded text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => props.onSelectAll?.()}
              >
                all
              </button>
              <button
                type="button"
                class="px-1.5 py-0.5 text-[10px] rounded text-white/80 hover:text-white hover:bg-white/10"
                onClick={() => props.onDeselectAll?.()}
              >
                none
              </button>
            </div>
          </div>
          <For each={visibleKinds()}>
            {(meta) => <RelationRow meta={meta} {...props} on={isEnabled(meta.kind)} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

// single row in the dropdown — toggle on click, solo on long-press.
function RelationRow(props: {
  meta: RelationKindMeta;
  on: boolean;
  counts?: Record<string, number>;
  onToggle?: (kind: string, next: boolean) => void;
  onSolo?: (kind: string) => void;
}) {
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
  const count = () => props.counts?.[props.meta.kind];

  return (
    <button
      type="button"
      class="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs select-none touch-none transition-colors"
      classList={{
        "text-white hover:bg-white/10": props.on,
        "text-white/55 hover:text-white/90 hover:bg-white/5": !props.on,
      }}
      onPointerDown={(e) => {
        pressFired = false;
        pressStart = { x: e.clientX, y: e.clientY };
        if (pressTimer !== null) window.clearTimeout(pressTimer);
        pressTimer = window.setTimeout(() => {
          pressFired = true;
          pressTimer = null;
          props.onSolo?.(props.meta.kind);
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
        if (pressFired) e.preventDefault();
      }}
      onClick={(e) => {
        if (pressFired) {
          pressFired = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        props.onToggle?.(props.meta.kind, !props.on);
      }}
      title={props.meta.description ? `${props.meta.description} (hold to solo)` : "hold to solo"}
      aria-pressed={props.on}
    >
      <span
        class="inline-block w-3 h-3 rounded-sm flex-shrink-0"
        style={{
          "background-color": props.on ? props.meta.color : "transparent",
          border: `1.5px solid ${props.meta.color}`,
        }}
      />
      <span class="flex-1 truncate">{props.meta.label}</span>
      <Show when={count() !== undefined}>
        <span class="text-[10px] text-white/55 tabular-nums">{count()}</span>
      </Show>
    </button>
  );
}

// inline chip shown next to the trigger for each active kind. tap removes;
// long-press solos. mirrors the gesture vocab used in the dropdown rows.
function ActiveKindChip(props: {
  meta: RelationKindMeta;
  compact?: boolean;
  onToggle?: (kind: string, next: boolean) => void;
  onSolo?: (kind: string) => void;
}) {
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
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded border bg-white/5 hover:bg-white/10 transition-colors select-none touch-none"
      classList={{
        "px-1.5 py-0.5 text-[10px]": !!props.compact,
        "px-2 py-0.5 text-[11px]": !props.compact,
      }}
      style={{
        "border-color": props.meta.color,
        color: "white",
      }}
      onPointerDown={(e) => {
        pressFired = false;
        pressStart = { x: e.clientX, y: e.clientY };
        if (pressTimer !== null) window.clearTimeout(pressTimer);
        pressTimer = window.setTimeout(() => {
          pressFired = true;
          pressTimer = null;
          props.onSolo?.(props.meta.kind);
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
        if (pressFired) e.preventDefault();
      }}
      onClick={(e) => {
        if (pressFired) {
          pressFired = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        props.onToggle?.(props.meta.kind, false);
      }}
      title={`${props.meta.label} (click to remove, hold to solo)`}
    >
      <span
        class="inline-block w-2 h-2 rounded-sm flex-shrink-0"
        style={{ "background-color": props.meta.color }}
      />
      <span>{props.meta.label}</span>
    </button>
  );
}
