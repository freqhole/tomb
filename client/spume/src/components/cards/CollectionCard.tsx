import { createSignal, For, JSX, Show } from "solid-js";
import { PlayIcon } from "../icons/registry";
import type { ImageMetadata } from "../../music/services/storage/types";
import { MediaImage } from "../media/MediaImage";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import { Badge } from "../badges/Badge";

// unified collection types
export interface CollectionCardData {
  // core identity
  id: string;
  title: string;
  subtitle?: string | null;

  // collection type info
  domainType: "album" | "playlist" | "artist" | "genre";

  // media info
  imageUrl?: string | null;
  images?: ImageMetadata[];

  // metadata
  artist?: string | null;
  album?: string | null;
  year?: number | null;
  trackCount?: number | null;
  totalDuration?: string | null;
  genres?: string | null;
  tags?: string[] | null;

  // user context
  isFavorite?: boolean | null;

  // analytics/activity
  playCount?: number | null;
  lastPlayedAt?: string | null;
}

interface CollectionCardProps {
  /** collection data to display */
  collection: CollectionCardData;
  /** size variant */
  size?: "small" | "medium" | "large";
  /** show genres row */
  showGenres?: boolean;
  /** show duration in metadata */
  showDuration?: boolean;
  /** show year in metadata */
  showYear?: boolean;
  /** show play count in metadata */
  showPlayCount?: boolean;
  /** callback when card is clicked */
  onClick?: (collection: CollectionCardData) => void;
  /** callback when play button is clicked */
  onPlay?: (collection: CollectionCardData) => void;
  /** callback when context menu is triggered */
  onContextMenu?: (e: MouseEvent, collection: CollectionCardData) => void;
  /** callback when favorite is toggled */
  onFavoriteToggle?: (collection: CollectionCardData, isFavorite: boolean) => void;
  /** additional css classes */
  class?: string;
}

export function CollectionCard(props: CollectionCardProps): JSX.Element {
  const [isCardHovering, setIsCardHovering] = createSignal(false);

  // event handlers
  const handleClick = () => {
    if (props.onClick && props.collection) {
      props.onClick(props.collection);
    }
  };

  const handlePlay = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.onPlay && props.collection) {
      props.onPlay(props.collection);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (props.onContextMenu && props.collection) {
      props.onContextMenu(e, props.collection);
    }
  };

  // size variants - compact sizing for grid layouts
  const sizeClasses = () => {
    switch (props.size) {
      case "small":
        return {
          container: "w-full aspect-square flex-shrink-0",
          image: "w-full h-full",
          playButton: "w-8 h-8 rounded-full",
          playIcon: "w-4 h-4",
          title: "text-xs font-medium leading-tight",
          subtitle: "text-xs leading-tight",
          meta: "text-xs leading-tight",
        };
      case "large":
        return {
          container: "w-full aspect-square flex-shrink-0",
          image: "w-full h-full",
          playButton: "w-16 h-16 rounded-full",
          playIcon: "w-8 h-8",
          title: "text-sm font-medium leading-tight",
          subtitle: "text-xs leading-tight",
          meta: "text-xs leading-tight",
        };
      default: // medium
        return {
          container: "w-full aspect-square flex-shrink-0",
          image: "w-full h-full",
          playButton: "w-12 h-12 rounded-full",
          playIcon: "w-6 h-6",
          title: "text-xs font-medium leading-tight",
          subtitle: "text-xs leading-tight",
          meta: "text-xs leading-tight",
        };
    }
  };

  return (
    <Show when={props.collection}>
      {(collection) => (
        <div
          class={`group cursor-pointer flex flex-col ${props.class || ""}`}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setIsCardHovering(true)}
          onMouseLeave={() => setIsCardHovering(false)}
        >
          {/* image/artwork area */}
          <div
            class={`${sizeClasses().container} bg-[var(--color-bg-base)] rounded-lg mb-2 relative transition-all duration-300 group-hover:rounded-none`}
          >
            <MediaImage
              images={collection().images}
              imageUrl={collection().imageUrl}
              alt={collection().title}
              domainType={collection().domainType}
              showFallback={true}
              enableAlbumHover={true}
              thumbnailSize={200}
              class="w-full h-full rounded-lg group-hover:rounded-none"
            />

            {/* favorite toggle - top right corner */}
            <Show when={collection().isFavorite !== undefined && collection().isFavorite !== null}>
              <div
                class="absolute top-2 right-2 z-40 transition-opacity duration-200"
                classList={{
                  "opacity-100": collection().isFavorite === true,
                  "opacity-0 group-hover:opacity-100": collection().isFavorite !== true,
                }}
              >
                <FavoriteHeart
                  isFavorite={collection().isFavorite ?? false}
                  onToggle={(isFavorite) => props.onFavoriteToggle?.(collection(), isFavorite)}
                  size="sm"
                  class="bg-black/30 backdrop-blur-sm rounded-full hover:bg-black/50 transition-colors"
                />
              </div>
            </Show>

            {/* hover overlay with play button */}
            <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <button
                class={`${sizeClasses().playButton} bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center transition-colors`}
                onClick={handlePlay}
                title={`play ${collection().domainType}`}
              >
                <PlayIcon size={props.size === "small" ? 20 : 24} className="ml-1" />
              </button>
            </div>
          </div>

          {/* collection info */}
          <div class="space-y-0.5 min-w-0">
            {/* title */}
            <MarqueeText
              text={collection().title}
              class={`text-[var(--color-text-primary)] font-medium ${sizeClasses().title} group-hover:text-[var(--color-accent-500)] transition-colors`}
              isHovering={isCardHovering}
            />

            {/* subtitle */}
            <Show when={collection().subtitle}>
              <MarqueeText
                text={collection().subtitle!}
                class={`text-[var(--color-text-primary)]/75 ${sizeClasses().subtitle} group-hover:text-[var(--color-text-primary)] transition-colors`}
                isHovering={isCardHovering}
              />
            </Show>

            {/* artist info for albums/songs only - not playlists */}
            <Show
              when={
                collection().artist &&
                collection().domainType !== "playlist" &&
                !collection().subtitle?.includes(collection().artist!)
              }
            >
              <MarqueeText
                text={`by ${collection().artist}`}
                class={`text-[var(--color-text-primary)]/75 ${sizeClasses().subtitle} group-hover:text-[var(--color-text-secondary)] transition-colors`}
                isHovering={isCardHovering}
              />
            </Show>

            {/* metadata row */}
            <div
              class={`text-[var(--color-text-tertiary)]/65 ${sizeClasses().meta} group-hover:text-[var(--color-text-secondary)] transition-colors`}
            >
              <div class="flex items-center gap-2 flex-wrap">
                {/* year */}
                <Show when={props.showYear && collection().year}>
                  <span>{collection().year}</span>
                </Show>

                {/* track count */}
                <Show when={collection().trackCount && collection().trackCount! > 0}>
                  <span>
                    {collection().trackCount} track
                    {collection().trackCount !== 1 ? "s" : ""}
                  </span>
                </Show>

                {/* duration */}
                <Show when={props.showDuration && collection().totalDuration}>
                  <span>{collection().totalDuration}</span>
                </Show>

                {/* play count */}
                <Show when={props.showPlayCount && collection().playCount}>
                  <span>{collection().playCount} plays</span>
                </Show>
              </div>
            </div>

            {/* genres */}
            <Show when={props.showGenres && collection().genres}>
              <MarqueeText
                text={collection().genres!}
                class={`${sizeClasses().meta} text-[var(--color-text-tertiary)]/50 group-hover:text-[var(--color-text-primary)] transition-colors bg-black/50 px-1 py-0.5 rounded`}
                isHovering={isCardHovering}
              />
            </Show>
            {/* tags */}
            <Show when={collection().tags && collection().tags!.length > 0}>
              <div class="w-full overflow-hidden flex flex-wrap gap-1">
                <For each={collection().tags}>
                  {(tag) => (
                    <Badge
                      size="sm"
                      variant="outline"
                      class="text-[var(--color-text-tertiary)]/70 group-hover:text-[var(--color-primary)] transition-colors"
                    >
                      #{tag}
                    </Badge>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

export default CollectionCard;
