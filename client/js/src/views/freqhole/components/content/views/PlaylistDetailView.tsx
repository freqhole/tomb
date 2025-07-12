import {
  For,
  Show,
  createSignal,
  createResource,
  createEffect,
} from "solid-js";
import { useStore, storeActions } from "../../../store";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { useSelection } from "../../../hooks/useSelection";
import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { useSongInteractions } from "../../../services/songInteractions";
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
  const songInteractions = useSongInteractions();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [editMode, setEditMode] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [loadingPlaylistSongs, setLoadingPlaylistSongs] = createSignal(false);
  const [isNewPlaylist, setIsNewPlaylist] = createSignal(false);
  const [sortBy, setSortBy] = createSignal<
    "recent" | "alphabetical" | "song_count"
  >("recent");
  const [originalTitle, setOriginalTitle] = createSignal("");
  const [originalDescription, setOriginalDescription] = createSignal("");
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = createSignal<number | null>(null);
  const [refreshSongs, setRefreshSongs] = createSignal(0);
  const [refreshPlaylists, setRefreshPlaylists] = createSignal(0);

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds, selectedSongs) => {
      console.log(
        `🎵 Playlist selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  // Listen for selection clear events
  createEffect(() => {
    events.on("selection:clear", () => {
      console.log("🎵 Clearing playlist view selection via event");
      selection.clearSelection();
    });
  });

  // Listen for playlist operation events to refresh UI
  createEffect(() => {
    events.on("playlist:deleted", ({ playlistId }) => {
      console.log("📝 Playlist deleted event received:", playlistId);
      // If we're currently viewing the deleted playlist, navigate away
      if (selectedPlaylist()?.id === playlistId) {
        console.log(
          "📝 Currently viewing deleted playlist, navigating to list"
        );
        navigate("/playlists");
      }
      // Refresh playlists list
      setRefreshPlaylists(refreshPlaylists() + 1);
    });

    events.on("playlist:song-removed", ({ playlistId, updatedPlaylist }) => {
      console.log("📝 Playlist song removed event received:", playlistId);
      // If we're currently viewing this playlist, update its song count
      if (selectedPlaylist()?.id === playlistId) {
        setSelectedPlaylist(updatedPlaylist);
      }
      // Refresh playlists list to update song counts
      setRefreshPlaylists(refreshPlaylists() + 1);
    });

    events.on("playlist:created", () => {
      console.log("📝 Playlist created event received");
      // Refresh playlists list
      setRefreshPlaylists(refreshPlaylists() + 1);
    });
  });

  // Detect if we're in "new playlist" mode or have a playlist ID in the route
  createEffect(() => {
    const isNew = location.pathname === "/playlists/new";
    setIsNewPlaylist(isNew);

    if (isNew) {
      // Initialize new playlist mode
      setSelectedPlaylist({
        id: "",
        title: "",
        description: null,
        song_count: 0,
        is_public: false,
        is_collaborative: false,
        visibility: "private",
        created_at: new Date().toISOString(),
      });
      setEditMode(true);
      setEditTitle("");
      setEditDescription("");
    } else if (params.id) {
      // Load specific playlist from route parameter
      loadPlaylistById(params.id);
    } else {
      // Reset to playlist list view
      setSelectedPlaylist(null);
      setEditMode(false);
    }
  });

  // Load specific playlist by ID
  const loadPlaylistById = async (playlistId: string) => {
    try {
      console.log("📝 Loading playlist:", playlistId);
      // Find playlist in cache first, or fetch all playlists
      const response = await apiClient.getPlaylists({ page_size: 100 });
      const playlist = response.playlists.find((p) => p.id === playlistId);

      if (playlist) {
        setSelectedPlaylist(playlist);
        setEditTitle(playlist.title);
        setEditDescription(playlist.description || "");
        setOriginalTitle(playlist.title);
        setOriginalDescription(playlist.description || "");
        storeActions.selectPlaylist(playlist);
        events.emit("playlist:selected", { playlist });
        console.log("📝 Playlist loaded:", playlist.title);
      } else {
        console.warn("⚠️ Playlist not found:", playlistId);
        // Navigate back to playlists list if not found
        navigate("/playlists");
      }
    } catch (error) {
      console.error("❌ Failed to load playlist:", error);
      navigate("/playlists");
    }
  };

  // Fetch playlists from API (only when not creating new playlist and no specific ID)
  const [playlistsResource] = createResource(
    () => {
      const refreshCount = refreshPlaylists(); // Track refresh signal
      const isNew = isNewPlaylist();
      const hasParamId = !!params.id;

      return !isNew && !hasParamId
        ? refreshCount // Return refresh count as key
        : false;
    },
    async () => {
      console.log("📝 Fetching playlists...");
      try {
        const response = await apiClient.getPlaylists({ page_size: 100 });
        console.log("📝 Playlists loaded:", response.playlists.length);
        return response;
      } catch (error) {
        console.error("❌ Failed to load playlists:", error);
        return { playlists: [], pagination: null };
      }
    }
  );

  // Fetch songs for selected playlist (only for existing playlists)
  const [playlistSongsResource] = createResource(
    () => {
      const refreshCount = refreshSongs(); // Track refresh signal
      const playlistId = selectedPlaylist()?.id;
      const isNew = isNewPlaylist();

      return playlistId && !isNew
        ? `${playlistId}-${refreshCount}` // Include refresh count in key
        : false;
    },
    async (key: string) => {
      if (!key) return [];

      // Extract playlist ID from the key (format: "playlistId-refreshCount")
      // Since playlist IDs are UUIDs with hyphens, split from the end to get the refresh count
      const lastHyphenIndex = key.lastIndexOf("-");
      const playlistId =
        lastHyphenIndex > 0 ? key.substring(0, lastHyphenIndex) : key;
      if (!playlistId) {
        console.warn("⚠️ Invalid playlist key format:", key);
        return [];
      }
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
    // Navigate to playlist route instead of just setting local state
    navigate(`/playlist/${playlist.id}`);
  };

  const handleBackToList = () => {
    setSelectedPlaylist(null);
    setEditMode(false);
    storeActions.selectPlaylist(null);
  };

  const handleCancelEdit = () => {
    // Reset to original values
    setEditTitle(originalTitle());
    setEditDescription(originalDescription());
    setEditMode(false);
  };

  const handleEditToggle = () => {
    if (editMode()) {
      // Save changes
      if (isNewPlaylist()) {
        handleCreateNewPlaylist();
      } else {
        handleSavePlaylist();
      }
    } else {
      setEditMode(true);
    }
  };

  const handleCreateNewPlaylist = async () => {
    const title = editTitle().trim();
    if (!title) {
      events.emit("notification:show", {
        type: "error",
        message: "Playlist title is required",
      });
      return;
    }

    try {
      const newPlaylist = await apiClient.createPlaylist({
        title,
        description: editDescription() || null,
        is_public: false,
        is_collaborative: false,
      });

      console.log("✅ Playlist created successfully:", newPlaylist.title);

      // Emit event for other components to react to playlist creation
      events.emit("playlist:created", {
        playlist: newPlaylist,
      });

      // Navigate to the new playlist
      navigate(`/playlist/${newPlaylist.id}`);

      events.emit("notification:show", {
        type: "success",
        message: "Playlist created successfully",
      });
    } catch (error) {
      console.error("❌ Failed to create playlist:", error);
      events.emit("notification:show", {
        type: "error",
        message: "Failed to create playlist",
      });
    }
  };

  const handleSavePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      const updatedPlaylist = await apiClient.updatePlaylist(playlist.id, {
        title: editTitle(),
        description: editDescription() || null,
      });

      // Update local state
      setSelectedPlaylist(updatedPlaylist);
      setOriginalTitle(updatedPlaylist.title);
      setOriginalDescription(updatedPlaylist.description || "");

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
      console.log("🗑️ Deleting playlist:", playlist.title);

      await apiClient.deletePlaylist(playlist.id);

      console.log("🗑️ Playlist deleted successfully, emitting events...");

      // Emit event for other components to react to playlist deletion
      events.emit("playlist:deleted", {
        playlistId: playlist.id,
        playlistTitle: playlist.title,
      });

      // Navigate back to playlists list
      navigate("/playlists");

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
      // Play first song and replace queue
      const firstSong = songs[0];
      if (firstSong) {
        songInteractions.playSong(firstSong, true);
        // Add rest of songs to queue
        songs.slice(1).forEach((song) => {
          if (song) {
            songInteractions.queueSong(song);
          }
        });
      }
    }
  };

  const handleShufflePlaylist = () => {
    const songs = playlistSongsResource();
    if (songs && songs.length > 0) {
      // Create shuffled copy
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      // Play first shuffled song and replace queue
      const firstShuffled = shuffled[0];
      if (firstShuffled) {
        songInteractions.playSong(firstShuffled, true);
        // Add rest of shuffled songs to queue
        shuffled.slice(1).forEach((song) => {
          if (song) {
            songInteractions.queueSong(song);
          }
        });
      }
    }
  };

  const handleAddPlaylistToQueue = () => {
    const songs = playlistSongsResource();
    if (songs) {
      songs.forEach((song) => {
        if (song) {
          songInteractions.queueSong(song);
        }
      });
    }
  };

  const handleSongClick = (song: Song, index: number, event: MouseEvent) => {
    if (event.shiftKey && selection.lastSelectedIndex() >= 0) {
      selection.selectRange(
        selection.lastSelectedIndex(),
        index,
        playlistSongsResource() || []
      );
    } else {
      selection.handleRowClick(song, index, event);
    }
  };

  const handleSongDoubleClick = (song: Song) => {
    songInteractions.playSong(song, true);
  };

  const handleRemoveSong = async (song: Song) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    console.log("🗑️ Removing song from playlist:", {
      songTitle: song.title,
      playlistTitle: playlist.title,
      currentSongCount: playlist.song_count,
    });

    try {
      await apiClient.removeSongsFromPlaylist(playlist.id, [song.id]);

      const updatedSongCount = Math.max(0, (playlist.song_count || 1) - 1);
      const updatedPlaylist = {
        ...playlist,
        song_count: updatedSongCount,
      };

      // Update the selected playlist song count
      setSelectedPlaylist(updatedPlaylist);

      console.log("🗑️ Song removed successfully, triggering refresh...");

      // Trigger refresh of songs resource
      setRefreshSongs(refreshSongs() + 1);

      // Emit event for other components to react to playlist changes
      events.emit("playlist:song-removed", {
        playlistId: playlist.id,
        songId: song.id,
        updatedPlaylist,
      });

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

  const handleDragStart = (e: DragEvent, index: number) => {
    if (editMode() || isNewPlaylist()) return;
    setDraggedIndex(index);
    e.dataTransfer!.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent, index: number) => {
    if (editMode() || isNewPlaylist()) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = async (e: DragEvent, dropIndex: number) => {
    if (editMode() || isNewPlaylist()) return;
    e.preventDefault();
    const dragIndex = draggedIndex();

    if (dragIndex === null || dragIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const songs = playlistSongsResource();
    const playlist = selectedPlaylist();

    if (!songs || !playlist) return;

    try {
      // Create reordered array
      const reorderedSongs = [...songs];
      const draggedSong = reorderedSongs[dragIndex];
      if (!draggedSong) return;
      reorderedSongs.splice(dragIndex, 1);
      reorderedSongs.splice(dropIndex, 0, draggedSong);

      // For now, let's try using the reorder endpoint or fall back to remove/add
      const songIds = reorderedSongs.map((song) => song.id);

      try {
        // Try reorder endpoint first
        await apiClient.makeRequest(
          "PUT",
          `/api/media/playlists/${playlist.id}/reorder`,
          {
            data: { song_ids: songIds },
            headers: { "Content-Type": "application/json" },
          }
        );
      } catch (reorderError) {
        // If reorder endpoint doesn't exist, fall back to remove all and re-add
        console.log(
          "Reorder endpoint not available, using remove/add approach"
        );
        await apiClient.removeSongsFromPlaylist(
          playlist.id,
          songs.map((s) => s.id)
        );
        await apiClient.addSongsToPlaylist(playlist.id, songIds);
      }

      // Refresh the playlist songs
      setRefreshSongs(refreshSongs() + 1);

      events.emit("notification:show", {
        type: "success",
        message: "Playlist reordered successfully",
      });
    } catch (error) {
      console.error("❌ Failed to reorder playlist:", error);
      events.emit("notification:show", {
        type: "error",
        message: "Failed to reorder playlist",
      });
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleCancelNewPlaylist = () => {
    navigate("/playlists");
  };

  const sortPlaylists = (playlists: Playlist[] | undefined) => {
    if (!playlists) return [];
    const sorted = [...playlists];
    switch (sortBy()) {
      case "recent":
        return sorted.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      case "alphabetical":
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case "song_count":
        return sorted.sort((a, b) => (b.song_count || 0) - (a.song_count || 0));
      default:
        return sorted;
    }
  };

  return (
    <div class={`h-full bg-black text-white ${props.class || ""}`}>
      <Show when={!selectedPlaylist() && !isNewPlaylist() && !params.id}>
        {/* Playlist List View */}
        <div class="h-full flex flex-col">
          {/* Header */}
          <div class="flex-shrink-0 p-6">
            <div class="flex items-center justify-between mb-4">
              <h1 class="text-2xl font-semibold text-white">playlists</h1>
              <button
                class="px-4 py-2 bg-magenta-600 hover:bg-magenta-500 rounded text-black font-medium transition-colors"
                onClick={() => navigate("/playlists/new")}
              >
                + create playlist
              </button>
            </div>
            <div class="flex items-center justify-between">
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

              <Show
                when={
                  !playlistsResource.loading &&
                  playlistsResource() &&
                  playlistsResource()!.playlists &&
                  playlistsResource()!.playlists.length > 0
                }
              >
                <div class="flex items-center space-x-2">
                  <span class="text-magenta-400 text-sm">sort by:</span>
                  <select
                    class="bg-magenta-950/50 border border-magenta-600/30 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-magenta-400"
                    value={sortBy()}
                    onChange={(e) => setSortBy(e.currentTarget.value as any)}
                  >
                    <option value="recent">most recent</option>
                    <option value="alphabetical">alphabetical</option>
                    <option value="song_count">song count</option>
                  </select>
                </div>
              </Show>
            </div>
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
                <For each={sortPlaylists(playlistsResource()?.playlists)}>
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
                {/* Playlist Info */}
                <div class="mb-8">
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
                      autofocus={isNewPlaylist()}
                    />
                    <textarea
                      value={editDescription()}
                      onInput={(e) => setEditDescription(e.currentTarget.value)}
                      class="text-magenta-300 bg-transparent border border-magenta-400 rounded p-2 mb-4 w-full focus:outline-none focus:border-magenta-300 resize-none"
                      placeholder="Description (optional)"
                      rows="2"
                    />
                  </Show>

                  <Show when={!isNewPlaylist()}>
                    <div class="text-magenta-400 text-sm mb-6">
                      {selectedPlaylist()?.song_count || 0} songs
                      <span class="ml-4">
                        Created{" "}
                        {formatDate(selectedPlaylist()?.created_at || "")}
                      </span>
                      <Show when={selectedPlaylist()?.is_public}>
                        <span class="ml-4 px-2 py-0.5 bg-magenta-600/30 rounded text-xs">
                          public
                        </span>
                      </Show>
                    </div>
                  </Show>

                  <Show when={isNewPlaylist()}>
                    <div class="text-magenta-400 text-sm mb-6">
                      Enter a title and optional description for your new
                      playlist
                    </div>
                  </Show>

                  {/* Action Buttons - Only show for existing playlists with songs */}
                  <Show when={!isNewPlaylist() && !editMode()}>
                    <div class="flex space-x-3">
                      <button
                        class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handlePlayPlaylist}
                        disabled={
                          loadingPlaylistSongs() ||
                          !playlistSongsResource()?.length
                        }
                      >
                        play all
                      </button>
                      <button
                        class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleShufflePlaylist}
                        disabled={
                          loadingPlaylistSongs() ||
                          !playlistSongsResource()?.length
                        }
                      >
                        shuffle
                      </button>
                      <button
                        class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleAddPlaylistToQueue}
                        disabled={
                          loadingPlaylistSongs() ||
                          !playlistSongsResource()?.length
                        }
                      >
                        + add to queue
                      </button>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Management buttons */}
              <div class="flex items-center space-x-2 ml-6">
                <Show when={isNewPlaylist()}>
                  <button
                    class="px-4 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleEditToggle}
                    disabled={!editTitle().trim()}
                  >
                    create playlist
                  </button>
                  <button
                    class="px-4 py-2 bg-gray-600/50 hover:bg-gray-600/70 border border-transparent hover:border-gray-400 rounded text-white font-medium transition-all"
                    onClick={handleCancelNewPlaylist}
                  >
                    cancel
                  </button>
                </Show>
                <Show when={!isNewPlaylist()}>
                  <button
                    class="px-4 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all"
                    onClick={handleEditToggle}
                  >
                    {editMode() ? "save" : "edit"}
                  </button>
                  <Show when={editMode()}>
                    <button
                      class="px-4 py-2 bg-gray-600/50 hover:bg-gray-600/70 border border-transparent hover:border-gray-400 rounded text-white font-medium transition-all"
                      onClick={handleCancelEdit}
                    >
                      cancel
                    </button>
                  </Show>
                  <Show when={!editMode()}>
                    <button
                      class="px-4 py-2 bg-red-600/50 hover:bg-red-600/70 border border-transparent hover:border-red-400 rounded text-white font-medium transition-all"
                      onClick={handleDeletePlaylist}
                    >
                      delete
                    </button>
                  </Show>
                </Show>
              </div>
            </div>
          </div>

          {/* New Playlist Help Message */}
          <Show when={isNewPlaylist()}>
            <div class="flex-1 p-6">
              <div class="text-center py-12">
                <div class="text-6xl mb-4">🎵</div>
                <div class="text-white text-xl mb-2">
                  create your new playlist
                </div>
                <div class="text-magenta-400 mb-6">
                  Enter a title above and click "create playlist" to get started
                </div>
                <div class="text-gray-500 text-sm">
                  After creating your playlist, you can add songs from the music
                  library
                </div>
              </div>
            </div>
          </Show>

          {/* Songs List - Only show for existing playlists */}
          <Show when={!isNewPlaylist()}>
            <div class="flex-1 overflow-y-auto p-6">
              <h3 class="text-xl font-semibold text-white mb-4">
                songs
                <Show when={loadingPlaylistSongs()}>
                  <span class="text-magenta-400 text-sm ml-2">loading...</span>
                </Show>
                <Show
                  when={
                    !editMode() &&
                    !isNewPlaylist() &&
                    playlistSongsResource() &&
                    playlistSongsResource()!.length > 1
                  }
                >
                  <span class="text-magenta-400 text-xs ml-4">
                    drag to reorder
                  </span>
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
                        class={`flex items-center p-3 rounded transition-colors cursor-pointer group ${
                          dragOverIndex() === index()
                            ? "bg-magenta-600/40 border-t-2 border-magenta-400"
                            : draggedIndex() === index()
                              ? "opacity-50 bg-magenta-600/10"
                              : "hover:bg-magenta-600/20"
                        }`}
                        draggable={!editMode() && !isNewPlaylist()}
                        onDragStart={(e) => handleDragStart(e, index())}
                        onDragOver={(e) => handleDragOver(e, index())}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index())}
                        onClick={(e) => handleSongClick(song, index(), e)}
                        onDblClick={() => handleSongDoubleClick(song)}
                        onMouseDown={(e) =>
                          selection.handleRowMouseDown(song, index(), e)
                        }
                        onContextMenu={(e) => {
                          // If right-clicking on unselected song, select it first
                          if (!selection.isSelected(song.id)) {
                            selection.setSelectedItems(new Set([song.id]));
                            selection.setLastSelectedIndex(index());
                          }

                          const selectedSongs = selection.getSelectedSongs(
                            playlistSongsResource() || []
                          );
                          if (selectedSongs.length > 1) {
                            songInteractions.handleBulkRightClick(
                              e,
                              selectedSongs
                            );
                          } else {
                            songInteractions.handleRightClick(e, song);
                          }
                        }}
                        class={`px-4 py-3 border-b border-gray-800 transition-colors cursor-pointer group ${
                          selection.isSelected(song.id)
                            ? "bg-magenta-600/30 border-magenta-400/50"
                            : ""
                        }`}
                      >
                        {/* Track Number / Drag Handle */}
                        <div class="w-8 text-magenta-400 text-sm flex-shrink-0 flex items-center">
                          <Show
                            when={editMode()}
                            fallback={
                              <div
                                class="cursor-grab active:cursor-grabbing opacity-60 hover:opacity-100 transition-opacity"
                                title="Drag to reorder"
                              >
                                <svg
                                  class="w-4 h-4"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path d="M3 7a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 13a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
                                </svg>
                              </div>
                            }
                          >
                            <span>{index() + 1}</span>
                          </Show>
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
                              songInteractions.queueSong(song);
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
          </Show>
        </div>
      </Show>
    </div>
  );
}
