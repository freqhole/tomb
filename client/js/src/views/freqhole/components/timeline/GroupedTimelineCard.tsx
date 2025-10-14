import { JSX, Show, For, createSignal, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  CollectionCard,
  type CollectionCardData,
} from "../shared/CollectionCard";
import { useCollectionInteractions } from "../../services/collectionInteractions";
import { useSongInteractions } from "../../services/songInteractions";
import { apiClient } from "../../../../lib/api-client";

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

    // For compilation albums, prefer album_artist over individual track artists
    // For playlists, handle differently
    const getDisplayArtist = () => {
      if (isActivityItem) return item.metadata?.artist_name || songs[0]?.artist;

      // For playlists, don't show artist - will be handled in subtitle
      if (item.domain_type === "playlist") {
        return null;
      }

      // For albums, use album_artist if available (compilation albums)
      const firstSong = songs[0];
      if (
        firstSong?.album_artist &&
        firstSong.album_artist !== firstSong.artist
      ) {
        return firstSong.album_artist;
      }

      return item.metadata?.artist_name || firstSong?.artist;
    };

    // Get appropriate subtitle based on domain type
    const getDisplaySubtitle = () => {
      if (isActivityItem) return item.subtitle;

      if (item.domain_type === "playlist") {
        // For playlists, show description or track count
        const description = item.metadata?.description || item.subtitle;
        const trackCount = item.metadata?.total_songs || songs.length;
        if (description && description !== item.title) {
          return description;
        }
        return trackCount > 0
          ? `${trackCount} track${trackCount !== 1 ? "s" : ""}`
          : null;
      }

      return getItemSubtitle(item);
    };

    return {
      id: item.domain_ids?.[0] || item.user_id || "",
      title: item.title,
      subtitle: getDisplaySubtitle(),
      domain_type: (item.domain_type === "collection"
        ? "album"
        : item.domain_type) as "album" | "playlist" | "artist" | "genre",
      image_url: item.image_url,
      play_count: item.play_count,
      last_played_at: item.last_played_at,
      created_at: item.created_at,
      // Enhanced metadata aggregation with album_artist support
      artist: getDisplayArtist(),
      album: item.metadata?.album_name || songs[0]?.album,
      album_artist: songs[0]?.album_artist,
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
      // For playlists, prefer playlist thumbnail, fall back to first song thumbnail
      thumbnail_blob_id:
        item.domain_type === "playlist"
          ? item.metadata?.thumbnail_blob_id ||
            songs.find((s) => s.thumbnail_blob_id)?.thumbnail_blob_id
          : songs.find((s) => s.thumbnail_blob_id)?.thumbnail_blob_id,
      // Enhanced image URL handling for playlists
      image_url:
        item.image_url ||
        (item.domain_type === "playlist" ? item.metadata?.image_url : null) ||
        null,
    };
  };

  const isCollectionContext = (item: FeedItem): boolean => {
    return (
      item.domain_type === "album" ||
      item.domain_type === "playlist" ||
      item.domain_type === "artist"
    );
  };

  // Filter out individual songs when there's an album or playlist card that contains them
  const getFilteredItems = (items: FeedItem[]): FeedItem[] => {
    const albumItems = items.filter((item) => item.domain_type === "album");
    const playlistItems = items.filter(
      (item) => item.domain_type === "playlist"
    );

    if (albumItems.length === 0 && playlistItems.length === 0) {
      return items; // No albums or playlists, return all items
    }

    // Get album identifiers for filtering - use collection_grid songs for accurate data
    // Handle compilation albums by using album_artist when available
    const albumKeys = new Set(
      albumItems.flatMap((album) => {
        const songs = album.metadata?.collection_grid?.songs || [];
        return songs.map((song) => {
          const albumName =
            song.album ||
            album.metadata?.album_name ||
            album.title?.split(" by ")[0];
          // Use album_artist for compilation albums, fall back to artist
          const artistName =
            song.album_artist ||
            song.artist ||
            album.metadata?.artist_name ||
            album.title?.split(" by ")[1];
          return `${albumName}:${artistName}`.toLowerCase().trim();
        });
      })
    );

    // Get playlist song identifiers for filtering
    const playlistSongIds = new Set(
      playlistItems.flatMap((playlist) => {
        const songs = playlist.metadata?.collection_grid?.songs || [];
        return songs.map((song) => song.id || song.song_id).filter(Boolean);
      })
    );

    // Filter out songs that match any album or are contained in any playlist
    return items.filter((item) => {
      if (item.domain_type !== "song") {
        return true; // Keep all non-song items
      }

      // Check if song is in any playlist first (by song ID)
      const songId = item.domain_ids?.[0];
      if (songId && playlistSongIds.has(songId)) {
        return false; // Remove songs that are in playlists
      }

      // Get song's album/artist from its metadata for album filtering
      const songs = item.metadata?.collection_grid?.songs || [];
      const firstSong = songs[0];

      if (
        !firstSong?.album ||
        (!firstSong?.artist && !firstSong?.album_artist)
      ) {
        return true; // Keep songs without clear album/artist info
      }

      // Check against both album_artist and artist for compilation album matching
      const albumArtistKey = firstSong.album_artist
        ? `${firstSong.album}:${firstSong.album_artist}`.toLowerCase().trim()
        : null;
      const artistKey = `${firstSong.album}:${firstSong.artist}`
        .toLowerCase()
        .trim();

      return (
        !albumKeys.has(artistKey) &&
        (!albumArtistKey || !albumKeys.has(albumArtistKey))
      );
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

  // Group items for grid display - stack consecutive songs together
  const groupItemsForGrid = (
    items: FeedItem[]
  ): Array<{ type: "collection" | "songs"; items: FeedItem[] }> => {
    const result: Array<{ type: "collection" | "songs"; items: FeedItem[] }> =
      [];
    let currentSongGroup: FeedItem[] = [];

    items.forEach((item, index) => {
      if (item.domain_type === "song") {
        currentSongGroup.push(item);

        // If this is the last item or next item is not a song, finalize the song group
        if (
          index === items.length - 1 ||
          items[index + 1].domain_type !== "song"
        ) {
          // Split songs into groups of maximum 3 per grid cell
          for (let i = 0; i < currentSongGroup.length; i += 3) {
            const songChunk = currentSongGroup.slice(i, i + 3);
            result.push({ type: "songs", items: songChunk });
          }
          currentSongGroup = [];
        }
      } else {
        // Non-song item (collection) - add as individual item
        result.push({ type: "collection", items: [item] });
      }
    });

    return result;
  };

  const handleSingleCollectionPlay = (item: FeedItem) => {
    switch (item.domain_type) {
      case "album":
        // Parse "ALBUM by ARTIST" format
        if (item.title && item.title.includes(" by ")) {
          const lastByIndex = item.title.lastIndexOf(" by ");
          const albumName = item.title.substring(0, lastByIndex);
          const artistName = item.title.substring(lastByIndex + 4);

          const albumObj = {
            album: albumName || null,
            artist: artistName,
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
            {props.group.items[0] &&
              (() => {
                const item = props.group.items[0];
                const songs = item.metadata?.collection_grid?.songs || [];
                const firstSong =
                  songs.find((s) => s.thumbnail_blob_id) || songs[0];

                return (
                  <CollectionCard
                    collection={{
                      id: item.domain_ids?.[0] || "",
                      title:
                        firstSong?.album ||
                        item.metadata?.album_name ||
                        item.title,
                      subtitle: `by ${firstSong?.artist || item.metadata?.artist_name || "Unknown Artist"}`,
                      domain_type: (item.domain_type === "collection"
                        ? "album"
                        : item.domain_type) as
                        | "album"
                        | "playlist"
                        | "artist"
                        | "genre",
                      artist: firstSong?.artist || item.metadata?.artist_name,
                      album: firstSong?.album || item.metadata?.album_name,
                      thumbnail_blob_id: firstSong?.thumbnail_blob_id,
                      track_count: item.metadata?.total_songs || songs.length,
                      year: firstSong?.year,
                      genres:
                        firstSong?.genre ||
                        [
                          ...new Set(songs.map((s) => s.genre).filter(Boolean)),
                        ].join(", ") ||
                        null,
                      created_at: item.created_at,
                    }}
                    size="small"
                    showYear={true}
                    showGenres={true}
                    enableNavigation={true}
                    enableContextMenu={true}
                    onPlay={() => handleSingleCollectionPlay(item)}
                  />
                );
              })()}
          </Show>
        </div>
      </Show>

      {/* Consecutive Items Display */}
      <Show when={props.group.groupType === "consecutive"}>
        <div class="consecutive-items-container bg-white/5 border border-white/10 rounded-none p-3 mx-2 md:mx-0">
          {/* Consecutive Items Grid */}
          <div class="consecutive-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1 p-1 items-start justify-items-start">
            <For each={groupItemsForGrid(getFilteredItems(props.group.items))}>
              {(gridItem) => (
                <Show
                  when={gridItem.type === "collection"}
                  fallback={
                    <div class="flex flex-col gap-1 min-h-0 w-full overflow-hidden col-span-2 md:col-span-2 lg:col-span-2">
                      <For each={gridItem.items}>
                        {(songItem) => (
                          <TimelineItemRow
                            item={songItem}
                            showTime={true}
                            showUsername={false}
                            compact={true}
                          />
                        )}
                      </For>
                    </div>
                  }
                >
                  <div class="w-full">
                    {(() => {
                      const item = gridItem.items[0];
                      const songs = item.metadata?.collection_grid?.songs || [];
                      const firstSong =
                        songs.find((s) => s.thumbnail_blob_id) || songs[0];

                      return (
                        <CollectionCard
                          collection={{
                            id: item.domain_ids?.[0] || item.user_id || "",
                            title:
                              firstSong?.album ||
                              item.metadata?.album_name ||
                              item.title,
                            subtitle: `by ${firstSong?.artist || item.metadata?.artist_name || "Unknown Artist"}`,
                            domain_type: (item.domain_type === "collection"
                              ? "album"
                              : item.domain_type) as
                              | "album"
                              | "playlist"
                              | "artist"
                              | "genre",
                            artist:
                              firstSong?.artist || item.metadata?.artist_name,
                            album:
                              firstSong?.album || item.metadata?.album_name,
                            thumbnail_blob_id: firstSong?.thumbnail_blob_id,
                            track_count:
                              item.metadata?.total_songs || songs.length,
                            year: firstSong?.year,
                            genres:
                              firstSong?.genre ||
                              [
                                ...new Set(
                                  songs.map((s) => s.genre).filter(Boolean)
                                ),
                              ].join(", ") ||
                              null,
                            created_at: item.created_at,
                          }}
                          size="small"
                          showYear={true}
                          showGenres={true}
                          enableNavigation={true}
                          enableContextMenu={true}
                          onPlay={() => handleSingleCollectionPlay(item)}
                        />
                      );
                    })()}
                  </div>
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
