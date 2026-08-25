// video series view - two-column list + detail layout, mirrors
// music/views/ArtistsView.tsx's structure exactly (TwoColumnLayout +
// AlphabetNav + URL/history-driven selection). one deliberate
// difference: nothing auto-selects on load — the right column shows a
// grid of all (filtered) series until one is actually picked, instead of
// ArtistsView's auto-select-first + plain empty-state message.
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { appState } from "../../app/services/storage/db";
import { isRadioPlayerBarActive } from "../../app/services/radio/radioService";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { isNarrowViewport } from "../../config/breakpoints";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import { AlphabetNav } from "../../components/navigation/AlphabetNav";
import { VirtualItemList, type ListItem } from "../../components/virtualized/VirtualItemList";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import { MediaImage } from "../../components/media/MediaImage";
import { VideoSeriesDetailPanel } from "../components/VideoSeriesDetailPanel";
import { useVideoSeriesListQuery } from "../queries/series";
import { buildRoute } from "../../music/utils/routing";
import type { VideoSeries } from "../data/types";

export function VideoSeriesView() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();

  // reactive viewport height for safari toolbar handling
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () =>
    (appState()?.queue.length || 0) > 0 || isRadioPlayerBarActive() ? 80 : 0;
  const listHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  // restore selected series from URL params or history state on mount
  const initialSeriesId =
    params.id ||
    (typeof window !== "undefined"
      ? (window.history.state?.selectedVideoSeriesId as string | null)
      : null);

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  const [showingDetailOnNarrow, setShowingDetailOnNarrow] = createSignal(
    isNarrowViewport() && !!initialSeriesId
  );

  const [selectedSeriesId, setSelectedSeriesId] = createSignal<string | null>(initialSeriesId);
  const [currentLetter, setCurrentLetter] = createSignal<string | null>(null);
  const [scrollToIndex, setScrollToIndex] = createSignal<((index: number) => void) | null>(null);
  const [isLocalClick, setIsLocalClick] = createSignal(false);

  onMount(() => {
    const handleResize = () => {
      const narrow = isNarrowViewport();
      setIsNarrow(narrow);
      if (!narrow) {
        setShowingDetailOnNarrow(false);
      }
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearPageInfo();
    });
  });

  // save selected series to history state when it changes
  createEffect(() => {
    const seriesId = selectedSeriesId();
    if (seriesId && typeof window !== "undefined") {
      const currentState = window.history.state || {};
      window.history.replaceState({ ...currentState, selectedVideoSeriesId: seriesId }, "");
    }
  });

  // sync URL params with selected series
  createEffect(() => {
    const urlSeriesId = params.id;

    if (urlSeriesId && urlSeriesId !== selectedSeriesId()) {
      setSelectedSeriesId(urlSeriesId);

      const shouldScroll = !isLocalClick();
      if (shouldScroll && scrollToIndex()) {
        const index = sortedSeries().findIndex((s) => s.id === urlSeriesId);
        if (index >= 0) {
          scrollToIndex()!(index);
        }
      }

      setIsLocalClick(false);
    } else if (!urlSeriesId && selectedSeriesId()) {
      // navigated back to the bare /video/series (no id) - deselect so
      // the grid shows again (the deliberate no-auto-select difference
      // from ArtistsView means we must also support "nothing selected"
      // as a real, reachable state, not just an initial one).
      setSelectedSeriesId(null);
    }
  });

  // top-nav search wiring: read the same `q` query param ArtistsView
  // reads, instead of an embedded search box. filtering continues to
  // work once top-nav search actually writes this param for the series
  // route (see docs/video-domain-round2-plan.md's agent 2 section) -
  // this view doesn't need to know or care whether that's landed yet.
  const seriesQuery = useVideoSeriesListQuery({
    search: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
  });

  // auto-fetch next page while more data is available
  createEffect(() => {
    if (seriesQuery.hasNextPage && !seriesQuery.isFetchingNextPage && !seriesQuery.isFetching) {
      seriesQuery.fetchNextPage();
    }
  });

  // flatten all pages, sorted by title
  const sortedSeries = createMemo((): VideoSeries[] => {
    const pages = seriesQuery.data?.pages ?? [];
    const all = pages.flatMap((page) => page.items);
    return [...all].sort((a, b) => a.title.localeCompare(b.title));
  });

  const selectedSeries = createMemo(() => {
    const id = selectedSeriesId();
    if (!id) return null;
    return sortedSeries().find((s) => s.id === id) ?? null;
  });

  createEffect(() => {
    setPageInfo({
      title: "series",
      count: sortedSeries().length,
      documentTitle: selectedSeries()?.title,
    });
  });

  // convert to list items
  const seriesListItems = createMemo((): ListItem[] => {
    return sortedSeries().map((series) => ({
      id: series.id,
      title: series.title,
      subtitle: series.description ?? undefined,
      remoteBlobId: series.poster_blob_id,
      remoteServerId: series.remote_server_id,
      domainType: "video_series" as const,
    }));
  });

  // calculate disabled letters for alphabet nav
  const disabledLetters = createMemo(() => {
    const list = sortedSeries();
    if (list.length === 0) return new Set<string>();

    const disabledSet = new Set<string>();
    const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

    const enabledLetters = new Set<string>();
    list.forEach((series) => {
      const firstChar = series.title[0]?.toUpperCase() || "";
      enabledLetters.add(/[A-Z]/.test(firstChar) ? firstChar : "#");
    });

    allLetters.forEach((letter) => {
      if (!enabledLetters.has(letter)) {
        disabledSet.add(letter);
      }
    });

    return disabledSet;
  });

  // calculate index for each letter (for A-Z navigation)
  const letterToIndexMap = createMemo(() => {
    const list = sortedSeries();
    const map = new Map<string, number>();

    list.forEach((series, index) => {
      const firstChar = series.title[0]?.toUpperCase() || "";
      const letter = /[A-Z]/.test(firstChar) ? firstChar : "#";
      if (!map.has(letter)) {
        map.set(letter, index);
      }
    });

    return map;
  });

  const handleSelectSeries = (series: VideoSeries) => {
    setIsLocalClick(true);
    if (isNarrow()) {
      setShowingDetailOnNarrow(true);
    }
    navigate(buildRoute(`/video/series/${series.id}`));
  };

  // handle back navigation on narrow
  const handleBack = () => {
    setShowingDetailOnNarrow(false);
    setSelectedSeriesId(null);
    navigate(buildRoute("/video/series"));
  };

  // left column - series list
  const leftColumn = (
    <div class="flex flex-col h-full">
      <div class="flex-1 overflow-hidden">
        <Show
          when={!seriesQuery.isError}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
              <p class="text-lg text-[var(--color-text-secondary)]">failed to load series</p>
            </div>
          }
        >
          <Show
            when={seriesListItems().length > 0}
            fallback={
              <Show
                when={seriesQuery.isLoading || seriesQuery.isFetching}
                fallback={
                  <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                    <p class="text-lg text-[var(--color-text-secondary)]">no series found</p>
                  </div>
                }
              >
                <div class="flex items-center justify-center h-full">
                  <LoadingState text="loading series..." />
                </div>
              </Show>
            }
          >
            <>
              <VirtualItemList
                items={seriesListItems()}
                selectedId={selectedSeriesId()}
                scrollPaddingTop={100}
                onItemClick={(item) => {
                  const series = sortedSeries().find((s) => s.id === item.id);
                  if (series) handleSelectSeries(series);
                }}
                onVirtualizerReady={(scrollFn) => {
                  setScrollToIndex(() => scrollFn);

                  const current = selectedSeriesId();
                  if (current && current === initialSeriesId) {
                    const index = sortedSeries().findIndex((s) => s.id === current);
                    if (index >= 0) {
                      setTimeout(() => scrollFn(index), 50);
                    }
                  }
                }}
                height={listHeight()}
              />
              <LoadingMoreIndicator isLoading={seriesQuery.isFetchingNextPage} />
            </>
          </Show>
        </Show>
      </div>
    </div>
  );

  // right column - either a grid of all/filtered series (nothing
  // selected - the deliberate difference from ArtistsView) or the
  // selected series' detail panel.
  const rightColumn = (
    <Show
      when={selectedSeries()}
      fallback={
        <div class="h-full overflow-auto p-4 wide:p-6">
          <Show
            when={!seriesQuery.isLoading}
            fallback={<LoadingState class="flex-1" text="loading series..." />}
          >
            <Show
              when={seriesListItems().length > 0}
              fallback={
                <div class="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
                  no series found
                </div>
              }
            >
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 wide:grid-cols-6 gap-4">
                <For each={sortedSeries()}>
                  {(series) => (
                    <div
                      class="group cursor-pointer flex flex-col"
                      onClick={() => handleSelectSeries(series)}
                    >
                      <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-lg mb-2 overflow-hidden">
                        <MediaImage
                          remoteBlobId={series.poster_blob_id}
                          remoteServerId={series.remote_server_id}
                          alt={series.title}
                          showFallback={true}
                          thumbnailSize={200}
                          domainType="video_series"
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
        </div>
      }
    >
      {(series) => (
        <VideoSeriesDetailPanel
          seriesId={series().id}
          showBackButton={isNarrow() && showingDetailOnNarrow()}
          onBack={handleBack}
          onDeleted={handleBack}
        />
      )}
    </Show>
  );

  const alphabetNav = () => (
    <AlphabetNav
      currentLetter={currentLetter() ?? undefined}
      disabledLetters={disabledLetters()}
      onLetterClick={(letter) => {
        setCurrentLetter(letter);
        const index = letterToIndexMap().get(letter);
        if (index !== undefined) {
          const scroll = scrollToIndex();
          if (scroll) {
            scroll(index);
          }
        }
      }}
    />
  );

  return (
    <div class="flex flex-col" style={{ height: `${listHeight()}px` }}>
      <div class="flex-1 overflow-hidden">
        <TwoColumnLayout
          leftColumn={leftColumn}
          rightColumn={rightColumn}
          alphabetNav={alphabetNav()}
          showDetail={showingDetailOnNarrow()}
          onBack={handleBack}
        />
      </div>
    </div>
  );
}
