import { For, Show, createSignal } from "solid-js";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import type { AlbumSummary } from "../../music/data/types";
import { getImageUrl } from "../../music/utils/images";

export interface AlbumCardProps {
  album: AlbumSummary;
  onClick?: (album: AlbumSummary) => void;
  onPlay?: (album: AlbumSummary) => void;
  onContextMenu?: (e: MouseEvent, album: AlbumSummary) => void;
  onFavoriteToggle?: (albumId: string, isFavorite: boolean) => void;
  onArtistClick?: (artistId: string) => void;
  onGenreClick?: (genre: string) => void;
}

export function AlbumCard(props: AlbumCardProps) {
  const [isCardHovered, setIsCardHovered] = createSignal(false);

  return (
    <div 
      class="bg-[var(--color-bg-primary)] rounded-lg p-4 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer group"
      onClick={() => props.onClick?.(props.album)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu?.(e, props.album);
      }}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <div class="relative mb-3 rounded-lg transition-all duration-300 group-hover:rounded-none">
        <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-lg relative">
          <Show when={props.album.images && props.album.images.length > 0}>
            <div
              class="absolute inset-0 bg-cover group-hover:bg-contain bg-center bg-no-repeat transition-all duration-300 group-hover:scale-105 rounded-lg group-hover:rounded-none"
              style={`background-image: url('${getImageUrl(props.album.images![0].blob_id)}')`}
              role="img"
              aria-label={props.album.title}
            />
          </Show>
          <Show when={!props.album.images || props.album.images.length === 0}>
            <div class="absolute inset-0 flex items-center justify-center">
              <svg class="w-12 h-12 text-[var(--color-accent-500)]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
              </svg>
            </div>
          </Show>
        </div>
        <div class="absolute top-2 right-2 z-10">
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
            <svg class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      </div>
      <div class="space-y-1 min-w-0">
        <div class="min-w-0">
          <MarqueeText
            text={props.album.title}
            class="text-[var(--color-text-primary)] font-medium text-xs group-hover:text-[var(--color-accent-500)] transition-colors"
            hoverOnly={!isCardHovered()}
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
                hoverOnly={!isCardHovered()}
              />
            </a>
          </div>
        </Show>
        <Show when={props.album.year || props.album.song_count}>
          <div class="text-xs text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors truncate">
            {[props.album.year, props.album.song_count && `${props.album.song_count} tracks`].filter(Boolean).join(" • ")}
          </div>
        </Show>
        <Show when={props.album.sub_genres && props.album.sub_genres.length > 0 || props.album.tags && props.album.tags.length > 0}>
          <div class="flex flex-wrap gap-1 mt-2 min-h-[20px] max-h-[48px] overflow-y-clip pb-1">
            <For each={props.album.sub_genres}>
              {(genre) => (
                <a
                  class="text-xs px-1.5 py-0.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded hover:bg-[var(--color-accent-500)] hover:text-[var(--color-text-on-accent)] transition-colors cursor-pointer flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onGenreClick?.(genre);
                  }}
                >
                  {genre}
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
