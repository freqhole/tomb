// main app layout with navigation, content area, and player bar
import { useLocation, useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
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
  cancelConnection,
  connectToRemote,
} from "./services/remotes/connectionProgress";
import { createRemoteSwitchingHandlers } from "./services/remotes/remoteSwitching";
import { selectLocalPlaybackTarget } from "./services/players/selectPlaybackTarget";
import { openPlayerImageCarousel } from "./services/playerImageCarousel";
import { createDebouncedBoolean } from "../utils/createDebouncedBoolean";
import { isTouchDevice } from "../utils/isMobile";
import { TopNav } from "../components/navigation/TopNav";
import {
  topNavRightContent,
  topNavSecondaryRowContent,
  topNavSearchContent,
  topNavHideSearch,
  topNavSearchExpanded,
} from "./shell/topNavSlots";
import type { ViewOption } from "../components/navigation/ViewSelector";
import { PlayerBar, type PlayerBarVideo } from "../components/player/PlayerBar";
import {
  VideoMiniPlayer,
  videoMiniPlayerExpanded,
  collapseVideoMiniPlayer,
} from "../components/player/VideoMiniPlayer";
import { QueueSidebar } from "../components/player/QueueSidebar";

import { isRemoteTargetActive } from "./services/players/activeTarget";
import {
  remotePause,
  remoteResume,
  remoteSkip,
  remoteSetVolume,
  remoteIsPlaying,
  remotePositionMs,
  remoteDurationMs,
  remoteVolume,
  remoteSeek,
  remoteQueue,
  remoteOptimisticCurrentIndex,
  remoteCommandPending,
  remoteStatusKnown,
  remoteCurrentItem,
  remoteTargetOffline,
  setRemoteStatusPolling,
} from "./services/players/remotePlaybackControl";
import { getCurrentRemote, getCurrentUser, getDataSource } from "../music/data";
import { useRouteDataSource } from "../music/hooks/useRouteDataSource";
import { useToggleFavoriteMutation } from "../music/queries/favorites";
import { useVideoFavoriteStatuses } from "../video/hooks/useVideoFavoriteStatuses";
import { useRecentPlaylistsQuery } from "../music/queries/playlists";
import {
  currentTime,
  duration,
  getVideoElement,
  isVideoWindowActive,
  isLoading,
  isPlaying,
  pause,
  pendingUpNextSha256,
  playMediaItem,
  playNext,
  playPrevious,
  seek,
  setPlayerVolume,
  togglePlayback,
  volume,
} from "../music/services/audio/player";
import {
  clearExternalMediaSession,
  setExternalMediaSession,
} from "../music/services/audio/mediaSessionBridge";
import {
  getVisibleLoadingIds,
  isSongSyncedLocally,
  getLoadingProgress,
  getLoadingIds,
} from "../music/services/download";
import { getLoadingP2PSongIds } from "../music/services/storage/blobResolver";
import { getSongByBlake3 } from "../music/services/storage/db/songs";
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
import { useVideoContextMenu } from "../video/hooks/contextMenu";
import {
  getAllRemotes,
  getRemoteById,
  onRemoteStatusChange,
  onSwitchToLocal,
} from "./services/remotes/remoteManager";
import { seedOnlineMap, wakeAllRemotes } from "./services/remotes/remoteHealth";
import { wakeAllPlayers } from "./services/players/playerPresenceStore";
import type { ImageMetadata, Song } from "../music/services/storage/types";
import {
  mediaItemKey,
  songsOnly,
  findMediaItemIndex,
  type QueuedVideo,
} from "./services/storage/mediaItem";
import {
  type Remote,
  type QueueHistoryEntry,
  type RadioStationRef,
  isHttpRemote,
  isP2PRemote,
} from "./services/storage/types";
import type { MenuAction } from "../components/overlays/ContextMenu";
import { IconNames, type IconName } from "../components/icons/registry";
import { routes, matchRoute, getDefaultRoute, hasFeedView } from "../music/utils/routing";
import { confirmState, closeConfirm, resolveConfirm, confirm } from "./services/confirmState";
import { playlistSelectorState, closePlaylistSelector } from "../music/hooks/playlistSelectorState";
import { showShareModal, useIsAnyModalOpen } from "../music/hooks/modals";
import { openAddMedia } from "./hooks/mediaModal";
import {
  appState,
  setQueueOpen,
  getLocalLibraryName,
  setLocalLibraryName,
} from "./services/storage/db";
import { getPageInfo } from "./services/pageInfo";
import { setAppDocumentTitle } from "./services/documentTitle";
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
import { loadVideoQueueHistory } from "../video/services/queue/videoQueueHistory";
import { reconnectVideoProgressTracking } from "../video/services/queue/videoListenProgress";
import {
  isCharnelMode,
  listMountedExternalStorageDevices,
  onExternalStorageMountedChanged,
  onExternalStorageSyncProgress,
} from "./services/charnel";
import {
  externalStorageSyncingSignal,
  externalStorageSyncProgressSignal,
  setExternalStorageSyncProgress,
} from "./services/charnel/externalStorageSyncState";
import {
  getAuthInfo,
  refreshOne as refreshRemoteAuthStatus,
} from "./services/remotes/authStatusStore";
import {
  checkAndShowConfigUpgradeToast,
  checkAndShowStorageHealthToast,
} from "./services/toastNotices";
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
import { openRadioImageCarousel } from "./services/radio/radioImageCarousel";
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
  const [currentVideoData, setCurrentVideoData] = createSignal<QueuedVideo | null>(null);
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // mini video player's "closed" state - the x button pauses + hides the
  // panel without touching the queue (see VideoMiniPlayer's onClose).
  // starts dismissed so a video restored from persisted state on app
  // boot (paused, not yet actually playing) never auto-shows the panel
  // - only a real switch to a different video *during* the session, or
  // actual playback starting, un-dismisses it (see the two effects below).
  const [videoMiniPlayerDismissed, setVideoMiniPlayerDismissed] = createSignal(true);
  // only fires for an actual video-to-video switch (prevId defined and
  // different) - going from no-id to an id (boot restore, or a user
  // picking their first video of the session) is intentionally ignored
  // here; the latter case still un-dismisses via the isPlaying effect
  // below once real playback starts. this can't use `on`'s `{ defer }`
  // option instead: currentVideoData is populated by a separate, later
  // effect (watching appState()), so by the time it lands this effect
  // is already on its second run (first run saw `undefined`, before
  // that other effect ran) - defer only special-cases the very first run.
  createEffect(
    on(
      () => currentVideoData()?.id,
      (id, prevId) => {
        if (prevId !== undefined && id !== prevId) setVideoMiniPlayerDismissed(false);
      }
    )
  );
  // scoped to `isPlaying` alone (via `on`) so this only reacts to real
  // play/pause transitions, not to `videoMiniPlayerDismissed` itself
  // changing - otherwise dismissing while the pause command is still
  // in flight (isPlaying briefly stale-true) would immediately re-open
  // the panel, requiring a second click to actually close it.
  createEffect(
    on(isPlaying, (playing) => {
      if (playing && videoMiniPlayerDismissed()) setVideoMiniPlayerDismissed(false);
    })
  );

  // the mini player floats above everything, including modals - hide it
  // (pausing playback first) whenever any modal opens so it doesn't sit
  // on top of the modal. only applies when a video is actually loaded
  // (the mini player is video-only - songs have no floating panel to
  // hide, so opening a modal shouldn't pause music playback).
  const isAnyModalOpenReactive = useIsAnyModalOpen();
  createEffect(() => {
    if (currentVideoData() && isAnyModalOpenReactive() && !videoMiniPlayerDismissed()) {
      if (isPlaying()) pause();
      setVideoMiniPlayerDismissed(true);
    }
  });

  // favorite status for the currently-playing video (video summary rows
  // don't carry is_favorite, so it's hydrated separately, same as
  // VideoDetailView/VideoCard do).
  const currentVideoIds = createMemo(() => {
    const id = currentVideoData()?.id;
    return id ? [id] : [];
  });
  const currentVideoFavoriteQuery = useVideoFavoriteStatuses(currentVideoIds);
  const isCurrentVideoFavorite = createMemo(() => {
    const id = currentVideoData()?.id;
    return id ? (currentVideoFavoriteQuery.data?.has(id) ?? false) : false;
  });

  // favorite status for videos currently in the queue - hoisted to setup
  // level (not built inline inside QueueSidebar's JSX) so `<QueueSidebar>`
  // itself is only constructed once; wrapping it in a reactive IIFE that
  // reads appState()/currentTime()/etc. would re-invoke the component on
  // every progress tick, remounting it and resetting its local state
  // (e.g. the queue/history tab selection).
  const queueVideoIds = createMemo(() =>
    (appState()?.queue ?? []).filter((i) => i.kind === "video").map((i) => i.video.id)
  );
  const queueVideoFavoriteQuery = useVideoFavoriteStatuses(queueVideoIds);

  // background image config (reactive)
  const bgConfig = () => getBackgroundConfig();
  // const [isQueueOpen, setIsQueueOpen] = createSignal(false);
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [storageUsage, setStorageUsage] = createSignal<number>(0);
  const [storageQuota, setStorageQuota] = createSignal<number>(0);
  const [externalStorageMounted, setExternalStorageMounted] = createSignal(false);

  // phase 6: unified playback target (paired freqhole-player devices) -
  // the "play on" picker itself now lives in QueueSidebar's bottom row.
  createEffect(() => setRemoteStatusPolling(isRemoteTargetActive()));
  onCleanup(() => setRemoteStatusPolling(false));

  // "optimistic remote-target playerbar sync" follow-up: surface the
  // client-side offline timeout (remoteTargetOffline(), see
  // remotePlaybackControl.ts) as a one-shot toast on the rising edge only
  // - not a persistent banner, so it doesn't need its own dismiss/retry ui
  // yet, and doesn't repeat on every tick while still offline. also falls
  // back to local playback automatically (docs/player-peer-trust-bridge-plan.md
  // step 6) rather than leaving the user stuck on a dead remote target.
  createEffect(
    on(remoteTargetOffline, (offline, prevOffline) => {
      if (offline && !prevOffline) {
        toast.error("lost connection to the player - controls may not respond", {
          title: "remote-player-connection-error",
        });
        void selectLocalPlaybackTarget();
      }
    })
  );

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  // reactive memo for currently-loading media ids (combines HTTP + P2P
  // song fetches, the current song, and now also video pre-caching).
  // uses the debounced/visible loading set so a load that finishes
  // within ~1s never flashes the queue row's loading indicator at all.
  const debouncedCurrentIsLoading = createDebouncedBoolean(isLoading);
  const loadingIds = createMemo(() => {
    const loadingSet = new Set(getVisibleLoadingIds());
    for (const sha256 of getLoadingP2PSongIds()) {
      loadingSet.add(sha256);
    }
    // add current song if audio is loading (includes P2P fetch wait)
    const currentSha256 = appState()?.current_sha256;
    if (debouncedCurrentIsLoading() && currentSha256) {
      loadingSet.add(currentSha256);
    }
    return loadingSet;
  });

  // download/transfer progress (0..1) of whichever item is currently
  // loading — the active video takes priority (no video is ever also the
  // current song). gated on the download module's own tracked-ids set
  // (getLoadingIds, NOT the playback-level `isLoading` signal above —
  // that one only flips true once decoding starts, well *after* the blob
  // fetch this progress reflects has already finished for some backends,
  // e.g. htmlAudio.ts's synthetic "loading" state is emitted post-fetch).
  // prefers `pendingUpNextSha256` (despite the name, holds a `mediaItemKey`
  // — song sha256 OR video id — for whichever item is actively being
  // fetched, set before appState().current_sha256 flips over — see
  // htmlAudio.ts and videoBackend.ts) so progress shows for the *incoming*
  // item, not a stale current one. drives the playerbar's play/pause ring
  // as a determinate fill instead of a plain indeterminate spin.
  const mediaTransferProgress = createMemo<number | null>(() => {
    const videoId = currentVideoData()?.id;
    if (videoId && getLoadingIds().has(videoId)) {
      const p = getLoadingProgress(videoId);
      return typeof p === "number" ? p : null;
    }
    const sha256 = pendingUpNextSha256() ?? appState()?.current_sha256;
    if (sha256 && getLoadingIds().has(sha256)) {
      const p = getLoadingProgress(sha256);
      return typeof p === "number" ? p : null;
    }
    return null;
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

  // keep per-remote auth status warm for topnav/admin affordances.
  // only refresh remotes that have not been queried yet.
  createEffect(() => {
    const list = remotes();
    if (!list.length) return;
    void Promise.all(
      list.map(async (remote) => {
        if (getAuthInfo(remote.remote_id) !== undefined) return;
        await refreshRemoteAuthStatus(remote);
      })
    );
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

  // update window/document title (freqhole ▸ remote ▸ page). prefers the
  // current view's pageInfo (documentTitle override, e.g. a loaded album's
  // actual name, else its bucket title like "songs"/"albums") - falls back
  // to a route-key guess for the brief window before a view mounts and
  // calls setPageInfo/DetailViewWrapper.
  createEffect(() => {
    const remote = getCurrentRemote();
    const remoteName = remote?.name ?? "local";
    const info = getPageInfo();
    const pathname = location.pathname;
    const pageName = info.documentTitle || info.title || matchRoute(pathname) || "songs";

    setAppDocumentTitle([remoteName, pageName]);
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
  onMount(() => {
    window.addEventListener("resize", handleResize);

    // re-probe when the tab/window becomes visible again — covers the
    // "laptop woke from sleep / switched back to tab" case where
    // stale-offline flags are common.
    const onVisibility = () => {
      if (document.visibilityState === "visible") wakeAllRemotes();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    // filled in by the async setup below. `onCleanup` must be registered
    // synchronously, before any `await`, to actually attach to this
    // component's disposal - registering it later (after crossing an
    // await boundary) runs outside solid's reactive ownership tracking
    // and triggers "cleanups created outside a `createRoot` or `render`
    // will never be run", so these start undefined and get populated
    // once each piece of async setup resolves.
    let unsubscribeStatusChange: (() => void) | undefined;
    let unsubscribeSwitchToLocalFn: (() => void) | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let unlistenExternalStorageMounted: (() => void) | undefined;
    let unlistenSyncProgress: (() => void) | undefined;

    onCleanup(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      unsubscribeStatusChange?.();
      unsubscribeSwitchToLocalFn?.();
      if (interval !== undefined) clearInterval(interval);
      unlistenExternalStorageMounted?.();
      unlistenSyncProgress?.();
    });

    void (async () => {
      // load queue history from idb
      await loadQueueHistory();
      await loadVideoQueueHistory();

      // load persisted radio queue entry (display only; no autoplay)
      await loadCurrentRadioStation();

      // load queue progress from storage
      loadProgressFromStorage();

      // reconnect progress tracking if there's an active queue from a previous page load
      reconnectProgressTracking();
      reconnectVideoProgressTracking();

      // resume auto-downloads if enabled (downloads songs beyond rolling window)
      void resumeAutoDownloadsOnInit();

      // start analytics sync loop
      startAnalyticsSync();

      // check if config needs upgrade (tauri mode only, shows persistent toast if needed)
      checkAndShowConfigUpgradeToast();

      // check if fetch-music-dir / external-storage paths are still
      // writable (flatpak doc-portal grants can go stale) - shows a
      // toast prompting reselect if not.
      void checkAndShowStorageHealthToast();

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

      // seed the reactive `isOnline(id)` map and fire a background wake-up
      // probe for every offline remote. dedupe + backoff lives in
      // remoteHealth so it's safe to call this freely.
      void seedOnlineMap();
      wakeAllRemotes();

      // same idea for paired players (playerPresenceStore.ts) - a
      // fire-and-forget sweep, never awaited, so this never delays
      // initial load/render. QueuePlayerTargetRow's flyout re-triggers
      // this itself on open for a fresher read.
      wakeAllPlayers();

      // listen for remote status changes (offline/online) and refresh remotes list
      unsubscribeStatusChange = onRemoteStatusChange(async (_remoteId, _isOffline) => {
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
      unsubscribeSwitchToLocalFn = onSwitchToLocal(() => {
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
      interval = setInterval(updateStorage, 30000);

      // poll for mounted removable-storage devices (desktop/tauri only) -
      // drives playerbar icon visibility, so it should disappear fairly
      // promptly once a device is unplugged.
      if (isCharnelMode()) {
        const updateExternalStorageMounted = async () => {
          try {
            const mounted = await listMountedExternalStorageDevices();
            setExternalStorageMounted(mounted.length > 0);
          } catch (error) {
            console.error("failed to check mounted external storage devices:", error);
          }
        };
        void updateExternalStorageMounted();
        unlistenExternalStorageMounted = await onExternalStorageMountedChanged(
          () => void updateExternalStorageMounted()
        );

        // global per-song sync progress - lives here (not just
        // StorageOverviewView) so the playerbar icon keeps showing live
        // progress even after navigating away mid-sync.
        unlistenSyncProgress = await onExternalStorageSyncProgress((event) => {
          setExternalStorageSyncProgress({
            title: event.data.title,
            current: event.data.current,
            total: event.data.total,
          });
        });
      }
    })();
  });

  // remote switch/recheck/delete/rename handlers (extracted - see
  // app/services/remotes/remoteSwitching.ts)
  const {
    handleSwitchToLocal,
    handleSwitchToRemote,
    handleRecheckRemote,
    handleDeleteRemote,
    handleRenameRemote,
  } = createRemoteSwitchingHandlers({ navigate, queryClient, setRemotes });

  const currentSourceName = createMemo(() => {
    const remote = getCurrentRemote();
    return remote ? remote.name : getLocalLibraryName();
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

  // watch for current song/video changes and load the corresponding data
  createEffect(() => {
    const state = appState();
    if (state?.current_sha256) {
      const sha256 = state.current_sha256;
      // first check if the item is in queue (avoids fetching from wrong remote)
      const itemInQueue = state.queue.find((i) => mediaItemKey(i) === sha256);
      if (itemInQueue?.kind === "video") {
        setCurrentVideoData(itemInQueue.video);
        setCurrentSongData(null);
        return;
      }
      if (itemInQueue?.kind === "song") {
        setCurrentVideoData(null);
        setCurrentSongData(itemInQueue.song);
      } else if (state.queue.length > 0) {
        // sha256 is set but not yet in the queue. this is a brief transitional
        // window while the queue is being rebuilt for a new track (setQueue
        // fires first, then playSong sets current_sha256). holding the previous
        // song data keeps the player bar showing something instead of flashing
        // "no song playing". the next appState tick (when current_sha256 lands
        // and the song IS in the queue) will update it correctly.
        // intentionally not calling setCurrentSongData(null) here.
      } else {
        // queue is empty - try fetching the song directly (page-reload case
        // where the queue hasn't been rehydrated yet).
        setCurrentVideoData(null);
        const dataSource = getDataSource();
        void dataSource.getSongById(sha256).then((song) => {
          // guard against stale response: only apply if sha256 is still current
          if (appState()?.current_sha256 !== sha256) return;
          if (song) {
            setCurrentSongData(song);
          } else {
            setCurrentSongData(null);
          }
        });
      }
    } else {
      setCurrentSongData(null);
      setCurrentVideoData(null);
    }
  });

  // update auto-download queue when queue or current song changes. the
  // song-rolling-window index is computed against the song-only subset of
  // the queue; updateAutoDownloadQueue separately handles videos internally
  // (keyed off the unified current_sha256/mediaItemKey), so this effect
  // must still fire for a video-only queue with no songs in it at all.
  createEffect(() => {
    const state = appState();
    if (!state) return;

    const queueSongs = songsOnly(state.queue);
    const currentIndex = state.current_sha256
      ? queueSongs.findIndex((s) => s.sha256 === state.current_sha256)
      : 0;

    // this effect will re-run when queue or current index changes
    // the function internally checks if auto-download is enabled
    if (state.queue.length > 0) {
      void updateAutoDownloadQueue(Math.max(0, currentIndex));
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
      isFavorite: radioCurrentFavorite() ?? false,
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
      onFavoriteToggle: () => {
        const songId = radioNowPlaying()?.song_id;
        if (!songId) return;
        const next = !(radioCurrentFavorite() ?? false);
        void setRadioFavorite(songId, next).catch((e) => {
          debug("AppLayout", "radio favorite toggle (media session) failed:", e);
        });
      },
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

  // handle video favorite toggle from player bar
  const handleVideoFavoriteToggle = (videoId: string) => {
    toggleFavoriteMutation.mutate({
      targetType: "video",
      targetId: videoId,
      isFavorite: !isCurrentVideoFavorite(),
    });
  };

  // handle player bar image click - show song + album images in carousel
  // (see app/services/playerImageCarousel.ts)
  const handlePlayerImageClick = async () => {
    const song = currentSongData();
    if (!song) return;
    await openPlayerImageCarousel(song);
  };

  const handleQueueToggle = async () => {
    // the queue sidebar never renders above the expanded mini player, so
    // its toggle button is otherwise dead while expanded on touch devices
    // (no hover affordance to collapse it instead) - repurpose it.
    if (isTouchDevice() && videoMiniPlayerExpanded()) {
      collapseVideoMiniPlayer();
      return;
    }
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

    // navigation actions based on type — scope to the entry's origin
    // remote (server_remote_id or the first song's remote_server_id), not
    // the globally-active remote, so links land on the right source.
    const firstSong = entry.songs[0];
    const entryRemoteId = entry.server_remote_id ?? firstSong?.remote_server_id ?? "local";
    const navActions: MenuAction[] = [];

    // for song/album types, show both "view album" and "view artist"
    if (entry.type === "song" || entry.type === "album") {
      const albumId = entry.type === "album" ? entry.entity_id : firstSong?.album_id;
      const artistId = firstSong?.artist_id;
      if (albumId) {
        navActions.push({
          label: "view album",
          icon: IconNames.album,
          onClick: () => navigate(routes.albumOn(entryRemoteId, albumId)),
        });
      }
      if (artistId) {
        navActions.push({
          label: "view artist",
          icon: IconNames.artist,
          onClick: () => navigate(routes.artistOn(entryRemoteId, artistId)),
        });
      }
    } else if (entry.entity_id) {
      const typeNavMap: Record<
        string,
        { label: string; route: (id: string) => string; icon: IconName }
      > = {
        artist: {
          label: "view artist",
          route: (id) => routes.artistOn(entryRemoteId, id),
          icon: IconNames.artist,
        },
        playlist: {
          label: "view playlist",
          route: (id) => routes.playlistOn(entryRemoteId, id),
          icon: IconNames.playlist,
        },
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
      { label: "playlists", path: `${prefix}/playlists` },
      { label: "favorites", path: `${prefix}/favorites` },
      { label: "videos", path: `${prefix}/video` },
      { label: "series", path: `${prefix}/video/series` },
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
        onRenameRemote={handleRenameRemote}
        localLibraryName={getLocalLibraryName()}
        onRenameLocalLibrary={async (newName) => {
          try {
            await setLocalLibraryName(newName);
            toast.success("local library renamed");
          } catch (error) {
            console.error("failed to rename local library:", error);
            toast.error("failed to rename local library");
            throw error;
          }
        }}
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
        onAddMedia={() => openAddMedia()}
        pageTitle={getPageInfo().title}
        pageCount={getPageInfo().count}
        viewOptions={viewOptions()}
        rightContent={topNavRightContent()}
        secondaryRowContent={topNavSecondaryRowContent()}
        searchComponent={topNavSearchContent()}
        externalSearchExpanded={topNavSearchExpanded()}
        hideSearch={topNavHideSearch()}
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
          "padding-top": isNarrow() ? "var(--nav-height, 42px)" : undefined,
          "padding-bottom": "var(--player-bar-height)",
        }}
      >
        <div class="flex-1 overflow-hidden">{props.children}</div>

        {/* queue sidebar - overlay drawer on narrow, inline sidebar on wide.
            operates directly on the real, ordered `MediaItem[]` queue
            (phase 4b) - QueueSidebar now renders one unified, interleaved
            virtualized list, so no more song-only/video-only index-mapping
            is needed. */}
        <QueueSidebar
          isOpen={queueOpen()}
          variant={isNarrow() ? "overlay" : "inline"}
          items={appState()?.queue ?? []}
          currentIndex={findMediaItemIndex(appState()?.queue ?? [], appState()?.current_sha256)}
          upNextIndex={
            pendingUpNextSha256()
              ? findMediaItemIndex(appState()?.queue ?? [], pendingUpNextSha256())
              : undefined
          }
          currentTime={currentTime()}
          duration={duration()}
          progressMap={progressMap()}
          loadingIds={loadingIds()}
          onClose={() => void setQueueOpen(false)}
          onItemClick={(index) => {
            const item = appState()?.queue[index];
            if (item) void playMediaItem(item, { userInitiated: true });
          }}
          onItemDoubleClick={(index) => {
            const item = appState()?.queue[index];
            if (item) void playMediaItem(item, { userInitiated: true });
          }}
          onRemoveItem={(index) => void removeFromQueue(index)}
          onReorder={(fromIndex, toIndex) => void reorderQueue(fromIndex, toIndex)}
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
          getContextMenuActions={(index, item) => {
            const queueLength = appState()?.queue.length ?? 0;

            if (item.kind === "video") {
              return useVideoContextMenu(item.video, {
                showPlayActions: false,
                isFavorite: queueVideoFavoriteQuery.data?.has(item.video.id) ?? false,
                showRemoveFromQueue: true,
                queueIndex: index,
                onRemoveFromQueue: () => void removeFromQueue(index),
                showClearAbove: index > 0,
                onClearAbove: () => void clearSongsAbove(index),
                showClearBelow: index < queueLength - 1,
                onClearBelow: () => void clearSongsBelow(index),
              });
            }

            const song = item.song;
            const isSynced = isSongSyncedLocally(song.sha256);
            return useSongContextMenu(song, {
              showPlayActions: false,
              isFavorite: song.is_favorite || false,
              showRemoveFromQueue: true,
              queueIndex: index,
              onRemoveFromQueue: () => void removeFromQueue(index),
              showClearAbove: index > 0,
              onClearAbove: () => void clearSongsAbove(index),
              showClearBelow: index < queueLength - 1,
              onClearBelow: () => void clearSongsBelow(index),
              showDeleteFromLocal: isSynced,
              onDeleteFromLocal: async () => {
                const result = await deleteSongFromLocal(song.id, {
                  remoteServerId: song.remote_server_id,
                  sha256: song.sha256,
                });
                if (result.success) {
                  // also remove from queue after deletion
                  await removeFromQueue(index);
                  toast.success("removed from local library");
                } else {
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
          (appState()?.queue.length || 0) > 0 ||
          radioStatus() !== "idle" ||
          !!currentRadioStation() ||
          isRemoteTargetActive()
        }
      >
        {(() => {
          const isRadio = () => playbackMode() === "radio";

          // phase 14b-style local-library lookup for whatever's currently
          // playing on a remote target - mirrors RemoteQueueRow.tsx's own
          // per-row lookup, so the bar can show a resolved song's real
          // images/favorite state instead of just the raw thumb the source
          // device sent, when this device happens to already have it.
          const [remoteBarSong] = createResource(
            () => remoteCurrentItem()?.blake3_hash,
            getSongByBlake3
          );

          // build the song-shaped object the bar consumes. in radio mode,
          // map fields from radioNowPlaying() + radioArtUrl().
          const barSong = () => {
            if (isRemoteTargetActive()) {
              const item = remoteCurrentItem();
              if (!item) return undefined;
              const resolved = remoteBarSong();
              if (resolved) {
                return {
                  id: resolved.id,
                  sha256: resolved.sha256,
                  title: resolved.title,
                  artist:
                    resolved.album_type === "compilation" && resolved.track_artist?.trim()
                      ? resolved.track_artist
                      : resolved.artist_name,
                  album: resolved.album_title,
                  images: resolved.images,
                  album_images: resolved.album_images,
                  isFavorite: resolved.is_favorite || false,
                };
              }
              return {
                id: item.blake3_hash,
                title: item.title || "untitled",
                artist: item.artist ?? "unknown artist",
                album: undefined,
                thumbnailUrl: item.artwork_full_url ?? item.artwork_thumb_url,
                images: undefined,
                isFavorite: false,
              };
            }
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
            if (cs) {
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
            }
            const cv = currentVideoData();
            if (cv) {
              // video mode: player bar shows a minimal metadata surface
              // (title only, no favorite/album-nav actions yet). the
              // actual video element is mounted on the dedicated watch
              // page via getVideoElement(), not embedded in the bar.
              return {
                id: cv.id,
                sha256: cv.id,
                title: cv.title,
                artist: "video",
                album: undefined,
                images: undefined,
                album_images: undefined,
                isFavorite: false,
              };
            }
            // fall back to appState directly so the bar never flashes "no
            // song playing" during the brief window between appState loading
            // from IDB and the createEffect updating currentSongData.
            const state = appState();
            const sha256 = state?.current_sha256;
            if (!sha256) return undefined;
            const queueItem = state?.queue.find((i) => mediaItemKey(i) === sha256);
            if (!queueItem) return undefined;
            if (queueItem.kind === "video") {
              return {
                id: queueItem.video.id,
                sha256: queueItem.video.id,
                title: queueItem.video.title,
                artist: "video",
                album: undefined,
                images: undefined,
                album_images: undefined,
                isFavorite: false,
              };
            }
            const queueSong = queueItem.song;
            return {
              id: queueSong.id,
              sha256: queueSong.sha256,
              title: queueSong.title,
              artist:
                queueSong.album_type === "compilation" && queueSong.track_artist?.trim()
                  ? queueSong.track_artist
                  : queueSong.artist_name,
              album: queueSong.album_title,
              images: queueSong.images,
              album_images: queueSong.album_images,
              isFavorite: queueSong.is_favorite || false,
            };
          };

          // map the currently playing video's raw codegen `images` shape
          // (`blob_id`/`is_primary: number`) to the bar's `ImageMetadata`
          // shape (`remote_blob_id`/`is_primary: boolean`) — mirrors the
          // same mapping done for queued video rows in QueueSidebar.tsx.
          const barVideo = (): PlayerBarVideo | null => {
            const cv = currentVideoData();
            if (!cv) return null;
            return {
              id: cv.id,
              title: cv.title,
              source_type: cv.source_type,
              poster_blob_id: cv.poster_blob_id,
              poster_opfs_path: cv.poster_opfs_path,
              remote_server_id: cv.remote_server_id,
              images: cv.images?.map((img) => ({
                remote_blob_id: img.blob_id,
                remote_server_id: cv.remote_server_id,
                is_primary: !!img.is_primary,
                blob_type: img.blob_type,
              })),
            };
          };

          const barIsPlaying = () =>
            isRemoteTargetActive()
              ? remoteIsPlaying()
              : isRadio()
                ? radioStatus() === "playing"
                : isPlaying();
          // for remote targets: show the loading ring while a control
          // command is in flight (play/pause/skip/seek/volume) or before
          // the first status has arrived for this target (reconnect-safe -
          // avoids briefly showing a stale/wrong play-pause icon while the
          // real state is still unknown).
          const barIsLoading = () =>
            isRemoteTargetActive()
              ? remoteCommandPending() || !remoteStatusKnown()
              : isRadio()
                ? radioStatus() === "connecting"
                : isLoading();
          const debouncedBarIsLoading = createDebouncedBoolean(barIsLoading);
          const barCurrentTime = () =>
            isRemoteTargetActive()
              ? remotePositionMs() / 1000
              : isRadio()
                ? radioElapsedMs() / 1000
                : currentTime();
          const barDuration = () => {
            if (isRemoteTargetActive()) {
              const ms = remoteDurationMs();
              return ms ? ms / 1000 : 0;
            }
            if (isRadio()) return 0;
            return duration();
          };
          // hides the seek/duration ui for radio (always live) and for
          // remote targets whose current item didn't report a duration
          // (e.g. tuned radio relayed through a player) - a remote item with
          // a known duration gets full seek support (phase 13).
          const barIsLiveStream = () =>
            isRadio() || (isRemoteTargetActive() && barDuration() === 0);

          const onPlayPause = () => {
            if (isRemoteTargetActive()) {
              if (remoteTargetOffline()) return;
              void (remoteIsPlaying() ? remotePause() : remoteResume());
              return;
            }
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
            // no previous-track support in the freqhole-player control protocol yet
            if (isRemoteTargetActive()) return;
            if (isRadio()) return; // radio has no track skip
            playPrevious();
          };
          const onNext = () => {
            if (isRemoteTargetActive()) {
              if (remoteTargetOffline()) return;
              void remoteSkip();
              return;
            }
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
            if (isRemoteTargetActive()) {
              if (remoteTargetOffline()) return;
              const ms = remoteDurationMs();
              if (!ms) return; // no known duration - seek ui is hidden anyway
              void remoteSeek((pct / 100) * ms);
              return;
            }
            if (isRadio()) return; // live audio is not seekable
            handleSeek(pct);
          };
          const onVolumeChangeCb = (vol: number) => {
            if (isRemoteTargetActive()) {
              if (remoteTargetOffline()) return;
              void remoteSetVolume(vol);
              return;
            }
            setPlayerVolume(vol);
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
              if (!radioArtUrl()) {
                navigate("/radio");
                return;
              }
              void openRadioImageCarousel();
              return;
            }
            handlePlayerImageClick();
          };

          const onSongMetaClick = () => {
            if (!isRadio()) {
              const cs = currentSongData();
              if (!cs || !cs.album_id) return;
              setHighlightedSongId(cs.id);
              // scope to the song's origin remote, not the currently-active
              // one — queue items can come from any remote/local source.
              navigate(routes.albumOn(cs.remote_server_id ?? "local", cs.album_id));
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
            <>
              <Show
                when={
                  !videoMiniPlayerDismissed() &&
                  !isRadio() &&
                  currentVideoData() &&
                  // on linux the picture is in its own gstreamer window, so
                  // there is no element here to mirror
                  !isVideoWindowActive() &&
                  getVideoElement()
                }
              >
                {(el) => (
                  <VideoMiniPlayer
                    videoElement={el()}
                    onClose={() => setVideoMiniPlayerDismissed(true)}
                  />
                )}
              </Show>
              <PlayerBar
                song={barSong()}
                isPlaying={barIsPlaying()}
                isLoading={debouncedBarIsLoading()}
                mediaTransferProgress={mediaTransferProgress()}
                hasUpNext={isRadio() ? false : !!pendingUpNextSha256()}
                currentTime={barCurrentTime()}
                duration={barDuration()}
                volume={isRemoteTargetActive() ? remoteVolume() : volume()}
                queueOpen={queueOpen()}
                onPlayPause={onPlayPause}
                onPrevious={onPrev}
                onNext={onNext}
                onSeek={onSeekCb}
                onVolumeChange={onVolumeChangeCb}
                onQueueToggle={handleQueueToggle}
                onFavoriteToggle={onFavToggle}
                onImageClick={onImageClick}
                onSongMetaClick={onSongMetaClick}
                queueLength={appState()?.queue.length || 0}
                canGoNext={
                  isRadio()
                    ? canAdminSkipRadioTrack()
                    : isRemoteTargetActive()
                      ? remoteQueue().length > remoteOptimisticCurrentIndex() + 1
                      : canGoNext()
                }
                canGoPrevious={isRadio() || isRemoteTargetActive() ? false : canGoPrevious()}
                showNext={!isRadio() || canAdminSkipRadioTrack()}
                showPrevious={!isRadio()}
                statusBadge={statusBadge()}
                isLiveStream={barIsLiveStream()}
                showExternalStorageIcon={externalStorageMounted()}
                externalStorageBusy={externalStorageSyncingSignal()}
                externalStorageProgress={externalStorageSyncProgressSignal()}
                onExternalStorageIconClick={() => navigate("/storage-overview")}
                activeTargetIsRemote={isRemoteTargetActive()}
                isVideoActive={!isRadio() && !!currentVideoData()}
                videoElement={
                  !isRadio() && currentVideoData() && !isVideoWindowActive()
                    ? getVideoElement()
                    : null
                }
                video={!isRadio() ? barVideo() : null}
                isVideoFavorite={isCurrentVideoFavorite()}
                onVideoFavoriteToggle={handleVideoFavoriteToggle}
              />
            </>
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
        onSuccess={(remote) => {
          debug("AppLayout", "remote added successfully");
          // reload remotes, switch source to the new remote, and
          // route to its default page.
          void (async () => {
            const allRemotes = await getAllRemotes();
            setRemotes(allRemotes);

            const result = await connectToRemote(remote.remote_id, { skipHealthCheck: true });
            if (result.success) {
              navigate(getDefaultRoute(remote.remote_id));
              queryClient.invalidateQueries();
            }
          })();
        }}
      />

      {/* connection progress modal (appears when connecting takes >1s) */}
      <ConnectionProgressModal state={connectionProgress()} onCancel={() => cancelConnection()} />

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
        items={playlistSelectorState().items}
        remote={playlistSelectorState().remote}
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
