// playlists view - displays playlists in two-column layout with detail panel
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { playQueue, addToQueue } from "../services/queue/queue";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { setBackgroundImage, clearBackgroundImage } from "../../app/services/backgroundImage";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Button } from "../../components/buttons/Button";
import { IconButton } from "../../components/buttons/IconButton";
import { ImageCarouselModal } from "../../components/modals/ImageCarouselModal";
import { toast } from "../../components/feedback/Toast";
import { LoadingState } from "../../components/feedback";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import { MarqueeText } from "../../components/text/MarqueeText";
import { DraggableRow, DraggableRowSongContent } from "../../components/lists/DraggableRow";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { FavoriteToggle } from "../../utils/FavoriteToggle";
import { VirtualItemList, type ListItem } from "../../components/virtualized/VirtualItemList";
import { formatRelativeTime } from "../../utils/dateTime";
import { formatHumanDuration } from "../../utils/formatDuration";
import { buildRoute } from "../utils/routing";
import { getCurrentRemote, getDataSource, RemoteOfflineError } from "../data";
import type { Song } from "../data/types";
import {
  usePlaylistSongsQuery,
  usePlaylistsQuery,
  useReorderPlaylistSongsMutation,
} from "../queries/playlists";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { usePlaylistContextMenu, useSongContextMenu } from "../hooks/contextMenu";
import { getBlobObjectURL } from "../services/storage/blobs";
import { resolveBlobUrl } from "../services/storage/blobResolver";
import { SendToRemoteFlyout } from "../../components/share/SendToRemoteFlyout";
import { createCurrentRemoteFull } from "../../app/services/remotes/currentRemoteFull";
import type { SendPayload } from "../services/send/sendToRemote";
import type { RemoteSong } from "../data/remote/adapters";
import { canUpdatePlaylist } from "../data/permissions";
import { getPlaylistById } from "../services/storage/db";
import { type Playlist } from "../services/storage/types";
import { getRoutePrefix } from "../utils/routing";
import { PlaylistEditor } from "./playlists/PlaylistEditor";
import { debug, error as errorLog } from "../../utils/logger";
import { isCharnelMode } from "../../app/services/charnel";
import { isNarrowViewport } from "../../config/breakpoints";

export interface PlaylistsViewProps {
  onAddMusic: () => void;
}

export function PlaylistsView(_props: PlaylistsViewProps) {
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const [isResetting, setIsResetting] = createSignal(false);
  const navigate = useNavigate();

  // restore selected playlist from history state on mount, fallback to params.id
  const initialPlaylistId =
    typeof window !== "undefined"
      ? (window.history.state?.selectedPlaylistId as string | null) || params.id || null
      : params.id || null;

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  // reactive viewport height for safari toolbar handling
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const listHeight = () => {
    const vh = viewportHeight();
    const pb = playerBarHeight();
    const navH = getNavHeight();
    const result = vh - navH - pb;
    debug("PlaylistsView", `listHeight=${result}px (viewport=${vh}, nav=${navH}, playerBar=${pb})`);
    return result;
  };

  // track whether detail is showing on narrow (for back navigation)
  // initialize to true if we have an initial ID and are on a narrow screen
  const [showingDetailOnNarrow, setShowingDetailOnNarrow] = createSignal(
    isNarrowViewport() && !!initialPlaylistId
  );

  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<string | null>(
    initialPlaylistId
  );
  const [editMode, setEditMode] = createSignal(false);
  const [showImageCarousel, setShowImageCarousel] = createSignal(false);
  const [carouselImages, setCarouselImages] = createSignal<string[]>([]);
  const [carouselInitialIndex, setCarouselInitialIndex] = createSignal(0);
  const [draggedSongId, setDraggedSongId] = createSignal<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);

  // pointer-based drag state for Tauri (HTML5 drag doesn't work in WKWebView)
  const [pointerDragSongId, setPointerDragSongId] = createSignal<string | null>(null);
  let pendingPointerDrag: {
    songId: string;
    startY: number;
    pointerId: number;
    target: HTMLElement;
  } | null = null;
  const DRAG_THRESHOLD = 8;
  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<string | null>(null);

  onMount(() => {
    const handleResize = () => {
      const narrow = isNarrowViewport();
      setIsNarrow(narrow);
      // reset detail view state when going from narrow to wide
      if (!narrow) {
        setShowingDetailOnNarrow(false);
      }
    };
    window.addEventListener("resize", handleResize);

    // global dragend cleanup for webkit/tauri compatibility
    const handleGlobalDragEnd = () => {
      setDraggedSongId(null);
      setDropTargetIndex(null);
    };
    document.addEventListener("dragend", handleGlobalDragEnd);

    // pointer-based drag for Tauri (HTML5 drag API doesn't work in WKWebView)
    const handlePointerMove = (e: PointerEvent) => {
      if (!isCharnelMode()) return;

      // check if pending drag should activate
      if (pendingPointerDrag !== null) {
        const deltaY = Math.abs(e.clientY - pendingPointerDrag.startY);
        if (deltaY >= DRAG_THRESHOLD) {
          setPointerDragSongId(pendingPointerDrag.songId);
          pendingPointerDrag.target.setPointerCapture(pendingPointerDrag.pointerId);
          pendingPointerDrag = null;
        }
        return;
      }

      const dragId = pointerDragSongId();
      if (!dragId) return;

      // find target index based on Y position (56px per row)
      const songs = playlistSongs();
      const container = document.querySelector("[data-playlist-songs]");
      const rect = container?.getBoundingClientRect();
      if (!rect) return;

      const relativeY = e.clientY - rect.top;
      const targetIndex = Math.floor(relativeY / 56);
      const clampedTarget = Math.max(0, Math.min(targetIndex, songs.length - 1));
      const currentIndex = songs.findIndex((s) => s.id === dragId);

      if (clampedTarget !== currentIndex) {
        setDropTargetIndex(clampedTarget);
      } else {
        setDropTargetIndex(null);
      }
    };

    const handlePointerUp = async () => {
      if (!isCharnelMode()) return;
      pendingPointerDrag = null;

      const dragId = pointerDragSongId();
      const toIndex = dropTargetIndex();

      if (dragId && toIndex !== null) {
        const songs = playlistSongs();
        const fromIndex = songs.findIndex((s) => s.id === dragId);
        if (fromIndex !== -1 && fromIndex !== toIndex) {
          const playlist = selectedPlaylist();
          if (playlist) {
            const newPosition = toIndex + 1;
            try {
              await reorderSongsMutation.mutateAsync({
                playlistId: playlist.playlist_id,
                songIds: [dragId],
                newPosition,
              });
            } catch {
              // error handled by mutation
            }
          }
        }
      }

      setPointerDragSongId(null);
      setDropTargetIndex(null);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("dragend", handleGlobalDragEnd);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      clearPageInfo(); // clear page info when leaving view
      clearBackgroundImage(); // clear global background when leaving view
    });
  });
  const [scrollToIndex, setScrollToIndex] = createSignal<((index: number) => void) | null>(null);
  const [isLocalClick, setIsLocalClick] = createSignal(false);

  // save selected playlist to history state when it changes
  createEffect(() => {
    const playlistId = selectedPlaylistId();
    if (playlistId && typeof window !== "undefined") {
      const currentState = window.history.state || {};
      window.history.replaceState({ ...currentState, selectedPlaylistId: playlistId }, "");
    }
  });

  // sync URL params with selected playlist
  createEffect(() => {
    const urlPlaylistId = params.id;

    if (urlPlaylistId && urlPlaylistId !== selectedPlaylistId()) {
      setSelectedPlaylistId(urlPlaylistId);

      // show detail view if on narrow and have a playlist selected
      if (isNarrow() && urlPlaylistId) {
        setShowingDetailOnNarrow(true);
      }

      // only scroll if this is from navigation (back/forward/initial), not from clicking in the list
      const shouldScroll = !isLocalClick();
      if (shouldScroll && scrollToIndex()) {
        const playlistIndex = playlists().findIndex((p) => p.playlist_id === urlPlaylistId);
        if (playlistIndex >= 0) {
          scrollToIndex()!(playlistIndex);
        }
      }

      // reset flag after capturing its value
      setIsLocalClick(false);
    }
  });

  // mutations for updating playlist
  const reorderSongsMutation = useReorderPlaylistSongsMutation();
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // query client for invalidation
  const queryClient = useQueryClient();

  // NOTE: don't revoke blob URLs on unmount - the blob URL cache systems
  // (BLOB_URL_CACHE and blobResolver's activeBlobUrls) manage URL lifecycles.
  // manually revoking causes "WebKitBlobResource error 1" when cached URLs
  // are reused when the component remounts.

  // check if viewing remote playlists
  const isViewingRemote = createMemo(() => getCurrentRemote() !== null);

  // fetch playlists using infinite query
  const playlistsQuery = usePlaylistsQuery({
    search: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
  });

  // reset virtual list when query param changes
  createEffect(() => {
    // track query param changes to reset list
    searchParams.q; // read to create dependency
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

  // update page info for TopNav (mobile displays "playlists (N)")
  createEffect(() => {
    const count = playlists().length;
    setPageInfo({ title: "playlists", count });
  });

  // fetch songs for selected playlist
  const playlistSongsQuery = usePlaylistSongsQuery({
    playlistId: () => selectedPlaylistId() ?? undefined,
  });

  // flatten playlist songs
  const playlistSongs = createMemo(() => {
    const pages = playlistSongsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  // current remote (full Remote record) — used as the source for "send to remote".
  const currentRemoteFull = createCurrentRemoteFull();

  // build a SendPayload describing the selected playlist for the flyout.
  const buildPlaylistSendPayload = (): SendPayload => {
    const pl = selectedPlaylist();
    const list = playlistSongs();
    return {
      kind: "playlist",
      playlistId: pl?.playlist_id ?? "",
      title: pl?.title ?? "untitled playlist",
      description: pl?.description ?? null,
      songs: list as unknown as RemoteSong[],
    };
  };

  // get selected playlist metadata
  // for local playlists, fetch full record from db
  const [_fullPlaylist, setFullPlaylist] = createSignal<Playlist | null>(null);

  // fetch full playlist when viewing local and selection changes
  // #TODO: yank this duplicate effect.
  createEffect(() => {
    const id = selectedPlaylistId();
    const viewingRemote = isViewingRemote();

    // if viewing remote or no selection, clear local state
    if (!id || viewingRemote) {
      setFullPlaylist(null);
      return;
    }

    // fetch full playlist record from db
    getPlaylistById(id).then((playlist) => {
      setFullPlaylist(playlist || null);

      // thumbnail_url is pre-resolved in query enrichment
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
      return {
        id: playlist.playlist_id,
        title: playlist.title,
        subtitle: `${playlist.song_count} ${playlist.song_count === 1 ? "song" : "songs"}`,
        metadata: `updated ${formatRelativeTime(playlist.updated_at)}`,
        images: playlist.images,
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

  // clear edit mode when navigating to a different playlist
  createEffect(() => {
    selectedPlaylistId();
    setEditMode(false);
  });

  // handle playlist selection (simple click, like ArtistsView/GenresView)
  const handlePlaylistClick = (item: ListItem) => {
    setIsLocalClick(true);
    // on narrow, show detail view
    if (isNarrow()) {
      setShowingDetailOnNarrow(true);
    }
    navigate(buildRoute(`/playlists/${item.id}`));
  };

  // handle back navigation on narrow
  const handleBack = () => {
    setShowingDetailOnNarrow(false);
  };

  // handle song double-click (play song)
  const handleSongDoubleClick = async (song: Song) => {
    const songs = playlistSongs();
    const startIndex = songs.findIndex((s) => s.sha256 === song.sha256);
    const playlist = selectedPlaylist();
    await playQueue(songs, {
      startIndex: Math.max(0, startIndex),
      source: {
        type: "playlist",
        label: playlist?.title ?? "playlist",
        entity_id: playlist?.playlist_id,
        image: playlist?.images?.[0],
      },
    });
  };

  // handle add song to queue
  const handleAddSongToQueue = async (song: Song) => {
    await addToQueue([song], { source: { type: "song", label: song.title } });
  };

  // fetch more playlists when scrolling near end
  const handlePlaylistsLoadMore = () => {
    if (playlistsQuery.hasNextPage && !playlistsQuery.isFetchingNextPage) {
      playlistsQuery.fetchNextPage();
    }
  };

  // get the primary image metadata for selected playlist
  const primaryImageMeta = createMemo(() => {
    const playlist = selectedPlaylist();
    if (!playlist?.images?.length) return null;
    return playlist.images.find((img) => img.is_primary) || playlist.images[0];
  });

  // construct thumbnail URL for selected playlist
  const thumbnailUrl = createMemo(() => {
    const imageMeta = primaryImageMeta();
    if (imageMeta) {
      return imageMeta.remote_url || imageMeta.local_blob_id || null;
    }
    return null;
  });

  // resolve blob URLs for background image (convert blob IDs to actual URLs)
  createEffect(() => {
    const imageMeta = primaryImageMeta();
    const url = thumbnailUrl();
    const remote = getCurrentRemote();

    // NOTE: don't manually revoke blob URLs - the blob URL cache systems
    // (BLOB_URL_CACHE and blobResolver's activeBlobUrls) manage URL lifecycles.
    // manually revoking causes "WebKitBlobResource error 1" when cached URLs
    // are reused elsewhere in the app.

    if (!url) {
      setBackgroundImageUrl(null);
      return;
    }

    // check if this is a tauri-managed or P2P remote (needs blob resolution)
    const isTransportBased =
      remote &&
      (remote.transport_type === "wasm" ||
        remote.transport_type === "app" ||
        remote.is_charnel_managed);

    // for transport-based remotes, always use resolveBlobUrl with blob ID
    if (isTransportBased && imageMeta?.remote_blob_id) {
      resolveBlobUrl(imageMeta.remote_blob_id, remote.remote_id, "image")
        .then((objectUrl) => {
          setBackgroundImageUrl(objectUrl);
        })
        .catch(() => {
          setBackgroundImageUrl(null);
        });
      return;
    }

    // if it's already a URL (http/https/blob/freqhole), use it directly
    if (url.startsWith("http") || url.startsWith("blob:") || url.startsWith("freqhole://")) {
      setBackgroundImageUrl(url);
      return;
    }

    // otherwise it's a blob ID, need to resolve it to a blob URL
    // no remote = local mode, resolve from local storage
    if (!remote) {
      // check for local_blob_id first (synced playlist images)
      const localBlobId = imageMeta?.local_blob_id;
      if (localBlobId) {
        getBlobObjectURL(localBlobId).then((objectUrl) => {
          setBackgroundImageUrl(objectUrl || null);
        });
      } else {
        setBackgroundImageUrl(null);
      }
      return;
    }

    // use resolveBlobUrl for P2P/Tauri remotes, getBlobObjectURL for HTTP
    if (isTransportBased) {
      resolveBlobUrl(url, remote.remote_id, "image")
        .then((objectUrl) => {
          setBackgroundImageUrl(objectUrl);
        })
        .catch(() => {
          setBackgroundImageUrl(null);
        });
    } else {
      getBlobObjectURL(url).then((objectUrl) => {
        if (objectUrl) {
          setBackgroundImageUrl(objectUrl);
        } else {
          setBackgroundImageUrl(null);
        }
      });
    }
  });

  // sync local background URL to global background service
  createEffect(() => {
    const bgUrl = backgroundImageUrl();
    if (bgUrl) {
      setBackgroundImage({ imageUrl: bgUrl, overlayOpacity: 0.6 });
    } else {
      clearBackgroundImage();
    }
  });

  // calculate total duration
  const totalDuration = createMemo(() => {
    const songs = playlistSongs();
    return songs.reduce((sum, song) => sum + (song.duration_seconds || 0), 0);
  });

  // open image carousel with all playlist and song images
  const handleOpenImageCarousel = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    const remote = getCurrentRemote();
    const songs = playlistSongs();

    // check if this remote needs blob resolution (P2P or tauri-managed)
    const isTransportBased =
      remote &&
      (remote.transport_type === "wasm" ||
        remote.transport_type === "app" ||
        remote.is_charnel_managed);

    // collect all images: Map<blobId, ImageMetadata>
    const imageMap = new Map<string, { blobId: string; url?: string }>();

    // add all playlist images (except waveforms), deduplicate by blob_id
    if (playlist.images?.length) {
      for (const img of playlist.images) {
        if (img.blob_type !== "waveform") {
          const blobId = img.remote_blob_id || img.local_blob_id;
          const url = img.remote_url;
          if (blobId) imageMap.set(blobId, { blobId, url });
        }
      }
    }

    // collect all song images (except waveforms), deduplicate by blob_id
    for (const song of songs) {
      if (song.images?.length) {
        for (const img of song.images) {
          if (img.blob_type !== "waveform") {
            const blobId = img.remote_blob_id || img.local_blob_id;
            const url = img.remote_url;
            if (blobId) imageMap.set(blobId, { blobId, url });
          }
        }
      }
    }

    if (imageMap.size === 0) {
      toast.info("no images available for this playlist");
      return;
    }

    // resolve images to URLs
    let resolvedUrls: string[];

    if (isTransportBased && remote) {
      // transport-based remote: resolve blob IDs through transport
      const resolvePromises = Array.from(imageMap.values()).map(async ({ blobId }) => {
        try {
          return await resolveBlobUrl(blobId, remote.remote_id, "image");
        } catch {
          return null;
        }
      });
      const results = await Promise.all(resolvePromises);
      resolvedUrls = results.filter((url): url is string => url !== null);
    } else {
      // HTTP remote or local: use URLs directly, or resolve local blob IDs
      const resolvePromises = Array.from(imageMap.values()).map(async ({ blobId, url }) => {
        // prefer URL if available (http remote)
        if (url) return url;
        // otherwise resolve from OPFS
        const resolved = await getBlobObjectURL(blobId);
        return resolved ?? null;
      });
      const results = await Promise.all(resolvePromises);
      resolvedUrls = results.filter((url): url is string => url !== null);
    }

    if (resolvedUrls.length === 0) {
      toast.info("no images available for this playlist");
      return;
    }

    setCarouselImages(resolvedUrls);
    setCarouselInitialIndex(0);
    setShowImageCarousel(true);
  };

  // play all songs in selected playlist
  const handlePlayAll = async () => {
    const songs = playlistSongs();
    if (songs.length > 0) {
      const playlist = selectedPlaylist();
      await playQueue(songs, {
        source: {
          type: "playlist",
          label: playlist?.title ?? "playlist",
          entity_id: playlist?.playlist_id,
          image: playlist?.images?.[0],
        },
      });
    }
  };

  // add all songs to queue
  const handleAddToQueue = async () => {
    const songs = playlistSongs();
    if (songs.length > 0) {
      const playlist = selectedPlaylist();
      await addToQueue(songs, {
        source: {
          type: "playlist",
          label: playlist?.title ?? "playlist",
          entity_id: playlist?.playlist_id,
          image: playlist?.images?.[0],
        },
      });
    }
  };

  // toggle edit mode
  const handleEditToggle = () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    setEditMode(!editMode());
  };

  // combined dragged song id (works for both HTML5 drag and pointer drag)
  const effectiveDraggedSongId = () => (isCharnelMode() ? pointerDragSongId() : draggedSongId());

  // handle drag start
  const handleDragStart = (songId: string) => (e: DragEvent) => {
    setDraggedSongId(songId);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", songId);
      // Safari has issues with drag images on transformed elements
      const target = e.currentTarget as HTMLElement;
      const clone = target.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.top = "-9999px";
      clone.style.left = "-9999px";
      clone.style.transform = "none";
      clone.style.width = `${target.offsetWidth}px`;
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(
        clone,
        e.clientX - target.getBoundingClientRect().left,
        e.clientY - target.getBoundingClientRect().top
      );
      requestAnimationFrame(() => clone.remove());
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

  // handle drag end
  const handleDragEnd = () => {
    setDraggedSongId(null);
    setDropTargetIndex(null);
  };

  // handle pointer down for Tauri drag
  const handlePointerDown = (songId: string) => (e: PointerEvent) => {
    if (isCharnelMode() && e.button === 0) {
      pendingPointerDrag = {
        songId,
        startY: e.clientY,
        pointerId: e.pointerId,
        target: e.currentTarget as HTMLElement,
      };
    }
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
    } catch (error) {
      errorLog("failed to reorder songs:", error);
    } finally {
      setDraggedSongId(null);
      setDropTargetIndex(null);
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
      }
    } catch (error) {
      errorLog("failed to create playlist:", error);
      toast.error(error instanceof Error ? error.message : "failed to create playlist", {
        title: "creation failed",
      });
    }
  };

  // callbacks for PlaylistEditor
  const handlePlaylistSaved = async () => {
    setEditMode(false);

    // refresh local playlist data
    const remote = getCurrentRemote();
    if (!remote) {
      const playlist = selectedPlaylist();
      if (playlist) {
        await getPlaylistById(playlist.playlist_id).then((p) => {
          setFullPlaylist(p || null);
        });
      }
    }
  };

  const handlePlaylistDeleted = () => {
    // clear selection and navigate back to list
    setSelectedPlaylistId(null);
    const prefix = getRoutePrefix();
    navigate(`${prefix}/playlists`, { replace: true });
  };

  const handlePlaylistEditCancelled = () => {
    setEditMode(false);
  };

  // debug: log actual rendered heights
  let containerRef: HTMLDivElement | undefined;
  onMount(() => {
    setTimeout(() => {
      if (containerRef) {
        const rect = containerRef.getBoundingClientRect();
        const parentRect = containerRef.parentElement?.getBoundingClientRect();
        debug("PlaylistsView", "rendered heights:", {
          containerHeight: rect.height,
          containerTop: rect.top,
          containerBottom: rect.bottom,
          parentHeight: parentRect?.height,
          parentTop: parentRect?.top,
          viewportHeight: viewportHeight(),
          listHeightCalc: listHeight(),
          windowHeight: window.innerHeight,
        });
      }
    }, 500);
  });

  return (
    <div ref={containerRef} class="flex flex-col" style={{ height: `${listHeight()}px` }}>
      {/* two-column layout */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={!playlistsQuery.isLoading}
          fallback={
            <div class="flex items-center justify-center h-full">
              <LoadingState text="loading playlists..." />
            </div>
          }
        >
          <Show
            when={!playlistsQuery.isError}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <Show
                    when={playlistsQuery.error instanceof RemoteOfflineError}
                    fallback={
                      <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                        failed to load playlists
                      </p>
                    }
                  >
                    <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                      {(playlistsQuery.error as RemoteOfflineError).remoteName} is offline
                    </p>
                    <p class="text-sm text-[var(--color-text-muted)]">
                      switch to a different remote or use local library
                    </p>
                  </Show>
                </div>
              </div>
            }
          >
            <Show
              when={playlistListItems().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                  <div class="text-center max-w-md">
                    <p class="text-lg text-[var(--color-text-secondary)] mb-4">
                      no playlists found!
                    </p>
                    <Button variant="primary" onClick={handleCreatePlaylist}>
                      create playlist
                    </Button>
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
                    <>
                      <VirtualItemList
                        items={playlistListItems()}
                        selectedId={selectedPlaylistId()}
                        scrollPaddingTop={100}
                        scrollPaddingBottom={68}
                        height={listHeight()}
                        onItemClick={handlePlaylistClick}
                        onVirtualizerReady={(scrollFn) => {
                          setScrollToIndex(() => scrollFn);

                          // only scroll if current playlist matches the initial one (prevents scroll on subsequent clicks)
                          const current = selectedPlaylistId();
                          if (current && current === initialPlaylistId) {
                            const index = playlists().findIndex((p) => p.playlist_id === current);
                            if (index >= 0) {
                              setTimeout(() => scrollFn(index), 50);
                            }
                          }
                        }}
                        onEndReached={handlePlaylistsLoadMore}
                        getContextMenuActions={(item) => {
                          const playlist = playlists().find((p) => p.playlist_id === item.id);
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
                            }
                          );
                        }}
                      />
                      <div class="sticky bottom-0 p-4">
                        <Button variant="primary" fullWidth={true} onClick={handleCreatePlaylist}>
                          create playlist
                        </Button>
                      </div>
                    </>
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
                        class={`flex flex-col h-full relative ${isNarrow() ? "overflow-auto" : ""}`}
                      >
                        {/* sticky header with back button for mobile */}
                        <Show when={isNarrow() && showingDetailOnNarrow()}>
                          <HeadingSection
                            title={selectedPlaylist()?.title || "playlist"}
                            titleElement={
                              <MarqueeText
                                text={selectedPlaylist()?.title || "playlist"}
                                hoverOnly={true}
                              />
                            }
                            variant="detail"
                            sticky
                            showBackButton={true}
                            onBack={handleBack}
                            class="px-4 py-3 relative z-20 !bg-transparent backdrop-blur-sm"
                          />
                        </Show>

                        {/* playlist header */}
                        <div class="flex-shrink-0 p-6 relative z-10">
                          <div class="flex-1">
                            <Show
                              when={editMode()}
                              fallback={
                                <>
                                  <Show when={!isNarrow()}>
                                    <div class="flex items-center gap-2 mb-2">
                                      <h2 class="text-2xl font-bold text-[var(--color-text-primary)]">
                                        {selectedPlaylist()?.title || "untitled playlist"}
                                      </h2>
                                    </div>
                                  </Show>

                                  <Show when={selectedPlaylist()?.description}>
                                    <p class="text-sm text-[var(--color-text-secondary)] mb-3">
                                      {selectedPlaylist()!.description}
                                    </p>
                                  </Show>
                                </>
                              }
                            >
                              <PlaylistEditor
                                playlist={selectedPlaylist()!}
                                onSaved={handlePlaylistSaved}
                                onDeleted={handlePlaylistDeleted}
                                onCancelled={handlePlaylistEditCancelled}
                              />
                            </Show>

                            <Show when={!playlistSongsQuery.isLoading}>
                              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-secondary)] mb-4">
                                <span>
                                  {playlistSongs().length}{" "}
                                  {playlistSongs().length === 1 ? "song" : "songs"}
                                </span>
                                <Show when={totalDuration() > 0}>
                                  <span>{formatHumanDuration(totalDuration())}</span>
                                </Show>
                                {/* line break on narrow screens */}
                                <div class="basis-full wide:hidden" />
                                <Show when={selectedPlaylist()?.created_at}>
                                  <span>
                                    created {formatRelativeTime(selectedPlaylist()!.created_at)}
                                  </span>
                                </Show>
                              </div>
                            </Show>

                            {/* action buttons - only render here on wide screens */}
                            <Show when={!editMode() && !isNarrow()}>
                              <div class="flex gap-2 sticky top-0 py-2 z-10">
                                <Show
                                  when={canUpdatePlaylist(
                                    selectedPlaylist()?.created_by_id ?? null
                                  )}
                                >
                                  <IconButton
                                    icon="edit"
                                    size="default"
                                    variant="ghost"
                                    onClick={handleEditToggle}
                                    aria-label="edit playlist"
                                  />
                                </Show>
                                <Show when={playlistSongs().length > 0}>
                                  <Button variant="primary" onClick={handlePlayAll}>
                                    play all
                                  </Button>
                                  <Button variant="secondary" onClick={handleAddToQueue}>
                                    add to queue
                                  </Button>
                                </Show>
                                <IconButton
                                  icon="carousel"
                                  size="default"
                                  onClick={handleOpenImageCarousel}
                                  aria-label="view all images"
                                />
                                <FavoriteToggle
                                  targetType="playlist"
                                  targetId={selectedPlaylist()?.playlist_id || ""}
                                  isFavorite={selectedPlaylist()?.is_favorite ?? false}
                                />
                                <SendToRemoteFlyout
                                  source={() => currentRemoteFull()}
                                  buildPayload={buildPlaylistSendPayload}
                                />
                              </div>
                            </Show>
                          </div>
                        </div>

                        {/* sticky action buttons for narrow - direct child of scroll container */}
                        <Show when={!editMode() && isNarrow()}>
                          <div class="flex gap-2 justify-between flex-wrap sticky top-12 backdrop-blur-sm px-6 py-2 z-20">
                            <Show
                              when={canUpdatePlaylist(selectedPlaylist()?.created_by_id ?? null)}
                            >
                              <IconButton
                                icon="edit"
                                size="default"
                                variant="ghost"
                                onClick={handleEditToggle}
                                aria-label="edit playlist"
                              />
                            </Show>
                            <Show when={playlistSongs().length > 0}>
                              <Button variant="primary" onClick={handlePlayAll}>
                                <Show when={!isNarrow()} fallback={"play"}>
                                  play all
                                </Show>
                              </Button>
                              <Button variant="secondary" onClick={handleAddToQueue}>
                                <Show when={!isNarrow()} fallback={"queue"}>
                                  add to queue
                                </Show>
                              </Button>
                            </Show>
                            <IconButton
                              icon="carousel"
                              size="default"
                              onClick={handleOpenImageCarousel}
                              aria-label="view all images"
                            />
                            <FavoriteToggle
                              targetType="playlist"
                              targetId={selectedPlaylist()?.playlist_id || ""}
                              isFavorite={selectedPlaylist()?.is_favorite ?? false}
                            />
                            <SendToRemoteFlyout
                              source={() => currentRemoteFull()}
                              buildPayload={buildPlaylistSendPayload}
                            />
                          </div>
                        </Show>

                        {/* songs list */}
                        <div class={`relative z-10 ${isNarrow() ? "" : "flex-1 overflow-hidden"}`}>
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
                              <div class={`${isNarrow() ? "" : "overflow-auto h-full"}`}>
                                <div class="space-y-1" data-playlist-songs>
                                  <For each={playlistSongs()}>
                                    {(song, index) => {
                                      const contextMenuActions = useSongContextMenu(song, {
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
                                            isDragging={effectiveDraggedSongId() === song.id}
                                            isDropTarget={dropTargetIndex() === index()}
                                            isPlaying={appState()?.current_sha256 === song.sha256}
                                            onDragStart={handleDragStart(song.id)}
                                            onDragOver={handleDragOver(index())}
                                            onDragLeave={handleDragLeave}
                                            onDrop={() => handleDrop(index())}
                                            onDragEnd={handleDragEnd}
                                            onPointerDown={handlePointerDown(song.id)}
                                            onDoubleClick={() => handleSongDoubleClick(song)}
                                            onPlayClick={() => handleSongDoubleClick(song)}
                                            images={[
                                              ...(song.images || []),
                                              ...(song.album_images || []),
                                            ]}
                                            disabled={isCharnelMode()}
                                          >
                                            <DraggableRowSongContent
                                              title={song.title}
                                              artist={song.artist_name}
                                              album={song.album_title}
                                              durationSeconds={song.duration_seconds}
                                              isFavorite={song.is_favorite}
                                              songId={song.id}
                                              sha256={song.sha256}
                                              onFavoriteToggle={(songId, isFavorite) => {
                                                toggleFavoriteMutation.mutate({
                                                  targetType: "song",
                                                  targetId: songId,
                                                  sha256: song.sha256,
                                                  isFavorite,
                                                });
                                              }}
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
                  showDetail={showingDetailOnNarrow()}
                  onBack={handleBack}
                />
              )}
            </Show>
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
    </div>
  );
}
