// composable context menu actions for music items
// provides reusable action builders for songs, albums, artists, playlists, etc.

import { useNavigate } from "@solidjs/router";
import { toast } from "../../components/feedback/Toast";
import { IconNames } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { queryClient } from "../../queryClient";
import { confirm } from "../../app/services/confirmState";
import { showPlaylistSelector } from "./playlistSelectorState";
import { showTagSelector } from "../modals";
import { getDataSource } from "../data";
import type { Song } from "../data/types";
import { showAlbumEditor, showArtistEditor, showSongEditor } from "../modals";
import {
  useToggleFavoriteMutation,
  type FavoriteTarget,
} from "../queries/favorites";
import { queryKeys } from "../queries/queryKeys";
import { routes } from "../utils/routing";
import { addToQueue, playQueue } from "../services/audio/queue";

// shared helper to create favorite menu action
// standardizes favorite toggle across all context menus
export function createFavoriteMenuAction(
  targetType: FavoriteTarget,
  targetId: string,
  isFavorite: boolean,
  sha256?: string, // only needed for songs (for queue updates)
): MenuAction {
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  return {
    label: isFavorite ? "remove from favorites" : "add to favorites",
    icon: isFavorite ? IconNames.favorite : IconNames.favoriteOutline,
    onClick: () => {
      toggleFavoriteMutation.mutate({
        targetType,
        targetId,
        sha256,
        isFavorite: !isFavorite,
      });
    },
  };
}

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
  const toggleFavoriteMutation = useToggleFavoriteMutation();
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
        await addToQueue([song], { position: "next" });
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
            song.id,
          ]);
          toast.success("removed from playlist");
          // invalidate playlist queries to refresh song list
          queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
          queryClient.invalidateQueries({ queryKey: ["playlists", options.playlistId, "songs"] });
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
  actions.push(
    createFavoriteMenuAction(
      "song",
      song.id,
      options.isFavorite ?? false,
      song.sha256,
    ),
  );

  // playlists
  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: () => {
      showPlaylistSelector([song.id]);
    },
  });

  // tags
  if (song.album_id) {
    actions.push({
      label: "tags",
      icon: IconNames.tag,
      onClick: () => {
        showTagSelector([song.album_id!], song.album_title);
      },
    });
  }

  actions.push({ type: "separator" });

  // edit/info
  actions.push({
    label: "edit info...",
    icon: IconNames.edit,
    onClick: () => {
      showSongEditor({ songId: song.id });
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
        try {
          const dataSource = getDataSource();
          if (dataSource.deleteSong) {
            await dataSource.deleteSong(song.id);
            toast.success(`deleted "${song.title}"`);
            // invalidate queries to refresh views
            queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
            queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
            queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
          } else {
            toast.error("delete not supported for this data source");
          }
        } catch (error) {
          console.error("failed to delete song:", error);
          toast.error("failed to delete song");
        }
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
        await addToQueue(songs, { position: "next" });
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
      showPlaylistSelector(songs.map((s) => s.id));
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
        try {
          const dataSource = getDataSource();
          if (dataSource.deleteSong) {
            // delete songs one by one
            let deleted = 0;
            for (const song of songs) {
              await dataSource.deleteSong(song.id);
              deleted++;
            }
            toast.success(`deleted ${deleted} songs`);
            // invalidate queries to refresh views
            queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
            queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
            queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
          } else {
            toast.error("delete not supported for this data source");
          }
        } catch (error) {
          console.error("failed to delete songs:", error);
          toast.error("failed to delete songs");
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
  const toggleFavoriteMutation = useToggleFavoriteMutation();
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
  actions.push(
    createFavoriteMenuAction("album", album.id, options.isFavorite ?? false),
  );

  // add all to playlist
  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: async () => {
      const dataSource = getDataSource();
      const response = await dataSource.getAlbumSongs(album.id);
      showPlaylistSelector(response.items.map((s) => s.id));
    },
  });

  // tags
  actions.push({
    label: "tags",
    icon: IconNames.tag,
    onClick: () => {
      showTagSelector([album.id], album.title);
    },
  });

  actions.push({ type: "separator" });

  // edit
  actions.push({
    label: "edit info...",
    icon: IconNames.edit,
    onClick: () => {
      showAlbumEditor({ albumId: album.id });
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
  const toggleFavoriteMutation = useToggleFavoriteMutation();
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
  actions.push(
    createFavoriteMenuAction(
      "playlist",
      playlist.id,
      options.isFavorite ?? false,
    ),
  );

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
        try {
          const dataSource = getDataSource();
          if (dataSource.deletePlaylist) {
            await dataSource.deletePlaylist(playlist.id);
            toast.success(`deleted "${playlist.title}"`);
            queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
          } else {
            toast.error("delete not supported for this data source");
          }
        } catch (error) {
          console.error("failed to delete playlist:", error);
          toast.error("failed to delete playlist");
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
  const toggleFavoriteMutation = useToggleFavoriteMutation();
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

  // edit
  actions.push({
    label: "edit info...",
    icon: IconNames.edit,
    onClick: () => {
      showArtistEditor({ artistId: artist.id });
    },
  });

  actions.push({ type: "separator" });

  // favorites
  actions.push(
    createFavoriteMenuAction("artist", artist.id, options.isFavorite ?? false),
  );

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
