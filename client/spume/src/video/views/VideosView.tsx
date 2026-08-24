// videos view - simple clone of AlbumsView.tsx's grid/table shape for
// videos (see music/views/AlbumsView.tsx). deliberately minimal per
// docs/video-domain-plan.md's MVP scope: no tag filtering, no bulk
// select/edit, no musicbrainz-style enrichment.
import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { useHistoryState } from "../../utils/historyState";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Button } from "../../components/buttons/Button";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import { VirtualVideoGrid } from "../../components/virtualized/VirtualVideoGrid";
import { VideosTable } from "../../library/components/VideosTable";
import { appState } from "../../app/services/storage/db";
import { isRadioPlayerBarActive } from "../../app/services/radio/radioService";
import { useVideosQuery } from "../queries/videos";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { buildRoute } from "../../music/utils/routing";
import { Icon } from "../../components/icons/registry";
import type { VideoQueryParams, VideoSummary } from "../data/types";

export interface VideosViewProps {
  onAddVideo?: () => void;
}

type VideoSortField = NonNullable<VideoQueryParams["sort_by"]>;

const videoSortFields = [
  { value: "added_at", label: "date added", description: "sort by date added" },
  { value: "title", label: "title", description: "sort by title" },
  { value: "year", label: "year", description: "sort by release year" },
  { value: "duration", label: "duration", description: "sort by duration" },
];

export function VideosView(props: VideosViewProps) {
  const navigate = useNavigate();

  // responsive grid height — reactive to safari toolbar changes
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () =>
    (appState()?.queue.length || 0) > 0 || isRadioPlayerBarActive() ? 80 : 0;
  const gridHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  onMount(() => {
    onCleanup(() => {
      clearPageInfo();
    });
  });

  // track query changes to force grid reset
  const [isResetting, setIsResetting] = createSignal(false);

  // sorting state (persisted in browser history)
  const [sortField, setSortField] = useHistoryState<VideoSortField>("videos.sortField", "added_at");
  const [sortDirection, setSortDirection] = useHistoryState<"asc" | "desc">(
    "videos.sortDirection",
    "desc"
  );

  const videosQuery = useVideosQuery({
    sortField: () => sortField(),
    sortDirection: () => sortDirection(),
  });

  // reset virtual grid when sort changes
  createEffect(
    on(
      () => [sortField(), sortDirection()] as const,
      () => {
        setIsResetting(true);
        setTimeout(() => setIsResetting(false), 0);
      },
      { defer: true }
    )
  );

  const loadMore = () => {
    if (videosQuery.hasNextPage && !videosQuery.isFetchingNextPage) {
      videosQuery.fetchNextPage();
    }
  };

  // flatten all pages into a flat videos list
  const videos = createMemo((): VideoSummary[] => {
    const pages = videosQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.items);
  });

  // update page info for TopNav
  createEffect(() => {
    setPageInfo({
      title: "videos",
      count: videos().length,
      sortFields: videoSortFields,
      sortBy: sortField(),
      sortDirection: sortDirection(),
      defaultSortBy: "added_at",
      defaultSortDirection: "desc",
      onSortChange: (field, direction) => {
        setSortField(field as VideoSortField);
        setSortDirection(direction);
      },
    });
  });

  // play the clicked video, queueing the rest of the currently-loaded list after it
  const handleVideoPlay = (video: VideoSummary) => {
    const list = videos();
    const idx = list.findIndex((v) => v.id === video.id);
    void playVideoQueue(list, Math.max(0, idx));
  };

  const handleVideoClick = (video: VideoSummary) => {
    navigate(buildRoute(`/video/${video.id}`));
  };

  const [viewMode, setViewMode] = createSignal<"grid" | "table">("grid");

  const viewModeSwitcher = () => (
    <div
      class="inline-flex items-center gap-1 p-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]"
      role="tablist"
      aria-label="videos view"
    >
      <button
        type="button"
        role="tab"
        aria-selected={viewMode() === "grid"}
        class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors border-none cursor-pointer"
        classList={{
          "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)]": viewMode() === "grid",
          "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]":
            viewMode() !== "grid",
        }}
        onClick={() => setViewMode("grid")}
      >
        <Icon name="grid" size={12} />
        <span>grid</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode() === "table"}
        class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors border-none cursor-pointer"
        classList={{
          "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)]": viewMode() === "table",
          "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]":
            viewMode() !== "table",
        }}
        onClick={() => setViewMode("table")}
      >
        <Icon name="list" size={12} />
        <span>table</span>
      </button>
    </div>
  );

  return (
    <div class="flex flex-col h-full">
      {/* in-page tab row: "all videos" (this view) vs "series" (drill-down flow) */}
      <div class="flex items-center justify-between gap-3 px-4 pt-3 pb-2 flex-wrap">
        <div
          class="inline-flex items-center gap-1 p-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]"
          role="tablist"
          aria-label="video library sections"
        >
          <span
            role="tab"
            aria-selected="true"
            class="px-2.5 py-1 text-xs rounded bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)]"
          >
            all videos
          </span>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            class="px-2.5 py-1 text-xs rounded border-none cursor-pointer bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
            onClick={() => navigate(buildRoute("/video/series"))}
          >
            series
          </button>
        </div>
        {viewModeSwitcher()}
      </div>

      {/* video grid or table */}
      <div class="flex-1 min-h-0 overflow-hidden relative">
        <Show
          when={viewMode() === "grid"}
          fallback={
            <VideosTable
              videos={videos()}
              onVideoClick={handleVideoClick}
              onVideoPlay={handleVideoPlay}
            />
          }
        >
          <div class="h-full overflow-hidden">
            {videosQuery.isLoading || isResetting() ? (
              <div class="flex items-center justify-center h-full">
                <LoadingState text="loading videos..." />
              </div>
            ) : videosQuery.isError ? (
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                    failed to load videos
                  </p>
                </div>
              </div>
            ) : videos().length === 0 ? (
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">no videos found!</p>
                  <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                    add videos to import local video files
                  </p>
                  <Show when={props.onAddVideo}>
                    <Button variant="primary" onClick={props.onAddVideo}>
                      add video
                    </Button>
                  </Show>
                </div>
              </div>
            ) : (
              <>
                <VirtualVideoGrid
                  videos={videos()}
                  onVideoClick={handleVideoClick}
                  onVideoPlay={handleVideoPlay}
                  onNearEnd={loadMore}
                  height={gridHeight()}
                  scrollRestoreKey="videos-grid"
                />
                <LoadingMoreIndicator isLoading={videosQuery.isFetchingNextPage} />
              </>
            )}
          </div>
        </Show>
      </div>
    </div>
  );
}

export default VideosView;
