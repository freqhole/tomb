// composable context menu actions for music items
// provides reusable action builders for songs, albums, artists, playlists, etc.

import { useNavigate } from "@solidjs/router";
import { IconNames } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { confirm } from "../../utils/confirm";
import { getDataSource } from "../data";
import type { Song } from "../data/types";
import { routes } from "../utils/routing";
import { addToQueue, addToQueueAfterCurrent, playQueue } from "./audio/player";

export interface ContextMenuOptions {
  /** whether to show play/queue actions (false for non-playable types like artists/genres) */
  showPlayActions?: boolean;
  /** whether to show "remove from playlist" action (playlist detail view only) */
  showRemoveFromPlaylist?: boolean;
  /** playlist id for remove action */
  playlistId?: string;
  /** whether to show "remove from queue" action (queue view only) */
  showRemoveFromQueue?: boolean;
  /** queue index for remove action */
  queueIndex?: number;
  /** callback when remove from queue is clicked */
  onRemoveFromQueue?: () => void;
  /** whether item is currently favorited */
  isFavorite?: boolean;
  /** custom actions to append */
  customActions?: MenuAction[];
  /** callback when play all is clicked (for artists/genres) */
  onPlayAll?: () => void | Promise<void>;
  /** callback when shuffle is clicked (for artists/genres) */
  onShuffle?: () => void | Promise<void>;
  /** callback when add to queue is clicked (for artists/genres) */
  onAddToQueue?: () => void | Promise<void>;
}

// build context menu actions for a single song
export function useSongContextMenu(
  song: Song,
  options: ContextMenuOptions = {},
): MenuAction[] {
  const navigate = useNavigate();
  const actions: MenuAction[] = [];

  // play actions
  if (options.showPlayActions !== false) {
    actions.push({
      label: "play now",
      icon: IconNames.play,
      onClick: async () => {
        await playQueue([song]);
      },
    });

    actions.push({
      label: "play next",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueueAfterCurrent([song]);
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueue([song]);
      },
    });

    actions.push({ type: "separator" });
  }

  // navigation actions
  if (song.album_id) {
    actions.push({
      label: "view album",
      icon: IconNames.album,
      onClick: () => {
        navigate(routes.album(song.album_id));
      },
    });
  }

  if (song.artist_id) {
    actions.push({
      label: "view artist",
      icon: IconNames.artist,
      onClick: () => {
        navigate(routes.artist(song.artist_id));
      },
    });
  }

  if (song.album_id || song.artist_id) {
    actions.push({ type: "separator" });
  }

  // playlist/queue management
  if (options.showRemoveFromPlaylist && options.playlistId) {
    actions.push({
      label: "remove from playlist",
      icon: IconNames.delete,
      destructive: true,
      onClick: async () => {
        const dataSource = getDataSource();
        if (dataSource.removeSongsFromPlaylist) {
          await dataSource.removeSongsFromPlaylist(options.playlistId!, [
            song.sha256,
          ]);
          // TODO: show toast notification
          // TODO: invalidate playlist query
        }
      },
    });
    actions.push({ type: "separator" });
  }

  if (options.showRemoveFromQueue && options.queueIndex !== undefined) {
    actions.push({
      label: "remove from queue",
      icon: IconNames.delete,
      destructive: true,
      onClick: () => {
        options.onRemoveFromQueue?.();
      },
    });
    actions.push({ type: "separator" });
  }

  // favorites
  actions.push({
    label: options.isFavorite ? "remove from favorites" : "add to favorites",
    icon: options.isFavorite ? IconNames.favorite : IconNames.favoriteOutline,
    onClick: () => {
      // TODO: implement favorite toggle API call
      console.log("toggle favorite:", song.sha256);
    },
  });

  // playlists
  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: () => {
      // TODO: open playlist selection modal
      console.log("add to playlist:", song.sha256);
    },
  });

  // tags
  actions.push({
    label: "manage tags...",
    icon: IconNames.genre,
    onClick: () => {
      // TODO: open tag management modal
      console.log("manage tags:", song.sha256);
    },
  });

  actions.push({ type: "separator" });

  // edit/info
  actions.push({
    label: "edit info...",
    icon: IconNames.edit,
    onClick: () => {
      // TODO: open song edit modal
      console.log("edit song:", song.sha256);
    },
  });

  // delete
  actions.push({
    label: "delete",
    icon: IconNames.delete,
    destructive: true,
    onClick: async () => {
      const confirmed = await confirm({
        title: "delete song",
        message: `are you sure you want to delete "${song.title}"? this cannot be undone.`,
        confirmText: "delete",
        variant: "danger",
      });

      if (confirmed) {
        // TODO: implement delete API call
        console.log("delete song:", song.sha256);
        // TODO: show toast notification
        // TODO: invalidate queries to refresh views
      }
    },
  });

  // append custom actions
  if (options.customActions && options.customActions.length > 0) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}

// build context menu actions for multiple songs
export function useMultipleSongsContextMenu(
  songs: Song[],
  options: ContextMenuOptions = {},
): MenuAction[] {
  const actions: MenuAction[] = [];

  if (songs.length === 0) return actions;

  // play actions for multiple songs
  if (options.showPlayActions !== false) {
    actions.push({
      label: `play ${songs.length} songs`,
      icon: IconNames.play,
      onClick: async () => {
        await playQueue(songs);
      },
    });

    actions.push({
      label: "play next",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueueAfterCurrent(songs);
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueue(songs);
      },
    });

    actions.push({ type: "separator" });
  }

  // bulk actions
  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: () => {
      // TODO: open playlist selection modal
      console.log("add multiple songs to playlist:", songs.length);
    },
  });

  actions.push({
    label: "manage tags...",
    icon: IconNames.genre,
    onClick: () => {
      // TODO: open tag management modal
      console.log("manage tags for multiple songs:", songs.length);
    },
  });

  actions.push({ type: "separator" });

  // bulk edit
  actions.push({
    label: "edit info...",
    icon: IconNames.edit,
    onClick: () => {
      // TODO: open bulk edit modal
      console.log("bulk edit songs:", songs.length);
    },
  });

  // delete multiple
  actions.push({
    label: `delete ${songs.length} songs`,
    icon: IconNames.delete,
    destructive: true,
    onClick: async () => {
      const confirmed = await confirm({
        title: "delete songs",
        message: `are you sure you want to delete ${songs.length} songs? this cannot be undone.`,
        confirmText: "delete",
        variant: "danger",
      });

      if (confirmed) {
        // TODO: implement delete API call
        console.log("delete multiple songs:", songs.length);
        // TODO: show toast notification
        // TODO: invalidate queries to refresh views
      }
    },
  });

  if (options.customActions && options.customActions.length > 0) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}

// build context menu actions for an album
export interface AlbumContextMenuData {
  id: string;
  title: string;
  artist_name?: string | null;
  song_count?: number;
}

export function useAlbumContextMenu(
  album: AlbumContextMenuData,
  options: ContextMenuOptions = {},
): MenuAction[] {
  const navigate = useNavigate();
  const actions: MenuAction[] = [];

  // play actions
  if (options.showPlayActions !== false) {
    actions.push({
      label: "play album",
      icon: IconNames.play,
      onClick: async () => {
        // fetch album songs and play
        const dataSource = getDataSource();
        if (dataSource.getAlbumSongs) {
          const response = await dataSource.getAlbumSongs(album.id);
          await playQueue(response.items);
        }
      },
    });

    actions.push({
      label: "shuffle album",
      icon: IconNames.shuffle,
      onClick: async () => {
        const dataSource = getDataSource();
        if (dataSource.getAlbumSongs) {
          const response = await dataSource.getAlbumSongs(album.id);
          const shuffled = [...response.items].sort(() => Math.random() - 0.5);
          await playQueue(shuffled);
        }
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        const dataSource = getDataSource();
        if (dataSource.getAlbumSongs) {
          const response = await dataSource.getAlbumSongs(album.id);
          await addToQueue(response.items);
        }
      },
    });

    actions.push({ type: "separator" });
  }

  // navigation
  actions.push({
    label: "view album",
    icon: IconNames.album,
    onClick: () => {
      navigate(routes.album(album.id));
    },
  });

  actions.push({ type: "separator" });

  // favorites
  actions.push({
    label: options.isFavorite ? "remove from favorites" : "add to favorites",
    icon: options.isFavorite ? IconNames.favorite : IconNames.favoriteOutline,
    onClick: () => {
      // TODO: implement favorite toggle for album
      console.log("toggle favorite album:", album.id);
    },
  });

  // add all to playlist
  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: () => {
      // TODO: open playlist selection modal
      console.log("add album to playlist:", album.id);
    },
  });

  actions.push({ type: "separator" });

  // edit
  actions.push({
    label: "edit info...",
    icon: IconNames.edit,
    onClick: () => {
      // TODO: open album edit modal
      console.log("edit album:", album.id);
    },
  });

  if (options.customActions && options.customActions.length > 0) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}

// build context menu actions for a playlist
export interface PlaylistContextMenuData {
  id: string;
  title: string;
  song_count?: number;
}

export function usePlaylistContextMenu(
  playlist: PlaylistContextMenuData,
  options: ContextMenuOptions = {},
): MenuAction[] {
  const navigate = useNavigate();
  const actions: MenuAction[] = [];

  // play actions
  if (options.showPlayActions !== false) {
    actions.push({
      label: "play playlist",
      icon: IconNames.play,
      onClick: async () => {
        const dataSource = getDataSource();
        if (dataSource.getPlaylistSongs) {
          const response = await dataSource.getPlaylistSongs(playlist.id);
          await playQueue(response.items);
        }
      },
    });

    actions.push({
      label: "shuffle playlist",
      icon: IconNames.shuffle,
      onClick: async () => {
        const dataSource = getDataSource();
        if (dataSource.getPlaylistSongs) {
          const response = await dataSource.getPlaylistSongs(playlist.id);
          const shuffled = [...response.items].sort(() => Math.random() - 0.5);
          await playQueue(shuffled);
        }
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        const dataSource = getDataSource();
        if (dataSource.getPlaylistSongs) {
          const response = await dataSource.getPlaylistSongs(playlist.id);
          await addToQueue(response.items);
        }
      },
    });

    actions.push({ type: "separator" });
  }

  // navigation
  actions.push({
    label: "view playlist",
    icon: IconNames.playlist,
    onClick: () => {
      navigate(routes.playlist(playlist.id));
    },
  });

  actions.push({ type: "separator" });

  // favorites
  actions.push({
    label: options.isFavorite ? "remove from favorites" : "add to favorites",
    icon: options.isFavorite ? IconNames.favorite : IconNames.favoriteOutline,
    onClick: () => {
      // TODO: implement favorite toggle for playlist
      console.log("toggle favorite playlist:", playlist.id);
    },
  });

  // edit
  actions.push({
    label: "edit details...",
    icon: IconNames.edit,
    onClick: () => {
      // TODO: open playlist edit modal
      console.log("edit playlist:", playlist.id);
    },
  });

  // delete
  actions.push({
    label: "delete playlist",
    icon: IconNames.delete,
    destructive: true,
    onClick: async () => {
      const confirmed = await confirm({
        title: "delete playlist",
        message: `are you sure you want to delete "${playlist.title}"? this cannot be undone.`,
        confirmText: "delete",
        variant: "danger",
      });

      if (confirmed) {
        const dataSource = getDataSource();
        if (dataSource.deletePlaylist) {
          await dataSource.deletePlaylist(playlist.id);
          // TODO: show toast notification
          // TODO: invalidate playlists query
        }
      }
    },
  });

  if (options.customActions && options.customActions.length > 0) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}

// build context menu actions for an artist (no play actions - navigate only)
export interface ArtistContextMenuData {
  id: string;
  name: string;
  song_count?: number;
  album_count?: number;
}

export function useArtistContextMenu(
  artist: ArtistContextMenuData,
  options: ContextMenuOptions = {},
): MenuAction[] {
  const navigate = useNavigate();
  const actions: MenuAction[] = [];

  // play actions (if callbacks provided)
  if (options.onPlayAll || options.onShuffle || options.onAddToQueue) {
    if (options.onPlayAll) {
      actions.push({
        label: "play all",
        icon: IconNames.play,
        onClick: () => {
          options.onPlayAll?.();
        },
      });
    }

    if (options.onShuffle) {
      actions.push({
        label: "shuffle all",
        icon: IconNames.shuffle,
        onClick: () => {
          options.onShuffle?.();
        },
      });
    }

    if (options.onAddToQueue) {
      actions.push({
        label: "add to queue",
        icon: IconNames.queue,
        onClick: () => {
          options.onAddToQueue?.();
        },
      });
    }

    actions.push({ type: "separator" });
  }

  // navigation
  actions.push({
    label: "view artist",
    icon: IconNames.artist,
    onClick: () => {
      navigate(routes.artist(artist.id));
    },
  });

  actions.push({ type: "separator" });

  // favorites
  actions.push({
    label: options.isFavorite ? "remove from favorites" : "add to favorites",
    icon: options.isFavorite ? IconNames.favorite : IconNames.favoriteOutline,
    onClick: () => {
      // TODO: implement favorite toggle for artist
      console.log("toggle favorite artist:", artist.id);
    },
  });

  if (options.customActions && options.customActions.length > 0) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}

// build context menu actions for a genre (no play actions - navigate only)
export interface GenreContextMenuData {
  id: string;
  name: string;
  song_count?: number;
}

export function useGenreContextMenu(
  genre: GenreContextMenuData,
  options: ContextMenuOptions = {},
): MenuAction[] {
  const navigate = useNavigate();
  const actions: MenuAction[] = [];

  // play actions (if callbacks provided)
  if (options.onPlayAll || options.onShuffle || options.onAddToQueue) {
    if (options.onPlayAll) {
      actions.push({
        label: "play all",
        icon: IconNames.play,
        onClick: () => {
          options.onPlayAll?.();
        },
      });
    }

    if (options.onShuffle) {
      actions.push({
        label: "shuffle all",
        icon: IconNames.shuffle,
        onClick: () => {
          options.onShuffle?.();
        },
      });
    }

    if (options.onAddToQueue) {
      actions.push({
        label: "add to queue",
        icon: IconNames.queue,
        onClick: () => {
          options.onAddToQueue?.();
        },
      });
    }

    actions.push({ type: "separator" });
  }

  // navigation
  actions.push({
    label: "view genre",
    icon: IconNames.genre,
    onClick: () => {
      navigate(routes.genre(genre.id));
    },
  });

  if (options.customActions && options.customActions.length > 0) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}
