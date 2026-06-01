// floating detail card for a taxon (value or group) node. shown when
// the user selects a value or group node in the graph.
// pure presentational; parent positions it via a wrapper container.

import { createSignal, For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import type { Taxon, TaxonRef } from "freqhole-api-client";

const MAX_DESCENDANTS = 8;

export interface TaxonDetailPopoverProps {
  taxon: Accessor<Taxon | null>;
  kindLabel: Accessor<string | undefined>;
  kindColor: Accessor<string | undefined>;
  albumCount: Accessor<number | undefined>;
  /** ancestor path, root first, immediate parent last. shown as a breadcrumb. */
  parents: Accessor<TaxonRef[]>;
  /** all descendants (not just direct children). capped in display at MAX_DESCENDANTS. */
  descendants: Accessor<TaxonRef[]>;
  canEdit: Accessor<boolean>;
  onEditHierarchy: () => void;
  onClose: () => void;
  /** whether this taxon has descendants (making it a group). shows color picker when true. */
  isGroup: Accessor<boolean>;
  /** reflects current edit-mode state; used to toggle the button label. */
  editMode: Accessor<boolean>;
  /** called when the user picks a color swatch or clears the color. */
  onSetColor: (color: string | null) => void;
  /** called when the user picks/clears the color in hub (kind) mode.
   *  writes to the parent taxon kind so the entire hexagon re-skins. */
  onSetKindColor?: (color: string | null) => void;
  /** create a new taxon (prompts for label). only invoked in edit mode. */
  onCreateTaxon?: (label: string) => void;
  /** soft-delete the current taxon. only invoked when a taxon is selected. */
  onDeleteTaxon?: () => void;
  /** current filter query for this hub's children (only meaningful in
   *  hub mode). when non-empty, the host hides non-matching taxon nodes
   *  on the canvas so the user can corral matches for re-parenting. */
  filterQuery?: Accessor<string>;
  /** called whenever the user types in the filter input. */
  onFilterChange?: (query: string) => void;
  /** select all currently-matching taxon nodes into the multi-selection.
   *  shown next to the filter input when a query is active. */
  onSelectMatches?: () => void;
  /** number of taxon nodes that currently match the filter query, used
   *  to label the "select matches" button. */
  matchCount?: Accessor<number>;
  /** when true, the filter only affects leaf value taxons (octagons)
   *  and leaves group taxons (7-sided) visible so the user can see the
   *  intermediate parent nodes while corralling matches. */
  filterValuesOnly?: Accessor<boolean>;
  /** toggle handler for the values-only filter scope. */
  onFilterValuesOnlyChange?: (valuesOnly: boolean) => void;
  /** when set, shows an "expand all" button that surfaces every
   *  immediate child + each artist child's albums on the canvas. only
   *  meaningful for group (7-sided) hub nodes. */
  onExpandSubtree?: () => void;
  /** true when this group's subtree is currently eagerly expanded.
   *  flips the button label between "expand" and "collapse" so the
   *  toggle gesture is discoverable. */
  isExpanded?: Accessor<boolean>;
  /** when provided, positions the popover absolutely at these css coords. */
  x?: number;
  y?: number;
}

export function TaxonDetailPopover(props: TaxonDetailPopoverProps) {
  const positioned = () => props.x !== undefined && props.y !== undefined;
  const [creating, setCreating] = createSignal(false);
  const [draftLabel, setDraftLabel] = createSignal("");
  const submitCreate = () => {
    const label = draftLabel().trim();
    if (!label) return;
    props.onCreateTaxon?.(label);
    setDraftLabel("");
    setCreating(false);
  };
  const cancelCreate = () => {
    setDraftLabel("");
    setCreating(false);
  };
  // prefer the taxon's own color (groups only); fall back to the kind color.
  const swatchColor = () => props.taxon()?.color ?? props.kindColor();
  // kind-only mode (relation hub selected): no taxon, just kind metadata.
  const isHubMode = () => props.taxon() === null;
  const title = () => props.taxon()?.label ?? props.kindLabel() ?? "";

  return (
    <Show when={props.taxon() !== null || props.kindLabel()}>
      <div
        class="rounded-lg bg-[var(--color-bg-elevated)] border border-white/10 shadow-xl text-[var(--color-text)] w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-var(--nav-height,56px)-var(--player-bar-height,0px)-3.5rem)] overflow-y-auto flex flex-col"
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
        {/* header: color swatch + title + kind chip */}
        <div class="flex items-start gap-2 p-3 pb-2">
          <Show when={swatchColor()}>
            <div
              class="mt-1 w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: swatchColor() ?? "" }}
            />
          </Show>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm leading-tight truncate">{title()}</div>
            <Show when={!isHubMode() && props.kindLabel()}>
              <div class="mt-1">
                <span
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] leading-none font-medium"
                  style={{
                    background: props.kindColor()
                      ? `${props.kindColor()}33`
                      : "rgba(255,255,255,0.08)",
                    color: props.kindColor() ?? "rgba(255,255,255,0.65)",
                    border: `1px solid ${
                      props.kindColor() ? `${props.kindColor()}55` : "rgba(255,255,255,0.12)"
                    }`,
                  }}
                >
                  {props.kindLabel()}
                </span>
              </div>
            </Show>
          </div>
        </div>

        {/* body */}
        <div class="px-3 pb-3 flex flex-col gap-2 text-xs text-white/65">
          <Show when={props.albumCount() !== undefined}>
            <div>
              {props.albumCount()} album{props.albumCount() !== 1 ? "s" : ""}
            </div>
          </Show>

          {/* parent breadcrumb: root first, immediate parent last */}
          <Show when={props.parents().length > 0}>
            <div class="flex flex-wrap items-center gap-0.5">
              <span class="text-white/40 mr-0.5">via</span>
              <For each={props.parents()}>
                {(parent, i) => (
                  <>
                    {i() > 0 && <span class="text-white/30 mx-0.5">›</span>}
                    <span class="text-white/75">{parent.label}</span>
                  </>
                )}
              </For>
            </div>
          </Show>

          {/* descendants list, capped */}
          <Show when={props.descendants().length > 0}>
            <div>
              <span class="text-white/40">descendants ({props.descendants().length}): </span>
              <For each={props.descendants().slice(0, MAX_DESCENDANTS)}>
                {(d, i) => (
                  <>
                    {i() > 0 && <span class="text-white/30">, </span>}
                    <span class="text-white/75">{d.label}</span>
                  </>
                )}
              </For>
              <Show when={props.descendants().length > MAX_DESCENDANTS}>
                <span class="text-white/40">
                  {" "}
                  ...{props.descendants().length - MAX_DESCENDANTS} more
                </span>
              </Show>
            </div>
          </Show>

          {/* edit button — admin only */}
          <Show when={props.canEdit()}>
            <button
              type="button"
              class="mt-1 w-full py-1.5 px-3 rounded text-xs font-medium border border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/25 text-white/80 hover:text-white transition-colors cursor-pointer text-left"
              onClick={(e) => {
                e.stopPropagation();
                props.onEditHierarchy();
              }}
            >
              {props.editMode() ? "exit edit mode" : "edit"}
            </button>
          </Show>

          {/* color picker — visible to admins for group taxons only */}
          <Show when={props.canEdit() && props.isGroup()}>
            <div class="mt-1 flex items-center gap-1.5">
              <label class="text-[10px] uppercase tracking-wide text-white/40">color</label>
              <input
                type="color"
                value={props.taxon()?.color ?? "#888888"}
                class="w-6 h-6 rounded-sm border border-white/15 bg-transparent cursor-pointer p-0"
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
                }}
              >
                clear
              </button>
            </div>
          </Show>

          {/* kind color picker — visible to admins when a relation hub
              (hexagon) is selected. writes to taxon_kindz.color so the
              entire hub + its leaf children re-skin. */}
          <Show when={props.canEdit() && isHubMode() && props.onSetKindColor}>
            <div class="mt-1 flex items-center gap-1.5">
              <label class="text-[10px] uppercase tracking-wide text-white/40">kind color</label>
              <input
                type="color"
                value={props.kindColor() ?? "#888888"}
                class="w-6 h-6 rounded-sm border border-white/15 bg-transparent cursor-pointer p-0"
                onClick={(e) => e.stopPropagation()}
                onInput={(e) => {
                  props.onSetKindColor?.((e.currentTarget as HTMLInputElement).value);
                }}
              />
              <button
                type="button"
                class="text-[10px] leading-none px-1.5 py-0.5 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 cursor-pointer transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSetKindColor?.(null);
                }}
              >
                clear
              </button>
            </div>
          </Show>

          {/* expand-all button — surfaces this hub's immediate children
              and any artist child's albums on the canvas. mirrors the
              long-press gesture on the node itself. only meaningful
              when the selected node is a group (has descendants). */}
          <Show when={props.isGroup() && props.onExpandSubtree}>
            <button
              type="button"
              class="mt-1 w-full py-1.5 px-2 rounded text-[11px] font-medium border border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 hover:text-sky-100 transition-colors cursor-pointer text-left"
              onClick={(e) => {
                e.stopPropagation();
                props.onExpandSubtree?.();
              }}
            >
              {props.isExpanded?.() ? "collapse children + albums" : "expand all children + albums"}
            </button>
          </Show>

          {/* filter input — hub mode + edit mode only. hides non-matching
              taxon children on the canvas so the user can corral matches
              for grouping / re-parenting. */}
          <Show when={isHubMode() && props.onFilterChange}>
            <div class="mt-1 flex flex-col gap-1">
              <div class="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="filter taxons…"
                  value={props.filterQuery?.() ?? ""}
                  onInput={(e) => props.onFilterChange?.(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      props.onFilterChange?.("");
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  class="flex-1 py-1 px-2 rounded text-xs bg-black/30 border border-white/15 focus:border-pink-400 outline-none text-white/85 placeholder:text-white/30"
                />
                <Show when={(props.filterQuery?.() ?? "").length > 0}>
                  <button
                    type="button"
                    class="py-1 px-2 rounded text-[10px] font-medium border border-white/15 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90 transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onFilterChange?.("");
                    }}
                  >
                    clear
                  </button>
                </Show>
              </div>
              <Show when={props.onFilterValuesOnlyChange}>
                <label
                  class="flex items-center gap-1.5 text-[10px] text-white/55 select-none cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={props.filterValuesOnly?.() ?? true}
                    onChange={(e) => props.onFilterValuesOnlyChange?.(e.currentTarget.checked)}
                    class="accent-pink-500 cursor-pointer"
                  />
                  <span>values only (keep groups visible)</span>
                </label>
              </Show>
              <Show when={(props.filterQuery?.() ?? "").length > 0 && props.onSelectMatches}>
                <button
                  type="button"
                  disabled={(props.matchCount?.() ?? 0) === 0}
                  class="w-full py-1 px-2 rounded text-[11px] font-medium border border-pink-500/30 bg-pink-500/10 hover:bg-pink-500/20 text-pink-200 hover:text-pink-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-left"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onSelectMatches?.();
                  }}
                >
                  select {props.matchCount?.() ?? 0} match
                  {(props.matchCount?.() ?? 0) === 1 ? "" : "es"}
                </button>
              </Show>
            </div>
          </Show>

          {/* edit-mode create / delete buttons (admin only) */}
          <Show when={props.canEdit() && props.editMode() && props.onCreateTaxon}>
            <Show
              when={creating()}
              fallback={
                <button
                  type="button"
                  class="mt-1 w-full py-1.5 px-3 rounded text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 hover:text-emerald-100 transition-colors cursor-pointer text-left"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreating(true);
                  }}
                >
                  + add taxon{!isHubMode() ? " under this one" : ""}
                </button>
              }
            >
              <form
                class="mt-1 flex flex-col gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  submitCreate();
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  autofocus
                  placeholder={isHubMode() ? "new taxon label" : "new child taxon label"}
                  value={draftLabel()}
                  onInput={(e) => setDraftLabel(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelCreate();
                    }
                  }}
                  class="w-full py-1.5 px-2 rounded text-xs bg-black/30 border border-emerald-500/30 focus:border-emerald-400 outline-none text-emerald-100 placeholder:text-emerald-200/40"
                />
                <div class="flex gap-1">
                  <button
                    type="submit"
                    disabled={!draftLabel().trim()}
                    class="flex-1 py-1 px-2 rounded text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 hover:text-emerald-100 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    create
                  </button>
                  <button
                    type="button"
                    class="flex-1 py-1 px-2 rounded text-xs font-medium border border-white/10 hover:bg-white/5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelCreate();
                    }}
                  >
                    cancel
                  </button>
                </div>
              </form>
            </Show>
          </Show>
          <Show when={props.canEdit() && props.editMode() && !isHubMode() && props.onDeleteTaxon}>
            <button
              type="button"
              class="mt-1 w-full py-1.5 px-3 rounded text-xs font-medium border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-200 hover:text-red-100 transition-colors cursor-pointer text-left"
              onClick={(e) => {
                e.stopPropagation();
                const label = props.taxon()?.label ?? "this taxon";
                if (window.confirm(`soft-delete taxon '${label}'?`)) props.onDeleteTaxon?.();
              }}
            >
              soft-delete taxon
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
