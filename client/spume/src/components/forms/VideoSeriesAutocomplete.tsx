// video series autocomplete - lightweight typeahead with "create new"
// option, for assigning a video to a series by name.
//
// same plain-input + absolute popover pattern as ArtistAutocomplete:
// debounced query, arrow-key navigation, and a "create new" row when
// the typed text has no exact match. picking "create new" does not
// create the series immediately - it reports isNew:true and lets the
// caller decide when to actually create it (EditVideoModal creates it
// as part of its save flow).
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { useVideoSeriesListQuery } from "../../video/queries/series";

export interface VideoSeriesAutocompleteProps {
  /** current series title value */
  value?: string;
  /** callback when a series is selected or a new name is typed */
  onSelect: (selection: { id?: string; name: string; isNew: boolean }) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  hint?: string;
  /** custom label for the "create new" option (default: "create new: {input}") */
  newLabel?: (input: string) => string;
}

interface SeriesOption {
  id: string;
  title: string;
}

const DEBOUNCE_MS = 180;

export function VideoSeriesAutocomplete(props: VideoSeriesAutocompleteProps) {
  let inputEl: HTMLInputElement | undefined;
  let containerEl: HTMLDivElement | undefined;

  const [text, setText] = createSignal(props.value ?? "");
  const [debounced, setDebounced] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  // sync local text when props.value changes externally (eg. reset).
  // skip while focused so the user's typing isn't clobbered.
  createEffect(() => {
    const v = props.value ?? "";
    if (document.activeElement !== inputEl) setText(v);
  });

  // debounce the query string
  createEffect(
    on(text, (t) => {
      const timer = window.setTimeout(() => setDebounced(t.trim()), DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    })
  );

  const seriesQuery = useVideoSeriesListQuery({
    search: () => (debounced().length > 0 ? debounced() : undefined),
    pageSize: 15,
  });

  const options = createMemo<SeriesOption[]>(() => {
    const items = seriesQuery.data?.pages.flatMap((p) => p.items) ?? [];
    return items.map((item) => ({ id: item.id, title: item.title }));
  });

  const exactMatch = createMemo<SeriesOption | undefined>(() => {
    const q = text().trim().toLowerCase();
    if (!q) return undefined;
    return options().find((o) => o.title.toLowerCase() === q);
  });
  const canCreate = createMemo(() => text().trim().length > 0 && !exactMatch());

  createEffect(() => {
    const max = options().length - 1;
    if (highlight() > Math.max(0, max)) setHighlight(0);
  });

  const onDocClick = (e: MouseEvent) => {
    if (!containerEl) return;
    if (!containerEl.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  const pickExisting = (opt: SeriesOption) => {
    setText(opt.title);
    setOpen(false);
    setHighlight(0);
    props.onSelect({ id: opt.id, name: opt.title, isNew: false });
  };

  const pickNew = () => {
    const trimmed = text().trim();
    if (!trimmed) return;
    setOpen(false);
    setHighlight(0);
    props.onSelect({ id: undefined, name: trimmed, isNew: true });
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
        pickExisting(opts[idx]);
      } else if (canCreate()) {
        pickNew();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const newLabel = (input: string) =>
    props.newLabel ? props.newLabel(input) : `create new: ${input}`;

  return (
    <div ref={containerEl} class={`relative ${props.class ?? ""}`}>
      <Show when={props.label}>
        <label class="block text-sm text-[var(--color-text-secondary)] mb-1">{props.label}</label>
      </Show>

      <div class="relative">
        <input
          ref={inputEl}
          type="text"
          value={text()}
          disabled={props.disabled}
          placeholder={props.placeholder || "search or type series title..."}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Show when={seriesQuery.isFetching}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <div class="animate-spin w-4 h-4 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
          </div>
        </Show>
      </div>

      <Show when={props.hint}>
        <p class="text-xs text-[var(--color-text-tertiary)] mt-1">{props.hint}</p>
      </Show>

      <Show when={open() && !props.disabled}>
        <div class="absolute left-0 right-0 top-full mt-1 z-[1100] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg max-h-80 overflow-y-auto">
          <Show
            when={options().length > 0 || canCreate()}
            fallback={
              <div class="px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
                {seriesQuery.isFetching ? "searching…" : "no matches"}
              </div>
            }
          >
            <Show when={canCreate()}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickNew();
                }}
                class="w-full text-left px-4 py-2 text-sm border-b border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] flex items-center gap-2 text-[var(--color-text-secondary)]"
              >
                <span class="font-medium">{newLabel(text().trim())}</span>
              </button>
            </Show>

            <For each={options()}>
              {(opt, i) => (
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i())}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickExisting(opt);
                  }}
                  class={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    i() === highlight()
                      ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                      : "hover:bg-[var(--color-bg-hover)]"
                  }`}
                >
                  {opt.title}
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default VideoSeriesAutocomplete;
