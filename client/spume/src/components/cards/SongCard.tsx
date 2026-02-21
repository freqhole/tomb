import { Show, createSignal } from "solid-js";
import { PlayIcon } from "../icons/registry";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MediaImage } from "../media/MediaImage";
import { MarqueeText } from "../text/MarqueeText";
import { formatDuration } from "../../utils/formatDuration";
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
      onClick={() => {
        // card click navigates to album detail
        if (props.song.album_id) {
          props.onAlbumClick?.(props.song.album_id);
        }
      }}
      onDblClick={() => {
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
          <div class="absolute inset-0 rounded-lg group-hover:rounded-none overflow-hidden">
            <MediaImage
              images={props.song.images?.length ? props.song.images : props.song.album_images}
              alt={props.song.title}
              domainType="song"
              enableAlbumHover
              class="w-full h-full"
            />
          </div>
        </div>
        <div
          class="absolute top-2 right-2 z-40 transition-opacity duration-200"
          classList={{
            "opacity-100": props.song.is_favorite === true,
            "opacity-0 group-hover:opacity-100": props.song.is_favorite !== true,
          }}
        >
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
            <PlayIcon size={24} className="ml-1" />
          </button>
        </div>
      </div>
      <div class="space-y-1 min-w-0">
        {/* title - card click handles navigation */}
        <MarqueeText
          text={props.song.title}
          class="text-[var(--color-text-primary)] font-medium text-xs group-hover:text-[var(--color-accent-500)] transition-colors"
          isHovering={isCardHovered}
        />
        {/* artist + album - links to artist */}
        <Show when={props.song.artist_name || props.song.album_title}>
          <a
            class="block cursor-pointer hover:text-[var(--color-accent-500)] transition-colors min-w-0"
            onClick={(e) => {
              e.stopPropagation();
              if (props.song.artist_id) {
                props.onArtistClick?.(props.song.artist_id);
              }
            }}
          >
            <MarqueeText
              text={[props.song.artist_name, props.song.album_title].filter(Boolean).join(" • ")}
              class="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors"
              hoverClass="underline"
              isHovering={isCardHovered}
            />
          </a>
        </Show>
        {/* duration */}
        <div class="text-xs text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors">
          {formatDuration(props.song.duration_seconds)}
        </div>
      </div>
    </div>
  );
}
