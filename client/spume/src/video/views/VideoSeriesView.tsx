// video series view - grid of series cards, drills down into VideoSeriesDetailView
import { A, useNavigate } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import { MediaImage } from "../../components/media/MediaImage";
import { useVideoSeriesListQuery } from "../queries/series";
import type { VideoSeries } from "../data/types";

export function VideoSeriesView() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = createSignal("");

  onMount(() => {
    onCleanup(() => {
      clearPageInfo();
    });
  });

  const seriesQuery = useVideoSeriesListQuery({
    search: () => searchQuery() || undefined,
  });

  // auto-fetch next page while more data is available
  createEffect(() => {
    if (seriesQuery.hasNextPage && !seriesQuery.isFetchingNextPage && !seriesQuery.isFetching) {
      seriesQuery.fetchNextPage();
    }
  });

  // flatten all pages, sorted by title
  const seriesList = createMemo((): VideoSeries[] => {
    const pages = seriesQuery.data?.pages ?? [];
    const all = pages.flatMap((page) => page.items);
    return [...all].sort((a, b) => a.title.localeCompare(b.title));
  });

  createEffect(() => {
    setPageInfo({ title: "series", count: seriesList().length });
  });

  const handleSeriesClick = (series: VideoSeries) => {
    navigate(`/video/series/${series.id}`);
  };

  return (
    <div class="flex flex-col h-full p-4 wide:p-6 gap-4">
      {/* tabs: all videos / series */}
      <div class="flex items-center gap-4 border-b border-[var(--color-border-default)]">
        <A
          href="/video"
          class="px-1 pb-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          all videos
        </A>
        <span class="px-1 pb-2 text-sm text-[var(--color-text-primary)] font-medium border-b-2 border-[var(--color-accent-500)]">
          series
        </span>
      </div>

      {/* search */}
      <input
        type="text"
        value={searchQuery()}
        onInput={(e) => setSearchQuery(e.currentTarget.value)}
        placeholder="search series..."
        class="w-full max-w-sm px-3 py-2 text-sm bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
      />

      <div class="flex-1 overflow-auto">
        <Show
          when={!seriesQuery.isLoading}
          fallback={<LoadingState class="flex-1" text="loading series..." />}
        >
          <Show
            when={seriesList().length > 0}
            fallback={
              <div class="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
                no series found
              </div>
            }
          >
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 wide:grid-cols-6 gap-4">
              <For each={seriesList()}>
                {(series) => (
                  <div
                    class="group cursor-pointer flex flex-col"
                    onClick={() => handleSeriesClick(series)}
                  >
                    <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-lg mb-2 overflow-hidden">
                      <MediaImage
                        blobId={series.poster_blob_id}
                        alt={series.title}
                        showFallback={true}
                        thumbnailSize={200}
                        class="w-full h-full rounded-lg group-hover:rounded-none transition-all duration-300"
                      />
                    </div>
                    <div class="text-sm font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-500)] transition-colors truncate">
                      {series.title}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
        <LoadingMoreIndicator isLoading={seriesQuery.isFetchingNextPage} />
      </div>
    </div>
  );
}
