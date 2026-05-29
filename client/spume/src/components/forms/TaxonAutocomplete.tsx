// taxon autocomplete - lightweight single-pick combobox.
//
// purpose: replace the kobalte combobox we used for genres/etc. that
// flow forced users to pick a "create new" item from a fly-out menu,
// which was clunky. this component:
//   * uses a plain <input> + absolute-positioned dropdown
//   * async-queries existing taxons (optionally scoped to a kind)
//   * arrow keys navigate, enter picks the highlighted item OR creates
//     a new taxon (when `onCreate` is provided and the typed text has
//     no exact label match)
//   * hides ids the caller already has via `excludeIds`
//
// caller wires actual mutations (add/remove/create) + chip rendering;
// this component only emits `onSelect(taxonRef)` and `onCreate(label)`.
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { getRemoteClient } from "../../music/data";
import type { TaxonRef } from "../../music/data/types";
import { Icon, IconNames } from "../icons/registry";

export interface TaxonAutocompleteProps {
  /** when set, queries are scoped to this taxon kind. also used as the
   *  kind_slug for `onCreate` (the caller still owns the create call). */
  kindSlug?: string;
  /** ids to hide from results — typically the chips already shown. */
  excludeIds?: string[];
  /** invoked when the user picks an existing taxon. */
  onSelect: (taxon: TaxonRef) => void;
  /** invoked when the user hits enter on a label that has no exact
   *  match. when omitted, enter is a no-op and only existing taxons
   *  can be picked. */
  onCreate?: (label: string) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  /** size cap for the query (server still caps at its own limit). */
  limit?: number;
  class?: string;
}

const DEBOUNCE_MS = 180;
const DEFAULT_LIMIT = 20;

export function TaxonAutocomplete(props: TaxonAutocompleteProps) {
  let inputEl: HTMLInputElement | undefined;
  let containerEl: HTMLDivElement | undefined;

  const [text, setText] = createSignal("");
  const [debounced, setDebounced] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);
  const [creating, setCreating] = createSignal(false);

  // debounce the search term so we don't hammer the server.
  createEffect(
    on(text, (t) => {
      const timer = window.setTimeout(() => setDebounced(t.trim()), DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    })
  );

  // async-fetch matching taxons. resource refetches whenever the
  // debounced query or kindSlug changes.
  const [results] = createResource(
    () => ({ q: debounced(), kind: props.kindSlug, limit: props.limit ?? DEFAULT_LIMIT }),
    async ({ q, kind, limit }) => {
      const client = await getRemoteClient();
      if (!client) return [] as TaxonRef[];
      const resp = await client.music.queryTaxons({
        kind_slug: kind,
        q: q || undefined,
        limit,
        offset: 0,
      });
      if (!resp.success) return [] as TaxonRef[];
      return (resp.data.items || []).map((t) => ({
        id: t.id,
        kind_slug: t.kind_slug,
        label: t.label,
      }));
    }
  );

  // visible options = query results minus excluded ids.
  const options = createMemo<TaxonRef[]>(() => {
    const all = results() || [];
    const exclude = new Set(props.excludeIds ?? []);
    return all.filter((o) => !exclude.has(o.id));
  });

  // does the typed text exactly match one of the options? if so, enter
  // picks; otherwise enter creates (when onCreate is provided).
  const exactMatch = createMemo<TaxonRef | undefined>(() => {
    const q = text().trim().toLowerCase();
    if (!q) return undefined;
    return options().find((o) => o.label.toLowerCase() === q);
  });

  const canCreate = createMemo(() => !!props.onCreate && text().trim().length > 0 && !exactMatch());

  // keep highlight in range whenever the option list shrinks.
  createEffect(() => {
    const max = options().length - 1;
    if (highlight() > Math.max(0, max)) setHighlight(0);
  });

  // close when the user clicks outside the component.
  const onDocClick = (e: MouseEvent) => {
    if (!containerEl) return;
    if (!containerEl.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  const pick = (taxon: TaxonRef) => {
    props.onSelect(taxon);
    setText("");
    setDebounced("");
    setHighlight(0);
    inputEl?.focus();
  };

  const create = async () => {
    if (!props.onCreate) return;
    const label = text().trim();
    if (!label) return;
    setCreating(true);
    try {
      await props.onCreate(label);
      setText("");
      setDebounced("");
      setHighlight(0);
      inputEl?.focus();
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const max = options().length - 1;
      setHighlight((h) => Math.min(h + 1, Math.max(0, max)));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opts = options();
      const idx = highlight();
      if (opts[idx]) {
        pick(opts[idx]);
      } else if (canCreate()) {
        void create();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setText("");
    }
  };

  return (
    <div ref={containerEl} class={`relative ${props.class ?? ""}`}>
      <div class="relative">
        <input
          ref={inputEl}
          type="text"
          value={text()}
          disabled={props.disabled || creating()}
          placeholder={props.placeholder ?? "type to search…"}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent-500)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        />
        <Show when={results.loading || creating()}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <div class="animate-spin w-4 h-4 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
          </div>
        </Show>
      </div>

      <Show when={open() && !props.disabled}>
        <div class="absolute left-0 right-0 top-full mt-1 z-[1100] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg max-h-72 overflow-y-auto">
          <Show
            when={options().length > 0}
            fallback={
              <Show
                when={canCreate()}
                fallback={
                  <div class="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
                    {results.loading ? "searching…" : "no matches"}
                  </div>
                }
              >
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                  class="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-hover)] flex items-center gap-2"
                >
                  <Icon name={IconNames.add} size={14} />
                  <span>
                    create <span class="font-medium">"{text().trim()}"</span>
                    <Show when={props.kindSlug}>
                      <span class="text-[var(--color-text-tertiary)] ml-1">
                        as {props.kindSlug}
                      </span>
                    </Show>
                  </span>
                </button>
              </Show>
            }
          >
            <For each={options()}>
              {(opt, i) => (
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i())}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(opt);
                  }}
                  class={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${
                    i() === highlight()
                      ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                      : "hover:bg-[var(--color-bg-hover)]"
                  }`}
                >
                  <span class="truncate">{opt.label}</span>
                  <Show when={!props.kindSlug}>
                    <span
                      class={`text-[10px] uppercase tracking-wide shrink-0 ${
                        i() === highlight() ? "opacity-90" : "text-[var(--color-text-tertiary)]"
                      }`}
                    >
                      {opt.kind_slug}
                    </span>
                  </Show>
                </button>
              )}
            </For>
            {/* always-visible "create" footer when typing something new */}
            <Show when={canCreate()}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void create();
                }}
                class="w-full text-left px-3 py-2 text-sm border-t border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] flex items-center gap-2 text-[var(--color-text-secondary)]"
              >
                <Icon name={IconNames.add} size={14} />
                <span>
                  create <span class="font-medium">"{text().trim()}"</span>
                  <Show when={props.kindSlug}>
                    <span class="text-[var(--color-text-tertiary)] ml-1">as {props.kindSlug}</span>
                  </Show>
                </span>
              </button>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
