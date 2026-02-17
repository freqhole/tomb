import { For, Show, createSignal } from "solid-js";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import { MediaImage } from "../media/MediaImage";
import type { ArtistSummary, GenreRef } from "../../music/data/types";
export interface ArtistCardProps {
  artist: ArtistSummary;
  onClick?: (artist: ArtistSummary) => void;
  onPlay?: (artist: ArtistSummary) => void;
  onContextMenu?: (e: MouseEvent, artist: ArtistSummary) => void;
  onFavoriteToggle?: (artistId: string, isFavorite: boolean) => void;
  onGenreClick?: (genre: GenreRef) => void;
}

export function ArtistCard(props: ArtistCardProps) {
  // helper to get artist abbreviation
  const getArtistAbbreviation = (name: string | undefined) => {
    if (!name) return "?";
    const words = name.split(/\s+/);
    return words
      .slice(0, 3)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("");
  };

  const [isCardHovered, setIsCardHovered] = createSignal(false);

  return (
    <div
      class="bg-[var(--color-bg-primary)] rounded-lg p-4 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer group"
      onClick={() => props.onClick?.(props.artist)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu?.(e, props.artist);
      }}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <div class="relative mb-3 rounded-lg transition-all duration-300 group-hover:rounded-none">
        <div class="w-full aspect-square bg-[var(--color-bg-elevated)] rounded-full relative">
          <div class="absolute inset-0 rounded-full overflow-hidden transition-all duration-300 group-hover:scale-105">
            <MediaImage
              images={props.artist.images}
              alt={props.artist.name}
              domainType="artist"
              class="w-full h-full object-cover"
            />
          </div>
        </div>
        <div
          class="absolute top-2 right-2 z-40 pointer-events-none transition-opacity duration-200"
          classList={{
            "opacity-100": props.artist.is_favorite === true,
            "opacity-0 group-hover:opacity-100": props.artist.is_favorite !== true,
          }}
        >
          <FavoriteHeart
            isFavorite={props.artist.is_favorite ?? false}
            onToggle={(isFavorite) => {
              event?.stopPropagation();
              props.onFavoriteToggle?.(props.artist.artist_id, isFavorite);
            }}
            size="sm"
            class="bg-black/30 backdrop-blur-sm rounded-full hover:bg-black/50 transition-colors pointer-events-auto"
          />
        </div>
        <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <button
            class="w-12 h-12 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center rounded-full transition-colors pointer-events-auto"
            onClick={(e) => {
              e.stopPropagation();
              props.onPlay?.(props.artist);
            }}
            title="play artist"
          >
            <svg class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      </div>
      <div class="space-y-1 text-center min-w-0">
        <MarqueeText
          text={props.artist.name}
          class="text-[var(--color-text-primary)] font-medium text-xs group-hover:text-[var(--color-accent-500)] transition-colors"
          isHovering={isCardHovered}
        />
        <Show when={props.artist.album_count !== undefined}>
          <div class="text-xs text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors">
            {props.artist.album_count} albums
          </div>
        </Show>
      </div>
    </div>
  );
}
