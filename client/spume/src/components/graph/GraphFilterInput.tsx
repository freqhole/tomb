// shared filter input + scope toggle used by the taxon and remote
// detail popovers. emits a free-text query plus an optional
// (taxons / entities) scope override the host can wire to a smart
// inference signal. callers control which sub-controls are available
// by passing the corresponding accessors / handlers.

import { Show } from "solid-js";
import type { Accessor } from "solid-js";

export type FilterScope = "taxons" | "entities";

export interface GraphFilterInputProps {
  /** current free-text query. */
  query: Accessor<string>;
  onQueryChange: (q: string) => void;
  /** placeholder override; defaults to a scope-aware placeholder. */
  placeholder?: Accessor<string>;
  /** when set, render the values-only checkbox (only meaningful for
   *  taxon scope; the host hides it for entity scope). */
  valuesOnly?: Accessor<boolean>;
  onValuesOnlyChange?: (valuesOnly: boolean) => void;
  /** when set, render the scope override pills (taxons / entities). */
  scope?: Accessor<FilterScope>;
  inferredScope?: Accessor<FilterScope>;
  onScopeChange?: (scope: FilterScope | null) => void;
  /** when query is non-empty + handler provided, render a
   *  "select N matches" button that selects all matching nodes. */
  matchCount?: Accessor<number>;
  onSelectMatches?: () => void;
  /** when true, hide the scope override + values-only sub-controls
   *  even if their handlers are set. used by callers that only ever
   *  want entity-scope matching (value/group/remote selections). */
  scopeFixedToEntities?: boolean;
}

export function GraphFilterInput(props: GraphFilterInputProps) {
  const scope = () => props.scope?.() ?? "taxons";
  const inferred = () => props.inferredScope?.() ?? scope();
  const defaultPlaceholder = () =>
    scope() === "entities" ? "filter artists + albums…" : "filter taxons…";
  const placeholder = () => props.placeholder?.() ?? defaultPlaceholder();
  return (
    <div class="mt-1 flex flex-col gap-1">
      <div class="flex items-center gap-1">
        <input
          type="text"
          placeholder={placeholder()}
          value={props.query()}
          onInput={(e) => props.onQueryChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              props.onQueryChange("");
            }
          }}
          onClick={(e) => e.stopPropagation()}
          class="flex-1 py-1 px-2 rounded text-xs bg-black/30 border border-white/15 focus:border-pink-400 outline-none text-white/85 placeholder:text-white/30"
        />
        <Show when={props.query().length > 0}>
          <button
            type="button"
            class="py-1 px-2 rounded text-[10px] font-medium border border-white/15 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              props.onQueryChange("");
            }}
          >
            clear
          </button>
        </Show>
      </div>
      <Show when={!props.scopeFixedToEntities && props.onScopeChange}>
        <div
          class="flex items-center gap-1 text-[10px] text-white/55"
          onClick={(e) => e.stopPropagation()}
        >
          <span class="shrink-0">scope</span>
          <div class="inline-flex rounded border border-white/15 overflow-hidden">
            <button
              type="button"
              class={`px-2 py-0.5 text-[10px] transition-colors cursor-pointer ${
                scope() === "taxons"
                  ? "bg-pink-500/20 text-pink-100"
                  : "bg-white/5 hover:bg-white/10 text-white/60"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                props.onScopeChange?.("taxons");
              }}
            >
              taxons
            </button>
            <button
              type="button"
              class={`px-2 py-0.5 text-[10px] border-l border-white/15 transition-colors cursor-pointer ${
                scope() === "entities"
                  ? "bg-pink-500/20 text-pink-100"
                  : "bg-white/5 hover:bg-white/10 text-white/60"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                props.onScopeChange?.("entities");
              }}
            >
              artists + albums
            </button>
          </div>
          <Show when={props.inferredScope && inferred() !== scope()}>
            <button
              type="button"
              class="px-1.5 py-0.5 rounded text-[10px] text-white/40 hover:text-white/75 border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
              title={`revert to inferred scope (${inferred()})`}
              onClick={(e) => {
                e.stopPropagation();
                props.onScopeChange?.(null);
              }}
            >
              auto
            </button>
          </Show>
        </div>
      </Show>
      <Show when={!props.scopeFixedToEntities && scope() === "taxons" && props.onValuesOnlyChange}>
        <label
          class="flex items-center gap-1.5 text-[10px] text-white/55 select-none cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={props.valuesOnly?.() ?? true}
            onChange={(e) => props.onValuesOnlyChange?.(e.currentTarget.checked)}
            class="accent-pink-500 cursor-pointer"
          />
          <span>values only (keep groups visible)</span>
        </label>
      </Show>
      <Show when={props.query().length > 0 && props.onSelectMatches}>
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
  );
}
