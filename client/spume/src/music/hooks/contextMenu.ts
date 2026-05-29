// composable context menu actions for music items
// provides reusable action builders for songs, albums, artists, playlists, etc.

import { useNavigate } from "@solidjs/router";
import { toast } from "../../components/feedback/Toast";
import { IconNames } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { queryClient } from "../../queryClient";
import { confirm } from "../../app/services/confirmState";
import { showPlaylistSelector } from "./playlistSelectorState";
import { showStationSelector } from "./stationSelectorState";
import { showTagSelector, showShareModal } from "./modals";
import { getDataSource, getCurrentRemote, getRemoteClient } from "../data";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { isCharnelMode } from "../../app/services/charnel";
import { RemoteMusicDataSource } from "../data/remote/remoteSource";
import { isP2PRemote } from "../../app/services/storage/schemas/remote";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { ShareTarget } from "../../components/share/types";
import type { SendPayload } from "../services/send/sendToRemote";
import type { RemoteSong } from "../data/remote/adapters";
import type { Song } from "../data/types";
import { showAlbumEditor, showArtistEditor, showSongEditor } from "./modals";
import {
  useToggleFavoriteMutation,
  type FavoriteTarget,
} from "../queries/favorites";
import { queryKeys } from "../queries/queryKeys";
import { routes } from "../utils/routing";
import { addToQueue, playQueue } from "../services/queue/queue";
import {
  canUpdateSong,
  canDeleteSong,
  canUpdateAlbum,
  canUpdateArtist,
  canManageTags,
  canDeletePlaylist,
  canUpdatePlaylist,
} from "../data/permissions";
import { debug } from "../../utils/logger";

// shared helper to create favorite menu action
// standardizes favorite toggle across all context menus
export function createFavoriteMenuAction(
  targetType: FavoriteTarget,
  targetId: string,
  isFavorite: boolean,
  sha256?: string, // only needed for songs (for queue updates)
  remote?: Remote, // when set, scope the mutation to this remote
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
        remote,
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
  /** whether to show "clear songs above" action (queue view only) */
  showClearAbove?: boolean;
  /** callback when clear songs above is clicked */
  onClearAbove?: () => void;
  /** whether to show "clear songs below" action (queue view only) */
  showClearBelow?: boolean;
  /** callback when clear songs below is clicked */
  onClearBelow?: () => void;
  /** whether to show "delete from local library" action (for synced songs) */
  showDeleteFromLocal?: boolean;
  /** callback when delete from local is clicked */
  onDeleteFromLocal?: () => void;
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
  /** explicit remote to scope navigation, data fetches, and editor
   *  modals to — overrides the globally-active data source. needed
   *  for views (library multi-remote table/graph, federated search)
   *  that browse one source while another is `getCurrentRemote()`. */
  remote?: Remote;
}

/**
 * shared helper that opens the global share modal for a given target.
 * by default snapshots the current remote at click time. when
 * `sourceRemoteId` is supplied, uses that remote instead — needed for
 * queue / non-active-remote share actions so the resulting permalink
 * targets the song's origin server.
 */
export function createShareMenuAction(
  target: ShareTarget,
  buildSendPayload?: () => SendPayload | Promise<SendPayload>,
  sourceRemoteId?: string,
): MenuAction {
  return {
    label: "share...",
    icon: IconNames.share,
    onClick: async () => {
      let remoteId = sourceRemoteId;
      if (!remoteId || remoteId === "local") {
        const info = getCurrentRemote();
        if (!info) {
          toast.error("share is only available on a remote");
          return;
        }
        remoteId = info.remote_id;
      }
      const remote = await getRemoteById(remoteId);
      if (!remote) {
        toast.error("could not find remote");
        return;
      }
      showShareModal({
        target,
        source: () => remote,
        buildSendPayload,
      });
    },
  };
}

// build context menu actions for a single song
export function useSongContextMenu(
  song: Song,
  options: ContextMenuOptions = {},
): MenuAction[] {
  const navigate = useNavigate();
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  const actions: MenuAction[] = [];

  // resolve the song's origin remote so every action below routes
  // against the same source. `options.remote` (when the caller knows
  // it eagerly) wins; otherwise we lazily look up by
  // `song.remote_server_id` at click time.
  const effectiveRemoteId =
    options.remote?.remote_id ?? song.remote_server_id ?? undefined;
  const resolveSongRemote = async (): Promise<Remote | undefined> => {
    if (options.remote) return options.remote;
    if (!song.remote_server_id) return undefined;
    return (await getRemoteById(song.remote_server_id)) ?? undefined;
  };

  // queue management actions FIRST (when in queue context)
  if (options.showRemoveFromQueue && options.queueIndex !== undefined) {
    actions.push({
      label: "remove from queue",
      icon: IconNames.close,
      onClick: () => {
        options.onRemoveFromQueue?.();
      },
    });

    // clear before/after actions (only in queue context)
    if (options.showClearAbove && options.queueIndex > 0) {
      actions.push({
        label: "clear songs before",
        icon: IconNames.chevronUp,
        onClick: () => {
          options.onClearAbove?.();
        },
      });
    }

    if (options.showClearBelow) {
      actions.push({
        label: "clear songs after",
        icon: IconNames.chevronDown,
        onClick: () => {
          options.onClearBelow?.();
        },
      });
    }

    actions.push({ type: "separator" });
  }

  // play actions
  if (options.showPlayActions !== false) {
    actions.push({
      label: "play now",
      icon: IconNames.play,
      onClick: async () => {
        await playQueue([song], { source: { type: "song", label: song.title } });
      },
    });

    actions.push({
      label: "play next",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueue([song], { position: "next", source: { type: "song", label: song.title } });
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueue([song], { source: { type: "song", label: song.title } });
      },
    });

    actions.push({ type: "separator" });
  }

  // navigation actions — scope to the song's own source remote, not
  // the globally-active one. queue items can come from any remote
  // (or local), and routes.album/artist build prefixes from
  // getCurrentRemote() which yields the wrong URL when the active
  // remote differs from the song's origin.
  const songRemoteId = effectiveRemoteId ?? "local";
  if (song.album_id) {
    actions.push({
      label: "view album",
      icon: IconNames.album,
      onClick: () => {
        navigate(routes.albumOn(songRemoteId, song.album_id));
      },
    });
  }

  if (song.artist_id) {
    actions.push({
      label: "view artist",
      icon: IconNames.artist,
      onClick: () => {
        navigate(routes.artistOn(songRemoteId, song.artist_id));
      },
    });
  }

  if (song.album_id || song.artist_id) {
    actions.push({ type: "separator" });
  }

  // playlist management (remove from playlist)
  if (options.showRemoveFromPlaylist && options.playlistId) {
    actions.push({
      label: "remove from playlist",
      icon: IconNames.close,
      onClick: async () => {
        // route to the song's origin remote, not the active source —
        // the queue can contain songs from multiple remotes.
        const remote = await resolveSongRemote();
        const dataSource = remote ? new RemoteMusicDataSource(remote) : getDataSource();
        if (dataSource.removeSongsFromPlaylist) {
          await dataSource.removeSongsFromPlaylist(options.playlistId!, [
            song.id,
          ]);
          // invalidate playlist queries to refresh song list
          queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
          queryClient.invalidateQueries({ queryKey: ["playlists", options.playlistId, "songs"] });
        }
      },
    });
    actions.push({ type: "separator" });
  }

  // favorites
  actions.push({
    label: options.isFavorite ? "remove from favorites" : "add to favorites",
    icon: options.isFavorite ? IconNames.favorite : IconNames.favoriteOutline,
    onClick: async () => {
      const remote = await resolveSongRemote();
      toggleFavoriteMutation.mutate({
        targetType: "song",
        targetId: song.id,
        sha256: song.sha256,
        isFavorite: !(options.isFavorite ?? false),
        remote,
      });
    },
  });

  // playlists
  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: async () => {
      const remote = await resolveSongRemote();
      void showPlaylistSelector([song.id], remote);
    },
  });

  // radio station: local admin (charnel) or remote admin (if song is from a remote)
  if (isCharnelMode() || !!song.remote_server_id) {
    actions.push({
      label: "add to station...",
      icon: IconNames.headphones,
      onClick: () => {
        void showStationSelector(
          { kind: "songs", songIds: [song.id] },
          song.remote_server_id ?? undefined,
        );
      },
    });
  }

  // share — drops a permalink that lands on the album view with this song
  // row highlighted (when album_id is known). always include the send-to
  // builder — the modal will badge destinations that already have the
  // blob and disable rows where the song lacks a blake3.
  actions.push(
    createShareMenuAction(
      {
        kind: "song",
        id: song.id,
        displayTitle: song.title,
        parentId: song.album_id || undefined,
      },
      () => ({
        kind: "song",
        // RemoteSong is a strict subset of Song; the orchestrator only
        // touches blake3/sha256/title/album fields, all present here.
        song: song as unknown as RemoteSong,
      }),
      effectiveRemoteId,
    ),
  );

  // tags
  if (song.album_id && canManageTags()) {
    actions.push({
      label: "tags",
      icon: IconNames.tag,
      onClick: async () => {
        const remote = await resolveSongRemote();
        showTagSelector([song.album_id!], song.album_title, remote);
      },
    });
  }

  // edit/info - only for admins
  if (canUpdateSong()) {
    actions.push({ type: "separator" });

    actions.push({
      label: "edit info...",
      icon: IconNames.edit,
      onClick: async () => {
        const remote = await resolveSongRemote();
        showSongEditor({ songId: song.id, remote });
      },
    });
  }

  // delete - only for admins
  if (canDeleteSong()) {
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
            const remote = await resolveSongRemote();
            const dataSource = remote ? new RemoteMusicDataSource(remote) : getDataSource();
            if (dataSource.deleteSong) {
              await dataSource.deleteSong(song.id);
              toast.success(`deleted "${song.title}"`);
              // invalidate queries to refresh views
              queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
              queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
              queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
              // also remove from queue if in queue context
              if (options.onRemoveFromQueue) {
                options.onRemoveFromQueue();
              }
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
  }

  // delete from local library (for synced songs) - LAST destructive action
  if (options.showDeleteFromLocal) {
    actions.push({ type: "separator" });
    actions.push({
      label: "delete from local library",
      icon: IconNames.delete,
      destructive: true,
      onClick: async () => {
        const confirmed = await confirm({
          title: "delete from local library",
          message: `Remove "${song.title}" from your local library? The song will still be available from the server.`,
          confirmText: "delete",
          cancelText: "cancel",
          variant: "danger",
        });
        if (confirmed) {
          options.onDeleteFromLocal?.();
        }
      },
    });
  }

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
        await playQueue(songs, { source: { type: "song", label: `${songs.length} songs` } });
      },
    });

    actions.push({
      label: "play next",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueue(songs, { position: "next", source: { type: "song", label: `${songs.length} songs` } });
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        await addToQueue(songs, { source: { type: "song", label: `${songs.length} songs` } });
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
      debug("contextMenu", "manage tags for multiple songs:", songs.length);
    },
  });

  actions.push({ type: "separator" });

  // bulk edit
  actions.push({
    label: "edit info...",
    icon: IconNames.edit,
    onClick: () => {
      // TODO: open bulk edit modal
      debug("contextMenu", "bulk edit songs:", songs.length);
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
  artist_id?: string | null;
  song_count?: number;
}

export function useAlbumContextMenu(
  album: AlbumContextMenuData,
  options: ContextMenuOptions = {},
): MenuAction[] {
  const navigate = useNavigate();
  const actions: MenuAction[] = [];

  // when an explicit remote is supplied, scope navigation, song fetches,
  // and editor modals to that remote rather than the globally-active
  // data source. otherwise fall back to the legacy implicit behavior.
  const remote = options.remote;
  const remoteId = remote?.remote_id ?? null;
  const dataSourceFor = (): { getAlbumSongs?: (id: string) => Promise<{ items: Song[] }> } =>
    remote ? new RemoteMusicDataSource(remote) : getDataSource();
  const routeAlbum = (id: string): string =>
    remote ? routes.albumOn(remoteId, id) : routes.album(id);
  const routeArtist = (id: string): string =>
    remote ? routes.artistOn(remoteId, id) : routes.artist(id);

  // play actions
  if (options.showPlayActions !== false) {
    actions.push({
      label: "play album",
      icon: IconNames.play,
      onClick: async () => {
        // fetch album songs and play
        const dataSource = dataSourceFor();
        if (dataSource.getAlbumSongs) {
          const response = await dataSource.getAlbumSongs(album.id);
          await playQueue(response.items, { source: { type: "album", label: album.title, entity_id: album.id } });
        }
      },
    });

    actions.push({
      label: "shuffle album",
      icon: IconNames.shuffle,
      onClick: async () => {
        const dataSource = dataSourceFor();
        if (dataSource.getAlbumSongs) {
          const response = await dataSource.getAlbumSongs(album.id);
          const shuffled = [...response.items].sort(() => Math.random() - 0.5);
          await playQueue(shuffled, { source: { type: "shuffle", label: album.title, entity_id: album.id } });
        }
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: async () => {
        const dataSource = dataSourceFor();
        if (dataSource.getAlbumSongs) {
          const response = await dataSource.getAlbumSongs(album.id);
          await addToQueue(response.items, { source: { type: "album", label: album.title, entity_id: album.id } });
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
      navigate(routeAlbum(album.id));
    },
  });

  if (album.artist_id) {
    actions.push({
      label: "view artist",
      icon: IconNames.artist,
      onClick: () => {
        navigate(routeArtist(album.artist_id!));
      },
    });
  }

  actions.push({ type: "separator" });

  // favorites
  actions.push(
    createFavoriteMenuAction(
      "album",
      album.id,
      options.isFavorite ?? false,
      undefined,
      remote,
    ),
  );

  // add all to playlist
  actions.push({
    label: "add to playlist...",
    icon: IconNames.playlist,
    onClick: async () => {
      const dataSource = dataSourceFor();
      if (!dataSource.getAlbumSongs) return;
      const response = await dataSource.getAlbumSongs(album.id);
      showPlaylistSelector(response.items.map((s) => s.id));
    },
  });

  // radio station: requires a P2P-capable backend (tauri-managed local
  // or a P2P remote). HTTP-only remotes don't expose the radio admin
  // surface, so the action is hidden rather than failing at click time.
  const currentRemote = getCurrentRemote();
  const stationCapable = remote
    ? isP2PRemote(remote)
    : isCharnelMode() || (!!currentRemote && isP2PRemote(currentRemote as Remote));
  if (stationCapable) {
    actions.push({
      label: "add to station...",
      icon: IconNames.headphones,
      onClick: () => {
        void showStationSelector(
          { kind: "album", albumId: album.id, albumTitle: album.title },
          remoteId ?? currentRemote?.remote_id,
        );
      },
    });
  }

  // share — permalink + send-to. send-to builder fetches the album's
  // song list lazily (only when the modal opens) so the menu click stays
  // snappy and we don't waste the fetch on permalink-only shares.
  actions.push(
    createShareMenuAction(
      {
        kind: "album",
        id: album.id,
        displayTitle: album.title,
      },
      async (): Promise<SendPayload> => {
        const dataSource = dataSourceFor();
        if (!dataSource.getAlbumSongs) throw new Error("album fetch not supported");
        const response = await dataSource.getAlbumSongs(album.id);
        const songList = response.items;
        return {
          kind: "album",
          albumId: album.id,
          title: album.title,
          artistName: album.artist_name ?? songList[0]?.artist_name ?? "unknown artist",
          albumType: songList[0]?.album_type ?? null,
          releaseDate: null,
          label: null,
          genres: songList[0]?.album_taxons?.filter((t) => t.kind_slug === "genre").map((t) => t.label).filter(Boolean) ?? [],
          // album-level images live on each song (denormalized). use the first
          // song's copy so dest gets cover art alongside the album row.
          images: songList[0]?.album_images ?? [],
          songs: songList as unknown as RemoteSong[],
        };
      },
    ),
  );

  // tags - only for admins
  if (canManageTags()) {
    actions.push({
      label: "tags",
      icon: IconNames.tag,
      onClick: () => {
        showTagSelector([album.id], album.title);
      },
    });
  }

  // edit - only for admins
  if (canUpdateAlbum()) {
    actions.push({ type: "separator" });

    actions.push({
      label: "edit info...",
      icon: IconNames.edit,
      onClick: () => {
        showAlbumEditor({ albumId: album.id, remote });
      },
    });
  }

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
  /** owner id for permission checks */
  created_by_id?: string | null;
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
          await playQueue(response.items, { source: { type: "playlist", label: playlist.title, entity_id: playlist.id } });
          // fire-and-forget: record initiated playlist play
          try {
            const remoteClient = await getRemoteClient();
            if (remoteClient) {
              void remoteClient.music.recordPlaylistPlay(playlist.id);
            }
          } catch (err) {
            console.warn("[playlist] recordPlaylistPlay failed:", err);
          }
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
          await playQueue(shuffled, { source: { type: "shuffle", label: playlist.title, entity_id: playlist.id } });
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
          await addToQueue(response.items, { source: { type: "playlist", label: playlist.title, entity_id: playlist.id } });
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

  // share — permalink + send-to. send-to builder fetches the playlist's
  // song list lazily so the menu click stays snappy.
  actions.push(
    createShareMenuAction(
      {
        kind: "playlist",
        id: playlist.id,
        displayTitle: playlist.title,
      },
      async (): Promise<SendPayload> => {
        const dataSource = getDataSource();
        if (!dataSource.getPlaylistSongs) throw new Error("playlist fetch not supported");
        const response = await dataSource.getPlaylistSongs(playlist.id);
        return {
          kind: "playlist",
          playlistId: playlist.id,
          title: playlist.title,
          description: null,
          songs: response.items as unknown as RemoteSong[],
        };
      },
    ),
  );

  // edit - only for owner or admin
  if (canUpdatePlaylist(playlist.created_by_id ?? null)) {
    actions.push({
      label: "edit details...",
      icon: IconNames.edit,
      onClick: () => {
        // TODO: open playlist edit modal
        debug("contextMenu", "edit playlist:", playlist.id);
      },
    });
  }

  // delete - only for owner or admin
  if (canDeletePlaylist(playlist.created_by_id ?? null)) {
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
  }

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

  // edit - only for admins
  if (canUpdateArtist()) {
    actions.push({ type: "separator" });

    actions.push({
      label: "edit info...",
      icon: IconNames.edit,
      onClick: () => {
        showArtistEditor({ artistId: artist.id });
      },
    });
  }

  actions.push({ type: "separator" });

  // favorites
  actions.push(
    createFavoriteMenuAction("artist", artist.id, options.isFavorite ?? false),
  );

  // radio station: local (charnel) or remote (if browsing a remote)
  if (isCharnelMode() || !!getCurrentRemote()) {
    actions.push({
      label: "add to station...",
      icon: IconNames.headphones,
      onClick: () => {
        void showStationSelector(
          { kind: "artist", artistId: artist.id, artistName: artist.name },
          getCurrentRemote()?.remote_id,
        );
      },
    });
  }

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

  // navigation: genre detail view was removed in the taxonomy refactor;
  // the "view genre" entry is suppressed pending a taxon browser.

  // radio station: local (charnel) or remote (if browsing a remote)
  if (isCharnelMode() || !!getCurrentRemote()) {
    actions.push({
      label: "add to station...",
      icon: IconNames.headphones,
      onClick: () => {
        void showStationSelector(
          { kind: "genre", genreId: genre.id, genreName: genre.name },
          getCurrentRemote()?.remote_id,
        );
      },
    });
  }

  if (options.customActions && options.customActions.length > 0) {
    actions.push({ type: "separator" });
    actions.push(...options.customActions);
  }

  return actions;
}
