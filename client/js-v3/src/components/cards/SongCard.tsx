import { Show, createSignal } from "solid-js";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";

export interface SongCardData {
  type: "song";
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration: string;
  thumbnailUrl?: string;
  isFavorite: boolean;
  sha256?: string;
  createdAt: number;
}

export interface SongCardProps {
  song: SongCardData;
  onClick?: (song: SongCardData) => void;
  onPlay?: (song: SongCardData) => void;
  onContextMenu?: (e: MouseEvent, song: SongCardData) => void;
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
          <Show when={props.song.thumbnailUrl}>
            <div
              class="absolute inset-0 bg-cover group-hover:bg-contain bg-center bg-no-repeat transition-all duration-300 group-hover:scale-105 rounded-lg group-hover:rounded-none"
              style={`background-image: url('${props.song.thumbnailUrl}')`}
              role="img"
              aria-label={props.song.title}
            />
          </Show>
          <Show when={!props.song.thumbnailUrl}>
            <div class="absolute inset-0 flex items-center justify-center">
              <svg class="w-12 h-12 text-[var(--color-accent-500)]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          </Show>
        </div>
        <div class="absolute top-2 right-2 z-10">
          <FavoriteHeart
            isFavorite={props.song.isFavorite}
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
        <div class="text-xs text-[var(--color-text-secondary)] min-w-0">
          <a
            class="cursor-pointer block"
            onClick={(e) => {
              e.stopPropagation();
              props.onArtistClick?.(props.song.id);
            }}
          >
            <MarqueeText
              text={[
                props.song.artist,
                props.song.album
              ].filter(Boolean).join(" • ")}
              class="group-hover:text-[var(--color-text-primary)] transition-colors"
              hoverClass="text-[var(--color-accent-500)] underline"
              hoverOnly={!isCardHovered()}
            />
          </a>
        </div>
        <div class="text-xs text-[var(--color-text-tertiary)]">
          {props.song.duration}
        </div>
      </div>
    </div>
  );
}
