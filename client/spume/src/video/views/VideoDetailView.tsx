// video detail view - mirrors AlbumDetailView.tsx's shape (see
// music/views/AlbumDetailView.tsx) for a single video: poster in a
// flex-shrink-0 box on the right, info column first/left, taxon chips,
// and responsive action buttons.
import { useNavigate, useParams } from "@solidjs/router";
import { createSignal, createMemo, createEffect, Show } from "solid-js";
import { DetailViewWrapper } from "../../components/layout/DetailViewWrapper";
import { MediaImage } from "../../components/media/MediaImage";
import { Button } from "../../components/buttons/Button";
import { LoadingState } from "../../components/feedback";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { Icon, IconNames } from "../../components/icons/registry";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { Rating } from "../../components/ratings/Rating";
import { ShareButton } from "../../components/buttons/ShareButton";
import { createCurrentRemoteFull } from "../../app/services/remotes/currentRemoteFull";
import { formatDuration } from "../../utils/formatDuration";
import { buildRoute } from "../../music/utils/routing";
import { TaxonChips } from "../../components/badges/TaxonChips";
import { TagChips } from "../../components/badges/TagChips";
import { useVideoQuery } from "../queries/videos";
import { useVideoTaxonsQuery } from "../queries/taxons";
import { useVideoEntityTagsQuery } from "../queries/tags";
import { videoQueryKeys } from "../queries/queryKeys";
import { useQueryClient } from "@tanstack/solid-query";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { addVideoToQueue } from "../services/videoQueueActions";
import { useLocalVideoPosterUrl } from "../components/VideoCard";
import { useToggleFavoriteMutation } from "../../music/queries/favorites";
import { useSetRatingMutation } from "../../music/queries/ratings";
import { useVideoFavoriteStatuses } from "../hooks/useVideoFavoriteStatuses";
import { useVideoRatingStatuses } from "../hooks/useVideoRatingStatuses";
import { useVideoContextMenu } from "../hooks/contextMenu";
import { showEditVideo } from "../hooks/modals";
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
  const currentRemoteFull = createCurrentRemoteFull();

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

  const handlePlay = async () => {
    const video = videoQuery.data;
    if (!video || playPending()) return;
    setPlayPending(true);
    try {
      // source is required so a history entry is created and watch-progress
      // tracking starts (without it, position never resumes on reload).
      await playVideoQueue([video], 0, { type: "video", label: video.title, entity_id: video.id });
    } finally {
      setPlayPending(false);
    }
  };

  const handleAddToQueue = async () => {
    const video = videoQuery.data;
    if (!video || queuePending()) return;
    setQueuePending(true);
    try {
      await addVideoToQueue(video);
    } finally {
      setQueuePending(false);
    }
  };

  // context menu for the poster (play/queue/favorite/edit/delete parity
  // with the grid/table context menus elsewhere in the video domain)
  const videoContextMenuActions = createMemo(() => {
    const video = videoQuery.data;
    if (!video) return [];
    return useVideoContextMenu(video, {
      isFavorite: isFavorite(),
      showPlayActions: true,
      onDeleted: () => navigate(buildRoute("/video")),
      onSave: () => {
        void queryClient.invalidateQueries({ queryKey: videoQueryKeys.tags.all() });
      },
    });
  });

  return (
    <DetailViewWrapper
      pageTitle="video"
      documentTitle={videoQuery.data?.title}
      onBack={buildRoute("/video")}
    >
      <div class="flex flex-col h-full">
        <Show when={videoQuery.data} fallback={<LoadingState class="flex-1" />}>
          {(video) => (
            <div class="flex justify-between px-1 wide:gap-6 wide:p-6">
              {/* video info */}
              <div class="flex flex-col justify-center min-w-0 wide:mt-[50px] wide:gap-2 wide:text-left">
                <h1 class="text-2xl wide:text-5xl font-bold text-[var(--color-text-primary)]">
                  {video().title}
                </h1>

                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs wide:text-sm text-[var(--color-text-secondary)]">
                  <Show when={releaseYear()}>{(year) => <span>{year()}</span>}</Show>
                  <Show when={video().episode_number != null}>
                    <span>episode {video().episode_number}</span>
                  </Show>
                  <Show when={video().duration_seconds != null}>
                    <span>{formatDuration(video().duration_seconds)}</span>
                  </Show>
                </div>

                <TaxonChips
                  taxons={taxonsQuery.data}
                  class="mt-2"
                  excludeKinds={["genre", "mood", "style", "era", "label"]}
                />

                <TagChips tags={tagsQuery.data} class="mt-2" />

                <Show when={video().description}>
                  <p class="mt-2 text-sm text-[var(--color-text-secondary)] max-w-prose">
                    {video().description}
                  </p>
                </Show>

                <div class="mt-3 flex items-center gap-2">
                  <Button
                    variant="primary"
                    loading={playPending()}
                    onClick={() => void handlePlay()}
                  >
                    <span class="hidden wide:inline">play video</span>
                    <span class="wide:hidden">play</span>
                  </Button>
                  <Button
                    variant="ghost"
                    loading={queuePending()}
                    onClick={() => void handleAddToQueue()}
                    title="add video to queue"
                    aria-label="add video to queue"
                  >
                    <span class="hidden wide:inline">+queue</span>
                    <span class="wide:hidden inline-flex items-center">
                      <Icon name={IconNames.queue} />
                    </span>
                  </Button>
                  <Show when={video().series_id}>
                    <Button
                      variant="ghost"
                      onClick={() => navigate(buildRoute(`/video/series/${video().series_id}`))}
                      title="view series"
                      aria-label="view series"
                    >
                      <span class="hidden wide:inline">view series</span>
                      <span class="wide:hidden inline-flex items-center">
                        <Icon name={IconNames.video} />
                      </span>
                    </Button>
                  </Show>
                  <Show when={canUpdateVideo()}>
                    <button
                      onClick={() => showEditVideo({ videoId: video().id })}
                      class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                      title="edit video info"
                      aria-label="edit video info"
                    >
                      <Icon name={IconNames.edit} />
                    </button>
                  </Show>
                  <FavoriteHeart isFavorite={isFavorite()} onToggle={handleFavoriteToggle} />
                  <ShareButton
                    target={{ kind: "video", id: video().id, displayTitle: video().title }}
                    source={currentRemoteFull}
                  />
                  <Rating rating={userRating()} size="md" onRatingChange={handleRatingChange} />
                </div>
              </div>

              {/* poster */}
              <ContextMenu actions={videoContextMenuActions()}>
                <div
                  class="w-48 wide:w-96 aspect-video mx-auto wide:mx-0 rounded-lg overflow-hidden bg-[var(--color-bg-base)] flex-shrink-0 cursor-pointer"
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
          )}
        </Show>
      </div>
    </DetailViewWrapper>
  );
}

export default VideoDetailView;
