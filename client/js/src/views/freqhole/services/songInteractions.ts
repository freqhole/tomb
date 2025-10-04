import { onCleanup } from "solid-js";
import { useGlobalEvents } from "../hooks/useGlobalEvents";
import { storeActions, useStore } from "../store";
import type { Song } from "../../../lib/music/schemas/song";
import type { Album } from "../../../lib/music/schemas/album";
import { apiClient } from "../../../lib/api-client";
import { useAuth } from "../../../hooks/auth";

interface SongAction {
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface SeparatorAction {
  type: "separator";
}

type MenuAction = SongAction | SeparatorAction;

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
    // Update player state
    storeActions.playSong(song);

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
    // Add to queue
    storeActions.addToQueue(song);

    // Show notification
    events.emit("notification:show", {
      message: `added "${song.display_title}" to queue`,
      type: "success",
    });
  };

  // Smart queue function that starts playing if queue is empty or no current song
  const smartQueueSong = (song: Song) => {
    const isQueueEmpty = store.queue.items.length === 0;
    const hasNoCurrentSong = !store.player.currentSong;

    // Only start playing if queue is empty or there's no current song
    if (isQueueEmpty || hasNoCurrentSong) {
      playSong(song, true); // Replace queue and start playing
    } else {
      queueSong(song); // Just add to queue
    }
  };

  // Smart queue function for multiple songs (albums, playlists, etc.)
  const smartQueueSongs = (songs: Song[]) => {
    if (songs.length === 0) return;

    const isQueueEmpty = store.queue.items.length === 0;
    const hasNoCurrentSong = !store.player.currentSong;

    // Only start playing if queue is empty or there's no current song
    if (isQueueEmpty || hasNoCurrentSong) {
      const firstSong = songs[0];
      if (firstSong) {
        playSong(firstSong, true); // Replace queue and start playing
        // Add remaining songs to queue
        songs.slice(1).forEach((song) => {
          queueSong(song);
        });
      }
    } else {
      // Otherwise just add all songs to queue
      songs.forEach((song) => {
        queueSong(song);
      });
    }
  };

  const toggleFavorite = async (song: Song) => {
    try {
      const newFavoriteStatus = !song.user_is_favorite;

      // Use the correct API method
      await apiClient.toggleSongFavorite(song.id, newFavoriteStatus);

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
      console.error("failed to toggle favorite:", error);
      events.emit("notification:show", {
        message: `failed to update favorite status`,
        type: "error",
      });
    }
  };

  const viewArtist = (song: Song) => {
    if (song.artist) {
      storeActions.selectArtist({ name: song.artist });
      storeActions.setCurrentView("artists");
      // Navigate to artist page (would need router integration)
      window.location.hash = `/artist/${encodeURIComponent(song.artist)}`;
    }
  };

  const viewAlbum = (song: Song) => {
    if (song.album) {
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

  const createContextMenuActions = (
    song: Song,
    context?: {
      hideViewArtist?: boolean;
      hideViewAlbum?: boolean;
      hideRemoveFromPlaylist?: boolean;
      currentPlaylistId?: string;
    }
  ): MenuAction[] => {
    const auth = useAuth();
    const actions: MenuAction[] = [
      {
        label: "play",
        icon: "play",
        action: () => playSong(song),
      },
      {
        label: "play next",
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
        label: "add to queue",
        icon: "queue-add",
        action: () => queueSong(song),
      },
      { type: "separator" },
      {
        label: song.user_is_favorite
          ? "remove from favorites"
          : "add to favorites",
        icon: song.user_is_favorite ? "heart-filled" : "heart",
        action: () => toggleFavorite(song),
      },
      {
        label: "add to playlist...",
        icon: "playlist-add",
        action: () => {
          events.emit("playlist-selector:open", {
            x: lastContextMenuPosition.x,
            y: lastContextMenuPosition.y,
            songs: [song],
          });
        },
      },
    ];

    // Add navigation actions if available
    const hasNavActions =
      (!context?.hideViewArtist && song.artist) ||
      (!context?.hideViewAlbum && song.album);

    if (hasNavActions) {
      actions.push({ type: "separator" });

      if (!context?.hideViewArtist && song.artist) {
        actions.push({
          label: "view artist",
          icon: "artist",
          action: () => viewArtist(song),
        });
      }

      if (!context?.hideViewAlbum && song.album) {
        actions.push({
          label: "view album",
          icon: "album",
          action: () => viewAlbum(song),
        });
      }
    }

    // Add playlist removal option if in a playlist
    if (context?.currentPlaylistId) {
      actions.push({ type: "separator" });
      actions.push({
        label: "remove from playlist",
        icon: "playlist-remove",
        action: () => {
          // This would need to be implemented
          console.log(
            "[songInteractions] #TODO something meaningful? remove from playlist action:",
            context.currentPlaylistId
          );
        },
        destructive: true,
      });
    }

    // Add tag management actions (admin only)
    if (auth.isAdmin) {
      actions.push({ type: "separator" });
      actions.push({
        label: "tags",
        icon: "tag",
        action: () => {
          events.emit("tag-selector:open", {
            x: lastContextMenuPosition.x,
            y: lastContextMenuPosition.y,
            songs: [song],
            mode: "manage",
          });
        },
      });
    }

    // Add info action
    actions.push({ type: "separator" });
    actions.push({
      label: "song info",
      icon: "info",
      action: () => {
        // Open song info modal
        events.emit("modal:open", {
          modal: "songInfoModal",
          data: { songs: [song] },
        });
      },
    });

    // Add delete option for admin users (at the end)
    if (auth.isAdmin) {
      actions.push({ type: "separator" });
      actions.push({
        label: "delete song",
        icon: "trash",
        destructive: true,
        action: async () => {
          if (confirm("are you sure you want to delete this song?")) {
            try {
              await apiClient.deleteSongs([song.id]);
              // refresh song list or emit event to update ui
              events.emit("data:reload", { type: "songs" });
              // clear selection
              events.emit("selection:clear");
            } catch (error) {
              console.error("failed to delete song:", error);
            }
          }
        },
      });
    }

    return actions;
  };

  const handleDoubleClick = (song: Song) => {
    playSong(song, true);
  };

  const handleRightClick = (
    event: MouseEvent,
    song: Song,
    context?: {
      hideViewArtist?: boolean;
      hideViewAlbum?: boolean;
      hideRemoveFromPlaylist?: boolean;
      currentPlaylistId?: string;
    }
  ) => {
    event.preventDefault();

    // Store position for potential playlist selector
    lastContextMenuPosition = { x: event.clientX, y: event.clientY };

    const actions = createContextMenuActions(song, context);

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
    const auth = useAuth();

    const actions: (SongAction | SeparatorAction)[] = [
      {
        label: `play ${songCount} songs`,
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
        label: `add ${songCount} songs to queue`,
        icon: "queue-add",
        action: () => {
          songs.forEach((song) => queueSong(song));
        },
      },
      { type: "separator" },
      {
        label: `add ${songCount} songs to playlist...`,
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
        label: `mark ${songCount} as favorites`,
        icon: "heart",
        action: () => {
          songs.forEach((song) => {
            if (!song.user_is_favorite) {
              toggleFavorite(song);
            }
          });
        },
      },
      {
        label: `remove ${songCount} from favorites`,
        icon: "heart-filled",
        action: () => {
          songs.forEach((song) => {
            if (song.user_is_favorite) {
              toggleFavorite(song);
            }
          });
        },
      },
    ];

    // Add bulk tag management for admin users
    if (auth.isAdmin) {
      actions.push({ type: "separator" });
      actions.push({
        label: `tags (${songCount} songs)`,
        icon: "tag",
        action: () => {
          events.emit("tag-selector:open", {
            x: lastContextMenuPosition.x,
            y: lastContextMenuPosition.y,
            songs,
            mode: "manage",
          });
        },
      });
    }

    // Add bulk song info action
    actions.push({ type: "separator" });
    actions.push({
      label: `edit ${songCount} songs`,
      icon: "info",
      action: () => {
        // Open song info modal for multiple songs
        events.emit("modal:open", {
          modal: "songInfoModal",
          data: { songs },
        });
      },
    });

    // Add delete songs option for admin users (at the end)
    if (auth.isAdmin) {
      actions.push({ type: "separator" });
      actions.push({
        label: `delete ${songCount} songs`,
        icon: "trash",
        destructive: true,
        action: async () => {
          const confirmMessage =
            songCount === 1
              ? "are you sure you want to delete this song?"
              : `are you sure you want to delete ${songCount} songs?`;

          if (confirm(confirmMessage)) {
            try {
              await apiClient.deleteSongs(songs.map((s) => s.id));
              // refresh song list or emit event to update ui
              events.emit("data:reload", { type: "songs" });
              // clear selection
              events.emit("selection:clear");
            } catch (error) {
              console.error("failed to delete songs:", error);
            }
          }
        },
      });
    }

    return actions;
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

  const createAlbumContextMenuActions = async (album: Album) => {
    const auth = useAuth();
    const actions: MenuAction[] = [];

    try {
      // Get all tracks for the album to use in context menu actions
      const tracks = await apiClient.getAlbumTracks(
        album.album || "",
        album.artist || undefined
      );

      if (tracks.length > 0) {
        actions.push(
          {
            label: "play album",
            icon: "play",
            action: () => smartQueueSongs(tracks),
          },
          {
            label: "add album to queue",
            icon: "queue-add",
            action: () => {
              tracks.forEach((track) => queueSong(track));
            },
          },
          { type: "separator" },
          {
            label: "add album to playlist...",
            icon: "playlist-add",
            action: () => {
              events.emit("playlist-selector:open", {
                x: lastContextMenuPosition.x,
                y: lastContextMenuPosition.y,
                songs: tracks,
              });
            },
          }
        );

        // Add admin actions
        if (auth.isAdmin) {
          actions.push(
            { type: "separator" },
            {
              label: "edit album",
              icon: "info",
              action: () => {
                events.emit("modal:open", {
                  modal: "songInfoModal",
                  data: { songs: tracks },
                });
              },
            }
          );
        }
      }
    } catch (error) {
      console.error("failed to load album tracks for context menu:", error);
    }

    return actions;
  };

  const handleAlbumRightClick = async (event: MouseEvent, album: Album) => {
    event.preventDefault();

    // Store position for potential playlist selector
    lastContextMenuPosition = { x: event.clientX, y: event.clientY };

    const actions = await createAlbumContextMenuActions(album);

    if (actions.length > 0) {
      events.emit("context-menu:open", {
        x: event.clientX,
        y: event.clientY,
        actions,
      });
    }
  };

  // Remove these event listeners to prevent double API calls
  // The SongFavoriteHeart component already handles the API calls
  // events.on("song:favorite", ({ song }) => {
  //   toggleFavorite(song);
  // });

  // events.on("song:unfavorite", ({ song }) => {
  //   toggleFavorite(song);
  // });

  return {
    // Core actions
    playSong,
    queueSong,
    smartQueueSong,
    smartQueueSongs,
    toggleFavorite,
    viewArtist,
    viewAlbum,
    addToPlaylist,

    // UI helpers
    createContextMenuActions,
    createBulkContextMenuActions,
    createAlbumContextMenuActions,
    handleDoubleClick,
    handleRightClick,
    handleBulkRightClick,
    handleAlbumRightClick,
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
