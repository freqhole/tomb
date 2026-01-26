import { Show, createSignal } from "solid-js";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import type { Song } from "../../music/data/types";
import { getImageUrl } from "../../music/utils/format";

export interface SongCardProps {
  song: Song;
  onClick?: (song: Song) => void;
  onPlay?: (song: Song) => void;
  onContextMenu?: (e: MouseEvent, song: Song) => void;
  onFavoriteToggle?: (songId: string, isFavorite: boolean) => void;
  onArtistClick?: (artistId: string) => void;
  onAlbumClick?: (albumId: string) => void;
}

export function SongCard(props: SongCardProps) {
  const [isCardHovered, setIsCardHovered] = createSignal(false);

  return (
    <div 
      class="bg-[var(--color-bg-primary)] rounded-lg p-4 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer group"
      onClick={() => props.onClick?.(props.song)}
      onDblClick={() => {
        console.log('song card double clicked:', props.song.title);
        props.onPlay?.(props.song);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu?.(e, props.song);
      }}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <div class="relative mb-3 rounded-lg transition-all duration-300 group-hover:rounded-none">
        <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-lg relative">
          <Show when={props.song.thumbnail_blob_id}>
            <div
              class="absolute inset-0 bg-cover group-hover:bg-contain bg-center bg-no-repeat transition-all duration-300 group-hover:scale-105 rounded-lg group-hover:rounded-none"
            style={`background-image: url('${getImageUrl(props.song.thumbnail_blob_id)}')`}
              role="img"
              aria-label={props.song.title}
            />
          </Show>
          <Show when={!props.song.thumbnail_blob_id}>
            <div class="absolute inset-0 flex items-center justify-center">
              <svg class="w-12 h-12 text-[var(--color-accent-500)]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          </Show>
        </div>
        <div class="absolute top-2 right-2 z-10">
          <FavoriteHeart
            isFavorite={props.song.is_favorite ?? false}
            onToggle={(isFavorite) => {
              event?.stopPropagation();
              props.onFavoriteToggle?.(props.song.id, isFavorite);
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
              props.onPlay?.(props.song);
            }}
            title="play song"
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
            text={props.song.title}
            class="text-[var(--color-text-primary)] font-medium text-xs group-hover:text-[var(--color-accent-500)] transition-colors"
            hoverOnly={!isCardHovered()}
          />
        </div>
        <div class="text-xs text-[var(--color-text-secondary)] min-w-0 flex items-center gap-1">
          <Show when={props.song.artist_name && props.song.artist_id}>
            <a
              class="cursor-pointer hover:text-[var(--color-accent-500)] hover:underline transition-colors truncate"
              onClick={(e) => {
                e.stopPropagation();
                props.onArtistClick?.(props.song.artist_id);
              }}
            >
              {props.song.artist_name}
            </a>
          </Show>
          <Show when={props.song.artist_name && props.song.album_title}>
            <span>•</span>
          </Show>
          <Show when={props.song.album_title && props.song.album_id}>
            <a
              class="cursor-pointer hover:text-[var(--color-accent-500)] hover:underline transition-colors truncate"
              onClick={(e) => {
                e.stopPropagation();
                props.onAlbumClick?.(props.song.album_id);
              }}
            >
              {props.song.album_title}
            </a>
          </Show>
        </div>
        <div class="text-xs text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors">
          {Math.floor(props.song.duration_seconds / 60)}:{String(props.song.duration_seconds % 60).padStart(2, '0')}
        </div>
      </div>
    </div>
  );
}
