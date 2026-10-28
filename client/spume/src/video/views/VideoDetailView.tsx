// video detail view - mirrors AlbumDetailView.tsx's shape (see
// music/views/AlbumDetailView.tsx) for a single video: poster in a
// flex-shrink-0 box on the right, info column first/left, taxon chips,
// and responsive action buttons.
import { useNavigate, useParams } from "@solidjs/router";
import { createSignal, createMemo, createEffect, createResource, For, Show } from "solid-js";
import { DetailViewWrapper } from "../../components/layout/DetailViewWrapper";
import { OfflineBadge } from "../../components/badges/OfflineBadge";
import { MediaImage } from "../../components/media/MediaImage";
import { Button } from "../../components/buttons/Button";
import { PlayWithStreamButton } from "../../components/buttons/PlayWithStreamButton";
import type { RequestQueueItem } from "../../components/radio/requestStation";
import { isVideoAlreadyLocal } from "../services/syncState";
import { LoadingState } from "../../components/feedback";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { Icon, IconNames } from "../../components/icons/registry";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { Rating } from "../../components/ratings/Rating";
import { ShareButton } from "../../components/buttons/ShareButton";
import {
  ResponsiveActionBar,
  type ActionBarItem,
} from "../../components/overlays/ResponsiveActionBar";
import type { SendVideoPayload } from "../services/send/sendVideoToRemote";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { createShareSourceRemote } from "../../app/services/remotes/shareSource";
import { formatDuration } from "../../utils/formatDuration";
import { buildRoute } from "../../music/utils/routing";
import { TaxonChips } from "../../components/badges/TaxonChips";
import { TagChips } from "../../components/badges/TagChips";
import { useVideoQuery, useVideoExtrasQuery } from "../queries/videos";
import { resumePositionFor, useVideoProgressQuery } from "../queries/progress";
import { useVideoTaxonsQuery } from "../queries/taxons";
import { useVideoEntityTagsQuery } from "../queries/tags";
import { videoQueryKeys } from "../queries/queryKeys";
import { useQueryClient } from "@tanstack/solid-query";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { addVideoToQueue } from "../services/videoQueueActions";
import { useLocalVideoPosterUrl } from "../components/VideoCard";
import { VideoListRow } from "../components/VideoListRow";
import { useToggleFavoriteMutation } from "../../music/queries/favorites";
import { useSetRatingMutation } from "../../music/queries/ratings";
import { useVideoFavoriteStatuses } from "../hooks/useVideoFavoriteStatuses";
import { useVideoRatingStatuses } from "../hooks/useVideoRatingStatuses";
import { useVideoContextMenu } from "../hooks/contextMenu";
import { spliceStreamMenuActions } from "../hooks/useVideoStreamContextMenuActions";
import { useStreamFlyoutActions } from "../../components/radio/useStreamFlyoutActions";
import { showEditVideo } from "../hooks/modals";
import { showShareModal } from "../../music/hooks/modals";
import { showStationSelector } from "../../music/hooks/stationSelectorState";
import { canUpdateVideo } from "../data/permissions";
import { getVideoDataSource } from "../data";
import { getCurrentRemote } from "../../music/data";
import { useArtistQuery, useAlbumQuery } from "../../music/queries/songs";
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
import type { VideoSummary } from "../data/types";

export function VideoDetailView() {
  const params = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const videoQuery = useVideoQuery(() => params.videoId);
  const taxonsQuery = useVideoTaxonsQuery(() => params.videoId);
  const tagsQuery = useVideoEntityTagsQuery("video", () => params.videoId);
  const queryClient = useQueryClient();

  // open image carousel with all of this video's entity_imagez images
  // (poster + any additional gallery images), mirroring
  // AlbumDetailView.tsx's handleAlbumImageClick.
  const handleVideoImageClick = async () => {
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
          entityType: "video",
          entityId: params.videoId,
        })) ?? [];
      for (const img of images) addImage(img);
    } catch (err) {
      console.error("failed to fetch video images:", err);
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
        title: formatImageCarouselTitle(videoQuery.data?.title),
        entityLabel: videoQuery.data?.title,
      }
    );
  };

  const [playPending, setPlayPending] = createSignal(false);
  const [queuePending, setQueuePending] = createSignal(false);
  const currentRemoteFull = createShareSourceRemote();

  // lightweight by-id display-name lookups, for the share payload only -
  // this view otherwise only ever needs artist_id/album_id/series_id (for
  // icon-only "view artist"/"view album"/"view series" nav buttons, no
  // label text), so there's no reason to extend the video query's own
  // response shape just to carry names nobody else here needs.
  const shareRemote = () => currentRemoteFull() ?? undefined;
  const shareArtistQuery = useArtistQuery(() => videoQuery.data?.artist_id ?? undefined, shareRemote);
  const shareAlbumQuery = useAlbumQuery(() => videoQuery.data?.album_id ?? undefined, shareRemote);
  const [shareSeriesTitle] = createResource(
    () => videoQuery.data?.series_id ?? undefined,
    async (seriesId) => {
      const series = await getVideoDataSource().getVideoSeriesById(seriesId);
      return series?.title;
    }
  );

  // build a SendVideoPayload for the share modal's send-to-remote section -
  // VideoSummary spreads directly into QueuedVideo (see QueuedVideo's own
  // doc comment), so no per-field mapping is needed here.
  const buildSendPayload = (): SendVideoPayload => {
    const v = videoQuery.data!;
    return {
      kind: "video",
      videos: [{ video: v as QueuedVideo, blobId: v.media_blob_id, blake3: v.blake3 ?? null }],
    };
  };

  // favorite status query for this video
  const videoIds = createMemo(() => {
    const id = params.videoId;
    return id ? [id] : [];
  });
  const favoriteStatusesQuery = useVideoFavoriteStatuses(videoIds);
  const isFavorite = createMemo(() => {
    const id = params.videoId;
    return id ? (favoriteStatusesQuery.data?.has(id) ?? false) : false;
  });

  // rating status query for this video - hydrates the viewer's own
  // existing rating (if any) instead of always starting unrated.
  const ratingStatusesQuery = useVideoRatingStatuses(videoIds);
  const [userRating, setUserRating] = createSignal(0);
  createEffect(() => {
    const id = params.videoId;
    const rating = id ? ratingStatusesQuery.data?.get(id) : undefined;
    setUserRating(rating ?? 0);
  });

  // mutations
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  const setRatingMutation = useSetRatingMutation();

  // handle favorite toggle
  const handleFavoriteToggle = (newIsFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "video",
      targetId: params.videoId,
      isFavorite: newIsFavorite,
    });
  };

  // handle rating change
  const handleRatingChange = (rating: number) => {
    setRatingMutation.mutate(
      {
        targetType: "video",
        targetId: params.videoId,
        rating,
      },
      {
        onSuccess: () => {
          setUserRating(rating);
        },
      }
    );
  };

  const localPosterUrl = useLocalVideoPosterUrl(() => {
    const v = videoQuery.data;
    return v && v.source_type === "local" ? v.poster_opfs_path : null;
  });

  const releaseYear = () => {
    const date = videoQuery.data?.release_date;
    if (!date) return null;
    const year = parseInt(date.substring(0, 4), 10);
    return Number.isNaN(year) ? null : year;
  };

  // playback progress for this one video - drives the "resume" button
  // label + seek-on-play below. `groupId` just scopes the query cache
  // entry (see queries/progress.ts's doc comment) - a single movie has
  // no series to group by, so its own id is as good a scope as any.
  const progressVideos = createMemo(() => (videoQuery.data ? [videoQuery.data] : []));
  const progressQuery = useVideoProgressQuery(() => videoQuery.data?.id, progressVideos);

  // seconds to resume at, or `undefined` when there's nothing worth
  // resuming (no progress yet, or already watched past
  // COMPLETED_PROGRESS_THRESHOLD - a finished movie just plays from the
  // start, same as before this existed, rather than seeking to near the
  // end).
  const resumePosition = createMemo((): number | undefined => {
    const video = videoQuery.data;
    if (!video) return undefined;
    return resumePositionFor(video.id, progressQuery.data ?? new Map());
  });

  const handlePlay = async () => {
    const video = videoQuery.data;
    if (!video || playPending()) return;
    setPlayPending(true);
    try {
      // source is required so a history entry is created and watch-progress
      // tracking starts (without it, position never resumes on reload).
      await playVideoQueue(
        [video],
        0,
        { type: "video", label: video.title, entity_id: video.id },
        resumePosition()
      );
    } finally {
      setPlayPending(false);
    }
  };

  const handleAddToQueue = async () => {
    const video = videoQuery.data;
    if (!video || queuePending()) return;
    setQueuePending(true);
    try {
      await addVideoToQueue(video, { type: "video", label: video.title, entity_id: video.id });
    } finally {
      setQueuePending(false);
    }
  };

  // item resolver for the play button's stream caret (see
  // PlayWithStreamButton.tsx) - single video, resume-aware (same source
  // handlePlay's own playVideoQueue call already uses).
  const resolveStreamItems = async (): Promise<RequestQueueItem[] | null> => {
    const video = videoQuery.data;
    if (!video) return null;
    return [{ kind: "video", itemId: video.id, startPositionSeconds: resumePosition() }];
  };
  // no file-access problem to solve once the video's already available
  // locally (a genuine local import, or a remote video already synced
  // down, or we're not even connected to a remote at all) - hides the
  // whole caret (see isVideoAlreadyLocal's doc comment).
  const isAlreadyLocal = () => {
    const video = videoQuery.data;
    return !!video && isVideoAlreadyLocal(video);
  };

  // secondary actions for the narrow/mobile layout's responsive action
  // bar - ordered by priority (first collapses last, into the "..."
  // overflow menu, as the container runs out of horizontal room). the
  // primary play/resume button and favorite toggle stay pinned (never
  // collapse) - see the narrow layout's own JSX below.
  const narrowActionItems = createMemo((): ActionBarItem[] => {
    const video = videoQuery.data;
    if (!video) return [];
    const items: ActionBarItem[] = [];

    items.push({
      key: "queue",
      render: () => (
        <Button
          variant="ghost"
          loading={queuePending()}
          onClick={() => void handleAddToQueue()}
          title="add video to queue"
          aria-label="add video to queue"
        >
          <Icon name={IconNames.queue} />
        </Button>
      ),
      action: {
        label: "add to queue",
        icon: "queue",
        onClick: () => void handleAddToQueue(),
      },
    });

    if (video.series_id) {
      const seriesId = video.series_id;
      items.push({
        key: "view-series",
        render: () => (
          <Button
            variant="ghost"
            onClick={() => navigate(buildRoute(`/video/series/${seriesId}`))}
            title="view series"
            aria-label="view series"
          >
            <Icon name={IconNames.video} />
          </Button>
        ),
        action: {
          label: "view series",
          icon: "video",
          onClick: () => navigate(buildRoute(`/video/series/${seriesId}`)),
        },
      });
    }

    if (video.artist_id) {
      const artistId = video.artist_id;
      items.push({
        key: "view-artist",
        render: () => (
          <Button
            variant="ghost"
            onClick={() => navigate(buildRoute(`/artists/${artistId}`))}
            title="view artist"
            aria-label="view artist"
          >
            <Icon name={IconNames.artist} />
          </Button>
        ),
        action: {
          label: "view artist",
          icon: "artist",
          onClick: () => navigate(buildRoute(`/artists/${artistId}`)),
        },
      });
    }

    if (video.album_id) {
      const albumId = video.album_id;
      items.push({
        key: "view-album",
        render: () => (
          <Button
            variant="ghost"
            onClick={() => navigate(buildRoute(`/albums/${albumId}`))}
            title="view album"
            aria-label="view album"
          >
            <Icon name={IconNames.album} />
          </Button>
        ),
        action: {
          label: "view album",
          icon: "album",
          onClick: () => navigate(buildRoute(`/albums/${albumId}`)),
        },
      });
    }

    if (canUpdateVideo()) {
      items.push({
        key: "edit",
        render: () => (
          <button
            onClick={() =>
              showEditVideo({
                videoId: video.id,
                onDeleted: () => navigate(buildRoute("/video")),
              })
            }
            class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
            title="edit video info"
            aria-label="edit video info"
          >
            <Icon name={IconNames.edit} />
          </button>
        ),
        action: {
          label: "edit video info",
          icon: "edit",
          onClick: () =>
            showEditVideo({
              videoId: video.id,
              onDeleted: () => navigate(buildRoute("/video")),
            }),
        },
      });
    }

    const shareTarget = {
      kind: "video" as const,
      id: video.id,
      displayTitle: video.title,
      artistName: shareArtistQuery.data?.name || undefined,
      albumName: shareAlbumQuery.data?.title || undefined,
      seriesTitle: shareSeriesTitle() || undefined,
      contentType: video.content_type || undefined,
    };
    items.push({
      key: "share",
      render: () => (
        <ShareButton
          target={shareTarget}
          source={currentRemoteFull}
          buildSendPayload={buildSendPayload}
        />
      ),
      action: {
        label: "share",
        icon: "share",
        onClick: () =>
          showShareModal({
            target: shareTarget,
            source: currentRemoteFull,
            buildSendPayload,
          }),
      },
    });

    items.push({
      key: "station",
      render: () => (
        <button
          onClick={() =>
            void showStationSelector(
              { kind: "video", videoId: video.id, videoTitle: video.title },
              video.remote_server_id ?? undefined
            )
          }
          class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
          title="add to station..."
          aria-label="add to station..."
        >
          <Icon name={IconNames.headphones} />
        </button>
      ),
      action: {
        label: "add to station...",
        icon: "headphones",
        onClick: () =>
          void showStationSelector(
            { kind: "video", videoId: video.id, videoTitle: video.title },
            video.remote_server_id ?? undefined
          ),
      },
    });

    return items;
  });

  // context menu for the poster (play/queue/favorite/edit/delete parity
  // with the grid/table context menus elsewhere in the video domain) -
  // shares the play button's own resolveStreamItems/isAlreadyLocal, so
  // its "stream on X" entry always agrees with the play button's caret.
  const posterStreamFlyout = useStreamFlyoutActions({
    remote: currentRemoteFull,
    resolveStreamItems,
    streamLabel: () => `video "${videoQuery.data?.title ?? ""}"`,
    alreadyLocal: isAlreadyLocal,
  });
  const videoContextMenuActions = createMemo(() => {
    const video = videoQuery.data;
    if (!video) return [];
    const base = useVideoContextMenu(video, {
      isFavorite: isFavorite(),
      showPlayActions: true,
      onDeleted: () => navigate(buildRoute("/video")),
      onSave: () => {
        void queryClient.invalidateQueries({ queryKey: videoQueryKeys.tags.all() });
      },
    });
    return spliceStreamMenuActions(base, posterStreamFlyout.menuActions());
  });

  return (
    <DetailViewWrapper
      pageTitle="video"
      documentTitle={videoQuery.data?.title}
      onBack={buildRoute("/video")}
    >
      <div class="flex flex-col h-full overflow-y-auto">
        <Show when={videoQuery.data} fallback={<LoadingState class="flex-1" />}>
          {(video) => (
            <>
              {/* MOBILE: poster on top, info centered below (mirrors
                  ArtistDetailPanel's mobile layout) */}
              <div class="wide:hidden flex flex-col items-center gap-3 p-4">
                <ContextMenu actions={videoContextMenuActions()}>
                  <div
                    class={`w-48 aspect-video rounded-lg overflow-hidden flex-shrink-0 cursor-pointer ${
                      (video().source_type === "remote" ? video().poster_blob_id : localPosterUrl())
                        ? ""
                        : "bg-[var(--color-bg-base)]"
                    }`}
                    title="view video images"
                    onClick={handleVideoImageClick}
                  >
                    <Show
                      when={video().source_type === "remote"}
                      fallback={
                        <Show when={localPosterUrl()} fallback={<div class="w-full h-full" />}>
                          {(url) => (
                            <img
                              src={url()}
                              alt={video().title}
                              class="w-full h-full object-contain"
                            />
                          )}
                        </Show>
                      }
                    >
                      <MediaImage
                        remoteBlobId={video().poster_blob_id}
                        remoteServerId={video().remote_server_id}
                        alt={video().title}
                        showFallback={true}
                        thumbnailSize={200}
                        domainType="video"
                        objectFit="contain"
                        class="w-full h-full"
                      />
                    </Show>
                  </div>
                </ContextMenu>

                <div class="flex flex-col items-center text-center w-full min-w-0">
                  <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
                    {video().title}
                  </h1>

                  <div class="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-secondary)]">
                    <OfflineBadge isOffline={video().is_offline} />
                    <Show when={releaseYear()}>{(year) => <span>{year()}</span>}</Show>
                    <Show when={video().episode_number != null}>
                      <span>episode {video().episode_number}</span>
                    </Show>
                    <Show when={video().duration_seconds != null}>
                      <span>{formatDuration(video().duration_seconds)}</span>
                    </Show>
                    <Show when={video().play_count != null && video().play_count! > 0}>
                      <span>
                        {video().play_count} {video().play_count === 1 ? "play" : "plays"}
                      </span>
                    </Show>
                  </div>

                  <TaxonChips
                    taxons={taxonsQuery.data}
                    class="mt-2 justify-center"
                  />

                  <TagChips tags={tagsQuery.data} class="mt-2 justify-center" />

                  <Show when={video().description}>
                    <p class="mt-2 text-sm text-[var(--color-text-secondary)] max-w-prose">
                      {video().description}
                    </p>
                  </Show>

                  <div class="mt-3 flex items-center justify-center">
                    <ResponsiveActionBar
                      class="justify-center"
                      items={narrowActionItems()}
                      pinnedStart={() => (
                        <>
                          <PlayWithStreamButton
                            label={resumePosition() != null ? "resume" : "play"}
                            loading={playPending()}
                            onClick={() => void handlePlay()}
                            remote={currentRemoteFull}
                            resolveStreamItems={resolveStreamItems}
                            streamLabel={`video "${video().title}"`}
                            alreadyLocal={isAlreadyLocal}
                          />
                          <FavoriteHeart isFavorite={isFavorite()} onToggle={handleFavoriteToggle} />
                        </>
                      )}
                      pinnedEnd={() => (
                        <Rating rating={userRating()} size="md" onRatingChange={handleRatingChange} />
                      )}
                    />
                  </div>
                </div>
              </div>

              {/* DESKTOP: info left, poster right */}
              <div class="hidden wide:flex justify-between gap-6 p-6">
                {/* extra top clearance below the wide-breakpoint floating nav pill (which doesn't reserve layout space) */}
                <div class="flex flex-col justify-center min-w-0 mt-20 gap-2 text-left">
                  <h1 class="text-5xl font-bold text-[var(--color-text-primary)]">
                    {video().title}
                  </h1>

                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--color-text-secondary)]">
                    <OfflineBadge isOffline={video().is_offline} />
                    <Show when={releaseYear()}>{(year) => <span>{year()}</span>}</Show>
                    <Show when={video().episode_number != null}>
                      <span>episode {video().episode_number}</span>
                    </Show>
                    <Show when={video().duration_seconds != null}>
                      <span>{formatDuration(video().duration_seconds)}</span>
                    </Show>
                    <Show when={video().play_count != null && video().play_count! > 0}>
                      <span>
                        {video().play_count} {video().play_count === 1 ? "play" : "plays"}
                      </span>
                    </Show>
                  </div>

                  <TaxonChips
                    taxons={taxonsQuery.data}
                    class="mt-2"
                  />

                  <TagChips tags={tagsQuery.data} class="mt-2" />

                  <Show when={video().description}>
                    <p class="mt-2 text-sm text-[var(--color-text-secondary)] max-w-prose">
                      {video().description}
                    </p>
                  </Show>

                  <div class="mt-3 flex items-center gap-2">
                    <PlayWithStreamButton
                      label={resumePosition() != null ? "resume video" : "play video"}
                      loading={playPending()}
                      onClick={() => void handlePlay()}
                      remote={currentRemoteFull}
                      resolveStreamItems={resolveStreamItems}
                      streamLabel={`video "${video().title}"`}
                      alreadyLocal={isAlreadyLocal}
                    />
                    <Button
                      variant="ghost"
                      loading={queuePending()}
                      onClick={() => void handleAddToQueue()}
                      title="add video to queue"
                      aria-label="add video to queue"
                    >
                      +queue
                    </Button>
                    <Show when={video().series_id}>
                      <Button
                        variant="ghost"
                        onClick={() => navigate(buildRoute(`/video/series/${video().series_id}`))}
                        title="view series"
                        aria-label="view series"
                      >
                        view series
                      </Button>
                    </Show>
                    <Show when={video().artist_id}>
                      <Button
                        variant="ghost"
                        onClick={() => navigate(buildRoute(`/artists/${video().artist_id}`))}
                        title="view artist"
                        aria-label="view artist"
                      >
                        view artist
                      </Button>
                    </Show>
                    <Show when={video().album_id}>
                      <Button
                        variant="ghost"
                        onClick={() => navigate(buildRoute(`/albums/${video().album_id}`))}
                        title="view album"
                        aria-label="view album"
                      >
                        view album
                      </Button>
                    </Show>
                    <Show when={canUpdateVideo()}>
                      <button
                        onClick={() =>
                          showEditVideo({
                            videoId: video().id,
                            onDeleted: () => navigate(buildRoute("/video")),
                          })
                        }
                        class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                        title="edit video info"
                        aria-label="edit video info"
                      >
                        <Icon name={IconNames.edit} />
                      </button>
                    </Show>
                    <FavoriteHeart isFavorite={isFavorite()} onToggle={handleFavoriteToggle} />
                    <ShareButton
                      target={{
                        kind: "video",
                        id: video().id,
                        displayTitle: video().title,
                        artistName: shareArtistQuery.data?.name || undefined,
                        albumName: shareAlbumQuery.data?.title || undefined,
                        seriesTitle: shareSeriesTitle() || undefined,
                        contentType: video().content_type || undefined,
                      }}
                      source={currentRemoteFull}
                      buildSendPayload={buildSendPayload}
                    />
                    <button
                      onClick={() =>
                        void showStationSelector(
                          { kind: "video", videoId: video().id, videoTitle: video().title },
                          video().remote_server_id ?? undefined
                        )
                      }
                      class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                      title="add to station..."
                      aria-label="add to station..."
                    >
                      <Icon name={IconNames.headphones} />
                    </button>
                    <Rating rating={userRating()} size="md" onRatingChange={handleRatingChange} />
                  </div>
                </div>

                <ContextMenu actions={videoContextMenuActions()}>
                  <div
                    class={`w-96 aspect-video rounded-lg overflow-hidden flex-shrink-0 cursor-pointer ${
                      (video().source_type === "remote" ? video().poster_blob_id : localPosterUrl())
                        ? ""
                        : "bg-[var(--color-bg-base)]"
                    }`}
                    title="view video images"
                    onClick={handleVideoImageClick}
                  >
                    <Show
                      when={video().source_type === "remote"}
                      fallback={
                        <Show when={localPosterUrl()} fallback={<div class="w-full h-full" />}>
                          {(url) => (
                            <img
                              src={url()}
                              alt={video().title}
                              class="w-full h-full object-contain"
                            />
                          )}
                        </Show>
                      }
                    >
                      <MediaImage
                        remoteBlobId={video().poster_blob_id}
                        remoteServerId={video().remote_server_id}
                        alt={video().title}
                        showFallback={true}
                        thumbnailSize={200}
                        domainType="video"
                        objectFit="contain"
                        class="w-full h-full"
                      />
                    </Show>
                  </div>
                </ContextMenu>
              </div>

              {/* extras: this movie's deleted scenes/bloopers/behind-the-
                  scenes/trailers (see Video::parent_video_id) - flat,
                  unordered-by-kind list per the v1 design. */}
              <Show when={video().content_type === "movie"}>
                <VideoExtrasSection movieId={video().id} />
              </Show>

              {/* "part of [movie]" back-link for an extra viewing its own
                  detail page. */}
              <Show when={video().parent_video_id}>
                {(parentId) => <ParentMovieLink parentVideoId={parentId()} navigate={navigate} />}
              </Show>
            </>
          )}
        </Show>
      </div>
    </DetailViewWrapper>
  );
}

/** a movie's extras (deleted scenes, bloopers, behind-the-scenes,
 * trailers) - same thumbnail/play/play-count/context-menu row used for a
 * series' episodes (`VideoListRow`), just unnumbered (no natural order). */
function VideoExtrasSection(props: { movieId: string }) {
  const extrasQuery = useVideoExtrasQuery(() => props.movieId);
  const queryClient = useQueryClient();
  // useVideoExtrasQuery is grimoire-only for now (see its doc comment) -
  // every result came from the currently-selected remote, so it's safe
  // to stamp source_type/remote_server_id onto the wire `Video` to get
  // a `VideoSummary` VideoListRow can consume.
  const extrasAsSummaries = (): VideoSummary[] =>
    (extrasQuery.data ?? []).map((extra) => ({
      ...extra,
      source_type: "remote",
      remote_server_id: getCurrentRemote()?.remote_id,
      added_at: 0,
    }));
  // own group id, distinct from the parent movie's own single-video
  // progress query (`${props.movieId}` alone) - two observers sharing one
  // query key but fetching different video sets would otherwise race and
  // overwrite each other's cached data (see queryKeys.ts's autocomplete
  // doc comment for the same failure mode elsewhere in this codebase).
  const progressQuery = useVideoProgressQuery(
    () => `${props.movieId}-extras`,
    extrasAsSummaries
  );
  const handlePlayExtra = async (extra: VideoSummary) => {
    await playVideoQueue(
      [extra],
      0,
      { type: "video", label: extra.title, entity_id: extra.id },
      resumePositionFor(extra.id, progressQuery.data ?? new Map())
    );
  };
  return (
    <Show when={extrasQuery.data && extrasQuery.data.length > 0}>
      <div class="px-4 wide:px-6 pb-6">
        <h2 class="text-sm font-medium text-[var(--color-text-secondary)] mb-2">extras</h2>
        <div class="flex flex-col gap-1">
          <For each={extrasAsSummaries()}>
            {(extra) => (
              <VideoListRow
                video={extra}
                onPlay={() => void handlePlayExtra(extra)}
                onTagsSaved={() => {
                  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.tags.all() });
                }}
                progress={progressQuery.data?.get(extra.id)?.position_fraction}
              />
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

/** "part of [movie title]" back-link for an extra's own detail page. */
function ParentMovieLink(props: { parentVideoId: string; navigate: (path: string) => void }) {
  const parentQuery = useVideoQuery(() => props.parentVideoId);
  return (
    <Show when={parentQuery.data}>
      {(parent) => (
        <div class="px-4 wide:px-6 pb-6">
          <button
            type="button"
            onClick={() => props.navigate(buildRoute(`/video/${parent().id}`))}
            class="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            part of <span class="font-medium">{parent().title}</span>
          </button>
        </div>
      )}
    </Show>
  );
}

export default VideoDetailView;
