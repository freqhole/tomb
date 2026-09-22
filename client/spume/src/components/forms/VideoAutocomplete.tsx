// video autocomplete - lightweight typeahead for picking an EXISTING
// video by title, scoped to a caller-given content type (e.g. "movie" for
// EditVideoModal.tsx's parent_video_id picker). unlike
// VideoSeriesAutocomplete, this has no "create new" option - a video is
// never created from this picker, only referenced.
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { useVideosQuery } from "../../video/queries/videos";

export interface VideoAutocompleteOption {
  id: string;
  title: string;
}

export interface VideoAutocompleteProps {
  /** current display text, e.g. the parent movie's title */
  value?: string;
  /** content_type(s) to search within (e.g. ["movie"]) */
  contentTypes: string[];
  /** video ids to exclude from results (e.g. the video being edited itself) */
  excludeIds?: string[];
  onSelect: (selection: VideoAutocompleteOption) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  hint?: string;
}

const DEBOUNCE_MS = 180;

export function VideoAutocomplete(props: VideoAutocompleteProps) {
  let inputEl: HTMLInputElement | undefined;
  let containerEl: HTMLDivElement | undefined;

  const [text, setText] = createSignal(props.value ?? "");
  const [debounced, setDebounced] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  // sync local text when props.value changes externally (e.g. reset) -
  // skip while focused so the user's typing isn't clobbered.
  createEffect(() => {
    const v = props.value ?? "";
    if (document.activeElement !== inputEl) setText(v);
  });

  createEffect(
    on(text, (t) => {
      const timer = window.setTimeout(() => setDebounced(t.trim()), DEBOUNCE_MS);
      onCleanup(() => window.clearTimeout(timer));
    })
  );

  const videosQuery = useVideosQuery({
    search: () => (debounced().length > 0 ? debounced() : undefined),
    contentTypes: () => props.contentTypes,
    pageSize: 15,
  });

  const options = createMemo<VideoAutocompleteOption[]>(() => {
    const exclude = new Set(props.excludeIds ?? []);
    const items = videosQuery.data?.pages.flatMap((p) => p.items) ?? [];
    return items.filter((v) => !exclude.has(v.id)).map((v) => ({ id: v.id, title: v.title }));
  });

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

  const pick = (opt: VideoAutocompleteOption) => {
    setText(opt.title);
    setOpen(false);
    setHighlight(0);
    props.onSelect(opt);
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
      const opt = options()[highlight()];
      if (opt) pick(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

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
          placeholder={props.placeholder || "search by title..."}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Show when={videosQuery.isFetching}>
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
            when={options().length > 0}
            fallback={
              <div class="px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
                {videosQuery.isFetching ? "searching…" : "no matches"}
              </div>
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
