import { For, Show, createSignal, createResource } from "solid-js";
import { useStore, storeActions } from "../../../store";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { apiClient } from "../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type { Playlist, Song } from "../../../../../lib/music/schemas";

interface PlaylistDetailViewProps {
  class?: string;
  playlistId?: string;
}

export function PlaylistDetailView(
  props: RouteSectionProps<unknown> & PlaylistDetailViewProps = {} as any
) {
  const [] = useStore();
  const events = useGlobalEvents();

  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [editMode, setEditMode] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [loadingPlaylistSongs, setLoadingPlaylistSongs] = createSignal(false);

  // Fetch playlists from API
  const [playlistsResource] = createResource(async () => {
    console.log("📝 Fetching playlists...");
    try {
      const response = await apiClient.getPlaylists({ page_size: 100 });
      console.log("📝 Playlists loaded:", response.playlists.length);
      return response;
    } catch (error) {
      console.error("❌ Failed to load playlists:", error);
      return { playlists: [], pagination: null };
    }
  });

  // Fetch songs for selected playlist
  const [playlistSongsResource] = createResource(
    () => selectedPlaylist()?.id,
    async (playlistId: string) => {
      if (!playlistId) return [];

      console.log("🎵 Fetching songs for playlist:", playlistId);
      setLoadingPlaylistSongs(true);

      try {
        const songs = await apiClient.getPlaylistSongs(playlistId);
        console.log("🎵 Playlist songs loaded:", songs.length);
        return songs;
      } catch (error) {
        console.error("❌ Failed to load playlist songs:", error);
        return [];
      } finally {
        setLoadingPlaylistSongs(false);
      }
    }
  );

  const handlePlaylistClick = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    setEditTitle(playlist.title);
    setEditDescription(playlist.description || "");
    storeActions.selectPlaylist(playlist);
    events.emit("playlist:selected", { playlist });
  };

  const handleBackToList = () => {
    setSelectedPlaylist(null);
    setEditMode(false);
    storeActions.selectPlaylist(null);
  };

  const handleEditToggle = () => {
    if (editMode()) {
      // Save changes
      handleSavePlaylist();
    } else {
      setEditMode(true);
    }
  };

  const handleSavePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await apiClient.updatePlaylist(playlist.id, {
        title: editTitle(),
        description: editDescription() || null,
      });

      // Update local state
      setSelectedPlaylist({
        ...playlist,
        title: editTitle(),
        description: editDescription() || null,
      });

      setEditMode(false);
      events.emit("notification:show", {
        type: "success",
        message: "Playlist updated successfully",
      });
    } catch (error) {
      console.error("❌ Failed to update playlist:", error);
      events.emit("notification:show", {
        type: "error",
        message: "Failed to update playlist",
      });
    }
  };

  const handleDeletePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    if (!confirm(`Are you sure you want to delete "${playlist.title}"?`)) {
      return;
    }

    try {
      await apiClient.deletePlaylist(playlist.id);
      handleBackToList();
      events.emit("notification:show", {
        type: "success",
        message: "Playlist deleted successfully",
      });
    } catch (error) {
      console.error("❌ Failed to delete playlist:", error);
      events.emit("notification:show", {
        type: "error",
        message: "Failed to delete playlist",
      });
    }
  };

  const handlePlayPlaylist = () => {
    const songs = playlistSongsResource();
    if (songs && songs.length > 0) {
      events.emit("song:play", { song: songs[0], replaceQueue: true });
      // Add rest of songs to queue
      songs.slice(1).forEach((song) => {
        events.emit("song:queue", { song });
      });
    }
  };

  const handleShufflePlaylist = () => {
    const songs = playlistSongsResource();
    if (songs && songs.length > 0) {
      // Create shuffled copy
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      events.emit("song:play", { song: shuffled[0], replaceQueue: true });
      // Add rest of shuffled songs to queue
      shuffled.slice(1).forEach((song) => {
        events.emit("song:queue", { song });
      });
    }
  };

  const handleAddPlaylistToQueue = () => {
    const songs = playlistSongsResource();
    if (songs) {
      songs.forEach((song) => {
        events.emit("song:queue", { song });
      });
    }
  };

  const handleSongClick = (song: Song) => {
    events.emit("song:play", { song, replaceQueue: false });
  };

  const handleSongDoubleClick = (song: Song) => {
    events.emit("song:play", { song, replaceQueue: true });
  };

  const handleRemoveSong = async (song: Song) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await apiClient.removeSongsFromPlaylist(playlist.id, [song.id]);

      // Note: In a real app, we'd want to refetch the resource or use a more sophisticated state management

      events.emit("notification:show", {
        type: "success",
        message: "Song removed from playlist",
      });
    } catch (error) {
      console.error("❌ Failed to remove song:", error);
      events.emit("notification:show", {
        type: "error",
        message: "Failed to remove song",
      });
    }
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div class={`h-full bg-black text-white ${props.class || ""}`}>
      <Show when={!selectedPlaylist()}>
        {/* Playlist List View */}
        <div class="h-full flex flex-col">
          {/* Header */}
          <div class="flex-shrink-0 p-6">
            <div class="flex items-center justify-between mb-4">
              <h1 class="text-2xl font-semibold text-white">playlists</h1>
              <button
                class="px-4 py-2 bg-magenta-600 hover:bg-magenta-500 rounded text-black font-medium transition-colors"
                onClick={() =>
                  events.emit("modal:open", { modal: "createPlaylist" })
                }
              >
                + create playlist
              </button>
            </div>
            <Show
              when={!playlistsResource.loading}
              fallback={
                <p class="text-magenta-300 text-sm">loading playlists...</p>
              }
            >
              <p class="text-magenta-300 text-sm">
                {playlistsResource()?.playlists?.length || 0} playlists
              </p>
            </Show>
          </div>

          {/* Playlists List - Scrollable */}
          <div class="flex-1 overflow-y-auto px-6 pb-6">
            <Show
              when={!playlistsResource.loading}
              fallback={
                <div class="space-y-4">
                  <For each={Array.from({ length: 8 })}>
                    {() => (
                      <div class="animate-pulse">
                        <div class="h-20 bg-magenta-800/30 rounded-lg"></div>
                      </div>
                    )}
                  </For>
                </div>
              }
            >
              <div class="space-y-4">
                <For each={playlistsResource()?.playlists || []}>
                  {(playlist) => (
                    <div
                      class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                      onClick={() => handlePlaylistClick(playlist)}
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex-1 min-w-0">
                          <h3 class="text-white font-medium truncate mb-1">
                            {playlist.title}
                          </h3>
                          <div class="text-magenta-400 text-sm">
                            {playlist.song_count || 0} songs
                            {playlist.description && (
                              <span class="ml-2">• {playlist.description}</span>
                            )}
                          </div>
                          <div class="text-magenta-500 text-xs mt-1">
                            Created {formatDate(playlist.created_at)}
                            {playlist.is_public && (
                              <span class="ml-2 px-2 py-0.5 bg-magenta-600/30 rounded text-xs">
                                public
                              </span>
                            )}
                          </div>
                        </div>
                        <div class="flex items-center space-x-2">
                          <button
                            class="p-2 rounded-full hover:bg-magenta-600/30 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlaylistClick(playlist);
                            }}
                            title="Play playlist"
                          >
                            <svg
                              class="w-5 h-5 text-magenta-400"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={selectedPlaylist()}>
        {/* Playlist Detail View */}
        <div class="h-full flex flex-col">
          {/* Header with back button */}
          <div class="flex-shrink-0 p-6 border-b border-magenta-800/30">
            <button
              class="flex items-center text-magenta-400 hover:text-magenta-300 transition-colors mb-4"
              onClick={handleBackToList}
            >
              <svg
                class="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              back to playlists
            </button>

            <div class="flex items-start justify-between">
              <div class="flex-1">
                <Show when={!editMode()}>
                  <h1 class="text-3xl font-bold text-white mb-2">
                    {selectedPlaylist()?.title}
                  </h1>
                  <Show when={selectedPlaylist()?.description}>
                    <p class="text-magenta-300 mb-4">
                      {selectedPlaylist()?.description}
                    </p>
                  </Show>
                </Show>

                <Show when={editMode()}>
                  <input
                    type="text"
                    value={editTitle()}
                    onInput={(e) => setEditTitle(e.currentTarget.value)}
                    class="text-3xl font-bold text-white bg-transparent border-b border-magenta-400 mb-4 w-full focus:outline-none focus:border-magenta-300"
                    placeholder="Playlist title"
                  />
                  <textarea
                    value={editDescription()}
                    onInput={(e) => setEditDescription(e.currentTarget.value)}
                    class="text-magenta-300 bg-transparent border border-magenta-400 rounded p-2 mb-4 w-full focus:outline-none focus:border-magenta-300 resize-none"
                    placeholder="Description (optional)"
                    rows="2"
                  />
                </Show>

                <div class="text-magenta-400 text-sm mb-6">
                  {selectedPlaylist()?.song_count || 0} songs
                  <span class="ml-4">
                    Created {formatDate(selectedPlaylist()?.created_at || "")}
                  </span>
                  <Show when={selectedPlaylist()?.is_public}>
                    <span class="ml-4 px-2 py-0.5 bg-magenta-600/30 rounded text-xs">
                      public
                    </span>
                  </Show>
                </div>

                {/* Action Buttons */}
                <div class="flex space-x-3">
                  <button
                    class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 hover:border hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handlePlayPlaylist}
                    disabled={
                      loadingPlaylistSongs() || !playlistSongsResource()?.length
                    }
                  >
                    play all
                  </button>
                  <button
                    class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 hover:border hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleShufflePlaylist}
                    disabled={
                      loadingPlaylistSongs() || !playlistSongsResource()?.length
                    }
                  >
                    shuffle
                  </button>
                  <button
                    class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 hover:border hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleAddPlaylistToQueue}
                    disabled={
                      loadingPlaylistSongs() || !playlistSongsResource()?.length
                    }
                  >
                    add to queue
                  </button>
                </div>
              </div>

              {/* Management buttons */}
              <div class="flex items-center space-x-2 ml-6">
                <button
                  class="px-4 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 hover:border hover:border-magenta-400 rounded text-white font-medium transition-all"
                  onClick={handleEditToggle}
                >
                  {editMode() ? "save" : "edit"}
                </button>
                <Show when={!editMode()}>
                  <button
                    class="px-4 py-2 bg-red-600/50 hover:bg-red-600/70 hover:border hover:border-red-400 rounded text-white font-medium transition-all"
                    onClick={handleDeletePlaylist}
                  >
                    delete
                  </button>
                </Show>
              </div>
            </div>
          </div>

          {/* Songs List */}
          <div class="flex-1 overflow-y-auto p-6">
            <h3 class="text-xl font-semibold text-white mb-4">
              songs
              <Show when={loadingPlaylistSongs()}>
                <span class="text-magenta-400 text-sm ml-2">loading...</span>
              </Show>
            </h3>

            <Show
              when={!loadingPlaylistSongs() && playlistSongsResource()}
              fallback={
                <Show when={selectedPlaylist() && !loadingPlaylistSongs()}>
                  <div class="text-center py-12">
                    <div class="text-6xl mb-4">📝</div>
                    <div class="text-white text-xl mb-2">no songs yet</div>
                    <div class="text-magenta-400">
                      add some songs to get started
                    </div>
                  </div>
                </Show>
              }
            >
              <div class="space-y-1">
                <For each={playlistSongsResource() || []}>
                  {(song, index) => (
                    <div
                      class="flex items-center p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer group"
                      onClick={() => handleSongClick(song)}
                      onDblClick={() => handleSongDoubleClick(song)}
                    >
                      {/* Track Number */}
                      <div class="w-8 text-magenta-400 text-sm flex-shrink-0">
                        {index() + 1}
                      </div>

                      {/* Song Info */}
                      <div class="flex-1 min-w-0 mx-4">
                        <div class="text-white font-medium truncate group-hover:text-magenta-300 transition-colors">
                          {song.title}
                        </div>
                        <div class="text-magenta-400 text-sm truncate">
                          {song.artist} • {song.album || "Unknown Album"}
                        </div>
                      </div>

                      {/* Duration */}
                      <div class="text-magenta-400 text-sm flex-shrink-0 mr-4">
                        {song.duration_seconds
                          ? formatDuration(song.duration_seconds)
                          : "—"}
                      </div>

                      {/* Actions */}
                      <div class="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          class="p-1 rounded-full hover:bg-magenta-600/30 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            events.emit("song:queue", { song });
                          }}
                          title="Add to queue"
                        >
                          <svg
                            class="w-4 h-4 text-magenta-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                          </svg>
                        </button>
                        <button
                          class="p-1 rounded-full hover:bg-red-600/30 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSong(song);
                          }}
                          title="Remove from playlist"
                        >
                          <svg
                            class="w-4 h-4 text-red-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
