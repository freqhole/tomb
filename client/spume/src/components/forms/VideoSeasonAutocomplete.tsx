// video season autocomplete - lightweight typeahead with "create new"
// option, for assigning a video to a season within an already-selected
// series.
//
// same plain-input + absolute popover pattern as VideoSeriesAutocomplete
// (this file's direct template): typed text filtered client-side against
// the series' full season list (seasons have no server-side search route,
// and a series rarely has enough of them to need one), arrow-key
// navigation, and a "create new" row when the typed text has no exact
// match. picking "create new" does not create the season immediately -
// it reports isNew:true with a parsed season_number/title and lets the
// caller decide when to actually create it (EditVideoModal/
// BulkEditVideosModal create it as part of their save flow).
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { useVideoSeasonsQuery } from "../../video/queries/series";

export interface VideoSeasonSelection {
  id?: string;
  season_number: number;
  title: string | null;
  isNew: boolean;
}

export interface VideoSeasonAutocompleteProps {
  /** series the season belongs to - no seasons load (and the field is
   * effectively disabled) until this is set */
  seriesId?: string;
  /** current display text, eg. "season 3 - finale" */
  value?: string;
  onSelect: (selection: VideoSeasonSelection) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  hint?: string;
}

interface SeasonOption {
  id: string;
  season_number: number;
  title: string | null;
}

/** formats a season for display, e.g. "season 3 - finale". guards
 *  against a title that's just a redundant restatement of the number
 *  (eg. title "season 3" on season_number 3, from old input before this
 *  parser understood a leading "season" word) so it isn't shown twice. */
export function formatSeasonLabel(season_number: number, title: string | null | undefined): string {
  const trimmedTitle = title?.trim();
  const isRedundant =
    !!trimmedTitle && trimmedTitle.toLowerCase().replace(/\s+/g, "") === `season${season_number}`;
  return `season ${season_number}${trimmedTitle && !isRedundant ? ` - ${trimmedTitle}` : ""}`;
}

/** parse freeform "create new" input into a season_number/title pair.
 * accepts: a bare number ("5"), a leading number + separator + title
 * ("5 - finale", "5: finale", "5 finale"), or - if no leading number is
 * found at all - falls back to auto-assigning the next unused season
 * number and using the whole input as the title. */
function parseSeasonInput(
  raw: string,
  existing: SeasonOption[]
): { season_number: number; title: string | null } {
  const trimmed = raw.trim();
  // an optional leading "season" word (as typed by a user echoing the
  // displayed label back, eg. "season 3") must not be swallowed into
  // the title - otherwise it duplicates as "season 3 - season 3".
  const match = trimmed.match(/^(?:season\s*)?(\d+)\s*[-:.]?\s*(.*)$/i);
  if (match) {
    const season_number = parseInt(match[1], 10);
    const title = match[2].trim();
    return { season_number, title: title.length > 0 ? title : null };
  }
  const maxNumber = existing.reduce((max, s) => Math.max(max, s.season_number), 0);
  return { season_number: maxNumber + 1, title: trimmed.length > 0 ? trimmed : null };
}

export function VideoSeasonAutocomplete(props: VideoSeasonAutocompleteProps) {
  let inputEl: HTMLInputElement | undefined;
  let containerEl: HTMLDivElement | undefined;

  const [text, setText] = createSignal(props.value ?? "");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  // sync local text when props.value changes externally (eg. reset).
  // skip while focused so the user's typing isn't clobbered.
  createEffect(() => {
    const v = props.value ?? "";
    if (document.activeElement !== inputEl) setText(v);
  });

  // clear the typed text whenever the series changes out from under us
  createEffect(
    on(
      () => props.seriesId,
      () => setText(props.value ?? "")
    )
  );

  const seasonsQuery = useVideoSeasonsQuery(() => props.seriesId);

  const allSeasons = createMemo<SeasonOption[]>(() =>
    (seasonsQuery.data ?? []).map((s) => ({
      id: s.id,
      season_number: s.season_number,
      title: s.title ?? null,
    }))
  );

  const options = createMemo<SeasonOption[]>(() => {
    const q = text().trim().toLowerCase();
    if (!q) return allSeasons();
    return allSeasons().filter((s) => formatSeasonLabel(s.season_number, s.title).includes(q));
  });

  const exactMatch = createMemo<SeasonOption | undefined>(() => {
    const q = text().trim().toLowerCase();
    if (!q) return undefined;
    return allSeasons().find(
      (s) => formatSeasonLabel(s.season_number, s.title).toLowerCase() === q
    );
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

  const pickExisting = (opt: SeasonOption) => {
    setText(formatSeasonLabel(opt.season_number, opt.title));
    setOpen(false);
    setHighlight(0);
    props.onSelect({
      id: opt.id,
      season_number: opt.season_number,
      title: opt.title,
      isNew: false,
    });
  };

  const pickNew = () => {
    const trimmed = text().trim();
    if (!trimmed) return;
    const { season_number, title } = parseSeasonInput(trimmed, allSeasons());
    setOpen(false);
    setHighlight(0);
    props.onSelect({ id: undefined, season_number, title, isNew: true });
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

  const newLabel = (input: string) => {
    const { season_number, title } = parseSeasonInput(input, allSeasons());
    return `create new: ${formatSeasonLabel(season_number, title)}`;
  };

  const disabled = createMemo(() => props.disabled || !props.seriesId);

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
          disabled={disabled()}
          placeholder={props.placeholder || "search or type season..."}
          onInput={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Show when={seasonsQuery.isFetching}>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <div class="animate-spin w-4 h-4 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
          </div>
        </Show>
      </div>

      <Show when={props.hint}>
        <p class="text-xs text-[var(--color-text-tertiary)] mt-1">{props.hint}</p>
      </Show>

      <Show when={open() && !disabled()}>
        <div class="absolute left-0 right-0 top-full mt-1 z-[1100] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg max-h-80 overflow-y-auto">
          <Show
            when={options().length > 0 || canCreate()}
            fallback={
              <div class="px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
                {seasonsQuery.isFetching ? "loading…" : "no seasons yet"}
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
                  {formatSeasonLabel(opt.season_number, opt.title)}
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

export default VideoSeasonAutocomplete;
