// standalone card shown in AddMusicModal after a session completes,
// prompting the user to review imported album metadata.
// purely presentational - no api calls.
import { Show } from "solid-js";
import { Button } from "../buttons/Button";

export interface ImportPendingReviewCardProps {
  /** number of albums in this session that still need review */
  pendingCount: number;
  /** number of tracks imported in this session */
  trackCount?: number | null;
  /** label for the session (e.g. the url or a folder name) */
  sessionLabel?: string | null;
  /** called when user clicks "review now" */
  onReview: () => void;
  /** called when user dismisses the card */
  onDismiss: () => void;
}

export function ImportPendingReviewCard(props: ImportPendingReviewCardProps) {
  return (
    <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3 flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col gap-0.5">
          <p class="body-small text-[var(--color-text-primary)]">
            {props.pendingCount} album{props.pendingCount !== 1 ? "s" : ""} pending review
            <Show when={props.trackCount != null}>
              {" "}
              <span class="text-[var(--color-text-muted)]">&middot; {props.trackCount} tracks</span>
            </Show>
          </p>
          <Show when={props.sessionLabel}>
            <p class="body-xs text-[var(--color-text-muted)] truncate max-w-xs">
              {props.sessionLabel}
            </p>
          </Show>
          <p class="body-xs text-[var(--color-text-muted)]">
            music is imported and available - review to fix metadata and artwork
          </p>
        </div>
      </div>

      <div class="flex gap-2">
        <Button variant="secondary" size="sm" onClick={props.onReview}>
          review now
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDismiss}>
          dismiss
        </Button>
      </div>
    </div>
  );
}
