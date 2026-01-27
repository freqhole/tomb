// playlists view - displays playlists in two-column layout with detail panel
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { appState, setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import { IconButton } from "../../components/buttons/IconButton";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { ImageCarouselModal } from "../../components/modals/ImageCarouselModal";
import { toast } from "../../components/feedback/Toast";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import {
  DraggableRow,
  DraggableRowSongContent,
} from "../../components/lists/DraggableRow";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { FavoriteToggle } from "../../utils/FavoriteToggle";
import {
  VirtualItemList,
  type ListItem,
} from "../../components/virtualized/VirtualItemList";
import { formatRelativeTime } from "../../utils/dateTime";
import { generateUUID } from "../../utils/uuid";
import { pollJobUntilComplete } from "../../utils/jobs";
import { buildRoute } from "../utils/routing";
import { getCurrentRemote, getDataSource } from "../data";
import type { Song } from "../data/types";
import { getImageUrl } from "../utils/images";
import {
  useDeletePlaylistMutation,
  usePlaylistSongsQuery,
  usePlaylistsQuery,
  useReorderPlaylistSongsMutation,
  useUpdatePlaylistMutation,
} from "../queries/playlists";
import { playSong } from "../services/audio/player";
import {
  usePlaylistContextMenu,
  useSongContextMenu,
} from "../services/contextMenu";
import { storeBlob } from "../services/storage/blobs";
import {
  checkIfPlaylistNeedsSync,
  downloadPlaylist,
  syncPlaylist,
  type DownloadProgress,
  type SyncCheckResult,
} from "../services/playlists/downloadSync";
import { getRemoteByUrl } from "../services/remotes/remoteManager";
import { getPlaylistById, initMusicDB } from "../services/storage/db";
import {
  convertToLocalPlaylist,
  isEditablePlaylist,
} from "../services/storage/playlists";
import { type Playlist } from "../services/storage/types";
import { getRoutePrefix } from "../utils/routing";

export interface PlaylistsViewProps {
  onAddMusic: () => void;
}

// type guard helper for SafeParseResult
function isSuccess<T>(result: {
  success: boolean;
  data?: T;
  error?: any;
}): result is { success: true; data: T } {
  return result.success === true;
}

export function PlaylistsView(props: PlaylistsViewProps) {
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const [isResetting, setIsResetting] = createSignal(false);
  const navigate = useNavigate();

  // restore selected playlist from history state on mount, fallback to params.id
  const initialPlaylistId = typeof window !== "undefined" 
    ? (window.history.state?.selectedPlaylistId as string | null) || params.id || null
    : params.id || null;

  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<
    string | null
  >(initialPlaylistId);
  const [search, setSearch] = createSignal<string>();
  const [lastClickedId, setLastClickedId] = createSignal<string | null>(null);
  const [clickTimeout, setClickTimeout] = createSignal<number | null>(null);
  const [editMode, setEditMode] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [uploadingImage, setUploadingImage] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal(0);
  const [showImageCarousel, setShowImageCarousel] = createSignal(false);
  const [carouselImages, setCarouselImages] = createSignal<string[]>([]);
  const [carouselInitialIndex, setCarouselInitialIndex] = createSignal(0);
  const [draggedSongId, setDraggedSongId] = createSignal<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(
    null,
  );
  const [syncStatus, setSyncStatus] = createSignal<SyncCheckResult | null>(
    null,
  );
  const [syncSourceRemoteName, setSyncSourceRemoteName] = createSignal<
    string | null
  >(null);
  const [localThumbnailUrl, setLocalThumbnailUrl] = createSignal<string | null>(
    null,
  );
  const [downloadProgress, setDownloadProgress] =
    createSignal<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [scrollToIndex, setScrollToIndex] = createSignal<((index: number) => void) | null>(null);
  const [isLocalClick, setIsLocalClick] = createSignal(false);
  
  // save selected playlist to history state when it changes
  createEffect(() => {
    const playlistId = selectedPlaylistId();
    if (playlistId && typeof window !== "undefined") {
      const currentState = window.history.state || {};
      window.history.replaceState(
        { ...currentState, selectedPlaylistId: playlistId },
        ""
      );
    }
  });
  
  // sync URL params with selected playlist
  createEffect(() => {
    const urlPlaylistId = params.id;
    
    if (urlPlaylistId && urlPlaylistId !== selectedPlaylistId()) {
      setSelectedPlaylistId(urlPlaylistId);
      
      // only scroll if this is from navigation (back/forward/initial), not from clicking in the list
      const shouldScroll = !isLocalClick();
      if (shouldScroll && scrollToIndex()) {
        const playlistIndex = playlists().findIndex(p => p.playlist_id === urlPlaylistId);
        if (playlistIndex >= 0) {
          scrollToIndex()!(playlistIndex);
        }
      }
      
      // reset flag after capturing its value
      setIsLocalClick(false);
    }
  });
  const [isSyncing, setIsSyncing] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);

  // mutations for updating playlist
  const updatePlaylistMutation = useUpdatePlaylistMutation();
  const reorderSongsMutation = useReorderPlaylistSongsMutation();
  const deletePlaylistMutation = useDeletePlaylistMutation();

  // query client for invalidation
  const queryClient = useQueryClient();

  // cleanup on unmount - revoke any object URLs
  onCleanup(() => {
    const url = localThumbnailUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  });

  // check if viewing remote playlists
  const isViewingRemote = createMemo(() => getCurrentRemote() !== null);

  // check sync status for both remote and local playlists
  createEffect(() => {
    const playlist = selectedPlaylist();
    const remote = getCurrentRemote();
    const viewingRemote = isViewingRemote();

    if (playlist && remote && viewingRemote) {
      // viewing remote playlist - check if there's a local copy
      checkIfPlaylistNeedsSync(remote.base_url, playlist.playlist_id).then(
        setSyncStatus,
      );
      setSyncSourceRemoteName(null); // remote context doesn't need remote name
    } else if (
      !viewingRemote &&
      playlist?.source_remote_url &&
      playlist?.source_remote_id
    ) {
      // viewing local synced playlist - check if needs sync with its remote source
      checkIfPlaylistNeedsSync(
        playlist.source_remote_url,
        playlist.source_remote_id,
      ).then(setSyncStatus);

      // look up remote name from URL
      getRemoteByUrl(playlist.source_remote_url).then((remote) => {
        setSyncSourceRemoteName(remote?.name || null);
      });
    } else {
      // not a synced playlist - clear sync status
      setSyncStatus(null);
      setSyncSourceRemoteName(null);
    }
  });

  // fetch playlists using infinite query
  const playlistsQuery = usePlaylistsQuery({
    search: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
  });

  // reset virtual list when query param changes
  createEffect(() => {
    const q = searchParams.q;
    const queryParam = Array.isArray(q) ? q[0] : q;
    // briefly show resetting state to force list to remount
    setIsResetting(true);
    setTimeout(() => setIsResetting(false), 0);
  });

  // flatten pages into single array
  const playlists = createMemo(() => {
    const pages = playlistsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  const totalCount = createMemo(() => {
    const pages = playlistsQuery.data?.pages;
    if (!pages || pages.length === 0) return 0;
    return pages[0].total;
  });

  // fetch songs for selected playlist
  const playlistSongsQuery = usePlaylistSongsQuery({
    playlistId: () => selectedPlaylistId(),
  });

  // flatten playlist songs
  const playlistSongs = createMemo(() => {
    const pages = playlistSongsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  // get selected playlist metadata
  // for local playlists, fetch full record from db to get sync fields
  const [fullPlaylist, setFullPlaylist] = createSignal<Playlist | null>(null);

  // fetch full playlist when viewing local and selection changes
  createEffect(() => {
    const id = selectedPlaylistId();
    const viewingRemote = isViewingRemote();

    // always revoke old object URL when switching playlists (use untrack to avoid dependency)
    untrack(() => {
      const oldUrl = localThumbnailUrl();
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
        setLocalThumbnailUrl(null);
      }
    });

    // if viewing remote or no selection, clear local state
    if (!id || viewingRemote) {
      setFullPlaylist(null);
      return;
    }

    // fetch full playlist record from db to get sync fields
    getPlaylistById(id).then((playlist) => {
      setFullPlaylist(playlist || null);

      // load local thumbnail if present
      if (playlist?.thumbnail_blob_id) {
        const thumbnailPath = playlist.thumbnail_blob_id;
        // check if it's an OPFS path (starts with "thumbnails/")
        if (thumbnailPath.startsWith("thumbnails/")) {
          readThumbnailFromOPFS(thumbnailPath)
            .then((file) => {
              const url = URL.createObjectURL(file);
              setLocalThumbnailUrl(url);
            })
            .catch((error) => {
              console.error("failed to load local thumbnail:", error);
              setLocalThumbnailUrl(null);
            });
        } else {
          // it's a blob ID, not an OPFS path - clear local thumbnail
          setLocalThumbnailUrl(null);
        }
      } else {
        setLocalThumbnailUrl(null);
      }
    });
  });

  const selectedPlaylist = createMemo(() => {
    const id = selectedPlaylistId();
    if (!id) return null;

    const summary = playlists().find((p) => p.playlist_id === id);
    if (!summary) return null;

    // return the summary from cache (gets optimistically updated for instant UI feedback)
    // this works for both local and remote since the cache is the source of truth
    return summary as unknown as Playlist;
  });

  // convert playlists to list items for VirtualItemList
  const playlistListItems = createMemo((): ListItem[] => {
    return playlists().map((playlist) => {
      // thumbnail_url is pre-resolved in the query
      const thumbnailUrl = playlist.thumbnail_url;

      return {
        id: playlist.playlist_id,
        title: playlist.title,
        subtitle: `${playlist.song_count} ${playlist.song_count === 1 ? "song" : "songs"}`,
        metadata: `updated ${formatRelativeTime(playlist.updated_at)}`,
        thumbnailUrl,
      };
    });
  });

  // read URL parameter on mount (for standalone page support)
  createEffect(() => {
    const id = params.id;
    if (id && !selectedPlaylistId()) {
      setSelectedPlaylistId(id);
    }
  });

  // auto-select first playlist when data loads (like ArtistsView/GenresView)
  createEffect(() => {
    const items = playlists();
    if (items.length > 0 && !selectedPlaylistId()) {
      setSelectedPlaylistId(items[0].playlist_id);
    }
  });

  // handle playlist selection (simple click, like ArtistsView/GenresView)
  const handlePlaylistClick = (item: ListItem) => {
    setIsLocalClick(true);
    navigate(buildRoute(`/playlists/${item.id}`));
  };

  // handle song double-click (play song)
  const handleSongDoubleClick = async (song: Song) => {
    await setQueue(playlistSongs());
    await playSong(song);
  };

  // handle add song to queue
  const handleAddSongToQueue = async (song: Song) => {
    const state = appState();
    const currentQueue = state?.queue || [];
    await setQueue([...currentQueue, song]);
  };

  // fetch more playlists when scrolling near end
  const handlePlaylistsLoadMore = () => {
    if (playlistsQuery.hasNextPage && !playlistsQuery.isFetchingNextPage) {
      playlistsQuery.fetchNextPage();
    }
  };

  // fetch more songs when scrolling near end
  const handleSongsLoadMore = () => {
    if (
      playlistSongsQuery.hasNextPage &&
      !playlistSongsQuery.isFetchingNextPage
    ) {
      playlistSongsQuery.fetchNextPage();
    }
  };

  // construct thumbnail URL for selected playlist
  const thumbnailUrl = createMemo(() => {
    const playlist = selectedPlaylist();
    if (!playlist) return null;

    // use pre-resolved thumbnail_url from query if available
    if (playlist.thumbnail_url) {
      return playlist.thumbnail_url;
    }

    // fallback: use local thumbnail URL if available for THIS playlist
    const localUrl = localThumbnailUrl();
    const localPlaylist = fullPlaylist();
    if (localUrl && localPlaylist?.playlist_id === playlist.playlist_id) {
      return localUrl;
    }

    return null;
  });

  // calculate total duration
  const totalDuration = createMemo(() => {
    const songs = playlistSongs();
    return songs.reduce((sum, song) => sum + (song.duration_seconds || 0), 0);
  });

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours} hr ${minutes} min`;
    }
    return `${minutes} min`;
  };

  // open image carousel with all playlist and song images
  const handleOpenImageCarousel = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    const songs = playlistSongs();
    const images: string[] = [];

    // add playlist thumbnail
    if (playlist.thumbnail_blob_id) {
      const url = await getImageUrl(playlist.thumbnail_blob_id);
      if (url) images.push(url);
    }

    // collect all unique images from songs (album cover, album images)
    const imageSet = new Set<string>();
    for (const song of songs) {
      // album cover (thumbnail_blob_id is the denormalized primary image)
      if (song.thumbnail_blob_id) {
        const url = await getImageUrl(song.thumbnail_blob_id);
        if (url) imageSet.add(url);
      }
      // album images
      if (song.album_images) {
        for (const img of song.album_images) {
          const url = await getImageUrl(img.blob_id);
          if (url) imageSet.add(url);
        }
      }
    }

    images.push(...Array.from(imageSet));

    if (images.length === 0) {
      toast.info("no images available for this playlist");
      return;
    }

    setCarouselImages(images);
    setCarouselInitialIndex(0);
    setShowImageCarousel(true);
  };

  // play all songs in selected playlist
  const handlePlayAll = async () => {
    const songs = playlistSongs();
    if (songs.length > 0) {
      await setQueue(songs);
      await playSong(songs[0]);
    }
  };

  // add all songs to queue
  const handleAddToQueue = async () => {
    const songs = playlistSongs();
    if (songs.length > 0) {
      const state = appState();
      const currentQueue = state?.queue || [];
      await setQueue([...currentQueue, ...songs]);
    }
  };

  // toggle edit mode
  const handleEditToggle = () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    // prevent editing synced playlists
    if (playlist.is_editable === false) {
      return;
    }

    if (!editMode()) {
      // entering edit mode - populate fields
      setEditTitle(playlist.title);
      setEditDescription(playlist.description || "");
      setEditMode(true);
    } else {
      // exiting edit mode without saving
      setEditMode(false);
    }
  };

  // save playlist changes
  const handleSavePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await updatePlaylistMutation.mutateAsync({
        playlistId: playlist.playlist_id,
        title: editTitle() || null,
        description: editDescription() || null,
      });

      setEditMode(false);

      // refresh local playlist data
      const remote = getCurrentRemote();
      if (!remote) {
        await getPlaylistById(playlist.playlist_id).then((p) => {
          setFullPlaylist(p || null);
        });
      }
    } catch (error) {
      console.error("failed to update playlist:", error);
    }
  };

  // cancel edit mode
  const handleCancelEdit = () => {
    setEditMode(false);
  };

  // handle image upload
  const handleImageUpload = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    const remote = getCurrentRemote();
    const isLocal = !remote;

    // create file input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        console.error("file too large (max 10MB)");
        return;
      }

      setUploadingImage(true);
      setUploadProgress(0);

      try {
        if (isLocal) {
          // for local playlists, store blob and update playlist
          const blobId = await storeBlob(file, file.type);

          // update playlist with new thumbnail
          const dataSource = getDataSource();
          await dataSource.updatePlaylist?.(playlist.playlist_id, {
            thumbnail_blob_id: blobId,
            images: [{ blob_id: blobId, is_primary: 1 }],
          });

          // invalidate and refetch queries
          await queryClient.invalidateQueries({
            queryKey: ["playlists"],
          });

          toast.success("playlist image updated");
        } else {
          // for remote playlists, upload to server
          const datasource = await getDataSource();
          
          const blobId = await datasource.uploadImage?.({
            file,
            entityType: "playlist",
            entityId: playlist.playlist_id,
            isPrimary: true,
          });

          if (!blobId) {
            console.error("upload failed");
            return;
          }

          console.log("image uploaded successfully:", blobId);

          // invalidate queries to refresh the UI
          await queryClient.invalidateQueries({
            queryKey: ["playlists"],
            refetchType: "all",
          });
        }
      } catch (error) {
        console.error("failed to upload image:", error);
      } finally {
        setUploadingImage(false);
        setUploadProgress(0);
      }
    };

    input.click();
  };

  // handle drag start
  const handleDragStart = (songId: string) => (e: DragEvent) => {
    setDraggedSongId(songId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
  };

  // handle drag over
  const handleDragOver = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    setDropTargetIndex(index);
  };

  // handle drag leave
  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  // handle drop
  const handleDrop = async (targetIndex: number) => {
    const draggedId = draggedSongId();
    if (!draggedId) return;

    const playlist = selectedPlaylist();
    if (!playlist) return;

    const songs = playlistSongs();
    const draggedIndex = songs.findIndex((s) => s.id === draggedId);
    if (draggedIndex === -1) return;

    // don't do anything if dropped on same position
    if (draggedIndex === targetIndex) {
      setDraggedSongId(null);
      setDropTargetIndex(null);
      return;
    }

    // calculate new position (1-based)
    const newPosition = targetIndex + 1;

    try {
      await reorderSongsMutation.mutateAsync({
        playlistId: playlist.playlist_id,
        songIds: [draggedId],
        newPosition,
      });

      console.log(
        `moved song from position ${draggedIndex + 1} to ${newPosition}`,
      );
    } catch (error) {
      console.error("failed to reorder songs:", error);
    } finally {
      setDraggedSongId(null);
      setDropTargetIndex(null);
    }
  };

  // handle image removal
  const handleRemoveImage = async () => {
    const playlist = selectedPlaylist();
    if (!playlist || !playlist.thumbnail_blob_id) return;

    const remote = getCurrentRemote();
    const isLocal = !remote;

    try {
      if (isLocal) {
        // for local playlists, just clear the thumbnail_blob_id
        const dataSource = getDataSource();
        await dataSource.updatePlaylist?.(playlist.playlist_id, {
          thumbnail_blob_id: null,
        });

        // invalidate queries first
        await queryClient.invalidateQueries({ queryKey: ["playlists"] });

        // revoke and clear local thumbnail URL
        const oldUrl = localThumbnailUrl();
        if (oldUrl) {
          URL.revokeObjectURL(oldUrl);
        }
        setLocalThumbnailUrl(null);

        // refresh local playlist data
        await getPlaylistById(playlist.playlist_id).then((p) => {
          setFullPlaylist(p || null);
        });
      } else {
        // for remote playlists, call datasource to remove thumbnail
        const datasource = await getDataSource();
        
        await datasource.removeImage?.({
          entityType: "playlist",
          entityId: playlist.playlist_id,
          blobId: "", // not needed for playlist removal
        });

        console.log("image removed successfully");

        // invalidate queries to refresh the UI
        queryClient.invalidateQueries({ queryKey: ["playlists"] });
      }
    } catch (error) {
      console.error("failed to remove image:", error);
    }
  };

  // handle download playlist (save remote playlist locally)
  const handleDownloadPlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    const remote = getCurrentRemote();
    if (!remote) {
      console.error(
        "no remote source - download only works with remote playlists",
      );
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(null);

    try {
      await downloadPlaylist(
        remote.base_url,
        playlist.playlist_id,
        (progress) => {
          setDownloadProgress(progress);
        },
      );

      console.log("playlist downloaded successfully");
      // refresh sync status
      const newSyncStatus = await checkIfPlaylistNeedsSync(
        remote.base_url,
        playlist.playlist_id,
      );
      setSyncStatus(newSyncStatus);
      setDownloadProgress(null);

      toast.success(`downloaded "${playlist.title}"`, {
        title: "playlist downloaded",
      });
    } catch (error) {
      console.error("failed to download playlist:", error);
      setDownloadProgress({
        stage: "error",
        totalSongs: 0,
        downloadedSongs: 0,
        error: error instanceof Error ? error.message : "download failed",
      });

      toast.error(error instanceof Error ? error.message : "download failed", {
        title: "download failed",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // handle sync playlist (update local copy from remote)
  const handleSyncPlaylist = async () => {
    // get full playlist object first
    const playlist = selectedPlaylist();
    if (!playlist) return;

    const status = syncStatus();
    if (!status || !status.localPlaylistId) return;

    const remote = getCurrentRemote();
    if (!remote) return;

    setIsSyncing(true);
    setDownloadProgress(null);

    try {
      await syncPlaylist(remote.base_url, playlist, (progress) => {
        setDownloadProgress(progress);
      });

      console.log("playlist synced successfully");
      // refresh sync status
      const newSyncStatus = await checkIfPlaylistNeedsSync(
        remote.base_url,
        playlist.playlist_id,
      );
      setSyncStatus(newSyncStatus);
      setDownloadProgress(null);

      toast.success(`synced "${playlist.title}"`, {
        title: "playlist synced",
      });
    } catch (error) {
      console.error("failed to sync playlist:", error);
      setDownloadProgress({
        stage: "error",
        totalSongs: 0,
        downloadedSongs: 0,
        error: error instanceof Error ? error.message : "sync failed",
      });

      toast.error(error instanceof Error ? error.message : "sync failed", {
        title: "sync failed",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // handle make local copy (convert synced playlist to editable local copy)
  const handleMakeLocalCopy = async () => {
    const playlist = selectedPlaylist();
    if (!playlist || !playlist.source_remote_id) return;

    try {
      const db = await initMusicDB();
      await convertToLocalPlaylist(db, playlist.playlist_id);

      console.log("converted to local playlist");
      // refresh playlist data
      setFullPlaylist(null);
      await getPlaylistById(playlist.playlist_id).then((p) => {
        setFullPlaylist(p || null);
      });

      toast.success(`"${playlist.title}" is now editable`, {
        title: "converted to local playlist",
      });
    } catch (error) {
      console.error("failed to convert to local playlist:", error);

      toast.error(
        error instanceof Error ? error.message : "conversion failed",
        { title: "conversion failed" },
      );
    }
  };

  // handle create playlist
  const handleCreatePlaylist = async () => {
    const dataSource = getDataSource();

    try {
      const result = await dataSource.createPlaylist?.({
        title: "new playlist",
        description: null,
        is_public: false,
      });

      if (result) {
        // invalidate queries
        await queryClient.invalidateQueries({ queryKey: ["playlists"] });

        // select the new playlist
        setSelectedPlaylistId(result.playlist_id);
        const prefix = getRoutePrefix();
        navigate(`${prefix}/playlists/${result.playlist_id}`, {
          replace: true,
        });

        // enter edit mode
        setEditMode(true);
        setEditTitle("new playlist");
        setEditDescription("");

        toast.success("created new playlist", {
          title: "playlist created",
        });
      }
    } catch (error) {
      console.error("failed to create playlist:", error);
      toast.error(
        error instanceof Error ? error.message : "failed to create playlist",
        { title: "creation failed" },
      );
    }
  };

  // handle delete playlist
  const handleDeletePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    const remote = getCurrentRemote();
    setIsDeleting(true);

    try {
      if (remote) {
        // delete remote playlist
        await deletePlaylistMutation.mutateAsync(playlist.playlist_id);
      } else {
        // delete local playlist (severs sync if synced)
        const dataSource = getDataSource();
        await dataSource.deletePlaylist?.(playlist.playlist_id);

        // invalidate queries
        await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      }

      // clear selection and navigate back to list
      setSelectedPlaylistId(null);
      const prefix = getRoutePrefix();
      navigate(`${prefix}/playlists`, { replace: true });

      toast.success(`deleted "${playlist.title}"`, {
        title: "playlist deleted",
      });
    } catch (error) {
      console.error("failed to delete playlist:", error);
      toast.error(
        error instanceof Error ? error.message : "failed to delete playlist",
        { title: "delete failed" },
      );
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      {/* header */}
      <div class="flex items-center justify-between p-4 ml-[150px]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            playlists
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {playlistsQuery.isLoading
              ? "loading..."
              : `${playlists().length} ${playlists().length === 1 ? "playlist" : "playlists"}`}
          </p>
        </div>
        <Button variant="primary" onClick={handleCreatePlaylist}>
          + create playlist
        </Button>
      </div>

      {/* two-column layout */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={!playlistsQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="text-[var(--color-text-secondary)]">
                loading playlists...
              </div>
            </div>
          }
        >
          <Show
            when={playlistListItems().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                    no playlists in your library yet
                  </p>
                  <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                    playlists let you organize your music into custom
                    collections
                  </p>
                </div>
              </div>
            }
          >
            {isResetting() ? (
              <div class="flex items-center justify-center h-full">
                <div class="text-[var(--color-text-secondary)]">loading...</div>
              </div>
            ) : (
              <TwoColumnLayout
                leftColumn={
                  <VirtualItemList
                    items={playlistListItems()}
                    selectedId={selectedPlaylistId()}
                    onItemClick={handlePlaylistClick}
                    onVirtualizerReady={(scrollFn) => {
                      setScrollToIndex(() => scrollFn);
                      
                      // only scroll if current playlist matches the initial one (prevents scroll on subsequent clicks)
                      const current = selectedPlaylistId();
                      if (current && current === initialPlaylistId) {
                        const index = playlists().findIndex(p => p.playlist_id === current);
                        if (index >= 0) {
                          setTimeout(() => scrollFn(index), 50);
                        }
                      }
                    }}
                    onEndReached={handlePlaylistsLoadMore}
                    getContextMenuActions={(item) => {
                      const playlist = playlists().find(
                        (p) => p.playlist_id === item.id,
                      );
                      if (!playlist) return [];

                      return usePlaylistContextMenu(
                        {
                          id: playlist.playlist_id,
                          title: playlist.title,
                          song_count: playlist.song_count,
                        },
                        {
                          showPlayActions: true,
                          isFavorite: false, // playlist-level favorites not yet implemented on frontend
                        },
                      );
                    }}
                  />
                }
                rightColumn={
                  <Show
                    when={selectedPlaylistId()}
                    fallback={
                      <div class="flex items-center justify-center h-full">
                        <p class="text-[var(--color-text-secondary)]">
                          select a playlist to view songs
                        </p>
                      </div>
                    }
                  >
                    <div
                      class="flex flex-col h-full relative"
                      style={{
                        ...(thumbnailUrl() && {
                          "background-image": `url('${thumbnailUrl()}')`,
                          "background-size": "cover",
                          "background-position": "center top",
                          "background-repeat": "no-repeat",
                        }),
                      }}
                    >
                      {/* background overlay */}
                      <Show when={thumbnailUrl()}>
                        <div class="absolute inset-0 bg-black/70 z-0" />
                      </Show>

                      {/* playlist header */}
                      <div class="flex-shrink-0 p-6 relative z-10">
                        <div class="flex-1">
                          <Show
                            when={editMode()}
                            fallback={
                              <>
                                <div class="flex items-center gap-2 mb-2">
                                  <Show
                                    when={
                                      selectedPlaylist()?.is_editable !== false
                                    }
                                  >
                                    <button
                                      class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                                      onClick={handleEditToggle}
                                      aria-label="edit playlist"
                                    >
                                      <svg
                                        class="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          stroke-width="2"
                                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                        />
                                      </svg>
                                    </button>
                                  </Show>
                                  <h2 class="text-2xl font-bold text-[var(--color-text-primary)]">
                                    {selectedPlaylist()?.title ||
                                      "untitled playlist"}
                                  </h2>
                                </div>
                                <Show when={selectedPlaylist()?.description}>
                                  <p class="text-sm text-[var(--color-text-secondary)] mb-3">
                                    {selectedPlaylist()!.description}
                                  </p>
                                </Show>
                              </>
                            }
                          >
                            <div class="space-y-2 mb-3">
                              <input
                                type="text"
                                class="w-full px-2 py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] text-xl font-bold focus:outline-none focus:border-[var(--color-accent-500)]"
                                value={editTitle()}
                                onInput={(e) =>
                                  setEditTitle(e.currentTarget.value)
                                }
                                placeholder="playlist title"
                              />
                              <textarea
                                class="w-full px-2 py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-secondary)] text-sm focus:outline-none focus:border-[var(--color-accent-500)] resize-none"
                                rows="2"
                                value={editDescription()}
                                onInput={(e) =>
                                  setEditDescription(e.currentTarget.value)
                                }
                                placeholder="description (optional)"
                              />
                              <div class="flex gap-2">
                                <Button
                                  variant="primary"
                                  onClick={handleSavePlaylist}
                                >
                                  save
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={handleCancelEdit}
                                >
                                  cancel
                                </Button>
                                <div class="flex-1" />
                                <Button
                                  variant="danger"
                                  onClick={() => setShowDeleteConfirm(true)}
                                >
                                  delete
                                </Button>
                              </div>
                            </div>
                          </Show>

                          <Show when={!playlistSongsQuery.isLoading}>
                            <div class="flex items-center gap-3 text-sm text-[var(--color-text-secondary)] mb-4">
                              <span>
                                {playlistSongs().length}{" "}
                                {playlistSongs().length === 1
                                  ? "song"
                                  : "songs"}
                              </span>
                              <Show when={totalDuration() > 0}>
                                <span>•</span>
                                <span>{formatDuration(totalDuration())}</span>
                              </Show>
                              <Show when={selectedPlaylist()?.created_at}>
                                <span>•</span>
                                <span>
                                  created{" "}
                                  {formatRelativeTime(
                                    selectedPlaylist()!.created_at,
                                  )}
                                </span>
                              </Show>
                              <Show
                                when={syncStatus() && !syncStatus()?.needsSync}
                              >
                                <span>•</span>
                                <Show
                                  when={!isViewingRemote()}
                                  fallback={<span>synced</span>}
                                >
                                  <span>
                                    synced from{" "}
                                    {syncSourceRemoteName() ||
                                      selectedPlaylist()?.source_remote_url}
                                  </span>
                                </Show>
                              </Show>
                            </div>
                          </Show>

                          {/* action buttons */}
                          <Show
                            when={playlistSongs().length > 0 && !editMode()}
                          >
                            <div class="flex gap-2">
                              <Button variant="primary" onClick={handlePlayAll}>
                                play all
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={handleAddToQueue}
                              >
                                + add to queue
                              </Button>
                              <IconButton
                                icon="library"
                                size="default"
                                onClick={handleOpenImageCarousel}
                                aria-label="view all images"
                              />
                              <FavoriteToggle
                                targetType="playlist"
                                targetId={selectedPlaylist()?.playlist_id || ""}
                                isFavorite={
                                  selectedPlaylist()?.is_favorite ?? false
                                }
                              />
                              <Show when={isViewingRemote()}>
                                <Show
                                  when={syncStatus()}
                                  fallback={
                                    <Button
                                      variant="secondary"
                                      onClick={handleDownloadPlaylist}
                                      disabled={isDownloading()}
                                    >
                                      {isDownloading()
                                        ? "downloading..."
                                        : "download playlist"}
                                    </Button>
                                  }
                                >
                                  <Show when={syncStatus()?.needsSync}>
                                    <Button
                                      variant="secondary"
                                      onClick={handleSyncPlaylist}
                                      disabled={isSyncing()}
                                    >
                                      {isSyncing()
                                        ? "syncing..."
                                        : "sync playlist"}
                                    </Button>
                                  </Show>
                                </Show>
                              </Show>
                              <Show
                                when={
                                  !isViewingRemote() &&
                                  selectedPlaylist()?.source_remote_id
                                }
                              >
                                <Button
                                  variant="secondary"
                                  onClick={handleMakeLocalCopy}
                                >
                                  make local copy
                                </Button>
                                <IconButton
                                  icon="delete"
                                  variant="ghost"
                                  onClick={() => setShowDeleteConfirm(true)}
                                  title="delete playlist"
                                  aria-label="delete playlist"
                                />
                              </Show>
                            </div>
                          </Show>

                          {/* download/sync progress indicator */}
                          <Show when={downloadProgress()}>
                            <div class="mt-4 p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
                              <Show
                                when={downloadProgress()?.stage === "error"}
                                fallback={
                                  <>
                                    <div class="flex items-center justify-between mb-2">
                                      <span class="text-sm text-[var(--color-text-secondary)]">
                                        {downloadProgress()?.stage ===
                                        "fetching"
                                          ? "fetching playlist metadata..."
                                          : `${downloadProgress()?.downloadedSongs || 0} / ${downloadProgress()?.totalSongs || 0} songs`}
                                      </span>
                                    </div>
                                    <Show
                                      when={
                                        downloadProgress()?.stage ===
                                          "downloading" &&
                                        downloadProgress()?.totalSongs
                                      }
                                    >
                                      <div class="w-full bg-[var(--color-bg-tertiary)] rounded-full h-2 mb-2">
                                        <div
                                          class="bg-[var(--color-accent-500)] h-2 rounded-full transition-all duration-300"
                                          style={{
                                            width: `${((downloadProgress()?.downloadedSongs || 0) / (downloadProgress()?.totalSongs || 1)) * 100}%`,
                                          }}
                                        />
                                      </div>
                                    </Show>
                                    <Show
                                      when={downloadProgress()?.currentSong}
                                    >
                                      <p class="text-xs text-[var(--color-text-tertiary)] truncate">
                                        {downloadProgress()?.currentSong}
                                      </p>
                                    </Show>
                                  </>
                                }
                              >
                                <p class="text-sm text-[var(--color-error)]">
                                  error: {downloadProgress()?.error}
                                </p>
                              </Show>
                            </div>
                          </Show>

                          {/* image upload controls (edit mode only) */}
                          <Show when={editMode()}>
                            <div class="mt-4 flex gap-2">
                              <Show
                                when={!uploadingImage()}
                                fallback={
                                  <div class="text-[var(--color-text-secondary)] text-sm">
                                    uploading... {uploadProgress()}%
                                  </div>
                                }
                              >
                                <button
                                  class="px-3 py-1 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-sm rounded"
                                  onClick={handleImageUpload}
                                >
                                  {thumbnailUrl()
                                    ? "change background"
                                    : "upload background"}
                                </button>
                                <Show when={thumbnailUrl()}>
                                  <button
                                    class="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-sm rounded"
                                    onClick={handleRemoveImage}
                                  >
                                    remove background
                                  </button>
                                </Show>
                              </Show>
                            </div>
                          </Show>
                        </div>
                      </div>

                      {/* songs list */}
                      <div class="flex-1 overflow-hidden relative z-10">
                        <Show
                          when={!playlistSongsQuery.isLoading}
                          fallback={
                            <div class="flex items-center justify-center h-full">
                              <div class="text-[var(--color-text-secondary)]">
                                loading songs...
                              </div>
                            </div>
                          }
                        >
                          <Show
                            when={playlistSongs().length > 0}
                            fallback={
                              <div class="flex items-center justify-center h-full">
                                <p class="text-[var(--color-text-secondary)]">
                                  this playlist is empty
                                </p>
                              </div>
                            }
                          >
                            <div class="overflow-auto h-full p-4">
                              <div class="space-y-1">
                                <For each={playlistSongs()}>
                                  {(song, index) => {
                                    console.log("[PlaylistsView] song data:", {
                                      id: song.id,
                                      title: song.title,
                                      is_favorite: song.is_favorite,
                                      sha256: song.sha256,
                                    });
                                    const contextMenuActions =
                                      useSongContextMenu(song, {
                                        showPlayActions: true,
                                        showRemoveFromPlaylist: true,
                                        playlistId: selectedPlaylistId()!,
                                        isFavorite: song.is_favorite ?? false,
                                      });

                                    return (
                                      <ContextMenu actions={contextMenuActions}>
                                        <DraggableRow
                                          id={song.id}
                                          index={index()}
                                          isDragging={
                                            draggedSongId() === song.id
                                          }
                                          isDropTarget={
                                            dropTargetIndex() === index()
                                          }
                                          onDragStart={handleDragStart(song.id)}
                                          onDragOver={handleDragOver(index())}
                                          onDragLeave={handleDragLeave}
                                          onDrop={() => handleDrop(index())}
                                          onDoubleClick={() =>
                                            handleSongDoubleClick(song)
                                          }
                                          onPlayClick={() =>
                                            handleSongDoubleClick(song)
                                          }
                                          thumbnailUrl={
                                            song.thumbnail_url || undefined
                                          }
                                          disabled={
                                            !isEditablePlaylist(
                                              selectedPlaylist()!,
                                            )
                                          }
                                        >
                                          <DraggableRowSongContent
                                            title={song.title}
                                            artist={song.artist_name}
                                            album={song.album_title}
                                            durationSeconds={
                                              song.duration_seconds
                                            }
                                            isFavorite={song.is_favorite}
                                            songId={song.id}
                                            sha256={song.sha256}
                                            actions={
                                              <IconButton
                                                icon="queue"
                                                size="sm"
                                                variant="ghost"
                                                onClick={(e: MouseEvent) => {
                                                  e.stopPropagation();
                                                  handleAddSongToQueue(song);
                                                }}
                                                aria-label="add to queue"
                                              />
                                            }
                                          />
                                        </DraggableRow>
                                      </ContextMenu>
                                    );
                                  }}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </Show>
                }
              />
            )}
          </Show>
        </Show>
      </div>

      {/* image carousel modal */}
      <Show when={showImageCarousel()}>
        <ImageCarouselModal
          images={carouselImages()}
          initialIndex={carouselInitialIndex()}
          onClose={() => setShowImageCarousel(false)}
        />
      </Show>

      {/* delete confirmation dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm()}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeletePlaylist}
        title="delete playlist"
        message={`are you sure you want to delete "${selectedPlaylist()?.title}"? this action cannot be undone.`}
        confirmText="delete"
        cancelText="cancel"
        variant="danger"
        loading={isDeleting()}
        alertVariant="warning"
      />
    </div>
  );
}
