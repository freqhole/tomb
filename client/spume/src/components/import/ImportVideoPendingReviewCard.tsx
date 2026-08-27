// standalone card shown in AddMediaModal after a video import session
// completes, prompting the user to review imported series/episode
// metadata. mirrors components/import/ImportPendingReviewCard.tsx (music).
// purely presentational - no api calls.
import { Show } from "solid-js";
import { Button } from "../buttons/Button";

export interface ImportVideoPendingReviewCardProps {
  /** number of groups (series/standalone videos) in this session that still need review */
  pendingCount: number;
  /** number of videos imported in this session */
  videoCount?: number | null;
  /** label for the session (e.g. the url or a filename) */
  sessionLabel?: string | null;
  onReview: () => void;
  onDismiss: () => void;
}

export function ImportVideoPendingReviewCard(props: ImportVideoPendingReviewCardProps) {
  return (
    <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3 flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col gap-0.5">
          <p class="body-small text-[var(--color-text-primary)]">
            {props.pendingCount} group{props.pendingCount !== 1 ? "s" : ""} pending review
            <Show when={props.videoCount != null}>
              {" "}
              <span class="text-[var(--color-text-muted)]">&middot; {props.videoCount} videos</span>
            </Show>
          </p>
          <Show when={props.sessionLabel}>
            <p class="body-xs text-[var(--color-text-muted)] truncate max-w-xs">
              {props.sessionLabel}
            </p>
          </Show>
          <p class="body-xs text-[var(--color-text-muted)]">
            video is imported and available - review to fix series/episode metadata
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
