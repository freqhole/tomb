// main app layout with navigation, content area, and player bar
import { useLocation, useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PlaylistSelectorModal } from "../components/dialogs/PlaylistSelectorModal";
import { AddToStationModal } from "../components/radio/AddToStationModal";
import { ToastRegion } from "../components/feedback/Toast";
import { toast } from "../components/feedback/Toast";
import { AddRemoteModal } from "../components/modals/AddRemoteModal";
import { ConnectionProgressModal } from "../components/modals/ConnectionProgressModal";
import {
  getConnectionProgress,
  cancelAndNavigate,
  connectToRemote,
  recheckRemote,
} from "./services/remotes/connectionProgress";
import { TopNav } from "../components/navigation/TopNav";
import type { ViewOption } from "../components/navigation/ViewSelector";
import { PlayerBar } from "../components/player/PlayerBar";
import { QueueSidebar } from "../components/player/QueueSidebar";
import { getCurrentRemote, getCurrentUser, getDataSource, useLocalSource } from "../music/data";
import { useRouteDataSource } from "../music/hooks/useRouteDataSource";
import { useToggleFavoriteMutation } from "../music/queries/favorites";
import { useRecentPlaylistsQuery } from "../music/queries/playlists";
import {
  currentTime,
  duration,
  isLoading,
  isPlaying,
  pendingUpNextSha256,
  playNext,
  playPrevious,
  playSong,
  seek,
  setPlayerVolume,
  togglePlayback,
  volume,
} from "../music/services/audio/player";
import {
  clearExternalMediaSession,
  setExternalMediaSession,
} from "../music/services/audio/mediaSessionBridge";
import { getLoadingSongIds, isSongSyncedLocally } from "../music/services/download";
import {
  getLoadingP2PSongIds,
  preCacheRemoteTransport,
  resolveBlobUrl,
  usesBlobResolver,
} from "../music/services/storage/blobResolver";
import { getClientForRemote } from "./api/client";
import { adminLocalRawDispatch, adminRawDispatch } from "./api/adminClient";
import { deleteSongFromLocal } from "../music/services/sync";
import {
  getPendingDownloadCount,
  resumeAutoDownload,
  updateAutoDownloadQueue,
  resumeAutoDownloadsOnInit,
} from "../music/services/autoDownload";
import {
  canGoNext,
  canGoPrevious,
  clearQueue,
  clearSongsAbove,
  clearSongsBelow,
  removeFromQueue,
  reorderQueue,
} from "../music/services/queue/queue";
import { useSongContextMenu } from "../music/hooks/contextMenu";
import {
  getAllRemotes,
  getRemoteById,
  onRemoteStatusChange,
  onSwitchToLocal,
  deleteRemote,
} from "./services/remotes/remoteManager";
import type { ImageMetadata, Song } from "../music/services/storage/types";
import {
  type Remote,
  type QueueHistoryEntry,
  type RadioStationRef,
  STORE_QUEUE_HISTORY,
  isHttpRemote,
  isP2PRemote,
} from "./services/storage/types";
import type { MenuAction } from "../components/overlays/ContextMenu";
import { IconNames, type IconName } from "../components/icons/registry";
import { routes, matchRoute, getDefaultRoute, hasFeedView } from "../music/utils/routing";
import { confirmState, closeConfirm, resolveConfirm, confirm } from "./services/confirmState";
import { playlistSelectorState, closePlaylistSelector } from "../music/hooks/playlistSelectorState";
import { showImageCarousel, openAddMusic, showShareModal } from "../music/hooks/modals";
import { appState, setCurrentSong, setQueueOpen } from "./services/storage/db";
import { getPageInfo } from "./services/pageInfo";
import {
  queueHistory,
  loadQueueHistory,
  removeHistoryEntry,
  clearQueueHistory,
  addRadioStationHistoryEntry,
} from "../music/services/queue/queueHistory";
import { addToQueue, resumeHistoryEntry } from "../music/services/queue/queue";
import { loadProgressFromStorage, progressMap } from "../music/services/queue/queueProgress";
import { startAnalyticsSync, stopAnalyticsSync } from "../music/services/analytics/analyticsQueue";
import { reconnectProgressTracking } from "../music/services/queue/listenProgress";
import { isCharnelMode, setWindowTitle } from "./services/charnel";
import {
  getAuthInfo,
  refreshOne as refreshRemoteAuthStatus,
} from "./services/remotes/authStatusStore";
import { checkAndShowConfigUpgradeToast } from "./services/toastNotices";
import { debug } from "../utils/logger";
import { isNarrowViewport } from "../config/breakpoints";
import { getBackgroundConfig } from "./services/backgroundImage";
import { playbackMode } from "./services/playbackMode";
import { setHighlightedSongId } from "../music/state/highlightedSong";
import {
  leaveRadio,
  radioArtUrl,
  radioCurrentFavorite,
  radioCurrentPeerAddr,
  radioCurrentRemoteServerId,
  radioElapsedMs,
  radioListenerCount,
  radioNowPlaying,
  radioPause,
  radioResume,
  radioStatus,
  radioUseTimelineMode,
  setRadioAudioSink,
  setRadioFavorite,
  tuneIntoRadio,
} from "./services/radio/radioService";
import { acknowledgeTimelineUserStart } from "./services/radio/radioQueueAdapter";
import {
  currentRadioStation,
  loadCurrentRadioStation,
} from "./services/storage/currentRadioStation";

interface AppLayoutProps {
  children?: JSX.Element;
}

export function AppLayout(props: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [currentSongData, setCurrentSongData] = createSignal<Song | null>(null);
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // background image config (reactive)
  const bgConfig = () => getBackgroundConfig();
  // const [isQueueOpen, setIsQueueOpen] = createSignal(false);
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [storageUsage, setStorageUsage] = createSignal<number>(0);
  const [storageQuota, setStorageQuota] = createSignal<number>(0);

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  // reactive memo for loading song ids (combines HTTP + P2P + current song loading)
  const loadingSongIds = createMemo(() => {
    const loadingSet = new Set(getLoadingSongIds());
    for (const sha256 of getLoadingP2PSongIds()) {
      loadingSet.add(sha256);
    }
    // add current song if audio is loading (includes P2P fetch wait)
    const currentSha256 = appState()?.current_sha256;
    if (isLoading() && currentSha256) {
      loadingSet.add(currentSha256);
    }
    return loadingSet;
  });

  // connection progress state (shared module)
  const connectionProgress = getConnectionProgress();

  // automatically switch data source based on route context
  const routeContext = useRouteDataSource();

  // radio queue entry metadata: resolve station peer_addr to remote name/image.
  const currentRadioRemote = createMemo(() => {
    const station = currentRadioStation();
    if (!station) return null;
    return (
      remotes().find((r) => {
        if (isP2PRemote(r)) return r.peer_addr === station.peer_addr;
        if (isHttpRemote(r)) return r.base_url === station.peer_addr;
        return false;
      }) ?? null
    );
  });

  const currentRadioRemoteName = createMemo(() => {
    const station = currentRadioStation();
    if (!station) return undefined;
    return currentRadioRemote()?.name ?? (station.is_local ? "local" : undefined);
  });

  const currentRadioRemoteImage = createMemo<ImageMetadata | undefined>(() => {
    const remote = currentRadioRemote();
    if (!remote) return undefined;
    const raw = remote.image_url ?? undefined;
    const remoteUrl = raw
      ? raw.startsWith("asset://") || raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : isHttpRemote(remote) && remote.base_url
          ? `${remote.base_url}${raw}`
          : undefined
      : undefined;
    if (!remote.image_blob_id && !remoteUrl) return undefined;
    return {
      remote_blob_id: remote.image_blob_id ?? undefined,
      remote_server_id: remote.remote_id,
      remote_url: remoteUrl,
      blob_type: "thumbnail",
      is_primary: true,
    };
  });

  createEffect(() => {
    const remoteId = radioCurrentRemoteServerId();
    if (!remoteId) return;
    if (getAuthInfo(remoteId) !== undefined) return;
    void (async () => {
      const remote = await getRemoteById(remoteId);
      if (remote) {
        await refreshRemoteAuthStatus(remote);
      }
    })();
  });

  const canAdminSkipRadioTrack = createMemo(() => {
    const station = currentRadioStation();
    if (!station?.station_id) return false;
    if (station.is_local) return isCharnelMode();
    const remoteId = radioCurrentRemoteServerId();
    if (!remoteId) return false;
    const auth = getAuthInfo(remoteId);
    return auth?.loggedIn === true && auth.role === "admin";
  });

  const requestRadioTrackSkip = async (): Promise<void> => {
    const station = currentRadioStation();
    if (!station?.station_id) {
      throw new Error("current station cannot be skipped");
    }

    if (station.is_local) {
      await adminLocalRawDispatch("radio_supervisor_skip_track", {
        station_id: station.station_id,
      });
      return;
    }

    const remoteId = radioCurrentRemoteServerId();
    if (!remoteId) {
      throw new Error("could not resolve the current radio remote");
    }
    const remote = await getRemoteById(remoteId);
    if (!remote) {
      throw new Error("current radio remote is no longer configured locally");
    }
    await adminRawDispatch(remote, "radio_supervisor_skip_track", {
      station_id: station.station_id,
    });
  };

  // update window/document title (freqhole ▸ remote ▸ route)
  createEffect(() => {
    const remote = getCurrentRemote();
    const remoteName = remote?.name ?? "local";
    const pathname = location.pathname;
    const routeKey = matchRoute(pathname);
    const routeName = routeKey || "songs";

    const title = `freqhole ▸ ${remoteName} ▸ ${routeName}`;

    // set browser document title
    document.title = title;

    // also set tauri window title if in tauri mode
    if (isCharnelMode()) {
      setWindowTitle(title);
    }
  });

  // fetch recent playlists (contextual to current data source)
  const recentPlaylistsQuery = useRecentPlaylistsQuery(5);

  // resize handler for narrow viewport detection (hoisted so cleanup can reference it)
  const handleResize = () => {
    setIsNarrow(isNarrowViewport());
  };

  // register cleanups in synchronous component body so solid can track them
  onCleanup(() => {
    stopAnalyticsSync();
    window.removeEventListener("resize", handleResize);
  });

  // load remotes and storage info on mount
  onMount(async () => {
    window.addEventListener("resize", handleResize);

    // load queue history from idb
    await loadQueueHistory();

    // load persisted radio queue entry (display only; no autoplay)
    await loadCurrentRadioStation();

    // load queue progress from storage
    loadProgressFromStorage();

    // reconnect progress tracking if there's an active queue from a previous page load
    reconnectProgressTracking();

    // resume auto-downloads if enabled (downloads songs beyond rolling window)
    void resumeAutoDownloadsOnInit();

    // start analytics sync loop
    startAnalyticsSync();

    // check if config needs upgrade (tauri mode only, shows persistent toast if needed)
    checkAndShowConfigUpgradeToast();

    try {
      const allRemotes = await getAllRemotes();
      debug("AppLayout", "loaded remotes from IDB", {
        count: allRemotes.length,
        remotes: allRemotes.map((r) => ({
          id: r.remote_id,
          name: r.name,
          is_offline: r.is_offline,
          last_checked: r.last_checked,
        })),
      });
      setRemotes(allRemotes);
    } catch (error) {
      console.error("failed to load remotes:", error);
    }

    // listen for remote status changes (offline/online) and refresh remotes list
    const unsubscribeStatusChange = onRemoteStatusChange(async (_remoteId, _isOffline) => {
      try {
        const allRemotes = await getAllRemotes();
        setRemotes(allRemotes);
        debug("AppLayout", "refreshed remotes after status change", {
          count: allRemotes.length,
        });
      } catch (error) {
        console.error("failed to refresh remotes after status change:", error);
      }
    });

    // listen for "switch to local" action from toast
    const unsubscribeSwitchToLocal = onSwitchToLocal(() => {
      handleSwitchToLocal();
    });

    // update storage usage
    const updateStorage = async () => {
      if (navigator.storage?.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          setStorageUsage(estimate.usage || 0);
          setStorageQuota(estimate.quota || 0);
        } catch (error) {
          console.error("failed to get storage estimate:", error);
        }
      }
    };

    await updateStorage();
    // refresh storage info every 30 seconds
    const interval = setInterval(updateStorage, 30000);
    return () => {
      clearInterval(interval);
      unsubscribeStatusChange();
      unsubscribeSwitchToLocal();
    };
  });

  // handle switching to local source
  const handleSwitchToLocal = async () => {
    try {
      debug("AppLayout", "switching to local source...");
      // switch data source first
      await useLocalSource();
      // navigate to local route
      navigate(getDefaultRoute("local"));
      // invalidate all queries to refetch from local source
      queryClient.invalidateQueries();
      debug("AppLayout", "switched to local source");
    } catch (error) {
      console.error("failed to switch to local:", error);
    }
  };

  // handle switching to remote source (from TopNav)
  const handleSwitchToRemote = async (remoteId: string) => {
    try {
      debug("AppLayout", `switching to remote: ${remoteId}...`);

      // pre-cache transport type for blob resolution (avoids flicker on image load)
      await preCacheRemoteTransport(remoteId);

      // connect with progress modal support
      const result = await connectToRemote(remoteId);

      if (result.cancelled) {
        debug("AppLayout", "connection cancelled by user");
        return;
      }

      if (!result.success) {
        debug("AppLayout", `remote ${remoteId} is offline, not switching`);
        // refresh remotes list to show updated status
        const allRemotes = await getAllRemotes();
        setRemotes(allRemotes);
        return;
      }

      // navigate to remote route
      navigate(getDefaultRoute(remoteId));
      // invalidate all queries to refetch from remote source
      queryClient.invalidateQueries();

      // refresh remotes list to show updated status
      const allRemotes = await getAllRemotes();
      setRemotes(allRemotes);

      debug("AppLayout", `switched to remote: ${remoteId}`);
    } catch (error) {
      console.error("failed to switch to remote:", error);
    }
  };

  // handle rechecking a remote's status (with progress modal)
  const handleRecheckRemote = async (remoteId: string): Promise<boolean> => {
    try {
      debug("AppLayout", `rechecking remote: ${remoteId}...`);

      const isOnline = await recheckRemote(remoteId);

      // refresh remotes list to update UI
      const allRemotes = await getAllRemotes();
      setRemotes(allRemotes);

      debug("AppLayout", `remote ${remoteId} recheck result: ${isOnline ? "online" : "offline"}`);
      return isOnline;
    } catch (error) {
      console.error("failed to recheck remote:", error);
      return false;
    }
  };

  // handle deleting a remote (called from topnav context menu)
  // topnav already handles user confirmation; here we just perform cleanup
  const handleDeleteRemote = async (remoteId: string): Promise<void> => {
    try {
      debug("AppLayout", `deleting remote: ${remoteId}...`);

      // clear queue history entries for this remote
      try {
        const { initAppDB } = await import("./services/storage/db");
        const db = await initAppDB();
        const allEntries = await db.getAll(STORE_QUEUE_HISTORY);
        const toDelete = (allEntries as QueueHistoryEntry[]).filter(
          (e) => e.server_remote_id === remoteId
        );
        for (const entry of toDelete) {
          await db.delete(STORE_QUEUE_HISTORY, entry.id);
        }
      } catch (e) {
        debug("AppLayout", "failed to clear queue history:", e);
      }

      // clear cached blobs for this remote
      try {
        const { clearBlobCache } = await import("../music/services/cache/blobCache");
        await clearBlobCache(remoteId);
      } catch (e) {
        debug("AppLayout", "failed to clear blob cache:", e);
      }

      // delete the remote record
      await deleteRemote(remoteId);

      // refresh remotes list
      const allRemotes = await getAllRemotes();
      setRemotes(allRemotes);

      toast.success("remote deleted");
    } catch (error) {
      console.error("failed to delete remote:", error);
      toast.error("failed to delete remote");
    }
  };

  const currentSourceName = createMemo(() => {
    const remote = getCurrentRemote();
    return remote ? remote.name : "local library";
  });

  // handle navigate to playlists view
  const handleViewAllPlaylists = () => {
    navigate(routes.playlists());
  };

  // handle create playlist
  const handleCreatePlaylist = () => {
    navigate(routes.playlists() + "?create=true");
  };

  // handle playlist click
  const handlePlaylistClick = (playlistId: string) => {
    navigate(routes.playlist(playlistId));
  };

  // handle favorite toggle for current song (deprecated - replaced by inline handler)

  // watch for current song changes and load song data
  createEffect(() => {
    const state = appState();
    if (state?.current_sha256) {
      // first check if song is in queue (avoids fetching from wrong remote)
      const songInQueue = state.queue.find((s) => s.sha256 === state.current_sha256);
      if (songInQueue) {
        setCurrentSongData(songInQueue);
      } else if (state.queue.length > 0) {
        // if queue exists but song not in it, it's stale - clear it
        setCurrentSongData(null);
        void setCurrentSong(null);
      } else {
        // queue hasn't loaded yet, try fetching
        const dataSource = getDataSource();
        void dataSource.getSongById(state.current_sha256).then((song) => {
          if (song) {
            setCurrentSongData(song);
          } else {
            // song not found - clear stale current_sha256
            setCurrentSongData(null);
            void setCurrentSong(null);
          }
        });
      }
    } else {
      setCurrentSongData(null);
    }
  });

  // update auto-download queue when queue or current song changes
  createEffect(() => {
    const state = appState();
    if (!state) return;

    const currentIndex = state.current_sha256
      ? state.queue.findIndex((s) => s.sha256 === state.current_sha256)
      : 0;
    const queueLength = state.queue.length;

    // this effect will re-run when queue or current index changes
    // the function internally checks if auto-download is enabled
    if (queueLength > 0) {
      void updateAutoDownloadQueue(currentIndex);
    }
  });

  // sync navigator media session for radio mode so lock-screen/control
  // center reflects the live station track (non-seekable).
  createEffect(() => {
    const mode = playbackMode();
    if (mode !== "radio") return;

    const station = currentRadioStation();
    const np = radioNowPlaying();
    const status = radioStatus();
    const title = np?.title?.trim() || station?.station_name || "radio";
    const artist = np?.artist?.trim() || "radio";
    const album = np?.album?.trim() || station?.station_name || "live stream";
    const artworkUrl = radioArtUrl();
    const isPlayingNow = status === "playing";

    console.info(
      "[AppLayout] mediaSession effect triggered",
      "song_id:",
      np?.song_id,
      "title:",
      title,
      "status:",
      status
    );

    // never arm media-session handlers while radio is idle. this avoids
    // accidental lock-screen/system-triggered play callbacks from
    // auto-retuning a saved station on page load.
    if (status === "idle") {
      clearExternalMediaSession();
      return;
    }

    setExternalMediaSession({
      title,
      artist,
      album,
      artworkUrl,
      isPlaying: isPlayingNow,
      isLive: true,
      onPlay: () => {
        if (radioStatus() === "paused") {
          radioResume();
        }
      },
      onPause: () => {
        if (radioStatus() === "playing" || radioStatus() === "connecting") {
          radioPause();
        }
      },
      onNextTrack: canAdminSkipRadioTrack()
        ? () => {
            void requestRadioTrackSkip().catch((e) => {
              toast.error(e instanceof Error ? e.message : String(e));
            });
          }
        : undefined,
      onPreviousTrack: undefined,
    });
  });

  // clear externally-owned media session when leaving radio mode.
  createEffect(() => {
    if (playbackMode() === "radio") return;
    clearExternalMediaSession();
  });

  const queueOpen = () => appState()?.queue_open ?? false;

  const handleSeek = (percentage: number) => {
    const dur = duration();
    const timeInSeconds = (percentage / 100) * dur;
    seek(timeInSeconds);
  };

  // handle song favorite toggle from player bar
  const handleSongFavoriteToggle = (songId: string) => {
    const song = currentSongData();
    if (!song) return;
    toggleFavoriteMutation.mutate({
      targetType: "song",
      targetId: songId,
      sha256: song.sha256,
      isFavorite: !(song.is_favorite || false),
    });
  };

  // handle player bar image click - show song + album images in carousel
  const handlePlayerImageClick = async () => {
    const song = currentSongData();
    if (!song) return;

    type ImageItem = { blobId?: string; url?: string; serverId?: string };
    const seen = new Set<string>();
    const imageItems: ImageItem[] = [];

    const addImage = (img: {
      remote_blob_id?: string;
      local_blob_id?: string;
      remote_url?: string;
      remote_server_id?: string;
      blob_type: string;
    }) => {
      if (img.blob_type === "waveform") return;
      const key = img.remote_blob_id || img.local_blob_id || img.remote_url;
      if (!key || seen.has(key)) return;
      seen.add(key);
      imageItems.push({
        blobId: img.remote_blob_id || img.local_blob_id,
        url: img.remote_url || img.local_blob_id,
        serverId: img.remote_server_id,
      });
    };

    // add song images (except waveforms), deduplicate by blob_id
    if (song.images?.length) {
      for (const img of song.images) addImage(img);
    }

    // add album images (except waveforms), deduplicate by blob_id
    if (song.album_images?.length) {
      for (const img of song.album_images) addImage(img);
    }

    if (imageItems.length === 0) {
      return;
    }

    // check if we need blob resolution (P2P or tauri-managed)
    const firstWithServerId = imageItems.find((item) => item.serverId);
    const needsResolution = firstWithServerId
      ? await usesBlobResolver(firstWithServerId.serverId!)
      : false;

    let imageUrls: string[];
    if (needsResolution) {
      // resolve all images via blobResolver
      imageUrls = (
        await Promise.all(
          imageItems.map(async (item) => {
            if (item.blobId && item.serverId) {
              try {
                return await resolveBlobUrl(item.blobId, item.serverId, "image");
              } catch {
                return item.url ?? null;
              }
            }
            return item.url ?? null;
          })
        )
      ).filter((u): u is string => u !== null);
    } else {
      // standard HTTP - use URLs directly
      imageUrls = imageItems.map((item) => item.url).filter((u): u is string => !!u);
    }

    if (imageUrls.length === 0) {
      return;
    }

    showImageCarousel({
      images: imageUrls,
      title: `${song.title} images`,
    });
  };

  const handleQueueToggle = async () => {
    await setQueueOpen(!queueOpen());
  };

  const resolveShareSourceRemote = (station: RadioStationRef): Remote | null => {
    if (station.is_local) {
      return remotes().find((r) => r.is_charnel_managed) ?? null;
    }
    return (
      remotes().find((r) => {
        if (isP2PRemote(r)) return r.peer_addr === station.peer_addr;
        if (isHttpRemote(r)) return r.base_url === station.peer_addr;
        return false;
      }) ?? null
    );
  };

  const openRadioShareModal = (station: RadioStationRef) => {
    if (!station.station_id) {
      toast.error("this station cannot be shared yet");
      return;
    }

    const source = resolveShareSourceRemote(station);
    if (!source) {
      toast.error("could not resolve source for sharing");
      return;
    }

    showShareModal({
      target: {
        kind: "radio_station",
        id: station.station_id,
        displayTitle: station.station_name,
      },
      source: () => source,
    });
  };

  const getRadioQueueContextMenuActions = (station: RadioStationRef): MenuAction[] => [
    {
      label: "resume",
      icon: IconNames.play,
      onClick: () => {
        void tuneIntoRadio(station.peer_addr, {
          stationId: station.station_id,
          stationName: station.station_name,
          isLocal: station.is_local,
        });
      },
    },
    {
      label: "save to history",
      icon: IconNames.recent,
      onClick: () => {
        void addRadioStationHistoryEntry({
          peer_addr: station.peer_addr,
          station_id: station.station_id,
          station_name: station.station_name,
          is_local: station.is_local,
          art_thumb_b64: station.art_thumb_b64,
          art_thumb_mime: station.art_thumb_mime,
        });
      },
    },
    { type: "separator" },
    {
      label: "share...",
      icon: IconNames.share,
      disabled: !station.station_id,
      onClick: () => openRadioShareModal(station),
    },
  ];

  // build context menu actions for a history entry
  const getHistoryContextMenuActions = (entry: QueueHistoryEntry): MenuAction[] => {
    const actions: MenuAction[] = [];
    const hasProgress = (entry.listened_seconds || 0) > 0;

    // resume action (when entry has progress)
    if (hasProgress) {
      actions.push({
        label: "resume",
        icon: IconNames.play,
        onClick: () => {
          void resumeHistoryEntry(entry);
        },
      });
    }

    // replay actions
    actions.push({
      label: "play again",
      icon: hasProgress ? IconNames.recent : IconNames.play,
      onClick: () => {
        void addToQueue(entry.songs, {
          startPlaying: true,
          source: {
            type: entry.type,
            label: entry.label,
            entity_id: entry.entity_id,
            image: entry.image,
          },
        });
      },
    });

    actions.push({
      label: "add to queue",
      icon: IconNames.queue,
      onClick: () => {
        void addToQueue(entry.songs, {
          source: {
            type: entry.type,
            label: entry.label,
            entity_id: entry.entity_id,
            image: entry.image,
          },
        });
      },
    });

    // navigation actions based on type
    const firstSong = entry.songs[0];
    const navActions: MenuAction[] = [];

    // for song/album types, show both "view album" and "view artist"
    if (entry.type === "song" || entry.type === "album") {
      const albumId = entry.type === "album" ? entry.entity_id : firstSong?.album_id;
      const artistId = firstSong?.artist_id;
      if (albumId) {
        navActions.push({
          label: "view album",
          icon: IconNames.album,
          onClick: () => navigate(routes.album(albumId)),
        });
      }
      if (artistId) {
        navActions.push({
          label: "view artist",
          icon: IconNames.artist,
          onClick: () => navigate(routes.artist(artistId)),
        });
      }
    } else if (entry.entity_id) {
      const typeNavMap: Record<
        string,
        { label: string; route: (id: string) => string; icon: IconName }
      > = {
        artist: { label: "view artist", route: routes.artist, icon: IconNames.artist },
        playlist: { label: "view playlist", route: routes.playlist, icon: IconNames.playlist },
        genre: { label: "view genre", route: routes.genre, icon: IconNames.genre },
      };
      const nav = typeNavMap[entry.type];
      if (nav) {
        navActions.push({
          label: nav.label,
          icon: nav.icon,
          onClick: () => navigate(nav.route(entry.entity_id!)),
        });
      }
    }

    if (navActions.length > 0) {
      actions.push({ type: "separator" });
      actions.push(...navActions);
    }

    // remove from history
    actions.push({ type: "separator" });
    actions.push({
      label: "remove from history",
      icon: IconNames.delete,
      destructive: true,
      onClick: () => {
        void removeHistoryEntry(entry.id);
      },
    });

    return actions;
  };

  // build view options for the TopNav view selector
  const viewOptions = (): ViewOption[] => {
    const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
    const options: ViewOption[] = [
      { label: "songs", path: `${prefix}/songs` },
      { label: "albums", path: `${prefix}/albums` },
      { label: "artists", path: `${prefix}/artists` },
      { label: "genres", path: `${prefix}/genres` },
      { label: "playlists", path: `${prefix}/playlists` },
      { label: "favorites", path: `${prefix}/favorites` },
    ];
    // feed is only available for remote sources
    if (!routeContext.isLocal()) {
      options.unshift({ label: "feed", path: `${prefix}/feed` });
    }
    return options;
  };

  return (
    <div
      class={`flex flex-col ${bgConfig() ? "bg-transparent" : "bg-[var(--color-bg-primary)]"}`}
      style={{
        height: "100dvh",
        "--player-bar-height":
          (appState()?.queue.length || 0) > 0 || radioStatus() !== "idle" || !!currentRadioStation()
            ? "var(--player-height)"
            : "0px",
      }}
    >
      {/* full-page background image (when set by a view) */}
      <Show when={bgConfig()}>
        {(config) => (
          <>
            {/* background image */}
            <div
              class="fixed inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-500"
              style={{
                "background-image": `url(${config().imageUrl})`,
                "z-index": -2,
              }}
            />
            {/* dark overlay for readability */}
            <div
              class="fixed inset-0 bg-black transition-opacity duration-500"
              style={{
                opacity: config().overlayOpacity ?? 0.7,
                "z-index": -1,
              }}
            />
          </>
        )}
      </Show>

      {/* top navigation */}
      <TopNav
        brandName="freqhole"
        brandTagline="get yr freq on."
        currentUsername={getCurrentUser()?.username ?? null}
        currentUserRole={getCurrentUser()?.role ?? null}
        searchPlaceholder="search artists, albums, songs..."
        onSearchChange={(query) => debug("AppLayout", "search:", query)}
        onSearchSubmit={(query) => debug("AppLayout", "search submit:", query)}
        onNavigate={(path) => navigate(path)}
        currentPath={location.pathname + location.search}
        currentSourceName={currentSourceName()}
        currentSourceId={getCurrentRemote()?.remote_id ?? null}
        remotes={remotes().map((r) => {
          // charnel-managed remotes are always local (embedded grimoire)
          const isCharnelManaged = r.is_charnel_managed === true;
          const url = isHttpRemote(r) && r.base_url ? r.base_url.toLowerCase() : "";
          const isLocal =
            isCharnelManaged ||
            url.includes("localhost") ||
            url.includes("127.0.0.1") ||
            url.includes("[::1]");
          return {
            id: r.remote_id,
            name: r.name,
            url: isHttpRemote(r) ? (r.base_url ?? "local") : r.peer_addr,
            imageUrl: r.image_url ?? undefined,
            imageBlobId: r.image_blob_id ?? undefined,
            peerAddr: isP2PRemote(r) ? r.peer_addr : undefined,
            isOffline: r.is_offline,
            lastChecked: r.last_checked,
            isCharnelManaged: r.is_charnel_managed,
            isLocal,
            updatedAt: r.updated_at,
          };
        })}
        onSwitchToLocal={handleSwitchToLocal}
        onSwitchToRemote={handleSwitchToRemote}
        onRecheckRemote={handleRecheckRemote}
        onAddRemote={() => setIsAddRemoteOpen(true)}
        onDeleteRemote={handleDeleteRemote}
        storageUsage={storageUsage()}
        storageQuota={storageQuota()}
        recentPlaylists={
          recentPlaylistsQuery.data?.map((playlist) => ({
            id: playlist.playlist_id,
            name: playlist.title,
            images: playlist.images,
            updatedAt: playlist.updated_at,
            onClick: () => handlePlaylistClick(playlist.playlist_id),
          })) || []
        }
        onViewAllPlaylists={handleViewAllPlaylists}
        onCreatePlaylist={handleCreatePlaylist}
        onAddMusic={() => openAddMusic()}
        pageTitle={getPageInfo().title}
        pageCount={getPageInfo().count}
        viewOptions={viewOptions()}
        mainNavSections={[
          {
            items: [
              // aggregate feed — combines all remotes
              {
                label: "all feeds",
                onClick: () => {
                  navigate("/feed");
                },
              },
              // per-remote feed is only available when hasFeedView() is true
              ...(hasFeedView()
                ? [
                    {
                      label: "feed",
                      onClick: () => {
                        navigate(routes.feed());
                      },
                    },
                  ]
                : []),
              {
                label: "songs",
                onClick: () => {
                  const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/songs`);
                },
              },
              {
                label: "albums",
                onClick: () => {
                  const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/albums`);
                },
              },
              {
                label: "artists",
                onClick: () => {
                  const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/artists`);
                },
              },
              {
                label: "genres",
                onClick: () => {
                  const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/genres`);
                },
              },
              {
                label: "playlists",
                onClick: () => {
                  const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/playlists`);
                },
              },
              {
                label: "favorites",
                onClick: () => {
                  const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/favorites`);
                },
              },
            ],
          },
        ]}
      />

      {/* main content area */}
      <div
        class="flex-1 overflow-hidden flex"
        style={{
          "padding-top": isNarrow() ? "var(--nav-height, 56px)" : undefined,
          "padding-bottom": "var(--player-bar-height)",
        }}
      >
        <div class="flex-1 overflow-hidden">{props.children}</div>

        {/* queue sidebar - overlay drawer on narrow, inline sidebar on wide */}
        <QueueSidebar
          isOpen={queueOpen()}
          variant={isNarrow() ? "overlay" : "inline"}
          songs={appState()?.queue || []}
          currentIndex={
            appState()?.current_sha256
              ? appState()!.queue.findIndex((s) => s.sha256 === appState()!.current_sha256)
              : -1
          }
          upNextIndex={
            pendingUpNextSha256()
              ? (appState()?.queue.findIndex((s) => s.sha256 === pendingUpNextSha256()) ??
                undefined)
              : undefined
          }
          currentTime={currentTime()}
          duration={duration()}
          progressMap={progressMap()}
          loadingSongIds={loadingSongIds()}
          onClose={() => void setQueueOpen(false)}
          onSongClick={(index) => {
            const state = appState();
            if (state?.queue[index]) {
              void playSong(state.queue[index], { userInitiated: true });
            }
          }}
          onSongDoubleClick={(index) => {
            const state = appState();
            if (state?.queue[index]) {
              void playSong(state.queue[index], { userInitiated: true });
            }
          }}
          onRemoveSong={(index) => {
            void removeFromQueue(index);
          }}
          onReorder={(fromIndex, toIndex) => {
            void reorderQueue(fromIndex, toIndex);
          }}
          onClearAll={() => {
            void clearQueue();
          }}
          onRadioQueueEntryClick={(station) => {
            void tuneIntoRadio(station.peer_addr, {
              stationId: station.station_id,
              stationName: station.station_name,
              isLocal: station.is_local,
            });
          }}
          getRadioQueueContextMenuActions={getRadioQueueContextMenuActions}
          onResumeDownloads={() => {
            resumeAutoDownload();
          }}
          pendingDownloadCount={getPendingDownloadCount()}
          getContextMenuActions={(index, _queueSong) => {
            const state = appState();
            if (!state?.queue[index]) return [];

            const fullSong = state.queue[index];
            const queueLength = state.queue.length;
            const isSynced = isSongSyncedLocally(fullSong.sha256);
            return useSongContextMenu(fullSong, {
              showPlayActions: false,
              isFavorite: fullSong.is_favorite || false,
              showRemoveFromQueue: true,
              queueIndex: index,
              onRemoveFromQueue: () => void removeFromQueue(index),
              showClearAbove: index > 0,
              onClearAbove: () => void clearSongsAbove(index),
              showClearBelow: index < queueLength - 1,
              onClearBelow: () => void clearSongsBelow(index),
              showDeleteFromLocal: isSynced,
              onDeleteFromLocal: async () => {
                const result = await deleteSongFromLocal(fullSong.id, {
                  remoteServerId: fullSong.remote_server_id,
                  sha256: fullSong.sha256,
                });
                if (result.success) {
                  // also remove from queue after deletion
                  await removeFromQueue(index);
                  const { toast } = await import("../components/feedback/Toast");
                  toast.success("removed from local library");
                } else {
                  const { toast } = await import("../components/feedback/Toast");
                  toast.error(result.error || "failed to delete");
                }
              },
            });
          }}
          historyEntries={queueHistory()}
          onReplayHistoryEntry={(entry) => {
            if (entry.type === "radio_station" && entry.radio_station_ref) {
              const ref = entry.radio_station_ref;
              void tuneIntoRadio(ref.peer_addr, {
                stationId: ref.station_id,
                stationName: ref.station_name,
                isLocal: ref.is_local,
              });
              return;
            }
            const hasProgress = (entry.listened_seconds || 0) > 0;
            if (hasProgress) {
              // resume from where we left off
              void resumeHistoryEntry(entry);
            } else {
              // play from the beginning
              void addToQueue(entry.songs, {
                startPlaying: true,
                source: {
                  type: entry.type,
                  label: entry.label,
                  entity_id: entry.entity_id,
                  image: entry.image,
                },
              });
            }
          }}
          onRemoveHistoryEntry={(id) => {
            void removeHistoryEntry(id);
          }}
          onClearHistory={async () => {
            const confirmed = await confirm({
              title: "clear history",
              message: "are you sure you want to clear all queue history?",
              confirmText: "clear",
              variant: "danger",
            });
            if (confirmed) {
              void clearQueueHistory();
            }
          }}
          getHistoryContextMenuActions={getHistoryContextMenuActions}
          currentRadioStation={currentRadioStation()}
          currentRadioRemoteName={currentRadioRemoteName()}
          currentRadioRemoteImage={currentRadioRemoteImage()}
        />
      </div>

      {/* unified player bar — handles both music (queue) and radio modes.
          radio audio element lives here so playback survives navigation;
          `setRadioAudioSink` is called once on mount. */}
      <Show
        when={
          (appState()?.queue.length || 0) > 0 || radioStatus() !== "idle" || !!currentRadioStation()
        }
      >
        {(() => {
          const isRadio = () => playbackMode() === "radio";

          // build the song-shaped object the bar consumes. in radio mode,
          // map fields from radioNowPlaying() + radioArtUrl().
          const barSong = () => {
            if (isRadio()) {
              const np = radioNowPlaying();
              if (!np) {
                const station = currentRadioStation();
                if (!station) return undefined;
                return {
                  id: station.station_id || station.peer_addr || "radio",
                  title: station.station_name || "radio station",
                  artist: "radio",
                  album: "ready to resume",
                  thumbnailUrl: undefined,
                };
              }
              const remoteId = radioCurrentRemoteServerId();
              const artUrl = radioArtUrl() ?? undefined;
              const images = remoteId
                ? [
                    ...(np.art_blob_id
                      ? [
                          {
                            remote_blob_id: np.art_blob_id,
                            remote_server_id: remoteId,
                            is_primary: true,
                            blob_type: "thumbnail" as const,
                          },
                        ]
                      : []),
                    ...(np.waveform_blob_id
                      ? [
                          {
                            remote_blob_id: np.waveform_blob_id,
                            remote_server_id: remoteId,
                            is_primary: false,
                            blob_type: "waveform" as const,
                          },
                        ]
                      : []),
                  ]
                : undefined;
              return {
                id: np.song_id || "radio",
                title: np.title || "untitled",
                artist: np.artist ?? "unknown artist",
                album: np.album ?? undefined,
                thumbnailUrl: artUrl,
                images,
                isFavorite: radioCurrentFavorite() ?? false,
              };
            }
            const cs = currentSongData();
            if (!cs) return undefined;
            return {
              id: cs.id,
              sha256: cs.sha256,
              title: cs.title,
              artist:
                cs.album_type === "compilation" && cs.track_artist?.trim()
                  ? cs.track_artist
                  : cs.artist_name,
              album: cs.album_title,
              images: cs.images,
              album_images: cs.album_images,
              isFavorite: cs.is_favorite || false,
            };
          };

          const barIsPlaying = () => (isRadio() ? radioStatus() === "playing" : isPlaying());
          const barIsLoading = () => (isRadio() ? radioStatus() === "connecting" : isLoading());
          const barCurrentTime = () => (isRadio() ? radioElapsedMs() / 1000 : currentTime());
          const barDuration = () => {
            if (isRadio()) {
              return 0;
            }
            return duration();
          };

          const onPlayPause = () => {
            if (isRadio()) {
              if (radioStatus() === "paused") {
                if (radioUseTimelineMode()) {
                  acknowledgeTimelineUserStart();
                }
                radioResume();
              } else if (radioStatus() === "playing") radioPause();
              else if (radioStatus() === "error") leaveRadio();
              else if (radioStatus() === "idle") {
                const station = currentRadioStation();
                if (!station) return;
                void tuneIntoRadio(station.peer_addr, {
                  stationId: station.station_id,
                  stationName: station.station_name,
                  isLocal: station.is_local,
                });
              }
              return;
            }
            togglePlayback();
          };
          const onPrev = () => {
            if (isRadio()) return; // radio has no track skip
            playPrevious();
          };
          const onNext = () => {
            if (isRadio()) {
              if (!canAdminSkipRadioTrack()) return;
              void requestRadioTrackSkip().catch((e) => {
                toast.error(e instanceof Error ? e.message : String(e));
              });
              return;
            }
            playNext();
          };
          const onSeekCb = (pct: number) => {
            if (isRadio()) return; // live audio is not seekable
            handleSeek(pct);
          };
          const onFavToggle = (songId: string) => {
            if (isRadio()) {
              // toggle favorite for the currently-playing radio track on
              // the broadcasting peer. requires the peer to be a
              // registered remote with an authenticated session; the
              // service surfaces an error otherwise.
              const next = !(radioCurrentFavorite() ?? false);
              void setRadioFavorite(songId, next).catch((e) => {
                debug("AppLayout", "radio favorite toggle failed:", e);
              });
              return;
            }
            handleSongFavoriteToggle(songId);
          };
          const onImageClick = () => {
            if (isRadio()) {
              navigate("/radio");
              return;
            }
            handlePlayerImageClick();
          };

          const onSongMetaClick = () => {
            if (!isRadio()) {
              const cs = currentSongData();
              if (!cs || !cs.album_id) return;
              setHighlightedSongId(cs.id);
              navigate(routes.album(cs.album_id));
              return;
            }

            const np = radioNowPlaying();
            const remoteId = radioCurrentRemoteServerId();
            const songId = typeof np?.song_id === "string" ? np.song_id.trim() : "";
            if (!np || !remoteId || !songId) {
              navigate("/radio");
              return;
            }
            void (async () => {
              try {
                const remote = await getRemoteById(remoteId);
                if (!remote) {
                  navigate("/radio");
                  return;
                }
                const client = await getClientForRemote(remote);
                const result = await client.music.querySongs({
                  q: null,
                  search_fields: null,
                  filters: { song_ids: [songId] },
                  sort_by: null,
                  sort_direction: null,
                  limit: 1,
                  offset: null,
                  user_id: null,
                  favorites_only: null,
                  min_rating: null,
                });
                if (!result.success || result.data.items.length === 0) {
                  navigate("/radio");
                  return;
                }
                const albumId = result.data.items[0].album?.id;
                if (!albumId) {
                  navigate("/radio");
                  return;
                }
                setHighlightedSongId(songId);
                navigate(
                  `/${remoteId}/albums/${encodeURIComponent(albumId)}?song_id=${encodeURIComponent(songId)}`
                );
              } catch (e) {
                debug("AppLayout", "radio song meta navigate failed:", e);
                navigate("/radio");
              }
            })();
          };

          // status badge for radio mode: live indicator + listener count.
          // when in timeline/queue mode (no MSE, forced by broadcaster, or
          // network fallback) shows "queue" instead of "live" with a purple dot.
          const statusBadge = () =>
            isRadio() ? (
              <div
                class="flex items-center gap-1 pr-1.5 py-0 rounded-full bg-black/60 backdrop-blur text-[9px] font-bold uppercase tracking-wide leading-none"
                classList={{
                  "text-violet-400": radioStatus() === "playing" && radioUseTimelineMode(),
                  "text-red-400": radioStatus() === "playing" && !radioUseTimelineMode(),
                  "text-amber-400": radioStatus() === "connecting",
                  "text-neutral-400": radioStatus() === "paused",
                  "text-red-500": radioStatus() === "error",
                }}
                title={radioCurrentPeerAddr() ?? ""}
              >
                <span>
                  {radioStatus() === "playing"
                    ? radioUseTimelineMode()
                      ? "queue"
                      : "live"
                    : radioStatus() === "connecting"
                      ? "tuning"
                      : radioStatus() === "paused"
                        ? "paused"
                        : radioStatus() === "idle"
                          ? "ready"
                          : "error"}
                </span>
                <span
                  class="w-1 h-1 rounded-full"
                  classList={{
                    "bg-violet-400 animate-pulse":
                      radioStatus() === "playing" && radioUseTimelineMode(),
                    "bg-red-500 animate-pulse":
                      radioStatus() === "playing" && !radioUseTimelineMode(),
                    "bg-amber-400 animate-pulse": radioStatus() === "connecting",
                    "bg-neutral-400": radioStatus() === "paused",
                    "bg-red-500": radioStatus() === "error",
                  }}
                />
                <span class="opacity-70 normal-case font-medium tabular-nums">
                  {radioListenerCount()} listening
                </span>
              </div>
            ) : undefined;

          return (
            <PlayerBar
              song={barSong()}
              isPlaying={barIsPlaying()}
              isLoading={barIsLoading()}
              hasUpNext={isRadio() ? false : !!pendingUpNextSha256()}
              currentTime={barCurrentTime()}
              duration={barDuration()}
              volume={volume()}
              queueOpen={queueOpen()}
              onPlayPause={onPlayPause}
              onPrevious={onPrev}
              onNext={onNext}
              onSeek={onSeekCb}
              onVolumeChange={setPlayerVolume}
              onQueueToggle={handleQueueToggle}
              onFavoriteToggle={onFavToggle}
              onImageClick={onImageClick}
              onSongMetaClick={onSongMetaClick}
              queueLength={appState()?.queue.length || 0}
              canGoNext={isRadio() ? canAdminSkipRadioTrack() : canGoNext()}
              canGoPrevious={isRadio() ? false : canGoPrevious()}
              showNext={!isRadio() || canAdminSkipRadioTrack()}
              showPrevious={!isRadio()}
              statusBadge={statusBadge()}
              isLiveStream={isRadio()}
            />
          );
        })()}
      </Show>

      {/* persistent <audio> for radio playback. hidden; lives at app root
          so navigation never tears it down. wired into radioService via
          setRadioAudioSink in onMount. */}
      <RadioAudioSink />

      {/* add remote modal */}
      <AddRemoteModal
        isOpen={isAddRemoteOpen()}
        onClose={() => setIsAddRemoteOpen(false)}
        onSuccess={() => {
          debug("AppLayout", "remote added successfully");
          // reload remotes list
          void (async () => {
            const allRemotes = await getAllRemotes();
            setRemotes(allRemotes);
          })();
        }}
      />

      {/* connection progress modal (appears when connecting takes >1s) */}
      <ConnectionProgressModal
        state={connectionProgress()}
        onCancel={() => cancelAndNavigate(navigate)}
      />

      {/* global confirm dialog */}
      <ConfirmDialog
        isOpen={confirmState().isOpen}
        onClose={closeConfirm}
        onConfirm={() => resolveConfirm(true)}
        title={confirmState().title}
        message={confirmState().message}
        confirmText={confirmState().confirmText}
        cancelText={confirmState().cancelText}
        variant={confirmState().variant}
      />

      {/* global playlist selector modal */}
      <PlaylistSelectorModal
        isOpen={playlistSelectorState().isOpen}
        onClose={closePlaylistSelector}
        songIds={playlistSelectorState().songIds}
      />

      {/* global station selector modal (charnel-only) */}
      <AddToStationModal />

      {/* toast notifications */}
      <Portal>
        <ToastRegion />
      </Portal>
    </div>
  );
}

/**
 * persistent <audio> element for radio playback. mounted once at the
 * app root so navigation never re-creates it (which would tear down the
 * MediaSource pipe). registers itself with `setRadioAudioSink` on mount
 * and unregisters on unmount. hidden from layout.
 */
function RadioAudioSink() {
  let mount!: HTMLDivElement;
  const audioEl = (() => {
    const el = document.createElement("audio");
    el.controls = false;
    el.autoplay = false;
    el.preload = "auto";
    el.style.display = "none";
    return el;
  })();
  setRadioAudioSink(audioEl);
  // initial volume sync — RadioAudioSink mounts after player.ts has
  // restored the persisted volume, so seed the new sink to match.
  try {
    audioEl.volume = Math.max(0, Math.min(1, volume()));
  } catch {
    // ignore — element may not be ready yet.
  }
  onMount(() => {
    if (mount && audioEl.parentElement !== mount) mount.appendChild(audioEl);
  });
  onCleanup(() => {
    setRadioAudioSink(null);
  });
  return <div ref={(el) => (mount = el)} class="hidden" />;
}
