import { JSX, Show, For } from "solid-js";
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
      // Use rich metadata from collection_grid if available
      const songs = props.item.metadata?.collection_grid?.songs || [];
      const songMetadata = songs[0];

      const songData = {
        id: songMetadata?.song_id || props.item.domain_ids?.[0] || "",
        media_blob_id: songMetadata?.id || props.item.domain_ids?.[0] || "",
        title: songMetadata?.title || props.item.title || "Unknown Song",
        artist:
          songMetadata?.artist ||
          extractArtistFromTitle(props.item.title) ||
          "Unknown Artist",
        album: songMetadata?.album || null,
        album_artist: songMetadata?.album_artist || null,
        track_number: songMetadata?.track_number || null,
        disc_number: songMetadata?.disc_number || null,
        duration_seconds: songMetadata?.duration
          ? (() => {
              const parts = songMetadata.duration.split(":").map(Number);
              return parts[0] * 60 + (parts[1] || 0);
            })()
          : null,
        genre: songMetadata?.genre || null,
        sub_genres: songMetadata?.sub_genres || null,
        year: songMetadata?.year || null,
        bpm: null,
        key_signature: null,
        user_rating: songMetadata?.user_rating || null,
        user_is_favorite: songMetadata?.is_favorite || false,
        tags: songMetadata?.tags || [],
        display_title:
          songMetadata?.title || props.item.title || "Unknown Song",
        detailed_display_title:
          songMetadata?.title || props.item.title || "Unknown Song",
        created_at: new Date().toISOString(),
        thumbnail_blob_id: songMetadata?.thumbnail_blob_id || null,
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
      // Use rich metadata from collection_grid if available
      const songs = props.item.metadata?.collection_grid?.songs || [];
      const songMetadata = songs[0];

      const songData = {
        id: songMetadata?.song_id || props.item.domain_ids?.[0] || "",
        media_blob_id: songMetadata?.id || props.item.domain_ids?.[0] || "",
        title: songMetadata?.title || props.item.title || "Unknown Song",
        artist:
          songMetadata?.artist ||
          extractArtistFromTitle(props.item.title) ||
          "Unknown Artist",
        album: songMetadata?.album || null,
        album_artist: songMetadata?.album_artist || null,
        track_number: songMetadata?.track_number || null,
        disc_number: songMetadata?.disc_number || null,
        duration_seconds: songMetadata?.duration
          ? (() => {
              const parts = songMetadata.duration.split(":").map(Number);
              return parts[0] * 60 + (parts[1] || 0);
            })()
          : null,
        genre: songMetadata?.genre || null,
        sub_genres: songMetadata?.sub_genres || null,
        year: songMetadata?.year || null,
        bpm: null,
        key_signature: null,
        user_rating: songMetadata?.user_rating || null,
        user_is_favorite: songMetadata?.is_favorite || false,
        tags: songMetadata?.tags || [],
        display_title:
          songMetadata?.title || props.item.title || "Unknown Song",
        detailed_display_title:
          songMetadata?.title || props.item.title || "Unknown Song",
        created_at: new Date().toISOString(),
        thumbnail_blob_id: songMetadata?.thumbnail_blob_id || null,
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
      class={`timeline-item-row group cursor-pointer bg-black/30 border border-white/10 py-1 pr-2 hover:bg-black/50 transition-colors ${
        props.compact ? "h-16 self-start w-full overflow-hidden" : ""
      }`}
      onClick={handleRowClick}
      onDblClick={handleRowDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div
        class={`flex items-center gap-2 ${props.compact ? "px-0" : "px-2 md:px-0"} ${props.compact ? "min-w-0 h-full" : ""}`}
      >
        {/* Media Image with Hover Play Button */}
        <div class="relative flex-shrink-0">
          <MediaImage
            imageUrl={imageUrl}
            alt={props.item.title || "unknown item"}
            size={props.compact ? "md" : compactSize}
            domainType={props.item.domain_type as any}
            enableHover={false}
          />
          {/* Hover overlay with play button */}
          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              class="w-6 h-6 bg-magenta-600 hover:bg-magenta-500 text-white flex items-center justify-center transition-colors rounded-full"
              onClick={(e) => {
                e.stopPropagation();
                handleRowDoubleClick(e);
              }}
              title="Play"
            >
              <svg
                class="w-3 h-3 ml-0.5"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Item Info */}
        <div
          class={`item-info flex-1 min-w-0 ${props.compact ? "overflow-hidden flex flex-col justify-center h-full py-1" : ""}`}
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <MarqueeText
                text={props.item.title || "unknown item"}
                class={`text-white font-medium group-hover:text-magenta-300 transition-colors ${
                  props.compact
                    ? "text-sm leading-tight"
                    : "text-xs leading-tight"
                }`}
              />

              {/* Artist and Album info */}
              <MarqueeText
                text={(() => {
                  const songs =
                    props.item.metadata?.collection_grid?.songs || [];
                  const firstSong = songs[0];
                  const artist =
                    firstSong?.artist || props.item.metadata?.artist_name;
                  const album =
                    firstSong?.album || props.item.metadata?.album_name;
                  const genre =
                    firstSong?.genre || props.item.metadata?.genre_name;

                  const parts = [];
                  if (artist) parts.push(artist);
                  if (album) parts.push(album);
                  if (genre && parts.length < 2) parts.push(genre);

                  return parts.join(" • ") || props.item.domain_type;
                })()}
                class={`text-white/70 ${
                  props.compact
                    ? "text-xs leading-relaxed"
                    : "text-xs leading-tight"
                }`}
              />

              {/* Action and time combined */}
              <MarqueeText
                text={(() => {
                  const parts = [];
                  if (props.showUsername) {
                    parts.push(props.item.username || "");
                  }
                  parts.push(getActionText(props.item));
                  parts.push(props.item.domain_type || "");
                  if (props.showTime) {
                    parts.push(formatRelativeTime(props.item.created_at));
                  }
                  if (props.item.play_count && props.item.play_count > 1) {
                    parts.push(`${props.item.play_count} plays`);
                  }
                  return parts.join(" • ");
                })()}
                class={`text-white/50 ${
                  props.compact
                    ? "text-xs leading-relaxed"
                    : "text-xs leading-tight"
                }`}
              />
            </div>

            {/* Rating and Favorite Display */}
            <div class="flex items-center gap-2 flex-shrink-0 h-full">
              {/* Rating Stars */}
              <Show
                when={
                  props.item.item_type === "user_rated_song" &&
                  props.item.metadata?.social_context?.rating
                }
              >
                <div class="rating-display flex items-center gap-0.5">
                  <For each={[1, 2, 3, 4, 5]}>
                    {(star) => (
                      <svg
                        class={`w-3 h-3 ${
                          star <=
                          (props.item.metadata?.social_context?.rating || 0)
                            ? "text-magenta-400"
                            : "text-gray-600"
                        }`}
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    )}
                  </For>
                </div>
              </Show>

              {/* Favorite Heart */}
              <Show when={props.item.item_type === "user_favorited_song"}>
                <svg
                  class="w-4 h-4 text-magenta-400"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </Show>
            </div>
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
      </div>
    </div>
  );
}
