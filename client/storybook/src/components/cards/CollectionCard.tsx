import { createSignal, JSX, Show } from "solid-js";
import { MediaImage } from "../media/MediaImage";
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
  tags?: string | null;

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
  /** additional css classes */
  class?: string;
}

export function CollectionCard(props: CollectionCardProps): JSX.Element {
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
          container: "aspect-square w-full",
          image: "w-full h-full",
          playButton: "w-8 h-8 rounded-full",
          playIcon: "w-4 h-4",
          title: "text-xs font-medium leading-tight",
          subtitle: "text-xs leading-tight",
          meta: "text-xs leading-tight",
        };
      case "large":
        return {
          container: "aspect-square w-full",
          image: "w-full h-full",
          playButton: "w-16 h-16 rounded-full",
          playIcon: "w-8 h-8",
          title: "text-sm font-medium leading-tight",
          subtitle: "text-xs leading-tight",
          meta: "text-xs leading-tight",
        };
      default: // medium
        return {
          container: "aspect-square w-full",
          image: "w-full h-full",
          playButton: "w-12 h-12 rounded-full",
          playIcon: "w-6 h-6",
          title: "text-xs font-medium leading-tight",
          subtitle: "text-xs leading-tight",
          meta: "text-xs leading-tight",
        };
    }
  };

  const classes = sizeClasses();

  return (
    <div
      class={`group cursor-pointer ${props.class || ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* image/artwork area */}
      <div
        class={`${classes.container} bg-magenta-800/30 rounded-lg overflow-visible mb-1 relative`}
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
          <img
            src={props.collection.imageUrl!}
            alt={props.collection.title}
            class={`${classes.image} object-cover transition-all duration-200 group-hover:scale-110 group-hover:rounded-none group-hover:z-20 group-hover:shadow-2xl group-hover:-translate-y-2 rounded-lg`}
            loading="lazy"
          />
        </Show>

        {/* hover overlay with play button */}
        <div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            class={`${classes.playButton} bg-magenta-600 hover:bg-magenta-500 text-white flex items-center justify-center transition-colors`}
            onClick={handlePlay}
            title={`play ${props.collection.domainType}`}
          >
            <svg
              class={`${classes.playIcon} ml-1`}
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
          class={`text-white font-medium ${classes.title} truncate group-hover:text-magenta-300 transition-colors`}
          title={props.collection.title}
        >
          {props.collection.title}
        </div>

        {/* subtitle */}
        <Show when={props.collection.subtitle}>
          <div
            class={`text-[var(--color-text-muted)] ${classes.subtitle} truncate group-hover:text-[var(--color-text-primary)] transition-colors`}
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
            class={`text-[var(--color-text-tertiary)] ${classes.subtitle} truncate group-hover:text-[var(--color-text-secondary)] transition-colors`}
            title={`by ${props.collection.artist}`}
          >
            by {props.collection.artist}
          </div>
        </Show>

        {/* metadata row */}
        <div
          class={`text-[var(--color-text-tertiary)] ${classes.meta} group-hover:text-[var(--color-text-secondary)] transition-colors`}
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
            class={`${classes.meta} text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-muted)] transition-colors bg-black/50 px-1 py-0.5 inline-block rounded`}
          />
        </Show>
      </div>
    </div>
  );
}

export default CollectionCard;
