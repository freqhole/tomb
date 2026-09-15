// inline "sending to remote" progress panel, shown by a review modal in
// place of its normal content while a post-review send is in flight.
// shared by ImportReviewModal.tsx (music) and ImportVideoReviewModal.tsx
// (video) - both send flows report the same SendReviewProgress shape (see
// app/services/send/sendReviewProgress.ts).
import { For, Show } from "solid-js";
import { Icon } from "../icons/registry";
import type { SendReviewProgress } from "../../app/services/send/sendReviewProgress";

export function SendProgressPanel(props: { progress: SendReviewProgress }) {
  const p = () => props.progress;
  const percent = () =>
    p().totalAlbums > 0 ? Math.round((p().completedAlbums / p().totalAlbums) * 100) : 0;

  return (
    <div class="flex-1 flex flex-col gap-4 py-10 px-4">
      <div class="text-center">
        <h3 class="heading-6 text-[var(--color-text-primary)] mb-1">
          {p().done ? `sent to ${p().targetName}` : `sending to ${p().targetName}\u2026`}
        </h3>
        <p class="body-small text-[var(--color-text-secondary)]">
          {p().completedAlbums} of {p().totalAlbums} album{p().totalAlbums === 1 ? "" : "s"}
          {p().failedAlbums > 0 ? ` \u00b7 ${p().failedAlbums} failed` : ""}
        </p>
      </div>

      <div class="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          class="h-full bg-[var(--color-accent-500)] rounded-full transition-all duration-300"
          style={{ width: `${percent()}%` }}
        />
      </div>

      <Show when={p().done}>
        <div class="flex-1 flex items-center justify-center">
          <p class="heading-4 text-[var(--color-accent-500)]">done!</p>
        </div>
      </Show>

      <Show when={!p().done}>
        <div class="flex items-center justify-center gap-2">
          <Icon name="loader" size={16} className="animate-spin text-[var(--color-text-muted)]" />
          <Show when={p().currentAlbumTitle}>
            <p class="body-xs text-[var(--color-text-tertiary)]">
              {p().currentAlbumTitle} — {p().currentSongsDone}/{p().currentSongsTotal}{" "}
              {p().itemLabel ?? "songs"}
            </p>
          </Show>
        </div>
      </Show>

      <Show when={p().errors.length > 0}>
        <div class="rounded-lg border border-red-500/30 bg-red-500/10 p-3 max-h-32 overflow-y-auto space-y-1">
          <For each={p().errors}>{(err) => <p class="body-xs text-red-400">{err}</p>}</For>
        </div>
      </Show>
    </div>
  );
}
