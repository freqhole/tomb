// bulk-action panel shown when the canvas multi-selection contains 2+
// nodes in edit mode. compact toolbar w/ flyout menus + autocomplete
// for long lists, so it doesn't dwarf the rest of the ui.

import { For, Show, createSignal, createMemo, onCleanup, onMount } from "solid-js";
import type { Accessor, JSX } from "solid-js";

export type BulkMode = "taxons" | "media" | "mixed";

export interface BulkCandidateParent {
  id: string;
  label: string;
}

export interface BulkAvailableTaxon {
  id: string;
  label: string;
  kindLabel: string;
  kindColor?: string | null;
}

export interface BulkSelectionPopoverProps {
  mode: Accessor<BulkMode>;
  counts: Accessor<{ taxons: number; albums: number; artists: number }>;
  allGroups: Accessor<boolean>;
  kindLabel: Accessor<string | undefined>;
  kindColor: Accessor<string | undefined>;
  candidateParents: Accessor<BulkCandidateParent[]>;
  availableTaxons: Accessor<BulkAvailableTaxon[]>;
  canEdit: Accessor<boolean>;
  onReparentTo: (parentTaxonId: string | null) => void;
  onSetColor: (color: string | null) => void;
  onDeleteTaxons: () => void;
  onAssignTaxon: (taxonId: string) => void;
  onClose: () => void;
  x?: number;
  y?: number;
}

const COLOR_SWATCHES = [
  "#e63946",
  "#f4a261",
  "#e9c46a",
  "#2a9d8f",
  "#264653",
  "#9b5de5",
  "#f15bb5",
  "#00bbf9",
];

type Flyout = null | "reparent" | "color" | "assign";

export function BulkSelectionPopover(props: BulkSelectionPopoverProps) {
  const positioned = () => props.x !== undefined && props.y !== undefined;
  const [flyout, setFlyout] = createSignal<Flyout>(null);
  const [query, setQuery] = createSignal("");

  // close any open flyout on outside click
  let rootEl: HTMLDivElement | undefined;
  const onDocClick = (e: MouseEvent) => {
    if (!rootEl) return;
    if (!rootEl.contains(e.target as Node)) setFlyout(null);
  };
  onMount(() => document.addEventListener("mousedown", onDocClick));
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  const openFlyout = (f: Flyout) => {
    if (flyout() === f) {
      setFlyout(null);
      setQuery("");
      return;
    }
    setQuery("");
    setFlyout(f);
  };

  const filteredParents = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = props.candidateParents();
    if (!q) return list.slice(0, 50);
    return list.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 50);
  });

  const filteredTaxons = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = props.availableTaxons();
    if (!q) return list.slice(0, 50);
    return list
      .filter((t) => t.label.toLowerCase().includes(q) || t.kindLabel.toLowerCase().includes(q))
      .slice(0, 50);
  });

  const summary = () => {
    const c = props.counts();
    const bits: string[] = [];
    if (c.taxons) bits.push(`${c.taxons}t`);
    if (c.albums) bits.push(`${c.albums}a`);
    if (c.artists) bits.push(`${c.artists}r`);
    return bits.join(" / ");
  };
  const summaryLong = () => {
    const c = props.counts();
    const bits: string[] = [];
    if (c.taxons) bits.push(`${c.taxons} taxon${c.taxons === 1 ? "" : "s"}`);
    if (c.albums) bits.push(`${c.albums} album${c.albums === 1 ? "" : "s"}`);
    if (c.artists) bits.push(`${c.artists} artist${c.artists === 1 ? "" : "s"}`);
    return bits.join(" + ");
  };

  const ToolbarBtn = (p: {
    active?: boolean;
    disabled?: boolean;
    title?: string;
    onClick: () => void;
    children: JSX.Element;
  }) => (
    <button
      type="button"
      title={p.title}
      disabled={p.disabled}
      class="px-2 py-1 rounded text-[11px] leading-none border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      classList={{
        "border-pink-500/50 bg-pink-500/15 text-pink-100": !!p.active,
        "border-white/15 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white": !p.active,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!p.disabled) p.onClick();
      }}
    >
      {p.children}
    </button>
  );

  return (
    <div
      ref={rootEl}
      class="relative rounded-lg bg-[var(--color-bg-elevated)] border border-pink-500/40 shadow-xl text-[var(--color-text)] w-auto inline-flex flex-col"
      style={
        positioned()
          ? {
              position: "absolute",
              left: `${props.x}px`,
              top: `${props.y}px`,
              "pointer-events": "auto",
              "z-index": 20,
            }
          : undefined
      }
      onClick={(e) => e.stopPropagation()}
    >
      {/* compact toolbar */}
      <div class="flex items-center gap-1.5 px-2 py-1.5">
        <span
          class="text-[10px] font-semibold text-pink-300 px-1 select-none"
          title={summaryLong()}
        >
          {summary()}
        </span>
        <Show when={props.mode() === "taxons" && props.kindLabel()}>
          <span
            class="text-[9px] px-1 py-px rounded leading-none select-none"
            style={{
              background: props.kindColor() ? `${props.kindColor()}33` : "rgba(255,255,255,0.08)",
              color: props.kindColor() ?? "rgba(255,255,255,0.55)",
            }}
          >
            {props.kindLabel()}
          </span>
        </Show>

        <div class="w-px h-3 bg-white/15 mx-0.5" />

        <Show when={props.mode() === "taxons" && props.canEdit()}>
          <ToolbarBtn
            active={flyout() === "reparent"}
            title="re-parent selected taxons"
            onClick={() => openFlyout("reparent")}
          >
            re-parent
          </ToolbarBtn>
          <ToolbarBtn
            active={flyout() === "color"}
            disabled={!props.allGroups()}
            title={
              props.allGroups()
                ? "set color on selected groups"
                : "color picker available when every selected taxon is a group"
            }
            onClick={() => openFlyout("color")}
          >
            color
          </ToolbarBtn>
          <ToolbarBtn
            title="soft-delete selected taxons"
            onClick={() => {
              const n = props.counts().taxons;
              if (window.confirm(`soft-delete ${n} selected taxon${n === 1 ? "" : "s"}?`)) {
                props.onDeleteTaxons();
              }
            }}
          >
            <span class="text-red-300">delete</span>
          </ToolbarBtn>
        </Show>

        <Show when={props.mode() === "media" && props.canEdit()}>
          <ToolbarBtn
            active={flyout() === "assign"}
            title="assign a taxon to every selected album / artist"
            onClick={() => openFlyout("assign")}
          >
            assign taxon
          </ToolbarBtn>
        </Show>

        <Show when={props.mode() === "mixed"}>
          <span class="text-[10px] text-amber-300/80 italic px-1">
            mixed selection — split to enable actions
          </span>
        </Show>
        <Show when={!props.canEdit()}>
          <span class="text-[10px] text-white/45 italic px-1">admin required</span>
        </Show>

        <div class="flex-1" />
        <button
          type="button"
          aria-label="clear selection"
          title="clear selection"
          class="text-white/50 hover:text-white text-sm leading-none px-1.5 py-0.5 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
        >
          ×
        </button>
      </div>

      {/* flyout panel — anchored below the toolbar */}
      <Show when={flyout() !== null}>
        <div class="border-t border-white/10 p-2 flex flex-col gap-1.5 w-72 max-w-[calc(100vw-2rem)]">
          <Show when={flyout() === "reparent"}>
            <input
              type="text"
              autofocus
              placeholder="filter candidate parents..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class="w-full px-2 py-1 rounded border border-white/15 bg-white/5 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/35"
            />
            <div class="max-h-48 overflow-y-auto flex flex-col gap-0.5">
              <button
                type="button"
                class="text-left px-2 py-1 rounded text-[11px] text-emerald-200 hover:bg-emerald-500/15 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onReparentTo(null);
                  setFlyout(null);
                }}
              >
                ↑ promote to top-level
              </button>
              <Show
                when={filteredParents().length > 0}
                fallback={
                  <div class="px-2 py-1 text-white/35 text-[11px] italic">
                    {props.candidateParents().length === 0
                      ? "no valid parents available"
                      : "no matches"}
                  </div>
                }
              >
                <For each={filteredParents()}>
                  {(p) => (
                    <button
                      type="button"
                      class="text-left px-2 py-1 rounded text-[11px] text-white/85 hover:bg-white/10 cursor-pointer truncate"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onReparentTo(p.id);
                        setFlyout(null);
                      }}
                    >
                      {p.label}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>

          <Show when={flyout() === "color"}>
            <div class="flex flex-wrap items-center gap-1.5 p-1">
              <For each={COLOR_SWATCHES}>
                {(hex) => (
                  <button
                    type="button"
                    title={hex}
                    class="w-6 h-6 rounded-sm border-2 border-transparent hover:border-white/60 transition-colors cursor-pointer p-0 flex-shrink-0"
                    style={{ background: hex }}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onSetColor(hex);
                      setFlyout(null);
                    }}
                  />
                )}
              </For>
              <button
                type="button"
                class="text-[10px] leading-none px-1.5 py-0.5 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 cursor-pointer transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSetColor(null);
                  setFlyout(null);
                }}
              >
                clear
              </button>
            </div>
          </Show>

          <Show when={flyout() === "assign"}>
            <input
              type="text"
              autofocus
              placeholder="search taxons by label or kind..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class="w-full px-2 py-1 rounded border border-white/15 bg-white/5 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/35"
            />
            <div class="max-h-56 overflow-y-auto flex flex-col gap-0.5">
              <Show
                when={filteredTaxons().length > 0}
                fallback={
                  <div class="px-2 py-1 text-white/35 text-[11px] italic">
                    {props.availableTaxons().length === 0
                      ? "no taxons loaded — pivot into a kind hub first"
                      : "no matches"}
                  </div>
                }
              >
                <For each={filteredTaxons()}>
                  {(t) => (
                    <button
                      type="button"
                      class="text-left px-2 py-1 rounded text-[11px] text-white/85 hover:bg-white/10 cursor-pointer flex items-center gap-1.5 min-w-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onAssignTaxon(t.id);
                        setFlyout(null);
                      }}
                    >
                      <span class="truncate flex-1">{t.label}</span>
                      <span
                        class="text-[9px] px-1 py-px rounded leading-none flex-shrink-0"
                        style={{
                          background: t.kindColor ? `${t.kindColor}33` : "rgba(255,255,255,0.08)",
                          color: t.kindColor ?? "rgba(255,255,255,0.55)",
                        }}
                      >
                        {t.kindLabel}
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
