import {
  For,
  Show,
  createSignal,
  createEffect,
  createResource,
  onMount,
  onCleanup,
} from "solid-js";
import { apiClient } from "../../../../lib/api-client";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import type { Song } from "../../../../lib/music/schemas/song";
import type { Playlist } from "../../../../lib/music/schemas";

interface PlaylistSelectorMenuProps {
  songs: Song[];
  onClose: () => void;
  onPlaylistSelected: (playlist: Playlist) => void;
  onNewPlaylistCreated: (playlist: Playlist) => void;
}

export function PlaylistSelectorMenu(props: PlaylistSelectorMenuProps) {
  const events = useGlobalEvents();
  const [showNewPlaylistInput, setShowNewPlaylistInput] = createSignal(false);
  const [newPlaylistName, setNewPlaylistName] = createSignal("");
  const [creatingPlaylist, setCreatingPlaylist] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);

  // Fetch recent playlists
  const [playlistsResource] = createResource(async () => {
    try {
      const response = await apiClient.getPlaylists({ page_size: 25 });
      return response.playlists.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA; // Most recent first
      });
    } catch (error) {
      console.error("Failed to load playlists:", error);
      return [];
    }
  });

  // Generate default playlist name from first song
  const getDefaultPlaylistName = () => {
    if (props.songs.length === 0) return "New Playlist";

    const firstSong = props.songs[0];
    if (!firstSong) return "New Playlist";
    if (firstSong.album) {
      return firstSong.album;
    } else if (firstSong.artist) {
      return `${firstSong.artist} Mix`;
    } else {
      return firstSong.display_title || "New Playlist";
    }
  };

  // Initialize playlist name when showing input
  createEffect(() => {
    if (showNewPlaylistInput()) {
      setNewPlaylistName(getDefaultPlaylistName());
    }
  });

  const handleNewPlaylistClick = () => {
    setShowNewPlaylistInput(true);
    // Focus the input after it renders
    setTimeout(() => {
      const input = document.querySelector(
        ".playlist-name-input"
      ) as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  };

  const handleCreatePlaylist = async () => {
    const name = newPlaylistName().trim();
    if (!name) return;

    setCreatingPlaylist(true);
    try {
      const newPlaylist = await apiClient.createPlaylist({
        title: name,
        description: `Created from ${props.songs.length} song${props.songs.length !== 1 ? "s" : ""}`,
        is_public: false,
        is_collaborative: false,
      });

      // Add songs to the new playlist
      if (props.songs.length > 0) {
        await apiClient.addSongsToPlaylist(
          newPlaylist.id,
          props.songs.map((song) => song.id)
        );
      }

      props.onNewPlaylistCreated(newPlaylist);

      events.emit("notification:show", {
        type: "success",
        message: `Created "${name}" with ${props.songs.length} song${props.songs.length !== 1 ? "s" : ""}`,
      });

      // Emit playlist created event for other components
      events.emit("playlist:created", { playlist: newPlaylist });

      // Clear selection after successful creation
      events.emit("selection:clear", {});

      props.onClose();
    } catch (error) {
      console.error("Failed to create playlist:", error);
      events.emit("notification:show", {
        type: "error",
        message: "Failed to create playlist",
      });
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handleAddToPlaylist = async (playlist: Playlist) => {
    try {
      await apiClient.addSongsToPlaylist(
        playlist.id,
        props.songs.map((song) => song.id)
      );

      props.onPlaylistSelected(playlist);

      events.emit("notification:show", {
        type: "success",
        message: `Added ${props.songs.length} song${props.songs.length !== 1 ? "s" : ""} to "${playlist.title}"`,
      });

      // Emit event for playlist updates
      events.emit("playlist:song-added", {
        playlistId: playlist.id,
        songCount: props.songs.length,
      });

      // Clear selection after successful addition
      events.emit("selection:clear", {});

      props.onClose();
    } catch (error) {
      console.error("Failed to add songs to playlist:", error);
      events.emit("notification:show", {
        type: "error",
        message: "Failed to add songs to playlist",
      });
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreatePlaylist();
    } else if (event.key === "Escape") {
      setShowNewPlaylistInput(false);
      setNewPlaylistName("");
    }
  };

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    const playlists = playlistsResource() || [];

    if (showNewPlaylistInput()) {
      // Don't handle global keys when typing
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, playlists.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
        break;
      case "Enter":
        event.preventDefault();
        if (selectedIndex() >= 0 && selectedIndex() < playlists.length) {
          const playlist = playlists[selectedIndex()];
          if (playlist) {
            handleAddToPlaylist(playlist);
          }
        } else if (selectedIndex() === -1) {
          handleNewPlaylistClick();
        }
        break;
      case "Escape":
        event.preventDefault();
        props.onClose();
        break;
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleGlobalKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleGlobalKeyDown);
  });

  const cancelNewPlaylist = () => {
    setShowNewPlaylistInput(false);
    setNewPlaylistName("");
    setSelectedIndex(-1);
  };

  return (
    <div class="min-w-64 max-w-80">
      {/* Header */}
      <div class="px-4 py-3 border-b border-dark-300">
        <h3 class="text-sm font-medium text-white">
          Add {props.songs.length} song{props.songs.length !== 1 ? "s" : ""} to
          playlist
        </h3>
      </div>

      {/* Add New Playlist Section */}
      <div class="p-2 border-b border-dark-300 bg-dark-100">
        <Show when={!showNewPlaylistInput()}>
          <button
            class={`w-full text-left px-3 py-2 text-sm text-magenta-400 hover:bg-magenta-600/20 rounded transition-colors flex items-center space-x-2 ${
              selectedIndex() === -1 ? "bg-magenta-600/20" : ""
            }`}
            onClick={handleNewPlaylistClick}
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            <span>Create new playlist</span>
          </button>
        </Show>

        <Show when={showNewPlaylistInput()}>
          <div class="space-y-2">
            <input
              class="playlist-name-input w-full px-3 py-2 bg-dark-200 border border-dark-300 rounded text-white text-sm focus:outline-none focus:border-magenta-400"
              type="text"
              placeholder="Playlist name"
              value={newPlaylistName()}
              onInput={(e) => setNewPlaylistName(e.currentTarget.value)}
              onKeyDown={handleInputKeyDown}
              disabled={creatingPlaylist()}
            />
            <div class="flex space-x-2">
              <button
                class="flex-1 px-3 py-1.5 bg-magenta-600 hover:bg-magenta-700 disabled:bg-magenta-800 text-white text-xs rounded transition-colors"
                onClick={handleCreatePlaylist}
                disabled={!newPlaylistName().trim() || creatingPlaylist()}
              >
                {creatingPlaylist() ? "Creating..." : "Create"}
              </button>
              <button
                class="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors"
                onClick={cancelNewPlaylist}
                disabled={creatingPlaylist()}
              >
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* Recent Playlists */}
      <div class="max-h-64 overflow-y-auto">
        {/* Keyboard hints */}
        <Show
          when={
            !showNewPlaylistInput() &&
            playlistsResource() &&
            playlistsResource()!.length > 0
          }
        >
          <div class="px-4 py-2 text-xs text-gray-500 border-b border-dark-400">
            Use ↑↓ to navigate, Enter to select, Esc to close
          </div>
        </Show>
        <Show when={playlistsResource.loading}>
          <div class="p-4 text-center text-gray-400 text-sm">
            Loading playlists...
          </div>
        </Show>

        <Show when={playlistsResource() && playlistsResource()!.length === 0}>
          <div class="p-4 text-center text-gray-400 text-sm">
            No playlists yet. Create your first one above!
          </div>
        </Show>

        <Show when={playlistsResource() && playlistsResource()!.length > 0}>
          <div class="py-1">
            <For each={playlistsResource()}>
              {(playlist, index) => (
                <button
                  class={`w-full text-left px-4 py-3 hover:bg-dark-300 transition-colors border-b border-dark-400 last:border-b-0 ${
                    selectedIndex() === index() ? "bg-dark-300" : ""
                  }`}
                  onClick={() => handleAddToPlaylist(playlist)}
                >
                  <div class="flex items-center justify-between">
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-white truncate">
                        {playlist.title}
                      </div>
                      <div class="text-xs text-gray-400 truncate">
                        {playlist.song_count} song
                        {playlist.song_count !== 1 ? "s" : ""}
                        {playlist.description && ` • ${playlist.description}`}
                      </div>
                    </div>
                    <svg
                      class="w-4 h-4 text-gray-400 ml-2 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
