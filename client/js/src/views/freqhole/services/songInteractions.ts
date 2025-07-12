import { useGlobalEvents } from "../hooks/useGlobalEvents";
import { storeActions, useStore } from "../store";
import type { Song } from "../../../lib/music/schemas/song";
import { apiClient } from "../../../lib/api-client";

/**
 * Service for handling song interactions and integrating with the store
 */
export function useSongInteractions() {
  const [store] = useStore();
  const events = useGlobalEvents();

  // Track last context menu position for playlist selector
  let lastContextMenuPosition = { x: 0, y: 0 };

  // Song playback actions
  const playSong = (song: Song, replaceQueue: boolean = true) => {
    console.log(`🎵 Playing song: ${song.display_title}`, { replaceQueue });
    console.log(
      `🎵 Before playSong - isPlaying: ${store.player.isPlaying}, currentSong: ${store.player.currentSong?.id}`
    );

    // Update player state
    storeActions.playSong(song);

    console.log(
      `🎵 After playSong - isPlaying: ${store.player.isPlaying}, currentSong: ${store.player.currentSong?.id}`
    );

    // Handle queue replacement or addition
    if (replaceQueue) {
      // Clear current queue and add this song
      storeActions.clearQueue();
      storeActions.addToQueue(song);
      storeActions.setCurrentIndex(0);
    } else {
      // Add to queue if not already playing
      if (store.player.currentSong?.id !== song.id) {
        storeActions.addToQueue(song);
      }
    }

    // Note: No need to emit player:play event since storeActions.playSong already sets isPlaying: true
  };

  const queueSong = (song: Song) => {
    console.log(`📝 Adding to queue: ${song.display_title}`);

    // Add to queue
    storeActions.addToQueue(song);

    // Show notification
    events.emit("notification:show", {
      message: `added "${song.display_title}" to queue`,
      type: "success",
    });
  };

  const toggleFavorite = async (song: Song) => {
    try {
      console.log(`❤️ Toggling favorite for: ${song.display_title}`);

      const newFavoriteStatus = !song.is_favorite;

      // Optimistically update the UI
      // Note: In a real app, you'd want to update the song in your local state

      // Call API to update favorite status
      await apiClient.makeRequest("PATCH", `/api/songs/${song.id}`, {
        data: { is_favorite: newFavoriteStatus },
      });

      // Show notification
      events.emit("notification:show", {
        message: newFavoriteStatus
          ? `added "${song.display_title}" to favorites`
          : `removed "${song.display_title}" from favorites`,
        type: "success",
      });

      // Trigger data reload to refresh the UI
      events.emit("data:reload", { type: "songs" });
    } catch (error) {
      console.error("❌ Failed to toggle favorite:", error);
      events.emit("notification:show", {
        message: `failed to update favorite status`,
        type: "error",
      });
    }
  };

  const viewArtist = (song: Song) => {
    if (song.artist) {
      console.log(`👤 Viewing artist: ${song.artist}`);
      storeActions.selectArtist({ name: song.artist });
      storeActions.setCurrentView("artists");
      // Navigate to artist page (would need router integration)
      window.location.hash = `/artist/${encodeURIComponent(song.artist)}`;
    }
  };

  const viewAlbum = (song: Song) => {
    if (song.album) {
      console.log(`💿 Viewing album: ${song.album}`);
      storeActions.selectAlbum({
        name: song.album,
        artist: song.album_artist || song.artist,
      });
      storeActions.setCurrentView("albums");
      // Navigate to album page (would need router integration)
      window.location.hash = `/album/${encodeURIComponent(song.album)}`;
    }
  };

  const addToPlaylist = (song: Song, playlistId?: string) => {
    console.log(`📋 Adding to playlist: ${song.display_title}`, { playlistId });

    if (playlistId) {
      // Add to specific playlist
      events.emit("playlist:add-songs", {
        playlistId,
        songs: [song],
      });
    } else {
      // Open playlist selector at last context menu position
      events.emit("playlist-selector:open", {
        x: lastContextMenuPosition.x,
        y: lastContextMenuPosition.y,
        songs: [song],
      });
    }
  };

  const createContextMenuActions = (song: Song) => {
    return [
      {
        label: "Play",
        icon: "play",
        action: () => playSong(song),
      },
      {
        label: "Play Next",
        icon: "queue-next",
        action: () => {
          // Insert at the beginning of queue
          storeActions.addToQueue(song);
          const currentQueue = store.queue.items;
          const lastIndex = currentQueue.length - 1;
          if (lastIndex > 0) {
            // Move the last item (just added) to position 1 (after current song)
            // This would need a reorder queue action
            events.emit("queue:reorder", { oldIndex: lastIndex, newIndex: 1 });
          }
        },
      },
      {
        label: "Add to Queue",
        icon: "queue-add",
        action: () => queueSong(song),
      },
      { type: "separator" },
      {
        label: song.is_favorite ? "Remove from Favorites" : "Add to Favorites",
        icon: song.is_favorite ? "heart-filled" : "heart",
        action: () => toggleFavorite(song),
      },
      {
        label: "Add to Playlist...",
        icon: "playlist-add",
        action: () => {
          events.emit("playlist-selector:open", {
            x: lastContextMenuPosition.x,
            y: lastContextMenuPosition.y,
            songs: [song],
          });
        },
      },
      { type: "separator" },
      {
        label: "View Artist",
        icon: "artist",
        action: () => viewArtist(song),
        disabled: !song.artist,
      },
      {
        label: "View Album",
        icon: "album",
        action: () => viewAlbum(song),
        disabled: !song.album,
      },
      { type: "separator" },
      {
        label: "Song Info",
        icon: "info",
        action: () => {
          // Open song info modal
          events.emit("modal:open", {
            modal: "songInfoModal",
            data: { song },
          });
        },
      },
    ];
  };

  const handleDoubleClick = (song: Song) => {
    playSong(song, true);
  };

  const handleRightClick = (event: MouseEvent, song: Song) => {
    event.preventDefault();

    // Store position for potential playlist selector
    lastContextMenuPosition = { x: event.clientX, y: event.clientY };

    const actions = createContextMenuActions(song);

    events.emit("context-menu:open", {
      x: event.clientX,
      y: event.clientY,
      actions,
    });
  };

  const handlePlaylistSelectorClick = (event: MouseEvent, songs: Song[]) => {
    event.preventDefault();

    events.emit("playlist-selector:open", {
      x: event.clientX,
      y: event.clientY,
      songs,
    });
  };

  const createBulkContextMenuActions = (songs: Song[]) => {
    const songCount = songs.length;

    return [
      {
        label: `Play ${songCount} songs`,
        icon: "play",
        action: () => {
          // Clear queue and add all selected songs
          storeActions.clearQueue();
          songs.forEach((song) => storeActions.addToQueue(song));
          storeActions.setCurrentIndex(0);
          if (songs.length > 0) {
            storeActions.playSong(songs[0]);
          }
        },
      },
      {
        label: `Add ${songCount} songs to Queue`,
        icon: "queue-add",
        action: () => {
          songs.forEach((song) => queueSong(song));
        },
      },
      { type: "separator" },
      {
        label: `Add ${songCount} songs to Playlist...`,
        icon: "playlist-add",
        action: () => {
          events.emit("playlist-selector:open", {
            x: lastContextMenuPosition.x,
            y: lastContextMenuPosition.y,
            songs,
          });
        },
      },
      { type: "separator" },
      {
        label: `Mark ${songCount} as Favorites`,
        icon: "heart",
        action: () => {
          songs.forEach((song) => {
            if (!song.is_favorite) {
              toggleFavorite(song);
            }
          });
        },
      },
      {
        label: `Remove ${songCount} from Favorites`,
        icon: "heart-filled",
        action: () => {
          songs.forEach((song) => {
            if (song.is_favorite) {
              toggleFavorite(song);
            }
          });
        },
      },
    ];
  };

  const handleBulkRightClick = (event: MouseEvent, songs: Song[]) => {
    event.preventDefault();

    // Store position for potential playlist selector
    lastContextMenuPosition = { x: event.clientX, y: event.clientY };

    const actions = createBulkContextMenuActions(songs);

    events.emit("context-menu:open", {
      x: event.clientX,
      y: event.clientY,
      actions,
    });
  };

  // Listen for global song events and handle them
  events.on("song:play", ({ song, replaceQueue }) => {
    playSong(song, replaceQueue);
  });

  events.on("song:queue", ({ song }) => {
    queueSong(song);
  });

  events.on("song:favorite", ({ song }) => {
    toggleFavorite(song);
  });

  events.on("song:unfavorite", ({ song }) => {
    toggleFavorite(song);
  });

  return {
    // Core actions
    playSong,
    queueSong,
    toggleFavorite,
    viewArtist,
    viewAlbum,
    addToPlaylist,

    // UI helpers
    createContextMenuActions,
    createBulkContextMenuActions,
    handleDoubleClick,
    handleRightClick,
    handleBulkRightClick,
    handlePlaylistSelectorClick,

    // Utilities
    formatDuration: (seconds: number | null): string => {
      if (!seconds) return "--:--";
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    },

    formatYear: (year: number | null): string => {
      return year ? year.toString() : "";
    },

    // Check if song is currently playing
    isCurrentSong: (song: Song): boolean => {
      return store.player.currentSong?.id === song.id;
    },

    // Check if song is in queue
    isInQueue: (song: Song): boolean => {
      return store.queue.items.some((item) => item.id === song.id);
    },
  };
}

/**
 * Keyboard shortcuts for song interactions
 */
export function useSongKeyboardShortcuts() {
  const events = useGlobalEvents();
  const [store] = useStore();

  const handleKeydown = (event: KeyboardEvent) => {
    // Only handle shortcuts when not typing in inputs
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (event.code) {
      case "Space":
        event.preventDefault();
        if (store.player.isPlaying) {
          events.emit("player:pause", {});
        } else {
          events.emit("player:play", {});
        }
        break;

      case "ArrowRight":
        if (event.shiftKey) {
          event.preventDefault();
          events.emit("queue:next", {});
        }
        break;

      case "ArrowLeft":
        if (event.shiftKey) {
          event.preventDefault();
          events.emit("queue:previous", {});
        }
        break;

      case "KeyS":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          events.emit("player:shuffle", {
            enabled: !store.player.shuffle,
          });
        }
        break;

      case "KeyR":
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          const currentRepeat = store.player.repeat;
          // Cycle through repeat modes: none -> one -> all -> none
          let nextMode: "none" | "one" | "all" = "none";
          if (!currentRepeat) nextMode = "one";
          // This assumes repeat is a boolean, might need to adjust based on actual store structure
          events.emit("player:repeat", { mode: nextMode });
        }
        break;
    }
  };

  // Set up keyboard listener
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeydown);

    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }

  return () => {};
}
