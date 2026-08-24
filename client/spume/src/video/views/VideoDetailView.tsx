// video detail view - mirrors AlbumDetailView.tsx's shape (see
// music/views/AlbumDetailView.tsx) for a single video: poster, title,
// description, series/season/episode info if present, duration, release
// date, and a play button.
import { useNavigate, useParams } from "@solidjs/router";
import { createSignal, createMemo, createEffect, Show } from "solid-js";
import { DetailViewWrapper } from "../../components/layout/DetailViewWrapper";
import { MediaImage } from "../../components/media/MediaImage";
import { Button } from "../../components/buttons/Button";
import { LoadingState } from "../../components/feedback";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { Rating } from "../../components/ratings/Rating";
import { formatDuration } from "../../utils/formatDuration";
import { buildRoute } from "../../music/utils/routing";
import { useVideoQuery } from "../queries/videos";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { useLocalVideoPosterUrl } from "../components/VideoCard";
import { useToggleFavoriteMutation } from "../../music/queries/favorites";
import { useSetRatingMutation } from "../../music/queries/ratings";
import { useVideoFavoriteStatuses } from "../hooks/useVideoFavoriteStatuses";
import { useVideoRatingStatuses } from "../hooks/useVideoRatingStatuses";

export function VideoDetailView() {
  const params = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const videoQuery = useVideoQuery(() => params.videoId);

  const [playPending, setPlayPending] = createSignal(false);

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
              <div class="flex flex-col justify-center min-w-0 wide:mt-[50px] wide:gap-2 wide:text-left">
                {/* poster */}
                <div class="w-32 h-32 wide:w-64 wide:h-64 mb-3 rounded-lg overflow-hidden bg-[var(--color-bg-base)]">
                  <Show
                    when={video().source_type === "remote"}
                    fallback={
                      <Show when={localPosterUrl()} fallback={<div class="w-full h-full" />}>
                        {(url) => (
                          <img src={url()} alt={video().title} class="w-full h-full object-cover" />
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
                      class="w-full h-full"
                    />
                  </Show>
                </div>

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
                    play
                  </Button>
                  <Show when={video().series_id}>
                    <Button variant="ghost" onClick={() => navigate(buildRoute("/video/series"))}>
                      view series
                    </Button>
                  </Show>
                  <FavoriteHeart isFavorite={isFavorite()} onToggle={handleFavoriteToggle} />
                  <Rating rating={userRating()} size="md" onRatingChange={handleRatingChange} />
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
    </DetailViewWrapper>
  );
}

export default VideoDetailView;
