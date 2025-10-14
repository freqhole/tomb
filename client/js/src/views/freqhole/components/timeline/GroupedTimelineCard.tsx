import { JSX, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  CollectionCard,
  type CollectionCardData,
} from "../shared/CollectionCard";
import { useCollectionInteractions } from "../../services/collectionInteractions";

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

  const createItemCardData = (item: FeedItem): CollectionCardData => {
    // Aggregate metadata from songs in collection_grid
    const songs = item.metadata?.collection_grid?.songs || [];

    // Calculate aggregated metadata
    const years = songs.map((s) => s.year).filter(Boolean);
    const genres = songs.map((s) => s.genre).filter(Boolean);
    const tags = songs.flatMap((s) => s.tags || []).filter(Boolean);
    const durations = songs.map((s) => s.duration).filter(Boolean);

    // Calculate total duration in seconds
    const totalSeconds = durations.reduce((sum, duration) => {
      if (!duration) return sum;
      const parts = duration.split(":").map(Number);
      return sum + parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
    }, 0);

    const formatTotalDuration = (seconds: number): string => {
      if (seconds === 0) return "";
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return hours > 0
        ? `${hours}:${mins.toString().padStart(2, "0")}:00`
        : `${mins}:00`;
    };

    // Handle activity/session items differently
    const isActivityItem =
      item.item_type?.includes("activity") ||
      item.item_type?.includes("session");

    return {
      id: item.domain_ids?.[0] || item.user_id || "",
      title: item.title,
      subtitle: isActivityItem ? item.subtitle : getItemSubtitle(item),
      domain_type: (item.domain_type === "collection"
        ? "album"
        : item.domain_type) as "album" | "playlist" | "artist" | "genre",
      image_url: item.image_url,
      play_count: item.play_count,
      last_played_at: item.last_played_at,
      created_at: item.created_at,
      // Enhanced metadata aggregation
      artist: item.metadata?.artist_name || songs[0]?.artist,
      album: item.metadata?.album_name || songs[0]?.album,
      year: years.length > 0 ? Math.min(...years) : null, // Use earliest year
      track_count:
        item.metadata?.total_songs ||
        item.metadata?.user_activity?.unique_collections ||
        songs.length,
      genres: [...new Set(genres)].join(", ") || null, // Unique genres
      tags: [...new Set(tags)].join(", ") || null, // Unique tags
      total_duration: isActivityItem
        ? item.metadata?.user_activity?.session_duration
          ? formatTotalDuration(item.metadata.user_activity.session_duration)
          : null
        : formatTotalDuration(totalSeconds) || null,
      item_type: item.item_type as any,
      // Try to get thumbnail from first song that has one
      thumbnail_blob_id: songs.find((s) => s.thumbnail_blob_id)
        ?.thumbnail_blob_id,
      // Also try image_url if available
      image_url: item.image_url || null,
    };
  };

  const isCollectionContext = (item: FeedItem): boolean => {
    return (
      item.domain_type === "album" ||
      item.domain_type === "playlist" ||
      item.domain_type === "artist"
    );
  };

  // Filter out individual songs when there's an album card with same artist/album
  const getFilteredItems = (items: FeedItem[]): FeedItem[] => {
    const albumItems = items.filter((item) => item.domain_type === "album");

    if (albumItems.length === 0) {
      return items; // No albums, return all items
    }

    // Get album identifiers for filtering
    const albumKeys = new Set(
      albumItems.map((album) => {
        // Extract album and artist from different possible sources
        let albumName = album.metadata?.album_name;
        let artistName = album.metadata?.artist_name;

        // Try extracting from title if metadata is missing
        if (!albumName || !artistName) {
          const titleParts = album.title?.split(" by ") || [];
          if (titleParts.length >= 2) {
            albumName = albumName || titleParts[0];
            artistName = artistName || titleParts[1];
          }
        }

        // Try extracting from collection_grid songs
        if (!albumName || !artistName) {
          const firstSong = album.metadata?.collection_grid?.songs?.[0];
          albumName = albumName || firstSong?.album;
          artistName = artistName || firstSong?.artist;
        }

        return `${albumName}:${artistName}`.toLowerCase();
      })
    );

    // Filter out songs that match any album
    return items.filter((item) => {
      if (item.domain_type !== "song") {
        return true; // Keep all non-song items (including activity/session items)
      }

      // Extract song's album/artist info from title parsing
      const songTitle = item.title || "";
      const titleMatch = songTitle.match(/^(.+?)\s*-\s*(.+)$/);
      let songTitle_clean = titleMatch ? titleMatch[1] : songTitle;
      let songArtist = titleMatch ? titleMatch[2] : "";

      // Try getting from metadata first
      const songAlbum = item.metadata?.collection_grid?.songs?.[0]?.album;
      const songArtistMeta = item.metadata?.collection_grid?.songs?.[0]?.artist;

      // Use metadata if available, otherwise use parsed values
      const finalAlbum = songAlbum || songTitle_clean;
      const finalArtist = songArtistMeta || songArtist;

      if (!finalAlbum || !finalArtist) {
        return true; // Keep songs without clear album/artist info
      }

      const songKey = `${finalAlbum}:${finalArtist}`.toLowerCase();
      return !albumKeys.has(songKey); // Remove songs that match an album
    });
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

  const handleSingleCollectionPlay = (item: FeedItem) => {
    switch (item.domain_type) {
      case "album":
        // Extract album and artist from title
        const albumArtist = extractArtistFromTitle(item.title);
        if (albumArtist && item.title) {
          const albumName = item.title.split(" - ")[0];
          const albumObj = {
            album: albumName || null,
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
        const artist = extractArtistFromTitle(item.title || "");
        if (artist && item.title) {
          const albumName = item.title.split(" - ")[0];
          const encodedAlbum = encodeURIComponent(albumName || "");
          const encodedArtist = encodeURIComponent(artist);
          navigate(`/album/${encodedArtist}/${encodedAlbum}`);
        }
        break;
      case "song":
        const songArtist = extractArtistFromTitle(item.title || "");
        if (songArtist) {
          const encodedArtist = encodeURIComponent(songArtist);
          navigate(`/artist/${encodedArtist}`);
        }
        break;
      default:
        break;
    }
  };

  const extractArtistFromTitle = (
    title: string | null | undefined
  ): string | null => {
    if (!title) return null;
    const parts = title.split(" - ");
    return parts.length > 1 ? parts[1] || null : null;
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

      {/* Single Item Display - Use collection card for album/playlist/artist/activity, row for songs */}
      <Show when={props.group.groupType === "single" && props.group.items[0]}>
        <div class="single-item-container mt-3 px-2 md:px-0">
          <Show
            when={
              props.group.items[0] &&
              props.group.items[0].domain_type !== "song"
            }
            fallback={
              props.group.items[0] && (
                <TimelineItemRow
                  item={props.group.items[0]}
                  showTime={false}
                  showUsername={false}
                  compact={false}
                />
              )
            }
          >
            {props.group.items[0] && (
              <CollectionCard
                collection={createItemCardData(props.group.items[0])}
                onPlay={() => handleSingleCollectionPlay(props.group.items[0]!)}
                onClick={() => handleViewItemNavigation(props.group.items[0]!)}
                showPlayCount={true}
                showYear={true}
                showGenres={true}
                showDuration={true}
                enableNavigation={true}
                enableContextMenu={true}
                size="small"
              />
            )}
          </Show>
        </div>
      </Show>

      {/* Consecutive Items Display */}
      <Show when={props.group.groupType === "consecutive"}>
        <div class="consecutive-items-container bg-white/5 border border-white/10 rounded-none p-3 mx-2 md:mx-0">
          {/* Consecutive Items Grid */}
          <div class="consecutive-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <For each={getFilteredItems(props.group.items)}>
              {(item) => (
                <Show
                  when={item.domain_type !== "song"}
                  fallback={
                    <TimelineItemRow
                      item={item}
                      showTime={true}
                      showUsername={false}
                      compact={true}
                    />
                  }
                >
                  <CollectionCard
                    collection={createItemCardData(item)}
                    onPlay={() => handleSingleCollectionPlay(item)}
                    onClick={() => handleViewItemNavigation(item)}
                    showPlayCount={true}
                    showYear={true}
                    showGenres={true}
                    showDuration={true}
                    size="small"
                    enableNavigation={true}
                    enableContextMenu={true}
                  />
                </Show>
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
