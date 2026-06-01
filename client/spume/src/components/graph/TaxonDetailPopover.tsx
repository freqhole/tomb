// floating detail card for a taxon (value or group) node. shown when
// the user selects a value or group node in the graph.
// pure presentational; parent positions it via a wrapper container.

import { For, Show } from "solid-js";
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
  /** when provided, positions the popover absolutely at these css coords. */
  x?: number;
  y?: number;
}

export function TaxonDetailPopover(props: TaxonDetailPopoverProps) {
  const positioned = () => props.x !== undefined && props.y !== undefined;
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

          {/* edit button — admin only, phase 4 will add full edit mode */}
          <Show when={props.canEdit()}>
            <button
              type="button"
              class="mt-1 w-full py-1.5 px-3 rounded text-xs font-medium border border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/25 text-white/80 hover:text-white transition-colors cursor-pointer text-left"
              onClick={(e) => {
                e.stopPropagation();
                props.onEditHierarchy();
              }}
            >
              edit hierarchy
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
