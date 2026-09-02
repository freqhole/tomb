// presentational component for the series-grouping stage of the video
// import review flow. mirrors components/import/ImportGroupingView.tsx,
// but simpler: videos are grouped by detected series server-side (no
// merge action - a misdetected group is fixed by moving videos out of it
// one at a time instead).
import { For, Show, createSignal } from "solid-js";
import { Button } from "../buttons/Button";
import { MediaImage } from "../media/MediaImage";
import type {
  ImportReviewVideoGroup,
  ImportReviewVideoItem,
} from "../../video/hooks/useVideoImportReview";

export interface ImportVideoGroupingViewProps {
  groups: ImportReviewVideoGroup[];
  /** called when a video is moved to a different group (series) */
  onMoveVideo: (videoId: string, toSeriesId: string | null) => void;
  /** "all look right" - advance to metadata stage */
  onConfirm: () => void;
}

function fmtEpisode(video: ImportReviewVideoItem): string {
  if (video.seasonNumber != null && video.episodeNumber != null) {
    return `S${video.seasonNumber}E${video.episodeNumber}`;
  }
  if (video.episodeNumber != null) return `E${video.episodeNumber}`;
  return "";
}

function SingleGroupCollapsed(props: { group: ImportReviewVideoGroup; onConfirm: () => void }) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3 p-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]">
        <MediaImage
          remoteBlobId={props.group.posterBlobId}
          remoteServerId={props.group.remoteServerId}
          imageUrl={props.group.posterUrl}
          alt=""
          size="sm"
          thumbnailSize={200}
          class="w-12 h-12 rounded object-cover flex-shrink-0"
          showFallback
          domainType="video_series"
        />

        <div class="flex-1 min-w-0">
          <p class="body-base font-medium text-[var(--color-text-primary)] truncate">
            {props.group.seriesTitle ?? props.group.videos[0]?.title ?? "untitled"}
          </p>
          <p class="body-small text-[var(--color-text-secondary)] truncate">
            {props.group.videos.length} video{props.group.videos.length !== 1 ? "s" : ""}
          </p>
        </div>

        <button
          class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors flex-shrink-0"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded() ? "hide" : "show videos"}
        </button>
      </div>

      <Show when={expanded()}>
        <div class="rounded-lg border border-[var(--color-border-default)] divide-y divide-[var(--color-border-subtle)] overflow-hidden">
          <For each={props.group.videos}>
            {(video) => (
              <div class="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-secondary)] text-sm">
                <span class="w-14 text-right body-xs text-[var(--color-text-muted)] flex-shrink-0">
                  {fmtEpisode(video)}
                </span>
                <span class="flex-1 min-w-0 truncate text-[var(--color-text-primary)]">
                  {video.title}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="flex gap-2">
        <Button variant="secondary" onClick={props.onConfirm}>
          next
          <svg
            class="inline ml-1"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 6h8M7 3l3 3-3 3"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
}

function VideoGroupCard(props: {
  group: ImportReviewVideoGroup;
  otherGroups: ImportReviewVideoGroup[];
  onMoveVideo: (videoId: string, toSeriesId: string | null) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);

  return (
    <div
      class="flex flex-col rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]"
      style={{ "min-width": "0" }}
    >
      <div class="flex items-start gap-3 p-3">
        <MediaImage
          remoteBlobId={props.group.posterBlobId}
          remoteServerId={props.group.remoteServerId}
          imageUrl={props.group.posterUrl}
          alt=""
          size="sm"
          thumbnailSize={200}
          class="w-10 h-10 rounded object-cover flex-shrink-0 mt-0.5"
          showFallback
          domainType="video_series"
        />
        <div class="flex-1 min-w-0">
          <p class="body-base font-medium text-[var(--color-text-primary)] truncate leading-tight">
            {props.group.seriesTitle ?? props.group.videos[0]?.title ?? "untitled"}
          </p>
          <p class="body-xs text-[var(--color-text-secondary)] truncate">
            {props.group.videos.length} video{props.group.videos.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <button
        class="px-3 pb-1 body-xs text-left text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded() ? "hide videos" : `show ${props.group.videos.length} videos`}
      </button>

      <Show when={expanded()}>
        <div class="border-t border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-b-lg">
          <For each={props.group.videos}>
            {(video) => (
              <div class="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-bg-primary)] text-sm group">
                <span class="w-14 text-right body-xs text-[var(--color-text-muted)] flex-shrink-0">
                  {fmtEpisode(video)}
                </span>
                <span class="flex-1 min-w-0 truncate text-[var(--color-text-primary)] body-small">
                  {video.title}
                </span>

                <Show when={props.otherGroups.length > 0}>
                  <select
                    class="opacity-0 group-hover:opacity-100 body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[var(--color-text-secondary)] transition-opacity flex-shrink-0 max-w-[140px]"
                    value=""
                    aria-label={`move ${video.title} to another group`}
                    onChange={(e) => {
                      const targetKey = e.currentTarget.value;
                      if (targetKey) {
                        const target = props.otherGroups.find((g) => g.groupKey === targetKey);
                        props.onMoveVideo(video.id, target?.seriesId ?? null);
                        e.currentTarget.value = "";
                      }
                    }}
                  >
                    <option value="" disabled>
                      move to...
                    </option>
                    <For each={props.otherGroups}>
                      {(other) => (
                        <option value={other.groupKey}>
                          {other.seriesTitle ?? other.videos[0]?.title ?? "untitled"}
                        </option>
                      )}
                    </For>
                  </select>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function ImportVideoGroupingView(props: ImportVideoGroupingViewProps) {
  // fast-path: single group
  if (props.groups.length <= 1) {
    const group = props.groups[0];
    if (!group) {
      return (
        <div class="flex flex-col items-center justify-center py-12 gap-2">
          <p class="body-base text-[var(--color-text-muted)]">no videos in this session</p>
          <Button variant="ghost" onClick={props.onConfirm}>
            close
          </Button>
        </div>
      );
    }
    return <SingleGroupCollapsed group={group} onConfirm={props.onConfirm} />;
  }

  return (
    <div class="flex flex-col gap-4">
      <p class="body-small text-[var(--color-text-secondary)]">
        check that videos landed in the right series/group. hover over a video to move it to a
        different group.
      </p>

      <div
        class="grid gap-3"
        style={{ "grid-template-columns": "repeat(auto-fill, minmax(260px, 1fr))" }}
      >
        <For each={props.groups}>
          {(group) => (
            <VideoGroupCard
              group={group}
              otherGroups={props.groups.filter((g) => g.groupKey !== group.groupKey)}
              onMoveVideo={props.onMoveVideo}
            />
          )}
        </For>
      </div>

      <div class="flex gap-2 flex-wrap pt-2 border-t border-[var(--color-border-subtle)]">
        <Button variant="secondary" onClick={props.onConfirm}>
          next
          <svg
            class="inline ml-1"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 6h8M7 3l3 3-3 3"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
}
