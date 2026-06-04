import { For } from "solid-js";
import { isFailed, isTerminalDone, isInflight, sourceShort, statusGlyph } from "./helpers";

export function ProgressBadges(props: {
  progress: Array<{ source: string; status: string; last_error?: string | null }>;
  // when set, clicking the badge for `lastfm` / `audiodb` opens that
  // source's raw-data peek modal. `mb` is intentionally not clickable
  // here — the candidate list is already rendered inline in the main
  // modal body.
  onClickSource?: (source: string) => void;
}) {
  return (
    <div class="flex items-center gap-1.5">
      <For each={props.progress}>
        {(p) => {
          const clickable = () =>
            !!props.onClickSource && (p.source === "lastfm" || p.source === "audiodb");
          return (
            <span
              role={clickable() ? "button" : undefined}
              tabindex={clickable() ? 0 : undefined}
              onClick={clickable() ? () => props.onClickSource?.(p.source) : undefined}
              onKeyDown={
                clickable()
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        props.onClickSource?.(p.source);
                      }
                    }
                  : undefined
              }
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide"
              classList={{
                "bg-[var(--color-error-500)]/15 text-[var(--color-error-500)]":
                  isFailed(p.status) || !!p.last_error,
                "bg-[var(--color-success-500)]/15 text-[var(--color-success-500)]":
                  isTerminalDone(p.status) && !p.last_error,
                "bg-[var(--color-warning-500)]/15 text-[var(--color-warning-500)]": isInflight(
                  p.status
                ),
                "bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)]":
                  !isTerminalDone(p.status) &&
                  !isInflight(p.status) &&
                  !isFailed(p.status) &&
                  !p.last_error,
                "cursor-pointer hover:ring-1 hover:ring-[var(--color-border-subtle)]": clickable(),
              }}
              title={
                clickable()
                  ? `${p.source}: ${p.status}${p.last_error ? `\n${p.last_error}` : ""}\nclick to view raw ${p.source} data`
                  : p.last_error
                    ? `${p.source}: ${p.status}\n${p.last_error}`
                    : `${p.source}: ${p.status}`
              }
            >
              {sourceShort(p.source)}
              <span class="opacity-70">{statusGlyph(p.status, !!p.last_error)}</span>
            </span>
          );
        }}
      </For>
    </div>
  );
}
