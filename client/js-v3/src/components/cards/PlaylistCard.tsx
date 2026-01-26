import { Show, createSignal } from "solid-js";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import type { PlaylistSummary } from "../../music/data/types";
import { getImageUrl } from "../../music/utils/format";

export interface PlaylistCardProps {
  playlist: PlaylistSummary;
  onClick?: (playlist: PlaylistSummary) => void;
  onPlay?: (playlist: PlaylistSummary) => void;
  onContextMenu?: (e: MouseEvent, playlist: PlaylistSummary) => void;
  onFavoriteToggle?: (playlistId: string, isFavorite: boolean) => void;
}

export function PlaylistCard(props: PlaylistCardProps) {
  const [isCardHovered, setIsCardHovered] = createSignal(false);

  // format duration from seconds
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  // format relative time
  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  };

  return (
    <div 
      class="bg-[var(--color-bg-primary)] rounded-lg p-4 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer group"
      onClick={() => props.onClick?.(props.playlist)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu?.(e, props.playlist);
      }}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <div class="relative mb-3 rounded-lg transition-all duration-300 group-hover:rounded-none">
        <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-lg relative">
          <Show when={props.playlist.thumbnail_blob_id}>
            <div
              class="absolute inset-0 bg-cover group-hover:bg-contain bg-center bg-no-repeat transition-all duration-300 group-hover:scale-105 rounded-lg group-hover:rounded-none"
            style={`background-image: url('${getImageUrl(props.playlist.thumbnail_blob_id)}')`}
              role="img"
              aria-label={props.playlist.title}
            />
          </Show>
          <Show when={!props.playlist.thumbnail_blob_id}>
            <div class="absolute inset-0 flex items-center justify-center">
              <svg class="w-12 h-12 text-[var(--color-accent-500)]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
              </svg>
            </div>
          </Show>
        </div>
        <div class="absolute top-2 right-2 z-10">
          <FavoriteHeart
            isFavorite={props.playlist.is_favorite ?? false}
            onToggle={(isFavorite) => {
              event?.stopPropagation();
              props.onFavoriteToggle?.(props.playlist.playlist_id, isFavorite);
            }}
            size="sm"
            class="bg-black/30 backdrop-blur-sm rounded-full hover:bg-black/50 transition-colors"
          />
        </div>
        <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            class="w-12 h-12 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center rounded-full transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              props.onPlay?.(props.playlist);
            }}
            title="play playlist"
          >
            <svg class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      </div>
      <div class="space-y-1 min-w-0">
        <div class="min-w-0">
          <MarqueeText
            text={props.playlist.title}
            class="text-[var(--color-text-primary)] font-medium text-xs group-hover:text-[var(--color-accent-500)] transition-colors"            hoverOnly={!isCardHovered()}          />
        </div>
        <Show when={props.playlist.description}>
          <div class="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors line-clamp-2">
            {props.playlist.description}
          </div>
        </Show>
        <div class="text-xs text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors truncate">
          {props.playlist.song_count && `${props.playlist.song_count} songs`}
        </div>
        <Show when={props.playlist.updated_at}>
          <div class="text-xs text-[var(--color-text-muted)] group-hover:text-[var(--color-text-tertiary)] transition-colors truncate">
            updated {formatRelativeTime(props.playlist.updated_at)}
          </div>
        </Show>
      </div>
    </div>
  );
}
