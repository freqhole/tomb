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
import { TopNav } from "../components/navigation/TopNav";
import type { ViewOption } from "../components/navigation/ViewSelector";
import { PlayerBar } from "../components/player/PlayerBar";
import { QueueSidebar } from "../components/player/QueueSidebar";
import { getCurrentRemote, getDataSource } from "../music/data";
import { useRouteDataSource } from "../music/hooks/useRouteDataSource";
import { useToggleFavoriteMutation } from "../music/queries/favorites";
import { useRecentPlaylistsQuery } from "../music/queries/playlists";
import {
  currentTime,
  duration,
  isPlaying,
  playNext,
  playPrevious,
  playSong,
  seek,
  setPlayerVolume,
  stop,
  togglePlayback,
  volume,
} from "../music/services/audio/player";
import {
  canGoNext,
  canGoPrevious,
  clearQueue,
  removeFromQueue,
  reorderQueue,
} from "../music/services/audio/queue";
import { useSongContextMenu } from "../music/hooks/contextMenu";
import {
  deactivateAllRemotes,
  getAllRemotes,
  setActiveRemote,
} from "./services/remotes/remoteManager";
import type { Song } from "../music/services/storage/types";
import type { Remote } from "./services/storage/types";
import { routes } from "../music/utils/routing";
import { confirmState, closeConfirm, resolveConfirm } from "./services/confirmState";
import { playlistSelectorState, closePlaylistSelector } from "../music/hooks/playlistSelectorState";
import { showImageCarousel } from "../music/modals";
import { appState, setCurrentSong, setQueueOpen } from "./services/storage/db";
import { getPageInfo } from "./services/pageInfo";

// responsive breakpoint
const NARROW_BREAKPOINT = 768;

interface AppLayoutProps {
  children?: JSX.Element;
}

export function AppLayout(props: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [currentSongData, setCurrentSongData] = createSignal<Song | null>(null);
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  // const [isQueueOpen, setIsQueueOpen] = createSignal(false);
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [storageUsage, setStorageUsage] = createSignal<number>(0);
  const [storageQuota, setStorageQuota] = createSignal<number>(0);

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false
  );

  // automatically switch data source based on route context
  const routeContext = useRouteDataSource();

  // fetch recent playlists (contextual to current data source)
  const recentPlaylistsQuery = useRecentPlaylistsQuery(5);

  // load remotes and storage info on mount
  onMount(async () => {
    // handle resize for narrow viewport detection
    const handleResize = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));

    try {
      const allRemotes = await getAllRemotes();
      setRemotes(allRemotes);
    } catch (error) {
      console.error("failed to load remotes:", error);
    }

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
    return () => clearInterval(interval);
  });

  // handle switching to local source
  const handleSwitchToLocal = async () => {
    try {
      await deactivateAllRemotes();
      // navigate to local route - useRouteDataSource hook will switch data source
      navigate("/local/songs");
      // invalidate all queries to refetch from local source
      queryClient.invalidateQueries();
    } catch (error) {
      console.error("failed to switch to local:", error);
    }
  };

  // handle switching to remote source
  const handleSwitchToRemote = async (remoteId: string) => {
    try {
      await setActiveRemote(remoteId);
      // navigate to remote route - useRouteDataSource hook will switch data source
      navigate(`/${remoteId}/songs`);
      // invalidate all queries to refetch from remote source
      queryClient.invalidateQueries();
    } catch (error) {
      console.error("failed to switch to remote:", error);
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
  const handlePlayerImageClick = () => {
    const song = currentSongData();
    if (!song) return;

    const imageMap = new Map<string, string>();

    // add song images (except waveforms), deduplicate by blob_id
    if (song.images?.length) {
      for (const img of song.images) {
        if (img.blob_type !== "waveform") {
          const blobId = img.remote_blob_id || img.local_blob_id;
          const url = img.remote_url || img.local_blob_id;
          if (blobId && url) imageMap.set(blobId, url);
        }
      }
    }

    // add album images (except waveforms), deduplicate by blob_id
    if (song.album_images?.length) {
      for (const img of song.album_images) {
        if (img.blob_type !== "waveform") {
          const blobId = img.remote_blob_id || img.local_blob_id;
          const url = img.remote_url || img.local_blob_id;
          if (blobId && url) imageMap.set(blobId, url);
        }
      }
    }

    const imageUrls = Array.from(imageMap.values());

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

  // build view options for the TopNav view selector
  const viewOptions = (): ViewOption[] => {
    const prefix = routeContext.isLocal() ? "/local" : `/${routeContext.remoteId()}`;
    return [
      { label: "songs", path: `${prefix}/songs` },
      { label: "albums", path: `${prefix}/albums` },
      { label: "artists", path: `${prefix}/artists` },
      { label: "genres", path: `${prefix}/genres` },
      { label: "playlists", path: `${prefix}/playlists` },
      { label: "favorites", path: `${prefix}/favorites` },
    ];
  };

  return (
    <div
      class="h-screen flex flex-col bg-[var(--color-bg-primary)]"
      style={{
        "--player-bar-height": (appState()?.queue.length || 0) > 0 ? "80px" : "0px",
      }}
    >
      {/* top navigation */}
      <TopNav
        brandName="freqhole"
        brandTagline="get yr freq on."
        searchPlaceholder="search artists, albums, songs..."
        onSearchChange={(query) => console.log("search:", query)}
        onSearchSubmit={(query) => console.log("search submit:", query)}
        onNavigate={(path) => navigate(path)}
        currentPath={location.pathname + location.search}
        currentSourceName={currentSourceName()}
        remotes={remotes().map((r) => ({
          id: r.remote_id,
          name: r.name,
          url: r.base_url,
          imageUrl: r.image_url,
        }))}
        onSwitchToLocal={handleSwitchToLocal}
        onSwitchToRemote={handleSwitchToRemote}
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
        queueOpen={queueOpen()}
        onQueueToggle={handleQueueToggle}
        queueLength={appState()?.queue.length || 0}
        pageTitle={getPageInfo().title}
        pageCount={getPageInfo().count}
        viewOptions={viewOptions()}
        mainNavSections={[
          {
            items: [
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
          onClose={() => void setQueueOpen(false)}
          onSongClick={(index) => {
            const state = appState();
            if (state?.queue[index]) {
              void playSong(state.queue[index]);
            }
          }}
          onSongDoubleClick={(index) => {
            const state = appState();
            if (state?.queue[index]) {
              void playSong(state.queue[index]);
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
          getContextMenuActions={(index, queueSong) => {
            const state = appState();
            if (!state?.queue[index]) return [];

            const fullSong = state.queue[index];
            return useSongContextMenu(fullSong, {
              showPlayActions: false, // already in queue, no need for play actions
              isFavorite: fullSong.is_favorite || false,
            });
          }}
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
                  artist: currentSongData()!.artist_name,
                  album: currentSongData()!.album_title,
                  images: currentSongData()!.images,
                  album_images: currentSongData()!.album_images,
                  isFavorite: currentSongData()!.is_favorite || false,
                }
              : undefined
          }
          isPlaying={isPlaying()}
          isLoading={false}
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
          hideQueueToggle={isNarrow()}
          canGoNext={canGoNext()}
          canGoPrevious={canGoPrevious()}
        />
      </Show>

      {/* add remote modal */}
      <AddRemoteModal
        isOpen={isAddRemoteOpen()}
        onClose={() => setIsAddRemoteOpen(false)}
        onSuccess={() => {
          console.log("remote added successfully");
          // reload remotes list
          void (async () => {
            const allRemotes = await getAllRemotes();
            setRemotes(allRemotes);
          })();
        }}
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
