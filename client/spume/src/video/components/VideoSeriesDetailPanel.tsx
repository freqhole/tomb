// reusable video series detail panel — mirrors ArtistDetailPanel.tsx's
// role for ArtistsView.tsx: the right column of VideoSeriesView.tsx's
// two-column layout. previously this content lived only in a standalone
// routed view (VideoSeriesDetailView.tsx); folded in here so the series
// list + detail can live side-by-side like artists/albums do.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { LoadingState } from "../../components/feedback";
import { MediaImage } from "../../components/media/MediaImage";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { Button } from "../../components/buttons/Button";
import { Icon, IconNames, PlayIcon } from "../../components/icons/registry";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { MarqueeText } from "../../components/text/MarqueeText";
import { TagChips } from "../../components/badges/TagChips";
import { TaxonChips } from "../../components/badges/TaxonChips";
import { ShareButton } from "../../components/buttons/ShareButton";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { formatDuration, formatLongDuration } from "../../utils/formatDuration";
import { buildRoute } from "../../music/utils/routing";
import { createCurrentRemoteFull } from "../../app/services/remotes/currentRemoteFull";
import { useVideoSeriesDetailQuery } from "../queries/series";
import { useVideoSeriesAggregateTagsQuery } from "../queries/tags";
import { useVideoSeriesAggregateTaxonsQuery } from "../queries/taxons";
import { videoQueryKeys } from "../queries/queryKeys";
import { useVideoSeriesFavoriteStatuses } from "../hooks/useVideoSeriesFavoriteStatuses";
import { useToggleFavoriteMutation } from "../../music/queries/favorites";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { addVideosToQueue } from "../services/videoQueueActions";
import { useLocalVideoPosterUrl } from "./VideoCard";
import { showEditVideoSeries } from "../hooks/modals";
import { useVideoContextMenu, useVideoSeriesContextMenu } from "../hooks/contextMenu";
import { canUpdateVideo } from "../data/permissions";
import { getVideoDataSource } from "../data";
import {
  formatImageCarouselTitle,
  beginImageCarouselLoading,
  endImageCarouselLoading,
  openImageCarouselFromResolvers,
  type ImageResolveResult,
} from "../../music/hooks/modals";
import {
  resolveBlobUrl,
  usesBlobResolver,
  withThumbSuffix,
  isValidHttpUrl,
} from "../../music/services/storage/blobResolver";
import { getBlobObjectURL } from "../../music/services/storage/blobs";
import type { ImageMetadata } from "../../music/services/storage/types";
import type { VideoSeason, VideoSummary } from "../data/types";

/** a single episode row - thumbnail (with a hover play button), title,
 * duration, and a right-click context menu. clicking the row itself
 * navigates to the episode's detail page; the thumbnail's play button
 * plays it directly (mirrors VideoCard's poster/hover-play split). */
function EpisodeRow(props: {
  video: VideoSummary;
  index: number;
  onPlay: () => void;
  onTagsSaved?: () => void;
}) {
  const navigate = useNavigate();
  const contextMenuActions = createMemo(() =>
    useVideoContextMenu(props.video, { showPlayActions: true, onSave: props.onTagsSaved })
  );
  // mirrors VideoCard.tsx's local-poster handling: a local video's
  // auto-imported poster lives in OPFS (poster_opfs_path), not the
  // reliquary blob store poster_blob_id points at.
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  return (
    <ContextMenu actions={contextMenuActions()}>
      <div
        onClick={() => navigate(buildRoute(`/video/${props.video.id}`))}
        class="flex items-center gap-3 px-2 py-2 rounded cursor-pointer hover:bg-[var(--color-bg-elevated)] transition-colors group"
      >
        <span class="w-8 text-sm text-[var(--color-text-tertiary)] text-right flex-shrink-0">
          {props.video.episode_number ?? props.index + 1}
        </span>
        <div class="relative w-16 h-9 flex-shrink-0 rounded overflow-hidden bg-[var(--color-bg-elevated)]">
          <Show
            when={props.video.source_type === "remote"}
            fallback={
              <Show
                when={localPosterUrl()}
                fallback={
                  <MediaImage
                    blobId={props.video.poster_blob_id}
                    alt={props.video.title}
                    showFallback={true}
                    thumbnailSize={50}
                    domainType="video"
                    objectFit="cover"
                    class="w-full h-full"
                  />
                }
              >
                {(url) => (
                  <img src={url()} alt={props.video.title} class="w-full h-full object-cover" />
                )}
              </Show>
            }
          >
            <MediaImage
              remoteBlobId={props.video.poster_blob_id}
              remoteServerId={props.video.remote_server_id}
              alt={props.video.title}
              showFallback={true}
              thumbnailSize={50}
              domainType="video"
              objectFit="cover"
              class="w-full h-full"
            />
          </Show>
          <div class="absolute inset-0 z-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onPlay();
              }}
              class="w-6 h-6 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center transition-colors"
              title="play episode"
              aria-label="play episode"
            >
              <PlayIcon size={12} className="ml-0.5" />
            </button>
          </div>
        </div>
        <span class="flex-1 min-w-0 truncate text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-500)] transition-colors">
          {props.video.title}
        </span>
        <Show when={props.video.play_count != null && props.video.play_count > 0}>
          <span
            class="text-xs text-[var(--color-text-muted)] flex-shrink-0"
            title={`${props.video.play_count} plays`}
          >
            {props.video.play_count}×
          </span>
        </Show>
        <span class="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
          {formatDuration(props.video.duration_seconds)}
        </span>
      </div>
    </ContextMenu>
  );
}

export interface VideoSeriesDetailPanelProps {
  seriesId: string;
  /** show a mobile back button in a sticky header (mirrors ArtistDetailPanel) */
  showBackButton?: boolean;
  onBack?: () => void;
  /** callback after the series itself is deleted via the context menu */
  onDeleted?: () => void;
  class?: string;
}

export function VideoSeriesDetailPanel(props: VideoSeriesDetailPanelProps) {
  const detailQuery = useVideoSeriesDetailQuery(() => props.seriesId);
  const queryClient = useQueryClient();
  const currentRemoteFull = createCurrentRemoteFull();

  // favorite status for this series (own bulk-status query, mirrors
  // VideoDetailView's single-id useVideoFavoriteStatuses usage).
  const seriesIds = createMemo(() => [props.seriesId]);
  const favoriteStatusQuery = useVideoSeriesFavoriteStatuses(seriesIds);
  const isFavorite = createMemo(() => favoriteStatusQuery.data?.has(props.seriesId) ?? false);
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  const handleFavoriteToggle = (newIsFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "video_series",
      targetId: props.seriesId,
      isFavorite: newIsFavorite,
    });
  };

  const handleTagsSaved = () => {
    void queryClient.invalidateQueries({ queryKey: videoQueryKeys.tags.all() });
  };

  // open image carousel with all of an entity's entity_imagez images,
  // mirroring AlbumDetailView.tsx's handleAlbumImageClick /
  // VideoDetailView.tsx's handleVideoImageClick. shared by the series
  // header image and each season's thumbnail below.
  const openEntityImageCarousel = async (
    entityType: "video_series" | "video_season",
    entityId: string,
    title: string | null | undefined
  ) => {
    beginImageCarouselLoading();

    const seen = new Set<string>();
    const imageItems: Array<{
      localBlobId?: string;
      remoteBlobId?: string;
      serverId?: string;
      url?: string;
    }> = [];

    const addImage = (img: ImageMetadata) => {
      if (img.blob_type === "waveform") return;
      const key = img.remote_blob_id || img.local_blob_id || img.remote_url;
      if (!key || seen.has(key)) return;
      seen.add(key);
      imageItems.push({
        localBlobId: img.local_blob_id,
        remoteBlobId: img.remote_blob_id,
        serverId: img.remote_server_id,
        url: img.remote_url,
      });
    };

    try {
      const dataSource = getVideoDataSource();
      const images =
        (await dataSource.getEntityImages?.({
          entityType,
          entityId,
        })) ?? [];
      for (const img of images) addImage(img);
    } catch (err) {
      console.error(`failed to fetch ${entityType} images:`, err);
    }

    if (imageItems.length === 0) {
      endImageCarouselLoading();
      return;
    }

    const firstWithServerId = imageItems.find((item) => item.serverId);
    const needsResolution = firstWithServerId
      ? await usesBlobResolver(firstWithServerId.serverId!)
      : false;

    // a local blob already on this device wins first (covers the local
    // library / no-remote-selected case, where images never carry a
    // server id at all), then a resolver-backed remote blob, then a
    // plain already-resolved http(s) url.
    const resolveOne = async (item: (typeof imageItems)[number]): Promise<ImageResolveResult> => {
      if (item.localBlobId) {
        const resolved = await getBlobObjectURL(item.localBlobId);
        if (resolved) return { url: resolved };
      }
      if (needsResolution && item.remoteBlobId && item.serverId) {
        try {
          const url = await resolveBlobUrl(item.remoteBlobId, item.serverId, "image");
          return { url };
        } catch {
          // fall through to the url check below
        }
      }
      if (isValidHttpUrl(item.url)) {
        return { url: item.url!, thumbnailUrl: withThumbSuffix(item.url!, 200) };
      }
      return null;
    };

    await openImageCarouselFromResolvers(
      imageItems.map((item) => () => resolveOne(item)),
      {
        title: formatImageCarouselTitle(title),
        entityLabel: title ?? undefined,
      }
    );
  };

  const handleSeriesImageClick = () =>
    openEntityImageCarousel("video_series", props.seriesId, detailQuery.data?.series.title);

  const handleSeasonImageClick = (season: VideoSeason) =>
    openEntityImageCarousel("video_season", season.id, seasonLabel(season));

  const seasons = createMemo((): (VideoSeason & { videos: VideoSummary[] })[] => {
    return detailQuery.data?.seasons ?? [];
  });

  const unassignedVideos = createMemo((): VideoSummary[] => {
    return detailQuery.data?.unassignedVideos ?? [];
  });

  // all episodes across every season plus any season-less videos, in
  // display order - used for the header's play-all/add-all-to-queue
  // actions and the context menu.
  const allVideos = createMemo((): VideoSummary[] => {
    return [...seasons().flatMap((season) => season.videos), ...unassignedVideos()];
  });

  // aggregate tags/taxons: the series' own tags/taxons plus the unique
  // union of every episode's tags/taxons (episodes across all seasons +
  // any season-less videos) - taxons remain remote-only for now (video
  // taxons have no local/indexeddb storage yet, see useVideoTaxonsQuery).
  const allVideoIds = createMemo(() => allVideos().map((v) => v.id));
  const totalDurationSeconds = createMemo(() =>
    allVideos().reduce((sum, v) => sum + (v.duration_seconds ?? 0), 0)
  );
  const aggregateTagsQuery = useVideoSeriesAggregateTagsQuery(() => props.seriesId, allVideoIds);
  const aggregateTaxonsQuery = useVideoSeriesAggregateTaxonsQuery(
    () => props.seriesId,
    allVideoIds
  );

  // seasons expanded/collapsed by id - all seasons expanded by default.
  // reset whenever the selected series changes so a stale season id from
  // the previous series doesn't linger in the expanded set.
  const [expandedSeasonIds, setExpandedSeasonIds] = createSignal<Set<string>>(new Set());

  createEffect(() => {
    props.seriesId;
    setExpandedSeasonIds(new Set<string>());
  });

  createEffect(() => {
    const list = seasons();
    if (list.length > 0 && expandedSeasonIds().size === 0) {
      setExpandedSeasonIds(new Set(list.map((season) => season.id)));
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
    // source is required so a history entry is created and watch-progress
    // tracking starts (without it, position never resumes on reload).
    await playVideoQueue(season.videos, index, {
      type: "season",
      label: season.title ?? `season ${season.season_number}`,
      entity_id: season.id,
    });
  };

  const handleUnassignedClick = async (index: number) => {
    const series = detailQuery.data?.series;
    await playVideoQueue(unassignedVideos(), index, {
      type: "series",
      label: series?.title ?? "series",
      entity_id: series?.id,
    });
  };

  // tracks which of play-all/add-all-to-queue is currently fetching +
  // queueing videos, mirrors AlbumDetailView's albumActionPending pattern.
  const [seriesActionPending, setSeriesActionPending] = createSignal<"play" | "queue" | null>(null);

  const handlePlayAll = async () => {
    if (seriesActionPending()) return;
    const videos = allVideos();
    if (videos.length === 0) return;
    setSeriesActionPending("play");
    try {
      const series = detailQuery.data?.series;
      await playVideoQueue(videos, 0, {
        type: "series",
        label: series?.title ?? "series",
        entity_id: series?.id,
      });
    } finally {
      setSeriesActionPending(null);
    }
  };

  const handleAddAllToQueue = async () => {
    if (seriesActionPending()) return;
    const videos = allVideos();
    if (videos.length === 0) return;
    setSeriesActionPending("queue");
    try {
      await addVideosToQueue(videos);
    } finally {
      setSeriesActionPending(null);
    }
  };

  const seriesContextMenuActions = createMemo(() => {
    const series = detailQuery.data?.series;
    if (!series) return [];
    return useVideoSeriesContextMenu(series, allVideos(), {
      isFavorite: isFavorite(),
      onDeleted: props.onDeleted,
    });
  });

  const seasonLabel = (season: VideoSeason) => season.title || `season ${season.season_number}`;

  return (
    <div class={`flex flex-col h-full ${props.class || ""}`}>
      {/* sticky header with back button for mobile - only meaningful once
          data has loaded (mirrors ArtistDetailPanel's back-button header) */}
      <Show when={props.showBackButton && detailQuery.data}>
        {(data) => (
          <HeadingSection
            title={data().series.title}
            titleElement={<MarqueeText text={data().series.title} hoverOnly={true} />}
            variant="detail"
            sticky
            showBackButton={props.showBackButton}
            onBack={props.onBack}
            class="px-4 py-3 wide:hidden"
          />
        )}
      </Show>

      <div class="flex-1 overflow-auto">
        <Show
          when={!detailQuery.isError}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
              <p class="text-lg text-[var(--color-text-secondary)]">failed to load series</p>
              <p class="text-sm text-[var(--color-text-tertiary)]">
                {detailQuery.error instanceof Error ? detailQuery.error.message : "unknown error"}
              </p>
            </div>
          }
        >
          <Show
            when={!detailQuery.isLoading}
            fallback={
              <div class="flex items-center justify-center h-full">
                <LoadingState text="loading series..." />
              </div>
            }
          >
            <Show
              when={detailQuery.data}
              fallback={
                <div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
                  <p class="text-lg text-[var(--color-text-secondary)]">series not found</p>
                  <p class="text-sm text-[var(--color-text-tertiary)]">
                    it may have been deleted, or the link is stale
                  </p>
                </div>
              }
            >
              {(data) => (
                <>
                  {/* header: poster + title + description */}
                  <div class="flex gap-4 wide:gap-6 p-4 wide:p-6">
                    <ContextMenu actions={seriesContextMenuActions()}>
                      <div
                        class={`w-48 wide:w-96 aspect-video rounded-lg flex-shrink-0 overflow-hidden cursor-pointer ${
                          data().series.poster_blob_id ? "" : "bg-[var(--color-bg-elevated)]"
                        }`}
                        title="view series images"
                        onClick={handleSeriesImageClick}
                      >
                        <MediaImage
                          blobId={data().series.poster_blob_id}
                          remoteBlobId={data().series.poster_blob_id}
                          remoteServerId={data().series.remote_server_id}
                          alt={data().series.title}
                          showFallback={true}
                          thumbnailSize={200}
                          domainType="video_series"
                          objectFit="contain"
                          class="w-full h-full"
                        />
                      </div>
                    </ContextMenu>
                    <div class="flex flex-col min-w-0 justify-center">
                      <h1 class="text-2xl wide:text-4xl font-bold text-[var(--color-text-primary)] truncate">
                        {data().series.title}
                      </h1>
                      <Show when={data().series.description}>
                        <p class="mt-2 text-sm text-[var(--color-text-secondary)] wide:max-w-2xl">
                          {data().series.description}
                        </p>
                      </Show>

                      <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
                        <Show when={seasons().length > 0}>
                          <span>
                            {seasons().length} {seasons().length === 1 ? "season" : "seasons"}
                          </span>
                          <span>•</span>
                        </Show>
                        <span>
                          {allVideos().length} {allVideos().length === 1 ? "episode" : "episodes"}
                        </span>
                        <Show when={totalDurationSeconds() > 0}>
                          <span>•</span>
                          <span>{formatLongDuration(totalDurationSeconds())}</span>
                        </Show>
                      </div>

                      <TaxonChips
                        taxons={aggregateTaxonsQuery.data}
                        class="mt-2"
                        excludeKinds={["genre", "mood", "style", "era", "label"]}
                      />

                      <TagChips tags={aggregateTagsQuery.data} class="mt-2" />

                      <div class="mt-3 flex items-center gap-2">
                        <Button
                          variant="primary"
                          loading={seriesActionPending() === "play"}
                          disabled={seriesActionPending() !== null || allVideos().length === 0}
                          onClick={handlePlayAll}
                        >
                          <span class="hidden wide:inline">play all</span>
                          <span class="wide:hidden">play</span>
                        </Button>
                        <Button
                          variant="ghost"
                          loading={seriesActionPending() === "queue"}
                          disabled={seriesActionPending() !== null || allVideos().length === 0}
                          onClick={handleAddAllToQueue}
                          title="add all episodes to queue"
                          aria-label="add all episodes to queue"
                        >
                          <span class="hidden wide:inline">+queue</span>
                          <span class="wide:hidden inline-flex items-center">
                            <Icon name={IconNames.queue} />
                          </span>
                        </Button>
                        <Show when={canUpdateVideo()}>
                          <button
                            onClick={() => showEditVideoSeries({ seriesId: data().series.id })}
                            class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                            title="edit series info"
                            aria-label="edit series info"
                          >
                            <Icon name={IconNames.edit} />
                          </button>
                        </Show>
                        <FavoriteHeart isFavorite={isFavorite()} onToggle={handleFavoriteToggle} />
                        <ShareButton
                          target={{
                            kind: "video_series",
                            id: data().series.id,
                            displayTitle: data().series.title,
                          }}
                          source={currentRemoteFull}
                        />
                      </div>
                    </div>
                  </div>

                  {/* seasons + any season-less ("extras") videos */}
                  <div class="px-4 wide:px-6 pb-4 space-y-4">
                    <For each={seasons()}>
                      {(season) => {
                        const isExpanded = () => expandedSeasonIds().has(season.id);
                        return (
                          <div>
                            <button
                              onClick={() => toggleSeason(season.id)}
                              class="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-[var(--color-bg-elevated)] transition-colors text-left"
                            >
                              <Show when={season.poster_blob_id}>
                                <div
                                  class="w-10 h-10 rounded overflow-hidden bg-[var(--color-bg-elevated)] flex-shrink-0 cursor-pointer"
                                  title="view season images"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleSeasonImageClick(season);
                                  }}
                                >
                                  <MediaImage
                                    blobId={season.poster_blob_id}
                                    remoteBlobId={season.poster_blob_id}
                                    remoteServerId={season.remote_server_id}
                                    alt={seasonLabel(season)}
                                    showFallback={true}
                                    thumbnailSize={50}
                                    domainType="video_season"
                                    class="w-full h-full object-cover"
                                  />
                                </div>
                              </Show>
                              <span class="flex-1 font-medium text-[var(--color-text-primary)]">
                                {seasonLabel(season)}
                              </span>
                              <Icon
                                name={isExpanded() ? IconNames.chevronUp : IconNames.chevronDown}
                                className="text-[var(--color-text-secondary)] flex-shrink-0"
                              />
                            </button>
                            <Show when={isExpanded()}>
                              <Show when={season.description}>
                                <p class="px-2 pt-1 text-xs text-[var(--color-text-tertiary)]">
                                  {season.description}
                                </p>
                              </Show>
                              <div class="space-y-1 mt-1">
                                <For each={season.videos}>
                                  {(video, index) => (
                                    <EpisodeRow
                                      video={video}
                                      index={index()}
                                      onPlay={() => handleEpisodeClick(season, index())}
                                      onTagsSaved={handleTagsSaved}
                                    />
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

                    {/* videos attached directly to the series with no
                        season - previously silently dropped (see
                        useVideoSeriesDetailQuery's comment). */}
                    <Show when={unassignedVideos().length > 0}>
                      <div>
                        <div class="px-2 py-2 font-medium text-[var(--color-text-primary)]">
                          {seasons().length > 0 ? "extras" : "episodes"}
                        </div>
                        <div class="space-y-1 mt-1">
                          <For each={unassignedVideos()}>
                            {(video, index) => (
                              <EpisodeRow
                                video={video}
                                index={index()}
                                onPlay={() => handleUnassignedClick(index())}
                                onTagsSaved={handleTagsSaved}
                              />
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <Show when={seasons().length === 0 && unassignedVideos().length === 0}>
                      <div class="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
                        no episodes yet
                      </div>
                    </Show>
                  </div>
                </>
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
