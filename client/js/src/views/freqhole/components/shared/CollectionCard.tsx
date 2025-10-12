import { Show, createSignal, onMount, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { apiClient } from "../../../../lib/api-client";
import { useCollectionInteractions } from "../../services/collectionInteractions";
import { MarqueeText } from "./MarqueeText";
import {
  getImageUrl,
  getTypeIcon,
  formatDuration,
} from "../../../../lib/image-utils";

// Unified collection types
export interface CollectionCardData {
  // Core identity
  id: string;
  title: string;
  subtitle?: string | null;

  // Collection type info
  domain_type: "album" | "playlist" | "artist" | "genre";
  domain_id?: string | null;

  // Media info
  image_url?: string | null;
  album_thumbnail_id?: string | null;
  thumbnail_blob_id?: string | null;

  // Metadata
  artist?: string | null;
  album?: string | null;
  year?: number | null;
  track_count?: number | null;
  song_count?: number | null;
  total_duration?: string | null;
  genres?: string | null;
  tags?: string | null;

  // Analytics/activity
  play_count?: number | null;
  last_played_at?: string | null;
  created_at?: string;

  // Feed-specific
  item_type?:
    | "recent_album"
    | "recent_playlist"
    | "recent_song"
    | "user_activity_group"
    | "trending_collection";
}

interface CollectionCardProps {
  collection: CollectionCardData;
  size?: "small" | "medium" | "large";
  showGenres?: boolean;
  showDuration?: boolean;
  showYear?: boolean;
  showPlayCount?: boolean;
  enableNavigation?: boolean;
  enableContextMenu?: boolean;
  onClick?: (collection: CollectionCardData) => void;
  onPlay?: (collection: CollectionCardData) => void;
  class?: string;
}

export function CollectionCard(props: CollectionCardProps) {
  const navigate = useNavigate();
  const collectionInteractions = useCollectionInteractions();
  const [fallbackImageUrl, setFallbackImageUrl] = createSignal<string | null>(
    null
  );

  // Helper functions using central image utility
  const getCollectionImageUrl = () => {
    const { collection } = props;

    // Use central image utility
    const url = getImageUrl(collection);
    if (url) return url;

    // Use fallback image if we fetched one
    if (fallbackImageUrl()) {
      return fallbackImageUrl();
    }

    return null;
  };

  // Try to fetch album thumbnail for albums without images
  createEffect(() => {
    const { collection } = props;

    if (
      collection.domain_type === "album" &&
      collection.album &&
      collection.artist &&
      !collection.image_url &&
      !collection.album_thumbnail_id &&
      !collection.thumbnail_blob_id &&
      !fallbackImageUrl()
    ) {
      // Try to fetch album info which might include thumbnail
      apiClient
        .getAlbumByName(collection.album, collection.artist)
        .then((albumInfo) => {
          if (albumInfo?.album_thumbnail_id) {
            setFallbackImageUrl(
              `${apiClient.getBaseUrl()}/api/blobs/${albumInfo.album_thumbnail_id}`
            );
          }
        })
        .catch(() => {
          // Silently fail - we'll show the fallback icon
        });
    }
  });

  const getTrackCount = () => {
    return props.collection.track_count || props.collection.song_count || 0;
  };

  const getTypeDisplay = () => {
    if (props.collection.item_type) {
      switch (props.collection.item_type) {
        case "recent_album":
          return "album";
        case "recent_playlist":
          return "playlist";
        case "recent_song":
          return "song";
        case "trending_collection":
          return "trending";
        case "user_activity_group":
          return "activity";
        default:
          return props.collection.domain_type;
      }
    }
    return props.collection.domain_type;
  };

  const getTypeColor = () => {
    if (props.collection.item_type) {
      switch (props.collection.item_type) {
        case "recent_album":
          return "text-blue-400";
        case "recent_playlist":
          return "text-green-400";
        case "recent_song":
          return "text-yellow-400";
        case "trending_collection":
          return "text-magenta-400";
        case "user_activity_group":
          return "text-purple-400";
        default:
          return "text-gray-400";
      }
    }
    return "text-gray-400";
  };

  // Event handlers
  const handleClick = () => {
    if (props.onClick) {
      props.onClick(props.collection);
      return;
    }

    if (props.enableNavigation) {
      const { collection } = props;

      if (
        collection.domain_type === "album" &&
        collection.album &&
        collection.artist
      ) {
        const encodedAlbum = encodeURIComponent(collection.album);
        const encodedArtist = encodeURIComponent(collection.artist);
        navigate(`/album/${encodedArtist}/${encodedAlbum}`);
      } else if (
        collection.domain_type === "playlist" &&
        collection.domain_id
      ) {
        navigate(`/playlist/${collection.domain_id}`);
      } else if (collection.domain_type === "artist" && collection.artist) {
        const encodedArtist = encodeURIComponent(collection.artist);
        navigate(`/artist/${encodedArtist}`);
      } else if (collection.domain_type === "genre") {
        // Navigate to genre view
        navigate(`/genres?selected=${encodeURIComponent(collection.title)}`);
      }
    }
  };

  const handlePlay = (e: MouseEvent) => {
    e.stopPropagation();

    if (props.onPlay) {
      props.onPlay(props.collection);
      return;
    }

    const { collection } = props;
    let domainId = collection.domain_id || collection.id;

    // For albums, create a better domain ID that includes artist info
    if (
      collection.domain_type === "album" &&
      collection.artist &&
      collection.album
    ) {
      domainId = `${collection.artist}:${collection.album}`;
    }

    // For songs, handle individual song play differently
    if (collection.domain_type === "song") {
      console.log("play individual song:", collection.title);
      // TODO: Integrate with song player when available
      return;
    }

    if (collection.domain_type && domainId) {
      collectionInteractions.playCollection(collection.domain_type, domainId, {
        total_songs: getTrackCount(),
        shuffle_enabled: false,
        play_source: "collection_card",
      });
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    if (!props.enableContextMenu) return;

    e.preventDefault();
    const { collection } = props;
    let domainId = collection.domain_id || collection.id;

    // For albums, create a better domain ID that includes artist info
    if (
      collection.domain_type === "album" &&
      collection.artist &&
      collection.album
    ) {
      domainId = `${collection.artist}:${collection.album}`;
    }

    // Skip context menu for songs for now
    if (collection.domain_type === "song") {
      return;
    }

    if (collection.domain_type && domainId) {
      collectionInteractions.showCollectionContextMenu(
        e,
        collection.domain_type,
        domainId,
        collection.title,
        {
          artist: collection.artist || undefined,
          album: collection.album || undefined,
        }
      );
    }
  };

  // Size variants
  const sizeClasses = () => {
    switch (props.size) {
      case "small":
        return {
          container: "aspect-square",
          image: "w-full h-full",
          playButton: "w-8 h-8 rounded-full",
          playIcon: "w-4 h-4",
          title: "text-xs font-medium",
          subtitle: "text-xs",
          meta: "text-xs",
        };
      case "large":
        return {
          container: "aspect-square",
          image: "w-full h-full",
          playButton: "w-16 h-16 rounded-full",
          playIcon: "w-8 h-8",
          title: "text-lg",
          subtitle: "text-base",
          meta: "text-sm",
        };
      default: // medium
        return {
          container: "aspect-square",
          image: "w-full h-full",
          playButton: "w-12 h-12 rounded-full",
          playIcon: "w-6 h-6",
          title: "text-sm",
          subtitle: "text-sm",
          meta: "text-xs",
        };
    }
  };

  const classes = sizeClasses();

  return (
    <div
      class={`group cursor-pointer transition-transform duration-200 hover:scale-[1.02] ${props.class || ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Image/artwork area */}
      <div
        class={`${classes.container} bg-magenta-800/30 rounded-lg overflow-hidden mb-3 transition-transform group-hover:scale-105 relative`}
      >
        <Show
          when={getCollectionImageUrl()}
          fallback={
            <div class="w-full h-full flex items-center justify-center">
              <div class="text-4xl text-magenta-400">
                {getTypeIcon(props.collection.domain_type)}
              </div>
            </div>
          }
        >
          <img
            src={getCollectionImageUrl()!}
            alt={props.collection.title}
            class={`${classes.image} object-cover`}
            loading="lazy"
          />
        </Show>

        {/* Hover overlay with play button */}
        <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            class={`${classes.playButton} bg-magenta-600 hover:bg-magenta-500 text-white flex items-center justify-center transition-colors`}
            onClick={handlePlay}
            title={`play ${getTypeDisplay()}`}
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

        {/* Type indicator - only show for timeline items */}
        <Show when={props.collection.item_type}>
          <div class="absolute top-2 left-2 bg-black/90 px-2 py-1 text-xs font-medium">
            <span class={getTypeColor()}>{getTypeDisplay()}</span>
          </div>
        </Show>
      </div>

      {/* Collection info */}
      <div class="space-y-1">
        {/* Title */}
        <MarqueeText
          text={props.collection.title}
          class={`text-white font-medium ${classes.title} group-hover:text-magenta-300 transition-colors`}
        />

        {/* Attribution and metadata */}
        <Show when={props.collection.subtitle}>
          <MarqueeText
            text={props.collection.subtitle || ""}
            class={`text-gray-400 ${classes.subtitle} group-hover:text-white transition-colors`}
          />
        </Show>

        {/* Artist info for albums/songs */}
        <Show
          when={
            props.collection.artist &&
            !props.collection.subtitle?.includes(props.collection.artist!)
          }
        >
          <MarqueeText
            text={`by ${props.collection.artist}`}
            class={`text-gray-500 ${classes.subtitle} group-hover:text-gray-300 transition-colors`}
          />
        </Show>

        {/* Metadata row */}
        <div
          class={`text-gray-500 ${classes.meta} group-hover:text-gray-300 transition-colors flex items-center justify-between`}
        >
          <div class="flex items-center space-x-2">
            {/* Year */}
            <Show when={props.showYear && props.collection.year}>
              <span>{props.collection.year}</span>
            </Show>

            {/* Track count */}
            <Show when={getTrackCount() > 0}>
              <span>
                {getTrackCount()} track{getTrackCount() !== 1 ? "s" : ""}
              </span>
            </Show>

            {/* Duration */}
            <Show when={props.showDuration && props.collection.total_duration}>
              <span>{formatDuration(props.collection.total_duration!)}</span>
            </Show>

            {/* Play count */}
            <Show when={props.showPlayCount && props.collection.play_count}>
              <span>{props.collection.play_count} plays</span>
            </Show>
          </div>
        </div>

        {/* Genres */}
        <Show when={props.showGenres && props.collection.genres}>
          <MarqueeText
            text={props.collection.genres!}
            class={`${classes.meta} text-gray-600 group-hover:text-gray-400 transition-colors bg-black/50 px-1 py-0.5 inline-block`}
          />
        </Show>
      </div>
    </div>
  );
}
