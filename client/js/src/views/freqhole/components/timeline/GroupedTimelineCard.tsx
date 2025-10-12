import { JSX, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { MarqueeText } from "../shared/MarqueeText";
import {
  CollectionCard,
  type CollectionCardData,
} from "../shared/CollectionCard";
import { useCollectionInteractions } from "../../services/collectionInteractions";
import { useSongInteractions } from "../../services/songInteractions";
import type { FeedItem } from "../../../../lib/analytics/analytics-api";
import type { GroupedFeedItem } from "./timeline-grouping";
import { getGroupSummaryText } from "./timeline-grouping";
import { TimelineItemRow } from "./TimelineItemRow";
import { formatRelativeTime } from "../../../../lib/date-utils";

interface GroupedTimelineCardProps {
  group: GroupedFeedItem;
}

export function GroupedTimelineCard(
  props: GroupedTimelineCardProps
): JSX.Element {
  const navigate = useNavigate();
  const collectionInteractions = useCollectionInteractions();
  const songInteractions = useSongInteractions();

  const createItemCardData = (item: FeedItem): CollectionCardData => {
    return {
      id: item.domain_ids?.[0] || "",
      title: item.title,
      subtitle: getItemSubtitle(item),
      domain_type: item.domain_type as
        | "album"
        | "playlist"
        | "artist"
        | "genre"
        | "song",
      image_url: item.image_url,
      play_count: item.play_count,
      last_played_at: item.last_played_at,
      created_at: item.created_at,
    };
  };

  const getItemSubtitle = (item: FeedItem): string => {
    const action = getSingleItemActionText(item);
    const time = new Date(item.created_at).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${action} at ${time}`;
  };

  const getSingleItemActionText = (item: FeedItem): string => {
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

  const handleSingleSongPlay = (item: FeedItem) => {
    const songData = {
      id: item.domain_ids?.[0] || "",
      media_blob_id: item.domain_ids?.[0] || "",
      title: item.title || "Unknown Song",
      artist: extractArtistFromTitle(item.title) || "Unknown Artist",
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
      display_title: item.title || "Unknown Song",
      detailed_display_title: item.title || "Unknown Song",
      created_at: new Date().toISOString(),
      thumbnail_blob_id: null,
      waveform_blob_id: null,
      thumbnail_blob_ids: [],
      preference_updated_at: null,
    };

    songInteractions.playSong(songData, true);
  };

  const handleSingleCollectionPlay = (item: FeedItem) => {
    switch (item.domain_type) {
      case "album":
        // Extract album and artist from title
        const albumArtist = extractArtistFromTitle(item.title);
        if (albumArtist && item.title) {
          const albumName = item.title.split(" - ")[0];
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
        if (item.domain_ids?.[0]) {
          collectionInteractions.playPlaylist(
            item.domain_ids[0],
            item.title || "Unknown Playlist"
          );
        }
        break;
      case "artist":
        if (item.title) {
          const artistObj = {
            artist: item.title,
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
        if (item.title) {
          const genreObj = {
            name: item.title,
            slug: item.title.toLowerCase().replace(/\s+/g, "-"),
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
  };

  const handleViewItemNavigation = (item: FeedItem) => {
    switch (item.domain_type) {
      case "artist":
        if (item.title) {
          const encodedArtist = encodeURIComponent(item.title);
          navigate(`/artist/${encodedArtist}`);
        }
        break;
      case "album":
        const artist = extractArtistFromTitle(item.title);
        if (artist && item.title) {
          const albumName = item.title.split(" - ")[0];
          const encodedAlbum = encodeURIComponent(albumName);
          const encodedArtist = encodeURIComponent(artist);
          navigate(`/album/${encodedArtist}/${encodedAlbum}`);
        }
        break;
      case "song":
        const songArtist = extractArtistFromTitle(item.title);
        if (songArtist) {
          const encodedArtist = encodeURIComponent(songArtist);
          navigate(`/artist/${encodedArtist}`);
        }
        break;
      default:
        break;
    }
  };

  const extractArtistFromTitle = (title: string): string | null => {
    const parts = title.split(" - ");
    return parts.length > 1 ? parts[1] : null;
  };

  const getItemIcon = (item: FeedItem): string => {
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

  const getItemIconColor = (item: FeedItem): string => {
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

  const getGroupBorderColor = (): string => {
    if (props.group.groupType === "consecutive") {
      return "border-l-green-400";
    }
    return "border-l-transparent";
  };

  return (
    <div
      class={`grouped-timeline-card bg-black border-b border-white/10 border-l-4 ${getGroupBorderColor()} px-0 py-4 md:p-4 hover:bg-white/5 transition-colors`}
    >
      {/* User Action Header */}
      <div class="timeline-header mb-3 px-2 md:px-0">
        <div class="user-action text-sm text-white/70">
          <span class="username text-green-400 font-medium">
            {props.group.user.username}
          </span>
          <span class="action text-white/50 mx-2">
            {getGroupSummaryText(props.group)}
          </span>
        </div>
        <div class="timestamp text-xs text-white/40 mt-1">
          {formatRelativeTime(props.group.timestamp.latest)}
        </div>
      </div>

      {/* Single Item Display - Use compact row */}
      <Show when={props.group.groupType === "single"}>
        <div class="single-item-container mt-3 px-2 md:px-0">
          <TimelineItemRow
            item={props.group.items[0]}
            showTime={false}
            showUsername={false}
            compact={false}
          />
        </div>
      </Show>

      {/* Consecutive Items Display */}
      <Show when={props.group.groupType === "consecutive"}>
        <div class="consecutive-items-container bg-white/5 border border-white/10 rounded-none p-3 mx-2 md:mx-0">
          {/* Consecutive Items Grid */}
          <div class="consecutive-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            <For each={props.group.items}>
              {(item) => (
                <TimelineItemRow
                  item={item}
                  showTime={true}
                  showUsername={false}
                  compact={true}
                />
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Social Context */}
      <Show when={props.group.groupType === "consecutive"}>
        <div class="social-context mt-2 text-xs text-white/40 px-2 md:px-0">
          <span class="grouping-indicator text-green-400">
            consecutive activity group
          </span>
          <span class="play-count">• {props.group.items.length} actions</span>
          <span class="time-span">
            •{" "}
            {Math.ceil(
              (new Date(props.group.timestamp.latest).getTime() -
                new Date(props.group.timestamp.earliest).getTime()) /
                (1000 * 60)
            )}
            min span
          </span>
        </div>
      </Show>
    </div>
  );
}
