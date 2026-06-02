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

export interface BulkCurrentTaxon {
  id: string;
  label: string;
  kindSlug: string;
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
  currentTaxons?: Accessor<BulkCurrentTaxon[]>;
  canEdit: Accessor<boolean>;
  onReparentTo: (parentTaxonId: string | null) => void;
  onSetColor: (color: string | null) => void;
  onDeleteTaxons: () => void;
  onAssignTaxon: (taxonId: string) => void;
  onRemoveTaxon?: (taxonId: string) => void;
  onGroupSelected?: (label: string) => void;
  onClose: () => void;
  x?: number;
  y?: number;
}

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
      class="relative rounded-lg bg-[var(--color-bg-elevated)] border border-pink-500/40 shadow-xl text-[var(--color-text)] w-auto inline-flex flex-col max-h-[calc(100dvh-var(--nav-height,56px)-var(--player-bar-height,0px)-3.5rem)] overflow-y-auto"
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
      <div class="flex items-center gap-1.5 px-2 py-1.5 flex-shrink-0">
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
            title="nest selected taxons under an existing or new parent"
            onClick={() => openFlyout("reparent")}
          >
            nest
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

      {/* current-taxons intersection chips — media mode only. shows every
          taxon currently applied to all selected albums/artists; each chip
          carries an inline × to remove the link from every selection. */}
      <Show
        when={
          props.mode() === "media" &&
          props.canEdit() &&
          props.currentTaxons &&
          (props.currentTaxons!()?.length ?? 0) > 0
        }
      >
        <div class="border-t border-white/10 px-2 py-1.5 flex flex-wrap gap-1 max-w-[28rem] flex-shrink-0">
          <span class="text-[9px] uppercase tracking-wider text-white/35 self-center mr-1">
            applied to all:
          </span>
          <For each={props.currentTaxons!()}>
            {(t) => (
              <span
                class="inline-flex items-center gap-1 text-[10px] leading-none rounded pl-1.5 pr-0.5 py-0.5"
                style={{
                  background: t.kindColor ? `${t.kindColor}26` : "rgba(255,255,255,0.06)",
                  color: t.kindColor ?? "rgba(255,255,255,0.7)",
                  border: `1px solid ${t.kindColor ? `${t.kindColor}66` : "rgba(255,255,255,0.15)"}`,
                }}
                title={`${t.kindLabel}: ${t.label}`}
              >
                <span class="font-medium">{t.label}</span>
                <span class="opacity-60">·</span>
                <span class="opacity-60">{t.kindLabel}</span>
                <Show when={props.onRemoveTaxon}>
                  <button
                    type="button"
                    aria-label={`remove taxon ${t.label}`}
                    title={`remove '${t.label}' from every selected album`}
                    class="ml-0.5 px-1 py-0.5 rounded text-[10px] leading-none hover:bg-red-500/20 hover:text-red-200 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onRemoveTaxon!(t.id);
                    }}
                  >
                    ×
                  </button>
                </Show>
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* flyout panel — anchored below the toolbar */}
      <Show when={flyout() !== null}>
        <div class="border-t border-white/10 p-2 flex flex-col gap-1.5 w-72 max-w-[calc(100vw-2rem)] flex-shrink-0">
          <Show when={flyout() === "reparent"}>
            <input
              type="text"
              autofocus
              placeholder="filter or type a new name..."
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const q = query().trim();
                if (!q) return;
                const exact = filteredParents().find(
                  (p) => p.label.toLowerCase() === q.toLowerCase()
                );
                if (exact) {
                  e.preventDefault();
                  props.onReparentTo(exact.id);
                  setFlyout(null);
                  return;
                }
                if (props.onGroupSelected) {
                  e.preventDefault();
                  props.onGroupSelected(q);
                  setFlyout(null);
                }
              }}
              class="w-full px-2 py-1 rounded border border-white/15 bg-white/5 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/35"
            />
            <div class="flex flex-col gap-0.5">
              <Show when={query().trim().length > 0 && props.onGroupSelected}>
                {(() => {
                  const q = () => query().trim();
                  const exact = () =>
                    filteredParents().some((p) => p.label.toLowerCase() === q().toLowerCase());
                  return (
                    <Show when={!exact()}>
                      <div
                        role="button"
                        tabindex="0"
                        class="text-left px-2 py-1 rounded text-[11px] text-pink-200 hover:bg-pink-500/15 cursor-pointer select-none"
                        title="create a new group taxon with this name and re-parent the selection under it"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onGroupSelected?.(q());
                          setFlyout(null);
                        }}
                      >
                        + create new “{q()}” and nest under it
                      </div>
                    </Show>
                  );
                })()}
              </Show>
              <div
                role="button"
                tabindex="0"
                class="text-left px-2 py-1 rounded text-[11px] text-emerald-200 hover:bg-emerald-500/15 cursor-pointer select-none"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onReparentTo(null);
                  setFlyout(null);
                }}
              >
                ↑ promote to top-level
              </div>
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
                    <div
                      role="button"
                      tabindex="0"
                      class="text-left px-2 py-1 rounded text-[11px] text-white/85 hover:bg-white/10 cursor-pointer truncate select-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onReparentTo(p.id);
                        setFlyout(null);
                      }}
                    >
                      {p.label}
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>

          <Show when={flyout() === "color"}>
            <div class="flex items-center gap-2 p-2">
              <label class="text-[10px] uppercase tracking-wide text-white/40">color</label>
              <input
                type="color"
                value={props.kindColor() ?? "#888888"}
                class="w-7 h-7 rounded-sm border border-white/15 bg-transparent cursor-pointer p-0"
                onClick={(e) => e.stopPropagation()}
                onInput={(e) => {
                  props.onSetColor((e.currentTarget as HTMLInputElement).value);
                }}
              />
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
            <div class="flex flex-col gap-0.5">
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
                    <div
                      role="button"
                      tabindex="0"
                      class="text-left px-2 py-1 rounded text-[11px] text-white/85 hover:bg-white/10 cursor-pointer flex items-center gap-1.5 min-w-0 select-none"
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
                    </div>
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
