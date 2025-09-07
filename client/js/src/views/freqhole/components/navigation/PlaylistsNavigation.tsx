import {
  For,
  Show,
  createResource,
  createEffect,
  createSignal,
} from "solid-js";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../services/songInteractions";
import { apiClient } from "../../../../lib/api-client";
import { formatCompactRelativeDate } from "../../utils/dateUtils";
import type { Playlist } from "../../../../lib/music/schemas";

interface PlaylistsNavigationProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function PlaylistsNavigation(props: PlaylistsNavigationProps) {
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();
  const [refreshPlaylists, setRefreshPlaylists] = createSignal(0);
  const [hoveredPlaylist, setHoveredPlaylist] = createSignal<string | null>(
    null
  );
  const [hoveredImage, setHoveredImage] = createSignal<string | null>(null);

  // Listen for playlist operation events to refresh the navigation list
  createEffect(() => {
    events.on("playlist:deleted", ({ playlistTitle }) => {
      console.log(
        "📝 Navigation: Playlist deleted event received:",
        playlistTitle
      );
      setRefreshPlaylists(refreshPlaylists() + 1);
    });

    events.on("playlist:created", ({ playlist }) => {
      console.log(
        "📝 Navigation: Playlist created event received:",
        playlist.title
      );
      setRefreshPlaylists(refreshPlaylists() + 1);
    });

    events.on("playlist:song-removed", () => {
      console.log("📝 Navigation: Playlist song removed event received");
      setRefreshPlaylists(refreshPlaylists() + 1);
    });

    events.on("playlist:song-added", () => {
      console.log("📝 Navigation: Playlist song added event received");
      setRefreshPlaylists(refreshPlaylists() + 1);
    });
  });

  // Fetch recent playlists from API (25 most recent)
  const [playlistsResource] = createResource(
    () => {
      const refreshCount = refreshPlaylists(); // Track refresh signal
      return refreshCount; // Return refresh count as key
    },
    async () => {
      try {
        console.log("📝 Fetching recent playlists for navigation...");
        const response = await apiClient.getPlaylists({ page_size: 25 });

        // Sort by created_at descending (most recent first)
        const sortedPlaylists = response.playlists.sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return dateB - dateA; // Most recent first
        });

        console.log("📝 Recent playlists loaded:", sortedPlaylists.length);
        return sortedPlaylists;
      } catch (error) {
        console.error("❌ Failed to load recent playlists:", error);
        return [];
      }
    }
  );

  const handleCreatePlaylist = () => {
    // Navigate to new playlist creation page instead of opening modal
    props.onNavigate("/playlists/new");
  };

  const handlePlaylistClick = (playlist: Playlist) => {
    props.onNavigate(`/playlist/${playlist.id}`);
    events.emit("playlist:selected", { playlist });
  };

  const handlePlaylistDoubleClick = async (playlist: Playlist) => {
    try {
      // Fetch playlist songs and start playing
      const songs = await apiClient.getPlaylistSongs(playlist.id);

      if (songs.length > 0 && songs[0]) {
        console.log(
          `🎵 Playing playlist: ${playlist.title} with ${songs.length} songs`
        );
        // Play first song and queue the rest
        songInteractions.playSong(songs[0], true); // Replace queue
        songs.slice(1).forEach((song) => {
          if (song) {
            songInteractions.queueSong(song);
          }
        });
      }
    } catch (error) {
      console.error("❌ Failed to play playlist:", error);
    }
  };

  const handleImageClick = async (e: Event, playlist: Playlist) => {
    e.stopPropagation(); // Prevent navigation
    await handlePlaylistDoubleClick(playlist);
  };

  const formatSongCount = (count: number) => {
    if (count === 0) return "empty";
    if (count === 1) return "1 song";
    return `${count} songs`;
  };

  const truncateTitle = (title: string, maxLength = 25) => {
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength - 3) + "...";
  };

  return (
    <div class="p-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-medium text-white">playlists</h3>
        <button
          onClick={() => props.onNavigate("/playlists")}
          class="text-xs text-gray-400 hover:text-magenta-400 transition-colors duration-200"
        >
          view all
        </button>
      </div>

      <div class="space-y-1">
        <Show
          when={!playlistsResource.loading}
          fallback={
            <div class="space-y-1">
              <For each={Array.from({ length: 5 })}>
                {() => (
                  <div class="p-2 rounded-lg bg-gray-800/30 animate-pulse">
                    <div class="h-4 bg-gray-700/50 rounded mb-1"></div>
                    <div class="h-3 bg-gray-700/30 rounded w-3/4"></div>
                  </div>
                )}
              </For>
            </div>
          }
        >
          <Show
            when={playlistsResource() && playlistsResource()!.length > 0}
            fallback={
              <div class="p-2 text-xs text-gray-500 text-center">
                no playlists yet
              </div>
            }
          >
            <For each={playlistsResource()!}>
              {(playlist) => (
                <button
                  class={`w-full text-left p-2 rounded-lg text-sm transition-all duration-200 group ${
                    props.currentPath === `/playlist/${playlist.id}`
                      ? "bg-magenta-600/30 text-white"
                      : "text-white hover:bg-magenta-600/20"
                  }`}
                  onClick={() => handlePlaylistClick(playlist)}
                  onDblClick={() => handlePlaylistDoubleClick(playlist)}
                  onMouseEnter={() => setHoveredPlaylist(playlist.id)}
                  onMouseLeave={() => setHoveredPlaylist(null)}
                  title={playlist.title}
                >
                  <div class="flex items-center space-x-2">
                    <div class="relative w-8 h-8 flex-shrink-0">
                      <Show
                        when={playlist.thumbnail_blob_id}
                        fallback={
                          <div
                            class="relative w-8 h-8 bg-magenta-600/20 rounded flex items-center justify-center cursor-pointer hover:bg-magenta-600/40 transition-all"
                            onClick={(e) => handleImageClick(e, playlist)}
                            onMouseEnter={() => setHoveredImage(playlist.id)}
                            onMouseLeave={() => setHoveredImage(null)}
                          >
                            <svg
                              class={`w-4 h-4 text-magenta-400 transition-opacity ${
                                hoveredImage() === playlist.id
                                  ? "opacity-0"
                                  : "opacity-100"
                              }`}
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                            <Show when={hoveredImage() === playlist.id}>
                              <div class="absolute inset-0 bg-black/50 rounded flex items-center justify-center">
                                <svg
                                  class="w-7 h-7 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              </div>
                            </Show>
                          </div>
                        }
                      >
                        <div
                          class="relative w-8 h-8 rounded overflow-hidden cursor-pointer hover:brightness-75 transition-all"
                          onClick={(e) => handleImageClick(e, playlist)}
                          onMouseEnter={() => setHoveredImage(playlist.id)}
                          onMouseLeave={() => setHoveredImage(null)}
                        >
                          <img
                            src={`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"}/api/blobs/${playlist.thumbnail_blob_id}`}
                            alt={playlist.title}
                            class="w-full h-full object-cover"
                          />
                          <Show when={hoveredImage() === playlist.id}>
                            <div class="absolute inset-0 bg-black/50 flex items-center justify-center">
                              <svg
                                class="w-7 h-7 text-white"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="truncate font-medium">
                        {truncateTitle(playlist.title)}
                      </div>
                      <div class="text-xs text-gray-400">
                        {formatSongCount(playlist.song_count || 0)}
                        {playlist.created_at &&
                          formatCompactRelativeDate(playlist.created_at) && (
                            <span class="ml-2">
                              • {formatCompactRelativeDate(playlist.created_at)}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <button
        onClick={handleCreatePlaylist}
        class="w-full mt-3 p-2 bg-magenta-600 rounded-lg text-sm text-black font-medium hover:bg-magenta-500 border border-transparent hover:border-magenta-400 transition-all duration-200"
      >
        + create playlist
      </button>
    </div>
  );
}
