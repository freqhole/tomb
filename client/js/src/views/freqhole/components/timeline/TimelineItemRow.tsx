import { JSX, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { MarqueeText } from "../shared/MarqueeText";
import { MediaImage } from "../shared/MediaImage";
import { useCollectionInteractions } from "../../services/collectionInteractions";
import { useSongInteractions } from "../../services/songInteractions";
import type { FeedItem } from "../../../../lib/analytics/analytics-api";
import { formatRelativeTime } from "../../../../lib/date-utils";
import { getImageUrl } from "../../../../lib/image-utils";
import { isMobile } from "../../../../lib/format-utils";

interface TimelineItemRowProps {
  item: FeedItem;
  showTime?: boolean;
  showUsername?: boolean;
  compact?: boolean;
  showNavButton?: boolean;
}

export function TimelineItemRow(props: TimelineItemRowProps): JSX.Element {
  const navigate = useNavigate();
  const collectionInteractions = useCollectionInteractions();
  const songInteractions = useSongInteractions();

  const getActionText = (item: FeedItem): string => {
    switch (item.item_type) {
      case "user_played_song":
        return "played";
      case "user_played_album":
        return "played album";
      case "user_played_playlist":
        return "played playlist";
      case "user_played_artist":
        return "listened to";
      case "user_played_genre":
        return "explored";
      case "user_favorited_song":
        return "favorited";
      case "user_favorited_album":
        return "favorited album";
      case "user_favorited_playlist":
        return "favorited playlist";
      case "user_unfavorited_song":
        return "unfavorited";
      case "user_rated_song":
        return "rated";
      default:
        return "interacted with";
    }
  };

  const getActionIcon = (item: FeedItem): string => {
    switch (item.item_type) {
      case "user_played_song":
      case "user_played_album":
      case "user_played_playlist":
      case "user_played_artist":
      case "user_played_genre":
        return "▶";
      case "user_favorited_song":
      case "user_favorited_album":
      case "user_favorited_playlist":
        return "♥";
      case "user_unfavorited_song":
        return "♡";
      case "user_rated_song":
        return "★";
      default:
        return "•";
    }
  };

  const getActionIconColor = (item: FeedItem): string => {
    switch (item.item_type) {
      case "user_played_song":
      case "user_played_album":
      case "user_played_playlist":
      case "user_played_artist":
      case "user_played_genre":
        return "text-white";
      case "user_favorited_song":
      case "user_favorited_album":
      case "user_favorited_playlist":
        return "text-magenta";
      case "user_unfavorited_song":
        return "text-white/50";
      case "user_rated_song":
        return "text-yellow-400";
      default:
        return "text-white/70";
    }
  };

  const extractArtistFromTitle = (title: string): string | null => {
    const parts = title.split(" - ");
    return parts.length > 1 ? parts[1] : null;
  };

  const handlePlay = (e?: MouseEvent) => {
    e?.stopPropagation();

    if (props.item.domain_type === "song") {
      const songData = {
        id: props.item.domain_ids?.[0] || "",
        media_blob_id: props.item.domain_ids?.[0] || "",
        title: props.item.title || "Unknown Song",
        artist: extractArtistFromTitle(props.item.title) || "Unknown Artist",
        album: null,
        album_artist: null,
        track_number: null,
        disc_number: null,
        duration_seconds: null,
        genre: null,
        sub_genres: null,
        year: null,
        bpm: null,
        key_signature: null,
        user_rating: null,
        user_is_favorite: false,
        tags: [],
        display_title: props.item.title || "Unknown Song",
        detailed_display_title: props.item.title || "Unknown Song",
        created_at: new Date().toISOString(),
        thumbnail_blob_id: null,
        waveform_blob_id: null,
        thumbnail_blob_ids: [],
        preference_updated_at: null,
      };
      songInteractions.playSong(songData, true);
    } else {
      // Handle collection play
      switch (props.item.domain_type) {
        case "album":
          // Extract album and artist from title
          const albumArtist = extractArtistFromTitle(props.item.title);
          if (albumArtist && props.item.title) {
            const albumName = props.item.title.split(" - ")[0];
            const albumObj = {
              album: albumName,
              artist: albumArtist,
              year: null,
              track_count: 0,
              disc_count: 1,
              total_duration: null,
              genres: null,
              avg_rating: null,
              favorite_count: 0,
              album_thumbnail_id: null,
            };
            collectionInteractions.playAlbum(albumObj);
          }
          break;
        case "playlist":
          if (props.item.domain_ids?.[0]) {
            collectionInteractions.playPlaylist(
              props.item.domain_ids[0],
              props.item.title || "Unknown Playlist"
            );
          }
          break;
        case "artist":
          if (props.item.title) {
            const artistObj = {
              artist: props.item.title,
              song_count: 0,
              album_count: 0,
              total_duration: 0,
              genres: [],
              avg_rating: null,
              favorite_count: 0,
            };
            collectionInteractions.playArtist(artistObj);
          }
          break;
        case "genre":
          if (props.item.title) {
            const genreObj = {
              name: props.item.title,
              slug: props.item.title.toLowerCase().replace(/\s+/g, "-"),
              song_count: 0,
              album_count: 0,
              artist_count: 0,
              total_duration: 0,
            };
            collectionInteractions.playGenre(genreObj);
          }
          break;
        default:
          break;
      }
    }
  };

  const handleRowClick = () => {
    // On mobile, single click to play
    if (isMobile()) {
      handlePlay();
    }
    // On desktop, single click does nothing (double click to play)
  };

  const handleRowDoubleClick = () => {
    handlePlay();
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (props.item.domain_type === "song") {
      const songData = {
        id: props.item.domain_ids?.[0] || "",
        media_blob_id: props.item.domain_ids?.[0] || "",
        title: props.item.title || "Unknown Song",
        artist: extractArtistFromTitle(props.item.title) || "Unknown Artist",
        album: null,
        album_artist: null,
        track_number: null,
        disc_number: null,
        duration_seconds: null,
        genre: null,
        sub_genres: null,
        year: null,
        bpm: null,
        key_signature: null,
        user_rating: null,
        user_is_favorite: false,
        tags: [],
        display_title: props.item.title || "Unknown Song",
        detailed_display_title: props.item.title || "Unknown Song",
        created_at: new Date().toISOString(),
        thumbnail_blob_id: null,
        waveform_blob_id: null,
        thumbnail_blob_ids: [],
        preference_updated_at: null,
      };

      songInteractions.handleRightClick(e, songData, {
        hideViewArtist: !extractArtistFromTitle(props.item.title),
        hideViewAlbum: true, // We don't have album info in feed items
      });
    }
  };

  const handleViewNavigation = () => {
    switch (props.item.domain_type) {
      case "artist":
        if (props.item.title) {
          const encodedArtist = encodeURIComponent(props.item.title);
          navigate(`/artist/${encodedArtist}`);
        }
        break;
      case "album":
        const artist = extractArtistFromTitle(props.item.title);
        if (artist && props.item.title) {
          const albumName = props.item.title.split(" - ")[0];
          const encodedAlbum = encodeURIComponent(albumName);
          const encodedArtist = encodeURIComponent(artist);
          navigate(`/album/${encodedArtist}/${encodedAlbum}`);
        }
        break;
      case "song":
        const songArtist = extractArtistFromTitle(props.item.title);
        if (songArtist) {
          const encodedArtist = encodeURIComponent(songArtist);
          navigate(`/artist/${encodedArtist}`);
        }
        break;
      default:
        break;
    }
  };

  const getImageSource = () => {
    // Create image source object compatible with getImageUrl
    const imageSource = {
      id: props.item.domain_ids?.[0] || "",
      image_url: props.item.image_url,
      thumbnail_blob_id:
        props.item.metadata?.collection_grid?.songs?.[0]?.thumbnail_blob_id,
    };

    return getImageUrl(imageSource);
  };

  const imageUrl = getImageSource();
  const compactSize = props.compact ? "xs" : "sm";

  return (
    <div
      class="timeline-item-row group cursor-pointer bg-black/30 border border-white/10 px-0 py-1 md:p-1 hover:bg-black/50 transition-colors"
      onClick={handleRowClick}
      onDblClick={handleRowDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div class="flex items-center gap-2 px-2 md:px-0">
        {/* Media Image */}
        <MediaImage
          imageUrl={imageUrl}
          alt={props.item.title || "unknown item"}
          size={compactSize}
          domainType={props.item.domain_type as any}
          enableHover={false}
        />

        {/* Action Icon */}
        <div
          class={`action-icon text-xs ${getActionIconColor(props.item)} flex-shrink-0`}
        >
          {getActionIcon(props.item)}
        </div>

        {/* Item Info */}
        <div class="item-info flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <MarqueeText
                text={props.item.title || "unknown item"}
                class="text-white text-xs font-medium group-hover:text-magenta-300 transition-colors leading-tight"
              />

              <div class="text-white/60 text-xs leading-tight">
                <Show when={props.showUsername}>
                  <span class="text-magenta-400">{props.item.username}</span>
                  <span class="mx-1">•</span>
                </Show>
                {getActionText(props.item)} • {props.item.domain_type}
                <Show when={props.item.play_count && props.item.play_count > 1}>
                  <span class="mx-1">•</span>
                  <span class="text-white/50">
                    {props.item.play_count} plays
                  </span>
                </Show>
              </div>

              <Show when={props.showTime}>
                <div class="text-white/40 text-xs leading-tight">
                  {formatRelativeTime(props.item.created_at)}
                </div>
              </Show>
            </div>

            {/* Rating Display for Rating Events */}
            <Show
              when={
                props.item.item_type === "user_rated_song" &&
                props.item.metadata?.social_context?.rating
              }
            >
              <div class="rating-display flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    class={`text-xs ${
                      star <= (props.item.metadata?.social_context?.rating || 0)
                        ? "text-yellow-400"
                        : "text-white/20"
                    }`}
                  >
                    ★
                  </span>
                ))}
              </div>
            </Show>
          </div>
        </div>

        {/* Navigation Button (optional) */}
        <Show when={props.showNavButton}>
          <button
            class="nav-btn w-6 h-6 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mr-1"
            onClick={(e) => {
              e.stopPropagation();
              handleViewNavigation();
            }}
            title={`view ${props.item.domain_type}`}
          >
            <svg
              class="w-3 h-3 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
            </svg>
          </button>
        </Show>

        {/* Play Button */}
        <button
          class="play-btn w-6 h-6 bg-magenta-600/70 hover:bg-magenta-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={handlePlay}
          title={`play ${props.item.domain_type}`}
        >
          <svg
            class="w-3 h-3 text-white ml-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
