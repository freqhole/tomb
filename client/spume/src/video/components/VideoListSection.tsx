// "videos" section for the artist/album detail views - a flat list of
// music video / karaoke rows (VideoListRow, with the content type shown).
// renders nothing while the list is empty, so callers can drop it in
// unconditionally.
import { createMemo, For, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { VideoListRow } from "./VideoListRow";
import { playVideoQueue } from "../services/queue/playVideoQueue";
import { videoQueryKeys } from "../queries/queryKeys";
import { useVideoFavoriteStatuses } from "../hooks/useVideoFavoriteStatuses";
import { useVideoRatingStatuses } from "../hooks/useVideoRatingStatuses";
import { useToggleFavoriteMutation } from "../../music/queries/favorites";
import { useSetRatingMutation } from "../../music/queries/ratings";
import type { VideoSummary } from "../data/types";

export interface VideoListSectionProps {
  videos: VideoSummary[] | undefined;
  title?: string;
  class?: string;
}

export function VideoListSection(props: VideoListSectionProps) {
  const queryClient = useQueryClient();

  const handlePlay = async (video: VideoSummary) => {
    await playVideoQueue([video], 0, {
      type: "video",
      label: video.title,
      entity_id: video.id,
    });
  };

  // favorite/rating status for every video in the list, hydrated in one
  // bulk call each (mirrors VideosView.tsx's grid/table wiring).
  const videoIds = createMemo(() => (props.videos ?? []).map((v) => v.id));
  const favoriteStatusesQuery = useVideoFavoriteStatuses(videoIds);
  const favoriteVideoIds = createMemo(() => favoriteStatusesQuery.data ?? new Set<string>());
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  const handleFavoriteToggle = (videoId: string, isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({ targetType: "video", targetId: videoId, isFavorite });
  };

  const ratingStatusesQuery = useVideoRatingStatuses(videoIds);
  const videoRatings = createMemo(() => ratingStatusesQuery.data ?? new Map<string, number>());
  const setRatingMutation = useSetRatingMutation();
  const handleRatingChange = (videoId: string, rating: number) => {
    setRatingMutation.mutate({ targetType: "video", targetId: videoId, rating });
  };

  return (
    <Show when={props.videos && props.videos.length > 0}>
      <div class={props.class}>
        <h2 class="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
          {props.title ?? "videos"}
        </h2>
        <div class="flex flex-col gap-1">
          <For each={props.videos}>
            {(video) => (
              <VideoListRow
                video={video}
                showContentType
                onPlay={() => void handlePlay(video)}
                onTagsSaved={() => {
                  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.tags.all() });
                }}
                rating={videoRatings().get(video.id) ?? 0}
                onRatingChange={(rating) => handleRatingChange(video.id, rating)}
                isFavorite={favoriteVideoIds().has(video.id)}
                onFavoriteToggle={(isFavorite) => handleFavoriteToggle(video.id, isFavorite)}
              />
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
