import {
  createSignal,
  For,
  Show,
  createEffect,
  onMount,
  batch,
} from "solid-js";
import { createAnalyticsApi } from "../../../../../lib/analytics/analytics-api";
import { apiClient } from "../../../../../lib/api-client";
import { TimelineCard } from "../../timeline/TimelineCard";
import type { FeedItem } from "../../../../../lib/analytics/analytics-api";

import { isMobile } from "../../../../../lib/format-utils";

export function FeedView() {
  const [allItems, setAllItems] = createSignal<FeedItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(true);
  const [, setMobile] = createSignal(isMobile());
  const [refreshing, setRefreshing] = createSignal(false);
  let scrollContainer: HTMLDivElement | undefined;

  // Update mobile state on window resize
  createEffect(() => {
    const handleResize = () => setMobile(isMobile());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  });
  const analyticsApi = createAnalyticsApi(() => apiClient);
  const [needsAlbumFallback, setNeedsAlbumFallback] = createSignal(false);

  const loadFeedBatch = async (offset: number = 0, reset: boolean = false) => {
    if (loading()) return;

    setLoading(true);
    try {
      const response = await analyticsApi.getSocialFeed(20, offset, 365); // Use full year for infinite timeline

      const feedItems = response.items || [];

      // Social feed now provides properly formatted items directly

      if (reset) {
        setAllItems(feedItems);
      } else {
        setAllItems((prev) => [...prev, ...feedItems]);
      }

      setHasMore(response.has_more && !needsAlbumFallback());
    } catch (error) {
      console.error("failed to load social feed:", error);
    } finally {
      setLoading(false);
    }
  };

  const refreshFeed = async () => {
    setRefreshing(true);
    batch(() => {
      setNeedsAlbumFallback(false);
      setHasMore(true);
    });
    await loadFeedBatch(0, true);
    setRefreshing(false);

    // Scroll to top after refresh
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
  };

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const buffer = 200; // Load more when 200px from bottom

    if (
      scrollTop + clientHeight >= scrollHeight - buffer &&
      hasMore() &&
      !loading()
    ) {
      loadFeedBatch(allItems().length);
    }
  };

  // Load initial data
  onMount(() => {
    loadFeedBatch(0, true);
  });

  // Responsive grid classes

  return (
    <div class="flex flex-col h-full text-white">
      {/* header */}
      <div class="flex-shrink-0 p-4 md:p-6">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
          <div>
            <h1 class="text-2xl md:text-3xl font-bold">music feed</h1>
            <p class="text-sm text-gray-400 mt-1">
              recent albums, playlists and activity
            </p>
          </div>

          {/* refresh button */}
          <button
            onClick={refreshFeed}
            disabled={refreshing()}
            class="px-4 py-2 bg-gray-800 text-white hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <svg
              class={`w-4 h-4 ${refreshing() ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {refreshing() ? "refreshing..." : "refresh"}
          </button>
        </div>
      </div>

      {/* feed content */}
      <div
        ref={scrollContainer!}
        class="flex-1 overflow-y-auto p-4 md:p-6 pt-0"
        onScroll={handleScroll}
      >
        <Show
          when={!loading() || allItems().length > 0}
          fallback={
            <div class="text-center py-12">
              <div class="w-16 h-16 mx-auto mb-4 bg-gray-800 flex items-center justify-center">
                <div class="w-8 h-8 border-2 border-magenta-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
              <div class="text-gray-500">loading your music feed...</div>
            </div>
          }
        >
          <Show
            when={allItems().length > 0}
            fallback={
              <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-4 bg-gray-800 flex items-center justify-center">
                  <svg
                    class="w-8 h-8 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width={2}
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                    />
                  </svg>
                </div>
                <div class="text-gray-500">no recent activity found</div>
                <div class="text-sm text-gray-600 mt-2">
                  add some music and it will appear here
                </div>
              </div>
            }
          >
            {/* feed grid */}
            <div class="timeline-container">
              <For each={allItems()}>
                {(item) => <TimelineCard event={item} />}
              </For>
            </div>

            {/* loading indicator for infinite scroll */}
            <Show when={loading()}>
              <div class="text-center py-8">
                <div class="w-8 h-8 mx-auto border-2 border-magenta-600 border-t-transparent rounded-full animate-spin"></div>
                <div class="text-gray-500 text-sm mt-2">loading more...</div>
              </div>
            </Show>

            {/* end of feed indicator */}
            <Show when={!hasMore() && allItems().length > 0}>
              <div class="text-center py-8">
                <div class="text-gray-600 text-xs opacity-50">
                  — end of feed —
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
