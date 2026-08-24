// video series detail view - series header + expandable season/episode list
import { useParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { DetailViewWrapper } from "../../components/layout/DetailViewWrapper";
import { LoadingState } from "../../components/feedback";
import { MediaImage } from "../../components/media/MediaImage";
import { Icon, IconNames } from "../../components/icons/registry";
import { formatDuration } from "../../utils/formatDuration";
import { useVideoSeriesDetailQuery } from "../queries/series";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import type { VideoSeason, VideoSummary } from "../data/types";

export function VideoSeriesDetailView() {
  const params = useParams<{ id: string }>();
  const detailQuery = useVideoSeriesDetailQuery(() => params.id);

  const seasons = createMemo((): (VideoSeason & { videos: VideoSummary[] })[] => {
    return detailQuery.data?.seasons ?? [];
  });

  // seasons expanded/collapsed by id - first season expanded by default
  const [expandedSeasonIds, setExpandedSeasonIds] = createSignal<Set<string>>(new Set());

  createEffect(() => {
    const list = seasons();
    if (list.length > 0 && expandedSeasonIds().size === 0) {
      setExpandedSeasonIds(new Set([list[0].id]));
    }
  });

  const toggleSeason = (seasonId: string) => {
    setExpandedSeasonIds((prev) => {
      const next = new Set(prev);
      if (next.has(seasonId)) {
        next.delete(seasonId);
      } else {
        next.add(seasonId);
      }
      return next;
    });
  };

  const handleEpisodeClick = async (
    season: VideoSeason & { videos: VideoSummary[] },
    index: number
  ) => {
    await playVideoQueue(season.videos, index);
  };

  const seasonLabel = (season: VideoSeason) => season.title || `season ${season.season_number}`;

  return (
    <DetailViewWrapper pageTitle="series" pageCount={seasons().length} onBack="/video/series">
      <div class="flex flex-col h-full">
        <Show
          when={detailQuery.data}
          fallback={<LoadingState class="flex-1" text="loading series..." />}
        >
          {(data) => (
            <>
              {/* header: poster + title + description */}
              <div class="flex gap-4 wide:gap-6 p-4 wide:p-6">
                <div class="w-32 h-32 wide:w-64 wide:h-64 bg-[var(--color-bg-elevated)] rounded-lg flex-shrink-0 overflow-hidden">
                  <MediaImage
                    blobId={data().series.poster_blob_id}
                    alt={data().series.title}
                    showFallback={true}
                    thumbnailSize={200}
                    class="w-full h-full object-cover"
                  />
                </div>
                <div class="flex flex-col min-w-0 justify-center">
                  <h1 class="text-2xl wide:text-4xl font-bold text-[var(--color-text-primary)] truncate">
                    {data().series.title}
                  </h1>
                  <Show when={data().series.description}>
                    <p class="mt-2 text-sm text-[var(--color-text-secondary)] wide:max-w-2xl">
                      {data().series.description}
                    </p>
                  </Show>
                </div>
              </div>

              {/* seasons */}
              <div class="flex-1 overflow-auto px-4 wide:px-6 pb-4 space-y-4">
                <For each={seasons()}>
                  {(season) => {
                    const isExpanded = () => expandedSeasonIds().has(season.id);
                    return (
                      <div>
                        <button
                          onClick={() => toggleSeason(season.id)}
                          class="w-full flex items-center justify-between px-2 py-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors text-left"
                        >
                          <span class="font-medium text-[var(--color-text-primary)]">
                            {seasonLabel(season)}
                          </span>
                          <Icon
                            name={isExpanded() ? IconNames.chevronUp : IconNames.chevronDown}
                            className="text-[var(--color-text-secondary)]"
                          />
                        </button>
                        <Show when={isExpanded()}>
                          <div class="space-y-1 mt-1">
                            <For each={season.videos}>
                              {(video, index) => (
                                <div
                                  onClick={() => handleEpisodeClick(season, index())}
                                  class="flex items-center gap-3 px-2 py-2 rounded cursor-pointer hover:bg-[var(--color-bg-elevated)] transition-colors group"
                                >
                                  <span class="w-8 text-sm text-[var(--color-text-tertiary)] text-right flex-shrink-0">
                                    {video.episode_number ?? index() + 1}
                                  </span>
                                  <span class="flex-1 min-w-0 truncate text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-500)] transition-colors">
                                    {video.title}
                                  </span>
                                  <span class="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                                    {formatDuration(video.duration_seconds)}
                                  </span>
                                </div>
                              )}
                            </For>
                            <Show when={season.videos.length === 0}>
                              <div class="px-2 py-2 text-sm text-[var(--color-text-tertiary)]">
                                no episodes
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
                <Show when={seasons().length === 0}>
                  <div class="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
                    no seasons found
                  </div>
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </DetailViewWrapper>
  );
}
