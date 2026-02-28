import { For, Show, createSignal } from "solid-js";
import { PlayIcon } from "../icons/registry";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MediaImage } from "../media/MediaImage";
import { MarqueeText } from "../text/MarqueeText";
import type { AlbumSummary, GenreRef } from "../../music/data/types";
import { debug } from "../../utils/logger";

export interface AlbumCardProps {
  album: AlbumSummary;
  onClick?: (album: AlbumSummary) => void;
  onPlay?: (album: AlbumSummary) => void;
  onContextMenu?: (e: MouseEvent, album: AlbumSummary) => void;
  onFavoriteToggle?: (albumId: string, isFavorite: boolean) => void;
  onArtistClick?: (artistId: string) => void;
  onGenreClick?: (genre: GenreRef) => void;
}

export function AlbumCard(props: AlbumCardProps) {
  const [isCardHovered, setIsCardHovered] = createSignal(false);

  const handleMouseEnter = () => {
    // debug("AlbumCard", `hover enter: ${props.album.title}`);
    setIsCardHovered(true);
  };

  const handleMouseLeave = () => {
    // debug("AlbumCard", `hover leave: ${props.album.title}`);
    setIsCardHovered(false);
  };

  return (
    <div
      class="bg-[var(--color-bg-primary)] rounded-lg p-4 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer group"
      onClick={() => props.onClick?.(props.album)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu?.(e, props.album);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div class="relative mb-3 rounded-lg transition-all duration-300 group-hover:rounded-none">
        <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-lg relative">
          <div class="absolute inset-0 rounded-lg group-hover:rounded-none overflow-hidden">
            <MediaImage
              images={props.album.images}
              alt={props.album.title}
              domainType="album"
              enableAlbumHover
              class="w-full h-full"
            />
          </div>
        </div>
        <div
          class="absolute top-2 right-2 z-40 transition-opacity duration-200"
          classList={{
            "opacity-100": props.album.is_favorite === true,
            "opacity-0 group-hover:opacity-100": props.album.is_favorite !== true,
          }}
        >
          <FavoriteHeart
            isFavorite={props.album.is_favorite ?? false}
            onToggle={(isFavorite) => {
              event?.stopPropagation();
              props.onFavoriteToggle?.(props.album.album_id, isFavorite);
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
              props.onPlay?.(props.album);
            }}
            title="play album"
          >
            <PlayIcon size={24} className="ml-1" />
          </button>
        </div>
      </div>
      <div class="space-y-1 min-w-0">
        <div class="min-w-0">
          <MarqueeText
            text={props.album.title}
            class="text-[var(--color-text-primary)] font-medium text-xs group-hover:text-[var(--color-accent-500)] transition-colors"
            isHovering={isCardHovered}
          />
        </div>
        <Show when={props.album.artist_name}>
          <div class="text-sm text-[var(--color-text-secondary)] min-w-0">
            <a
              class="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                props.onArtistClick?.(props.album.artist_id);
              }}
            >
              <MarqueeText
                text={props.album.artist_name}
                class="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors"
                hoverClass="text-[var(--color-accent-500)] underline"
                isHovering={isCardHovered}
              />
            </a>
          </div>
        </Show>
        <Show when={props.album.year || props.album.song_count}>
          <div class="text-xs text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors truncate">
            {[props.album.year, props.album.song_count && `${props.album.song_count} tracks`]
              .filter(Boolean)
              .join(" • ")}
          </div>
        </Show>
        <Show
          when={
            (props.album.genres && props.album.genres.length > 0) ||
            (props.album.tags && props.album.tags.length > 0)
          }
        >
          <div class="flex flex-wrap gap-1 mt-2 min-h-[20px] max-h-[48px] overflow-clip pb-1">
            <For each={props.album.genres}>
              {(genre) => (
                <a
                  class="text-xs px-1.5 py-0.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded hover:bg-[var(--color-accent-500)] hover:text-[var(--color-text-on-accent)] transition-colors cursor-pointer flex-shrink-0"
                  title={genre.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onGenreClick?.(genre);
                  }}
                >
                  {genre.name}
                </a>
              )}
            </For>
            <For each={props.album.tags}>
              {(tag) => (
                <span class="text-xs px-1.5 py-0.5 bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] rounded flex-shrink-0">
                  {tag}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
