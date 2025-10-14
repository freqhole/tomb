import { JSX, Show, For, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { apiClient } from "../../../../lib/api-client";
import { MarqueeText } from "../shared/MarqueeText";
import { useCollectionInteractions } from "../../services/collectionInteractions";
import { useSongInteractions } from "../../services/songInteractions";
import type { FeedItem } from "../../../../lib/analytics/analytics-api";
import {
  CollectionCard,
  type CollectionCardData,
} from "../shared/CollectionCard";
import { formatRelativeTime } from "../../../../lib/date-utils";
import { TimelineItemRow } from "./TimelineItemRow";

interface TimelineCardProps {
  event: FeedItem;
}

export function TimelineCard(props: TimelineCardProps): JSX.Element {
  const navigate = useNavigate();
  const collectionInteractions = useCollectionInteractions();
  const songInteractions = useSongInteractions();

  // Helper to convert song data to FeedItem format for TimelineItemRow
  const createSongFeedItem = (song: any): any => {
    return {
      domain_type: "song",
      domain_ids: [song.id || song.media_blob_id],
      title: `${song.title || "Unknown Song"} - ${song.artist || "Unknown Artist"}`,
      image_url: song.thumbnail_blob_id
        ? `${apiClient.getBaseUrl()}/api/blobs/${song.thumbnail_blob_id}`
        : null,
      created_at: new Date().toISOString(),
      item_type: "user_played_song",
      username: props.event.username,
      user_id: props.event.user_id,
      play_count: 1,
      metadata: {
        collection_grid: {
          songs: [song],
        },
      },
    };
  };

  // Group songs by album for cleaner display
  const groupSongsByAlbum = (songs: any[]) => {
    const albumGroups = new Map();

    songs.forEach((song) => {
      const albumKey = `${song.album || "Unknown Album"} - ${song.artist || "Unknown Artist"}`;
      if (!albumGroups.has(albumKey)) {
        albumGroups.set(albumKey, {
          album: song.album || "Unknown Album",
          artist: song.artist || "Unknown Artist",
          songs: [],
          thumbnail_blob_id: song.thumbnail_blob_id,
        });
      }
      albumGroups.get(albumKey).songs.push(song);
    });

    return Array.from(albumGroups.values());
  };
  const getActionText = (event: FeedItem): string => {
    switch (event.item_type) {
      case "user_played_album":
        return "played album";
      case "user_played_playlist":
        return "played playlist";
      case "user_played_artist":
        return "listened to";
      case "user_played_genre":
        return "explored";
      case "user_played_song":
        return "played";
      case "user_favorited_album":
        return "favorited album";
      case "user_favorited_playlist":
        return "favorited playlist";
      case "user_favorited_song":
        return "favorited";
      case "user_unfavorited_song":
        return "unfavorited";
      case "user_rated_song":
        return "rated";
      case "user_listening_session":
        return "had a listening session";
      case "user_daily_activity":
        return "daily music activity";
      case "user_weekly_activity":
        return "weekly music activity";
      case "user_monthly_activity":
        return "monthly music activity";
      case "user_music_archive":
        return "music archive";
      default:
        return "interacted with";
    }
  };

  const getFrequencyText = (event: FeedItem): string => {
    // For session and grouped events, don't show frequency (it's in subtitle)
    if (
      event.item_type.includes("session") ||
      event.item_type.includes("activity")
    )
      return "";

    // For non-play events, don't show frequency
    if (!event.item_type.includes("played")) return "";

    const playCount = event.play_count || 0;
    if (playCount === 1) return "";
    if (playCount < 5) return ` ${playCount} times`;
    if (playCount < 20) return ` ${playCount} times`;
    return ` ${playCount} times recently`;
  };

  const isGroupedItem = (event: FeedItem): boolean => {
    return (
      event.item_type.includes("session") ||
      event.item_type.includes("activity")
    );
  };

  const getCollectionGrid = (event: FeedItem) => {
    const grid = event.metadata?.collection_grid;
    if (!grid || !grid.songs) return null;

    return {
      songs: grid.songs,
      totalSongs: grid.total_songs || grid.songs.length,
      groupingLevel: grid.grouping_level || "unknown",
    };
  };

  const createSingleItemCardData = (event: FeedItem): CollectionCardData => {
    return {
      id: event.domain_ids?.[0] || "",
      title: event.title,
      subtitle: event.metadata?.user_activity
        ? `${event.metadata.user_activity.total_play_count} plays`
        : "single play",
      domain_type: event.domain_type as
        | "album"
        | "playlist"
        | "artist"
        | "genre"
        | "song",
      image_url: event.image_url,
      play_count: event.play_count,
      last_played_at: event.last_played_at,
      created_at: event.created_at,
    };
  };

  const handleSingleSongPlay = (event: FeedItem) => {
    // Create song data from feed item for songInteractions
    const songData = {
      id: event.domain_ids?.[0] || "", // Use first domain_id as song ID
      media_blob_id: event.domain_ids?.[0] || "",
      title: event.title || "Unknown Song",
      artist: extractArtistFromTitle(event.title) || "Unknown Artist",
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
      display_title: event.title || "Unknown Song",
      detailed_display_title: event.title || "Unknown Song",
      created_at: new Date().toISOString(),
      thumbnail_blob_id: null,
      waveform_blob_id: null,
      thumbnail_blob_ids: [],
      preference_updated_at: null,
    };

    songInteractions.playSong(songData, true);
  };

  const extractArtistFromTitle = (title: string): string | null => {
    // Try to extract artist from title format like "Song Title - Artist Name"
    const parts = title.split(" - ");
    return parts.length > 1 ? parts[1] : null;
  };

  const handleSingleCollectionPlay = (event: FeedItem) => {
    // Handle playing single collections (albums, playlists, etc.)
    switch (event.domain_type) {
      case "album":
        // Extract album and artist from title
        const albumArtist = extractArtistFromTitle(event.title);
        if (albumArtist && event.title) {
          const albumName = event.title.split(" - ")[0];
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
        if (event.domain_ids?.[0]) {
          collectionInteractions.playPlaylist(
            event.domain_ids[0],
            event.title || "Unknown Playlist"
          );
        }
        break;
      case "artist":
        if (event.title) {
          const artistObj = {
            artist: event.title,
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
        if (event.title) {
          const genreObj = {
            name: event.title,
            slug: event.title.toLowerCase().replace(/\s+/g, "-"),
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

  const handleViewItemNavigation = (event: FeedItem) => {
    switch (event.domain_type) {
      case "artist":
        if (event.title) {
          const encodedArtist = encodeURIComponent(event.title);
          navigate(`/artist/${encodedArtist}`);
        }
        break;
      case "album":
        // Extract artist from title if format is "Album - Artist"
        const artist = extractArtistFromTitle(event.title);
        if (artist && event.title) {
          const albumName = event.title.split(" - ")[0];
          const encodedAlbum = encodeURIComponent(albumName);
          const encodedArtist = encodeURIComponent(artist);
          navigate(`/album/${encodedArtist}/${encodedAlbum}`);
        }
        break;
      case "song":
        // Navigate to song's album if we can extract artist
        const songArtist = extractArtistFromTitle(event.title);
        if (songArtist) {
          const encodedArtist = encodeURIComponent(songArtist);
          navigate(`/artist/${encodedArtist}`);
        }
        break;
      default:
        break;
    }
  };

  const handleSongClick = (song: any) => {
    // Navigate to album page when clicking the song card
    if (song.album && song.artist) {
      const encodedAlbum = encodeURIComponent(song.album);
      const encodedArtist = encodeURIComponent(song.artist);
      navigate(`/album/${encodedArtist}/${encodedAlbum}`);
    }
  };

  const handleSongPlay = (song: any, event: MouseEvent) => {
    event.stopPropagation();
    // Play individual song using songInteractions for proper queue management
    if (song.song_id || song.id) {
      const songData = {
        id: song.song_id || song.id, // Use UUID for API calls
        media_blob_id: song.id, // Keep media_blob_id for player
        title: song.title || "Unknown Song",
        artist: song.artist || "Unknown Artist",
        album: song.album || "Unknown Album",
        year: song.year,
        genre: song.genre,
        duration: song.duration,
        sub_genres: song.sub_genres || [],
        tags: song.tags || [],
      };

      // Use songInteractions for proper queue management and analytics
      songInteractions.playSong(songData, true);
    }
  };

  const handleSongContextMenu = (song: any, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Use songInteractions for full context menu with all song actions
    if (song.song_id || song.id) {
      const songData = {
        id: song.song_id || song.id, // Use UUID for API calls
        media_blob_id: song.id, // Keep media_blob_id for player
        title: song.title || "Unknown Song",
        artist: song.artist || null,
        album: song.album || null,
        album_artist: song.artist || null,
        track_number: song.track_number || null,
        disc_number: song.disc_number || null,
        duration_seconds: song.duration
          ? parseInt(song.duration.split(":")[0]) * 60 +
            parseInt(song.duration.split(":")[1])
          : null,
        genre: song.genre || null,
        sub_genres: song.sub_genres || null,
        year: song.year || null,
        bpm: null,
        key_signature: null,
        user_rating: song.user_rating || null,
        user_is_favorite: song.is_favorite || false,
        tags: song.tags || [],
        display_title: song.title || "Unknown Song",
        detailed_display_title: `${song.title || "Unknown Song"} - ${song.artist || "Unknown Artist"}`,
        created_at: new Date().toISOString(),
        thumbnail_blob_id: song.thumbnail_blob_id || null,
        waveform_blob_id: null,
        thumbnail_blob_ids: song.thumbnail_blob_id
          ? [song.thumbnail_blob_id]
          : [],
        preference_updated_at: null,
      };

      // Use full song context menu with all actions
      songInteractions.handleRightClick(event, songData, {
        hideViewArtist: !song.artist,
        hideViewAlbum: !song.album,
      });
    }
  };

  const getUsernameColor = (): string => {
    if (isGroupedItem(props.event)) {
      switch (props.event.metadata?.social_context?.grouping_level) {
        case "session":
          return "text-magenta";
        case "daily":
          return "text-yellow-500";
        case "weekly":
          return "text-green-400";
        case "monthly":
          return "text-yellow-400";
        default:
          return "text-purple-400";
      }
    }
    return "text-magenta";
  };

  const getCardBorderColor = () => {
    if (isGroupedItem(props.event)) {
      switch (props.event.metadata?.social_context?.grouping_level) {
        case "session":
          return "border-l-magenta-500";
        case "daily":
          return "border-l-yellow-500";
        case "weekly":
          return "border-l-green-500";
        case "monthly":
          return "border-l-yellow-500";
        default:
          return "border-l-purple-500";
      }
    }
    return "border-l-transparent";
  };

  return (
    <div
      class={`timeline-card bg-black border-b border-white/10 border-l-4 ${getCardBorderColor()} px-0 py-4 md:p-4 hover:bg-white/5 transition-colors`}
    >
      {/* User Action Header */}
      <div class="timeline-header mb-3 px-3 md:px-0">
        <div class="user-action text-sm text-white/70">
          <span class={`username ${getUsernameColor()} font-medium`}>
            {props.event.username || "unknown user"}
          </span>
          <span class="action text-white/50 mx-2">
            {getActionText(props.event)}
          </span>
          <span class="frequency text-white/40">
            {getFrequencyText(props.event)}
          </span>
        </div>
        <div class="timestamp text-xs text-white/40 mt-1">
          {formatRelativeTime(props.event.created_at)}
        </div>
      </div>

      {/* Target Content */}
      <div class="timeline-content">
        <div
          class={`collection-preview ${isGroupedItem(props.event) ? "bg-white/10" : "bg-white/5"} rounded-none border border-white/10`}
        >
          <div class="collection-info">
            <h3
              class={`collection-title font-medium text-base px-3 my-1 ${isGroupedItem(props.event) ? "text-magenta-200" : "text-white"}`}
            >
              {props.event.title}
            </h3>

            {props.event.subtitle && (
              <p class="collection-subtitle text-white/60 text-sm px-3 my-2">
                {props.event.subtitle}
              </p>
            )}

            {/* Show rating for rating events */}
            {props.event.item_type === "user_rated_song" &&
              props.event.metadata?.social_context && (
                <div class="rating-display flex items-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      class={
                        star <=
                        (props.event.metadata?.social_context?.rating || 0)
                          ? "text-magenta"
                          : "text-white/20"
                      }
                    >
                      ★
                    </span>
                  ))}
                </div>
              )}
          </div>

          {/* Collection Grid for Grouped Sessions */}
          <Show
            when={isGroupedItem(props.event) && getCollectionGrid(props.event)}
          >
            {(grid) => {
              const albumGroups = groupSongsByAlbum(grid().songs);

              return (
                <div class="collection-grid mt-3 pt-3 border-t border-magenta-500/30 md:px-0">
                  <div class="collection-albums-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1 p-1">
                    <For each={albumGroups}>
                      {(albumGroup) => (
                        <CollectionCard
                          collection={{
                            id: `${albumGroup.album}:${albumGroup.artist}`,
                            title: albumGroup.album,
                            subtitle: `by ${albumGroup.artist}`,
                            domain_type: "album" as const,
                            artist: albumGroup.artist,
                            album: albumGroup.album,
                            thumbnail_blob_id: albumGroup.thumbnail_blob_id,
                            track_count: albumGroup.songs.length,
                            year: albumGroup.songs[0]?.year,
                            genres:
                              [
                                ...new Set(
                                  albumGroup.songs
                                    .map((s) => s.genre)
                                    .filter(Boolean)
                                ),
                              ].join(", ") || null,
                            created_at: new Date().toISOString(),
                          }}
                          size="small"
                          showYear={true}
                          showGenres={true}
                          enableNavigation={true}
                          enableContextMenu={true}
                          onPlay={() => {
                            const albumObj = {
                              album: albumGroup.album,
                              artist: albumGroup.artist,
                              year: null,
                              track_count: albumGroup.songs.length,
                              disc_count: 1,
                              total_duration: null,
                              genres: null,
                              avg_rating: null,
                              favorite_count: 0,
                              album_thumbnail_id: albumGroup.thumbnail_blob_id,
                            };
                            collectionInteractions.playAlbum(albumObj);
                          }}
                        />
                      )}
                    </For>
                  </div>
                </div>
              );
            }}
          </Show>

          {/* Single Item Cards for Individual Items */}
          <Show when={!isGroupedItem(props.event)}>
            <div class="single-item-display mt-3 px-2 md:px-0">
              <CollectionCard
                collection={createSingleItemCardData(props.event)}
                size="medium"
                showPlayCount={true}
                enableNavigation={true}
                enableContextMenu={true}
                class="bg-transparent border-0 p-0"
                onPlay={(collection) => {
                  if (props.event.domain_type === "song") {
                    handleSingleSongPlay(props.event);
                  } else {
                    handleSingleCollectionPlay(props.event);
                  }
                }}
              />
            </div>
          </Show>
        </div>
      </div>

      {/* Enhanced Social Context */}
      {props.event.metadata?.social_context && (
        <div class="social-context mt-2 text-xs text-white/40 px-3 md:px-0">
          {props.event.metadata.social_context.frequency > 10 && (
            <span class="heavy-listener">heavy listener • </span>
          )}
          {props.event.metadata.social_context.is_trending && (
            <span class="trending-item text-magenta font-medium">
              trending •{" "}
            </span>
          )}
          <span class="activity-type">
            {props.event.domain_type}{" "}
            {props.event.metadata.social_context.action_type}
          </span>
          {props.event.metadata?.user_activity?.total_play_count && (
            <span class="play-count">
              {" "}
              • {props.event.metadata.user_activity.total_play_count} plays
            </span>
          )}
          {isGroupedItem(props.event) && (
            <span class="grouping-indicator text-magenta-400">
              {" "}
              • {props.event.metadata.social_context.grouping_level} grouping
            </span>
          )}
          {props.event.metadata.social_context.age_category && (
            <span class="age-category">
              {" "}
              • {props.event.metadata.social_context.age_category}
            </span>
          )}
          {isGroupedItem(props.event) &&
            props.event.metadata.user_activity?.session_duration && (
              <span class="session-duration">
                {" "}
                •{" "}
                {Math.round(
                  props.event.metadata.user_activity.session_duration / 60
                )}
                min session
              </span>
            )}
        </div>
      )}
    </div>
  );
}
