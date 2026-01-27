// main app layout with navigation, content area, and player bar
import { useLocation, useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
  untrack,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { ToastRegion } from "../components/feedback/Toast";
import { AddRemoteModal } from "../components/modals/AddRemoteModal";
import { TopNav } from "../components/navigation/TopNav";
import { PlayerBar } from "../components/player/PlayerBar";
import { QueueSidebar } from "../components/player/QueueSidebar";
import {
  getCurrentRemote,
  getDataSource,
} from "../music/data";
import { useRouteDataSource } from "../music/hooks/useRouteDataSource";
import { useToggleFavoriteMutation } from "../music/queries/favorites";
import { useRecentPlaylistsQuery } from "../music/queries/playlists";
import {
  canGoNext,
  canGoPrevious,
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
import { useSongContextMenu } from "../music/services/contextMenu";
import {
  deactivateAllRemotes,
  getAllRemotes,
  getRemoteById,
  setActiveRemote,
} from "../music/services/remotes/remoteManager";
import type { Remote, Song } from "../music/services/storage/types";
import { routes } from "../music/utils/routing";
import {
  appState,
  setCurrentSong,
  setQueue,
  setQueueOpen,
} from "./services/storage/db";

interface AppLayoutProps {
  children?: JSX.Element;
}

export function AppLayout(props: AppLayoutProps) {
  const navigate = useNavigate();
  // const location = useLocation();
  const queryClient = useQueryClient();
  const [currentSongData, setCurrentSongData] = createSignal<Song | null>(null);
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  // const [isQueueOpen, setIsQueueOpen] = createSignal(false);
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [storageUsage, setStorageUsage] = createSignal<number>(0);
  const [storageQuota, setStorageQuota] = createSignal<number>(0);

  // automatically switch data source based on route context
  const routeContext = useRouteDataSource();

  // fetch recent playlists (contextual to current data source)
  const recentPlaylistsQuery = useRecentPlaylistsQuery(5);

  // helper to get thumbnail URL for a song
  // songs are enriched with thumbnail_url in queries
  const getSongThumbnailUrl = (song: Song): string | undefined => {
    return song.thumbnail_url || undefined;
  };

  // load remotes and storage info on mount
  onMount(async () => {
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
      const songInQueue = state.queue.find(
        (s) => s.sha256 === state.current_sha256,
      );
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

  const handleQueueToggle = async () => {
    await setQueueOpen(!queueOpen());
  };

  return (
    <div
      class="h-screen flex flex-col bg-[var(--color-bg-primary)]"
      style={{
        "--player-bar-height":
          (appState()?.queue.length || 0) > 0 ? "80px" : "0px",
      }}
    >
      {/* top navigation */}
      <TopNav
        brandName="freqhole"
        brandTagline="your music library"
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
            thumbnailUrl: playlist.thumbnail_url || undefined,
            updatedAt: playlist.updated_at,
            onClick: () => handlePlaylistClick(playlist.playlist_id),
          })) || []
        }
        onViewAllPlaylists={handleViewAllPlaylists}
        onCreatePlaylist={handleCreatePlaylist}
        mainNavSections={[
          {
            items: [
              {
                label: "songs",
                onClick: () => {
                  const prefix = routeContext.isLocal()
                    ? "/local"
                    : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/songs`);
                },
              },
              {
                label: "albums",
                onClick: () => {
                  const prefix = routeContext.isLocal()
                    ? "/local"
                    : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/albums`);
                },
              },
              {
                label: "artists",
                onClick: () => {
                  const prefix = routeContext.isLocal()
                    ? "/local"
                    : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/artists`);
                },
              },
              {
                label: "genres",
                onClick: () => {
                  const prefix = routeContext.isLocal()
                    ? "/local"
                    : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/genres`);
                },
              },
              {
                label: "playlists",
                onClick: () => {
                  const prefix = routeContext.isLocal()
                    ? "/local"
                    : `/${routeContext.remoteId()}`;
                  navigate(`${prefix}/playlists`);
                },
              },
              {
                label: "favorites",
                onClick: () => {
                  const prefix = routeContext.isLocal()
                    ? "/local"
                    : `/${routeContext.remoteId()}`;
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
        style={{ "padding-bottom": "var(--player-bar-height)" }}
      >
        <div class="flex-1 overflow-hidden">{props.children}</div>

        {/* queue sidebar */}
        <QueueSidebar
          isOpen={queueOpen()}
          variant="inline"
          songs={appState()?.queue || []}
          currentIndex={
            appState()?.current_sha256
              ? appState()!.queue.findIndex(
                  (s) => s.sha256 === appState()!.current_sha256,
                )
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
            const state = appState();
            if (state?.queue) {
              const removedSong = state.queue[index];
              const newQueue = state.queue.filter((_, i) => i !== index);
              void setQueue(newQueue);

              // if we removed the currently playing song, stop playback and clear it
              if (removedSong.sha256 === state.current_sha256) {
                stop();
                void setCurrentSong(null);
              }
            }
          }}
          onReorder={(fromIndex, toIndex) => {
            const state = appState();
            if (state?.queue) {
              const newQueue = [...state.queue];
              const [movedSong] = newQueue.splice(fromIndex, 1);
              newQueue.splice(toIndex, 0, movedSong);
              void setQueue(newQueue);
            }
          }}
          onClearAll={() => {
            // stop playback and clear current song
            stop();
            void setCurrentSong(null);
            void setQueue([]);
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
                  thumbnailUrl: getSongThumbnailUrl(currentSongData()!),
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
          console.log("remote added successfully");
          // reload remotes list
          void (async () => {
            const allRemotes = await getAllRemotes();
            setRemotes(allRemotes);
          })();
        }}
      />

      {/* toast notifications */}
      <Portal>
        <ToastRegion />
      </Portal>
    </div>
  );
}
