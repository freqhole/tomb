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
import { ToastRegion } from "../components/feedback/Toast";
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
import { getLoadingSongIds, isSongSyncedLocally } from "../music/services/download";
import {
  getLoadingP2PSongIds,
  preCacheRemoteTransport,
  resolveBlobUrl,
  usesBlobResolver,
} from "../music/services/storage/blobResolver";
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
  onRemoteStatusChange,
  onSwitchToLocal,
} from "./services/remotes/remoteManager";
import type { Song } from "../music/services/storage/types";
import {
  type Remote,
  type QueueHistoryEntry,
  isHttpRemote,
  isP2PRemote,
} from "./services/storage/types";
import type { MenuAction } from "../components/overlays/ContextMenu";
import { IconNames, type IconName } from "../components/icons/registry";
import { routes, matchRoute, getDefaultRoute, hasFeedView } from "../music/utils/routing";
import { confirmState, closeConfirm, resolveConfirm, confirm } from "./services/confirmState";
import { playlistSelectorState, closePlaylistSelector } from "../music/hooks/playlistSelectorState";
import { showImageCarousel, openAddMusic } from "../music/hooks/modals";
import { appState, setCurrentSong, setQueueOpen } from "./services/storage/db";
import { getPageInfo } from "./services/pageInfo";
import {
  queueHistory,
  loadQueueHistory,
  removeHistoryEntry,
  clearQueueHistory,
} from "../music/services/queue/queueHistory";
import { addToQueue, resumeHistoryEntry } from "../music/services/queue/queue";
import { loadProgressFromStorage, progressMap } from "../music/services/queue/queueProgress";
import { startAnalyticsSync, stopAnalyticsSync } from "../music/services/analytics/analyticsQueue";
import { reconnectProgressTracking } from "../music/services/queue/listenProgress";
import { isCharnelMode, setWindowTitle } from "./services/charnel";
import { checkAndShowConfigUpgradeToast } from "./services/toastNotices";
import { debug } from "../utils/logger";
import { isNarrowViewport } from "../config/breakpoints";
import { getBackgroundConfig } from "./services/backgroundImage";

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
        "--player-bar-height": (appState()?.queue.length || 0) > 0 ? "var(--player-height)" : "0px",
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
              // feed is only available when hasFeedView() is true (remotes + Tauri local)
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
              {
                label: "gossip",
                onClick: () => {
                  navigate("/gossip");
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
        />
      </div>

      {/* player bar */}
      <Show when={(appState()?.queue.length || 0) > 0}>
        <PlayerBar
          song={
            currentSongData()
              ? {
                  id: currentSongData()!.id,
                  sha256: currentSongData()!.sha256,
                  title: currentSongData()!.title,
                  artist:
                    currentSongData()!.album_type === "compilation" &&
                    currentSongData()!.track_artist?.trim()
                      ? currentSongData()!.track_artist!
                      : currentSongData()!.artist_name,
                  album: currentSongData()!.album_title,
                  images: currentSongData()!.images,
                  album_images: currentSongData()!.album_images,
                  isFavorite: currentSongData()!.is_favorite || false,
                }
              : undefined
          }
          isPlaying={isPlaying()}
          isLoading={isLoading()}
          hasUpNext={!!pendingUpNextSha256()}
          currentTime={currentTime()}
          duration={duration()}
          volume={volume()}
          queueOpen={queueOpen()}
          onPlayPause={togglePlayback}
          onPrevious={playPrevious}
          onNext={playNext}
          onSeek={handleSeek}
          onVolumeChange={setPlayerVolume}
          onQueueToggle={handleQueueToggle}
          onFavoriteToggle={handleSongFavoriteToggle}
          onImageClick={handlePlayerImageClick}
          queueLength={appState()?.queue.length || 0}
          canGoNext={canGoNext()}
          canGoPrevious={canGoPrevious()}
        />
      </Show>

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

      {/* toast notifications */}
      <Portal>
        <ToastRegion />
      </Portal>
    </div>
  );
}
