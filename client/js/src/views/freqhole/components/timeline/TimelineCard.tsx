import { JSX, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { apiClient } from "../../../../lib/api-client";
import { MarqueeText } from "../shared/MarqueeText";
import { useCollectionInteractions } from "../../services/collectionInteractions";
import { useSongInteractions } from "../../services/songInteractions";
import type { FeedItem } from "../../../../lib/analytics/analytics-api";
import type { CollectionCardData } from "../shared/CollectionCard";

interface TimelineCardProps {
  event: FeedItem;
}

export function TimelineCard(props: TimelineCardProps): JSX.Element {
  const navigate = useNavigate();
  const collectionInteractions = useCollectionInteractions();
  const songInteractions = useSongInteractions();
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

  const createCollectionCardData = (song: any): CollectionCardData => {
    return {
      id: song.id,
      title: song.title,
      subtitle: song.artist || null,
      domain_type: "song" as const,
      artist: song.artist,
      album: song.album,
      year: song.year,
      thumbnail_blob_id: song.thumbnail_blob_id,
      track_count: 1,
      total_duration: song.duration,
      genres: song.genre,
      tags: song.tags?.join(", ") || null,
    };
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

  const getCardBorderColor = () => {
    if (isGroupedItem(props.event)) {
      switch (props.event.metadata?.social_context?.grouping_level) {
        case "session":
          return "border-l-magenta-500";
        case "daily":
          return "border-l-blue-500";
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
      class={`timeline-card bg-black border-b border-white/10 border-l-4 ${getCardBorderColor()} p-4 hover:bg-white/5 transition-colors`}
    >
      {/* User Action Header */}
      <div class="timeline-header mb-3">
        <div class="user-action text-sm text-white/70">
          <span class="username text-magenta font-medium">
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
          {new Date(props.event.created_at).toLocaleDateString()} at{" "}
          {new Date(props.event.created_at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Target Content */}
      <div class="timeline-content">
        <div
          class={`collection-preview ${isGroupedItem(props.event) ? "bg-white/10" : "bg-white/5"} rounded-none border border-white/10 p-3`}
        >
          <div class="collection-info">
            <h3
              class={`collection-title font-medium text-base mb-1 ${isGroupedItem(props.event) ? "text-magenta-200" : "text-white"}`}
            >
              {props.event.title}
            </h3>

            {props.event.subtitle && (
              <p class="collection-subtitle text-white/60 text-sm mb-2">
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

            <div class="collection-meta flex items-center gap-4 text-xs text-white/50">
              <span class="domain-type">{props.event.domain_type}</span>

              {props.event.metadata?.user_activity?.total_play_count && (
                <span class="total-plays">
                  {props.event.metadata.user_activity.total_play_count} total
                  plays
                </span>
              )}

              {props.event.metadata?.social_context?.is_trending && (
                <span class="trending text-magenta">trending</span>
              )}

              {props.event.item_type.includes("favorited") && (
                <span class="favorited text-magenta">♥ favorited</span>
              )}
            </div>
          </div>

          {/* Collection Grid for Sessions */}
          <Show
            when={isGroupedItem(props.event) && getCollectionGrid(props.event)}
          >
            {(grid) => (
              <div class="collection-grid mt-3 pt-3 border-t border-magenta-500/30">
                <div class="grid-header mb-3 flex items-center justify-between">
                  <span class="text-xs text-magenta-300 font-medium">
                    {grid().totalSongs} songs • {grid().groupingLevel}
                  </span>
                  <span class="text-xs text-white/40">
                    {props.event.metadata?.user_activity?.session_duration &&
                      `${Math.round(props.event.metadata.user_activity.session_duration / 60)}min`}
                  </span>
                </div>
                <div class="collections-grid grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                  <For each={grid().songs.slice(0, 12)}>
                    {(song) => (
                      <div
                        class="group cursor-pointer"
                        onClick={() => handleSongClick(song)}
                        onContextMenu={(e) => handleSongContextMenu(song, e)}
                      >
                        {/* Song Cover */}
                        <div class="aspect-square bg-magenta-800/30 rounded-lg overflow-hidden mb-2 transition-transform hover:scale-105 relative">
                          <Show
                            when={song.thumbnail_blob_id}
                            fallback={
                              <div class="w-full h-full flex items-center justify-center">
                                <svg
                                  class="w-6 h-6 text-magenta-400"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                </svg>
                              </div>
                            }
                          >
                            <img
                              src={`${apiClient.getBaseUrl()}/api/blobs/${song.thumbnail_blob_id}`}
                              alt={`${song.title} by ${song.artist}`}
                              class="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </Show>

                          {/* Hover overlay with play button */}
                          <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              class="w-8 h-8 bg-magenta-600 hover:bg-magenta-500 rounded-full flex items-center justify-center transition-colors cursor-pointer"
                              onClick={(e) => handleSongPlay(song, e)}
                              title="play song"
                            >
                              <svg
                                class="w-4 h-4 text-white ml-0.5"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </button>
                          </div>

                          {/* Favorite heart icon */}
                          <Show when={song.is_favorite}>
                            <div class="absolute top-1 right-1 text-magenta-400">
                              <svg
                                class="w-3 h-3 fill-current"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                              </svg>
                            </div>
                          </Show>
                        </div>

                        {/* Song Info */}
                        <div class="space-y-0.5">
                          <MarqueeText
                            text={song.title || "unknown song"}
                            class="text-white font-medium text-xs group-hover:text-magenta-300 transition-colors"
                          />
                          <MarqueeText
                            text={song.artist || "unknown artist"}
                            class="text-magenta-400 text-xs"
                          />
                          <div class="text-magenta-500 text-xs truncate">
                            {song.year && `${song.year} · `}
                            {song.duration || "unknown"}
                            {song.genre && ` · ${song.genre}`}
                          </div>
                          <Show when={song.tags && song.tags.length > 0}>
                            <MarqueeText
                              text={song.tags.join(", ")}
                              class="text-gray-500 text-xs bg-black/30 px-1 py-0.5 rounded"
                            />
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={grid().totalSongs > 12}>
                  <div class="more-collections text-xs text-white/50 mt-2 text-center">
                    +{grid().totalSongs - 12} more songs
                  </div>
                </Show>
              </div>
            )}
          </Show>

          {/* Action Buttons */}
          <div class="timeline-actions mt-3 flex gap-2">
            <button
              class="action-btn bg-magenta text-black px-3 py-1 text-xs hover:bg-magenta/80 transition-colors"
              onClick={() => {
                // TODO: implement play action
                console.log("play collection", props.event.domain_ids);
              }}
            >
              play
            </button>

            <button
              class="action-btn bg-white/10 text-white px-3 py-1 text-xs hover:bg-white/20 transition-colors"
              onClick={() => {
                // TODO: implement view collection action
                console.log("view collection", props.event.domain_ids);
              }}
            >
              view
            </button>
          </div>
        </div>
      </div>

      {/* Enhanced Social Context */}
      {props.event.metadata?.social_context && (
        <div class="social-context mt-2 text-xs text-white/40">
          {props.event.metadata.social_context.frequency > 10 && (
            <span class="heavy-listener">heavy listener • </span>
          )}
          {props.event.metadata.social_context.is_trending && (
            <span class="trending-item text-magenta font-medium">
              trending •{" "}
            </span>
          )}
          <span class="activity-type">
            {props.event.metadata.social_context.action_type} activity
          </span>
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
