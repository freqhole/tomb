/* @jsxImportSource solid-js */
import {
  createSignal,
  createResource,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";
import {
  createAnalyticsApi,
  formatNumber,
  formatPercentage,
  getTrendIcon,
  getTrendColor,
} from "../../../lib/analytics/analytics-api.js";
import { apiClient } from "../../../lib/api-client.js";
import { SongRow } from "./SongRow.js";

export function AnalyticsDashboard() {
  const analyticsApi = createAnalyticsApi(() => apiClient);

  const [refreshInterval, setRefreshInterval] =
    createSignal<NodeJS.Timeout | null>(null);
  const [lastUpdated, setLastUpdated] = createSignal<Date>(new Date());

  // Data resources using createResource for reactive loading
  const [overviewData, { refetch: refetchOverview }] = createResource(
    async () => {
      const data = await analyticsApi.getOverview();
      setLastUpdated(new Date());
      return data;
    }
  );

  const [topSongsData, { refetch: refetchTopSongs }] = createResource(
    async () => {
      return await analyticsApi.getTopSongs(168, 10); // last week, top 10
    }
  );

  const [trendingData, { refetch: refetchTrending }] = createResource(
    async () => {
      return await analyticsApi.getTrendingSongs(24, 10); // last 24h, top 10
    }
  );

  const [genrePatternsData, { refetch: refetchGenrePatterns }] = createResource(
    async () => {
      return await analyticsApi.getGenrePatterns(30, 3); // last 30 days, min 3 plays
    }
  );

  // Auto-refresh every 5 minutes
  onMount(() => {
    const interval = setInterval(
      () => {
        // Trigger resource refresh
        refetchOverview();
        refetchTopSongs();
        refetchTrending();
        refetchGenrePatterns();
        setLastUpdated(new Date());
      },
      5 * 60 * 1000
    );

    setRefreshInterval(interval);
  });

  onCleanup(() => {
    const interval = refreshInterval();
    if (interval) {
      clearInterval(interval);
    }
  });

  const manualRefresh = () => {
    refetchOverview();
    refetchTopSongs();
    refetchTrending();
    refetchGenrePatterns();
    setLastUpdated(new Date());
  };

  return (
    <div class="analytics-dashboard bg-black text-white min-h-screen p-6">
      {/* Header */}
      <div class="mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-white mb-2">ANAL! y? tics.</h1>
            <p class="text-gray-400 text-sm">
              last updated: {lastUpdated().toLocaleTimeString()}
            </p>
          </div>
          <button
            onClick={manualRefresh}
            class="px-4 py-2 bg-magenta-600 text-white hover:bg-magenta-700 transition-colors text-sm font-medium"
            disabled={overviewData.loading}
          >
            {overviewData.loading ? "refreshing..." : "refresh"}
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Show when={overviewData()} fallback={<OverviewSkeleton />}>
          {(overview) => (
            <>
              <MetricCard
                title="total events"
                value={formatNumber(overview().total_events)}
                subtitle="all time"
                loading={overviewData.loading}
              />
              <MetricCard
                title="total plays"
                value={formatNumber(overview().total_plays)}
                subtitle="music playback events"
                loading={overviewData.loading}
              />
              <MetricCard
                title="unique users"
                value={formatNumber(overview().unique_users)}
                subtitle="active listeners"
                loading={overviewData.loading}
              />
              <MetricCard
                title="active sessions"
                value={formatNumber(overview().active_sessions)}
                subtitle="current activity"
                loading={overviewData.loading}
              />
            </>
          )}
        </Show>
      </div>

      {/* Main Content Grid */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Songs */}
        <div class="bg-gray-900 p-6">
          <h2 class="text-lg font-semibold text-white mb-4">
            top songs (last week)
          </h2>
          <Show when={topSongsData()} fallback={<TableSkeleton />}>
            {(topSongs) => (
              <div class="space-y-1">
                <For each={topSongs().songs}>
                  {(song, index) => (
                    <SongRow
                      song={song}
                      rank={index() + 1}
                      showPlayCount={true}
                      showCompletionRate={true}
                      showMomentum={true}
                    />
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>

        {/* Trending Songs */}
        <div class="bg-gray-900 p-6">
          <h2 class="text-lg font-semibold text-white mb-4">
            trending (last 24h)
          </h2>
          <Show when={trendingData()} fallback={<TableSkeleton />}>
            {(trending) => (
              <div class="space-y-1">
                <For each={trending().trending_songs}>
                  {(song, index) => (
                    <SongRow
                      song={song}
                      rank={index() + 1}
                      showTrendInfo={true}
                      showCompletionRate={true}
                    />
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>

        {/* Genre Patterns */}
        <div class="bg-gray-900 p-6 lg:col-span-2">
          <h2 class="text-lg font-semibold text-white mb-4">
            genre listening patterns (last 30 days)
          </h2>
          <Show when={genrePatternsData()} fallback={<TableSkeleton />}>
            {(genrePatterns) => (
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <For each={genrePatterns().genre_patterns.slice(0, 9)}>
                  {(genre) => (
                    <div class="bg-gray-800 p-4">
                      <div class="flex items-center justify-between mb-2">
                        <h3 class="text-white font-medium">{genre.genre}</h3>
                        <span
                          class={`text-sm ${getTrendColor(genre.trend_direction)}`}
                        >
                          {getTrendIcon(genre.trend_direction)}
                        </span>
                      </div>
                      <div class="space-y-1 text-sm">
                        <div class="flex justify-between text-gray-300">
                          <span>plays:</span>
                          <span>{formatNumber(genre.total_plays)}</span>
                        </div>
                        <div class="flex justify-between text-gray-300">
                          <span>users:</span>
                          <span>{formatNumber(genre.unique_users)}</span>
                        </div>
                        <div class="flex justify-between text-gray-300">
                          <span>songs:</span>
                          <span>{formatNumber(genre.unique_songs)}</span>
                        </div>
                        <div class="flex justify-between text-gray-300">
                          <span>completion:</span>
                          <span>
                            {formatPercentage(genre.avg_completion_rate)}
                          </span>
                        </div>
                        <div class="flex justify-between text-gray-400 text-xs">
                          <span>rank:</span>
                          <span>#{genre.popularity_rank}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
      </div>

      {/* Footer */}
      <div class="mt-8 pt-6 border-t border-gray-800 text-center text-gray-500 text-xs">
        analytics refreshed every 5 minutes • materialized views updated every 6
        hours
      </div>
    </div>
  );
}

// Helper component for metric cards
function MetricCard(props: {
  title: string;
  value: string;
  subtitle: string;
  loading?: boolean;
}) {
  return (
    <div class="bg-gray-900 p-6">
      <h3 class="text-gray-400 text-sm font-medium mb-2">{props.title}</h3>
      <Show
        when={!props.loading}
        fallback={<div class="h-8 bg-gray-700 animate-pulse" />}
      >
        <div class="text-2xl font-bold text-white mb-1">{props.value}</div>
        <p class="text-gray-500 text-xs">{props.subtitle}</p>
      </Show>
    </div>
  );
}

// Loading skeleton for overview cards
function OverviewSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map(() => (
        <div class="bg-gray-900 p-6">
          <div class="h-4 bg-gray-700 animate-pulse mb-2" />
          <div class="h-8 bg-gray-700 animate-pulse mb-1" />
          <div class="h-3 bg-gray-700 animate-pulse w-1/2" />
        </div>
      ))}
    </>
  );
}

// Loading skeleton for tables
function TableSkeleton() {
  return (
    <div class="space-y-2">
      {Array.from({ length: 5 }).map(() => (
        <div class="flex items-center justify-between py-2 px-3 bg-gray-800">
          <div class="flex items-center space-x-3">
            <div class="w-6 h-4 bg-gray-700 animate-pulse" />
            <div>
              <div class="w-32 h-4 bg-gray-700 animate-pulse mb-1" />
              <div class="w-20 h-3 bg-gray-700 animate-pulse" />
            </div>
          </div>
          <div class="text-right">
            <div class="w-16 h-4 bg-gray-700 animate-pulse mb-1" />
            <div class="w-12 h-3 bg-gray-700 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
