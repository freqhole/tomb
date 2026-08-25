// videos view - simple clone of AlbumsView.tsx's grid/table shape for
// videos (see music/views/AlbumsView.tsx). deliberately minimal per
// docs/video-domain-plan.md's MVP scope: no bulk select/edit,
// no musicbrainz-style enrichment. tag filtering mirrors AlbumsView's
// topnav TagFilterPicker wiring.
import { useNavigate, useSearchParams } from "@solidjs/router";
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
import { useVideoTagsQuery } from "../queries/tags";
import type { TagFilter } from "../../components/forms/TagFilterPicker";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { buildRoute } from "../../music/utils/routing";
import { Icon } from "../../components/icons/registry";
import { useToggleFavoriteMutation } from "../../music/queries/favorites";
import { useSetRatingMutation } from "../../music/queries/ratings";
import { useVideoFavoriteStatuses } from "../hooks/useVideoFavoriteStatuses";
import { useVideoRatingStatuses } from "../hooks/useVideoRatingStatuses";
import { useVideoContextMenu } from "../hooks/contextMenu";
import { useQueryClient } from "@tanstack/solid-query";
import { videoQueryKeys } from "../queries/queryKeys";
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
  const [searchParams] = useSearchParams();

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

  // top-nav search wiring: read the same `q` query param AlbumsView reads
  // (VideosView was never wired up to it, unlike VideoSeriesView).
  const searchQuery = () => {
    const q = searchParams.q;
    return Array.isArray(q) ? q[0] : q;
  };

  // tag filtering state (persisted in browser history) + available tags.
  // declared before `videosQuery` since its options reference `tagFilters()`.
  const [tagFilters, setTagFilters] = useHistoryState<TagFilter[]>("videos.tagFilters", []);
  const tagsQuery = useVideoTagsQuery();

  const videosQuery = useVideosQuery({
    search: searchQuery,
    tagFilters: () => tagFilters(),
    sortField: () => sortField(),
    sortDirection: () => sortDirection(),
  });

  const availableTags = createMemo(() =>
    (tagsQuery.data || []).map((tag) => ({ value: tag.name, label: tag.name }))
  );

  const handleAddTag = (tag: string) => {
    setTagFilters([...tagFilters(), { tag, mode: "include" }]);
  };
  const handleRemoveTag = (tag: string) => {
    setTagFilters(tagFilters().filter((f) => f.tag !== tag));
  };
  const handleToggleTagMode = (tag: string) => {
    setTagFilters(
      tagFilters().map((f) =>
        f.tag === tag
          ? {
              tag: f.tag,
              mode: (f.mode === "include" ? "exclude" : "include") as "include" | "exclude",
            }
          : f
      )
    );
  };
  const handleClearAllTags = () => setTagFilters([]);

  // reset virtual grid when sort or search query changes
  createEffect(
    on(
      () => [searchQuery(), tagFilters(), sortField(), sortDirection()] as const,
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

  // extract video ids for favorite status query
  const videoIds = createMemo(() => videos().map((v) => v.id));

  // fetch favorite statuses for all visible videos
  const favoriteStatusesQuery = useVideoFavoriteStatuses(videoIds);
  const favoriteVideoIds = createMemo(() => favoriteStatusesQuery.data ?? new Set<string>());

  // favorite toggle mutation
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // handle favorite toggle
  const handleVideoFavoriteToggle = (videoId: string, isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "video",
      targetId: videoId,
      isFavorite,
    });
  };

  // fetch the caller's own rating for all visible videos (mirrors the
  // favorites wiring above) so the table's rating column can render it.
  const ratingStatusesQuery = useVideoRatingStatuses(videoIds);
  const videoRatings = createMemo(() => ratingStatusesQuery.data ?? new Map<string, number>());
  const setRatingMutation = useSetRatingMutation();
  const handleVideoRatingChange = (videoId: string, rating: number) => {
    setRatingMutation.mutate({ targetType: "video", targetId: videoId, rating });
  };

  const queryClient = useQueryClient();

  // context menu actions for a video — mirrors AlbumsView's
  // getContextMenuActions, passed down to the grid/table which render
  // the actual menu via the shared ContextMenu component.
  const getContextMenuActions = (video: VideoSummary) => {
    return useVideoContextMenu(video, {
      showPlayActions: true,
      isFavorite: favoriteVideoIds().has(video.id),
      onSave: () => {
        // a context-menu "tags"/"edit info" save may have added a brand
        // new tag or changed this video's own tags - invalidate so the
        // top-nav tag filter picker's available-tags list (and any
        // per-video tag displays) pick up the change.
        void queryClient.invalidateQueries({ queryKey: videoQueryKeys.tags.all() });
      },
    });
  };

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
      availableTags: availableTags(),
      selectedTagFilters: tagFilters(),
      tagsLoading: tagsQuery.isLoading,
      onAddTag: handleAddTag,
      onRemoveTag: handleRemoveTag,
      onToggleTagMode: handleToggleTagMode,
      onClearAllTags: handleClearAllTags,
    });
  });

  // play the clicked video immediately (mirrors SongsView's handlePlayClick,
  // which also only queues the single clicked item, not the whole loaded list).
  // always pass a source so a history entry is created and watch-progress
  // tracking starts (without it, position never resumes on reload).
  const handleVideoPlay = (video: VideoSummary) => {
    void playVideoQueue([video], 0, { type: "video", label: video.title, entity_id: video.id });
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
      <div class="flex items-center justify-end gap-3 px-4 pt-3 pb-2 flex-wrap">
        {viewModeSwitcher()}
      </div>

      {/* video grid or table */}
      <div class="flex-1 min-h-0 overflow-hidden relative">
        <Show
          when={viewMode() === "grid"}
          fallback={
            <VideosTable
              videos={videos()}
              onVideoPlay={handleVideoPlay}
              getContextMenuActions={getContextMenuActions}
              favoriteVideoIds={favoriteVideoIds()}
              onVideoFavoriteToggle={handleVideoFavoriteToggle}
              videoRatings={videoRatings()}
              onVideoRatingChange={handleVideoRatingChange}
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
                  getContextMenuActions={getContextMenuActions}
                  favoriteVideoIds={favoriteVideoIds()}
                  onVideoFavoriteToggle={handleVideoFavoriteToggle}
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
