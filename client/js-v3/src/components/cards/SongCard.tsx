import { Show, createSignal } from "solid-js";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MediaImage } from "../media/MediaImage";
import { MarqueeText } from "../text/MarqueeText";
import type { Song } from "../../music/data/types";


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
          <MediaImage
            images={props.song.images}
            alt={props.song.title}
            domainType="song"
            enableAlbumHover
            class="absolute inset-0 rounded-lg group-hover:rounded-none"
          />
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
