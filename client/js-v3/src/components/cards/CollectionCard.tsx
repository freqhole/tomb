import { createSignal, JSX, Show } from "solid-js";
import type { FavoriteTarget } from "../../music/queries/favorites";
import { MediaImage } from "../media/MediaImage";
import { FavoriteToggle } from "../ratings/FavoriteToggle";
import { MarqueeText } from "../text/MarqueeText";

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
  onFavoriteToggle?: (
    collection: CollectionCardData,
    isFavorite: boolean,
  ) => void;
  /** additional css classes */
  class?: string;
}

export function CollectionCard(props: CollectionCardProps): JSX.Element {
  const [isCardHovering, setIsCardHovering] = createSignal(false);

  // event handlers
  const handleClick = () => {
    if (props.onClick) {
      props.onClick(props.collection);
    }
  };

  const handlePlay = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.onPlay) {
      props.onPlay(props.collection);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (props.onContextMenu) {
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
    <div
      class={`group cursor-pointer flex flex-col ${props.class || ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* image/artwork area */}
      <div
        class={`${sizeClasses().container} bg-[var(--color-bg-base)] rounded-lg mb-2 relative transition-all duration-300 group-hover:rounded-none`}
      >
        <Show
          when={props.collection.imageUrl}
          fallback={
            <div class="w-full h-full flex items-center justify-center bg-[var(--color-bg-elevated)] rounded-lg">
              <MediaImage
                imageUrl={null}
                alt={props.collection.title}
                domainType={props.collection.domainType}
                showFallback={true}
                size="lg"
              />
            </div>
          }
        >
          <div
            class="w-full h-full bg-cover group-hover:bg-contain bg-center bg-no-repeat transition-all duration-300 group-hover:scale-105 rounded-lg"
            style={`background-image: url('${props.collection.imageUrl}')`}
            role="img"
            aria-label={props.collection.title}
          />
        </Show>

        {/* favorite toggle - top right corner */}
        <Show
          when={
            props.collection.isFavorite !== undefined &&
            props.collection.isFavorite !== null
          }
        >
          <div class="absolute top-2 right-2 z-10">
            <FavoriteToggle
              targetType={props.collection.domainType as FavoriteTarget}
              targetId={props.collection.id}
              isFavorite={props.collection.isFavorite ?? false}
              size="sm"
              class="bg-black/30 backdrop-blur-sm rounded-full hover:bg-black/50 transition-colors"
              onToggleSuccess={(newValue) => {
                props.onFavoriteToggle?.(props.collection, newValue);
              }}
            />
          </div>
        </Show>

        {/* hover overlay with play button */}
        <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            class={`${sizeClasses().playButton} bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center transition-colors`}
            onClick={handlePlay}
            title={`play ${props.collection.domainType}`}
          >
            <svg
              class={`${sizeClasses().playIcon} ml-1`}
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      </div>

      {/* collection info */}
      <div class="space-y-0.5 min-w-0">
        {/* title */}
        <div
          class={`text-[var(--color-text-primary)] font-medium ${sizeClasses().title} truncate group-hover:text-[var(--color-accent-500)] transition-colors`}
          title={props.collection.title}
        >
          {props.collection.title}
        </div>

        {/* subtitle */}
        <Show when={props.collection.subtitle}>
          <div
            class={`text-[var(--color-text-muted)] ${sizeClasses().subtitle} truncate group-hover:text-[var(--color-text-primary)] transition-colors`}
            title={props.collection.subtitle || ""}
          >
            {props.collection.subtitle}
          </div>
        </Show>

        {/* artist info for albums/songs only - not playlists */}
        <Show
          when={
            props.collection.artist &&
            props.collection.domainType !== "playlist" &&
            !props.collection.subtitle?.includes(props.collection.artist!)
          }
        >
          <div
            class={`text-[var(--color-text-tertiary)] ${sizeClasses().subtitle} truncate group-hover:text-[var(--color-text-secondary)] transition-colors`}
            title={`by ${props.collection.artist}`}
          >
            by {props.collection.artist}
          </div>
        </Show>

        {/* metadata row */}
        <div
          class={`text-[var(--color-text-tertiary)] ${sizeClasses().meta} group-hover:text-[var(--color-text-secondary)] transition-colors`}
        >
          <div class="flex items-center gap-2 flex-wrap">
            {/* year */}
            <Show when={props.showYear && props.collection.year}>
              <span>{props.collection.year}</span>
            </Show>

            {/* track count */}
            <Show
              when={
                props.collection.trackCount && props.collection.trackCount > 0
              }
            >
              <span>
                {props.collection.trackCount} track
                {props.collection.trackCount !== 1 ? "s" : ""}
              </span>
            </Show>

            {/* duration */}
            <Show when={props.showDuration && props.collection.totalDuration}>
              <span>{props.collection.totalDuration}</span>
            </Show>

            {/* play count */}
            <Show when={props.showPlayCount && props.collection.playCount}>
              <span>{props.collection.playCount} plays</span>
            </Show>
          </div>
        </div>

        {/* genres */}
        <Show when={props.showGenres && props.collection.genres}>
          <MarqueeText
            text={props.collection.genres!}
            class={`${sizeClasses().meta} text-[var(--color-text-tertiary)} group-hover:text-[var(--color-text-muted)] transition-colors bg-black/50 px-1 py-0.5 rounded`}
            hoverOnly={!isCardHovering()}
          />
        </Show>
        {/* tags */}
        <Show when={props.collection.tags && props.collection.tags.length > 0}>
          <div class="w-full overflow-hidden">
            <MarqueeText
              text={props.collection.tags!.join(" • ")}
              class={`${sizeClasses().meta} text-[var(--color-text-tertiary)] group-hover:text-[var(--color-accent-500)] transition-colors bg-[var(--color-accent-500)]/10 px-1 py-0.5 rounded`}
              hoverOnly={!isCardHovering()}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}

export default CollectionCard;
