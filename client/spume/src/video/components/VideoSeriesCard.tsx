// video series card — mirrors PlaylistCard.tsx's shape/simplicity (poster
// thumbnail, title, description, favorite toggle, play button) since
// VideoSeries carries no aggregate season/episode counts on its own (unlike
// VideoSeriesDetailPanel's stats row, which computes those from a full
// series-detail fetch this card doesn't have).
import { Show, createSignal } from "solid-js";
import { PlayIcon } from "../../components/icons/registry";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { MediaImage } from "../../components/media/MediaImage";
import { MarqueeText } from "../../components/text/MarqueeText";
import type { VideoSeries } from "../data/types";

export interface VideoSeriesCardProps {
  series: VideoSeries;
  onClick?: (series: VideoSeries) => void;
  onPlay?: (series: VideoSeries) => void;
  onContextMenu?: (e: MouseEvent, series: VideoSeries) => void;
  /** whether this series is favorited (omit to hide the heart entirely) */
  isFavorite?: boolean;
  onFavoriteToggle?: (seriesId: string, isFavorite: boolean) => void;
}

export function VideoSeriesCard(props: VideoSeriesCardProps) {
  const [isCardHovered, setIsCardHovered] = createSignal(false);

  return (
    <div
      class="bg-[var(--color-bg-primary)] rounded-lg p-4 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer group"
      onClick={() => props.onClick?.(props.series)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu?.(e, props.series);
      }}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <div class="relative mb-3 rounded-lg transition-all duration-300 group-hover:rounded-none">
        <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-lg relative">
          <div class="absolute inset-0 rounded-lg group-hover:rounded-none overflow-hidden">
            <MediaImage
              blobId={props.series.poster_blob_id}
              remoteBlobId={props.series.poster_blob_id}
              remoteServerId={props.series.remote_server_id}
              alt={props.series.title}
              showFallback={true}
              thumbnailSize={200}
              domainType="video_series"
              class="w-full h-full"
            />
          </div>
        </div>
        <Show when={props.isFavorite !== undefined}>
          <div
            class="absolute top-2 right-2 z-40 transition-opacity duration-200"
            classList={{
              "opacity-100": props.isFavorite === true,
              "opacity-0 group-hover:opacity-100": props.isFavorite !== true,
            }}
          >
            <FavoriteHeart
              isFavorite={props.isFavorite ?? false}
              onToggle={(isFavorite) => {
                event?.stopPropagation();
                props.onFavoriteToggle?.(props.series.id, isFavorite);
              }}
              size="sm"
              class="bg-black/30 backdrop-blur-sm rounded-full hover:bg-black/50 transition-colors"
            />
          </div>
        </Show>
        <Show when={props.onPlay}>
          <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              class="w-12 h-12 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center rounded-full transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                props.onPlay?.(props.series);
              }}
              title="play series"
            >
              <PlayIcon size={24} className="ml-1" />
            </button>
          </div>
        </Show>
      </div>
      <div class="space-y-1 min-w-0">
        <MarqueeText
          text={props.series.title}
          class="text-[var(--color-text-primary)] font-medium text-xs group-hover:text-[var(--color-accent-500)] transition-colors"
          isHovering={isCardHovered}
        />
        <Show when={props.series.description}>
          <MarqueeText
            text={props.series.description!}
            class="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors"
            isHovering={isCardHovered}
          />
        </Show>
      </div>
    </div>
  );
}
