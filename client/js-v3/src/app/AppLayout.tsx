// main app layout with navigation, content area, and player bar
import { useLocation, useNavigate } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
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
  useLocalSource,
  useRemoteSource,
} from "../music/data";
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
import {
  deactivateAllRemotes,
  getAllRemotes,
  getRemoteById,
  setActiveRemote,
} from "../music/services/remotes/remoteManager";
import type { Remote, Song } from "../music/services/storage/types";
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [currentSongData, setCurrentSongData] = createSignal<Song | null>(null);
  const [isQueueOpen, setIsQueueOpen] = createSignal(false);
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [remotes, setRemotes] = createSignal<Remote[]>([]);

  // load remotes on mount
  onMount(async () => {
    try {
      const allRemotes = await getAllRemotes();
      setRemotes(allRemotes);
    } catch (error) {
      console.error("failed to load remotes:", error);
    }
  });

  // handle switching to local source
  const handleSwitchToLocal = async () => {
    try {
      await deactivateAllRemotes();
      useLocalSource();
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
      // switch data source to remote
      const remote = await getRemoteById(remoteId);
      if (remote) {
        useRemoteSource(remote.remote_id, remote.name, remote.base_url);
        // invalidate all queries to refetch from remote source
        queryClient.invalidateQueries();
      }
    } catch (error) {
      console.error("failed to switch to remote:", error);
    }
  };

  const currentSourceName = createMemo(() => {
    const remote = getCurrentRemote();
    return remote ? remote.name : "local library";
  });

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
      } else {
        // fallback: fetch from current data source
        void (async () => {
          const dataSource = getDataSource();
          const song = await dataSource.getSongById(state.current_sha256);
          setCurrentSongData(song || null);
        })();
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
        currentSourceName={currentSourceName()}
        remotes={remotes().map((r) => ({
          id: r.remote_id,
          name: r.name,
          url: r.base_url,
        }))}
        onSwitchToLocal={handleSwitchToLocal}
        onSwitchToRemote={handleSwitchToRemote}
        onAddRemote={() => setIsAddRemoteOpen(true)}
        mainNavSections={[
          {
            items: [
              {
                label: "songs",
                onClick: () => navigate("/songs"),
              },
              {
                label: "albums",
                onClick: () => navigate("/albums"),
              },
              {
                label: "artists",
                onClick: () => navigate("/artists"),
              },
              {
                label: "genres",
                onClick: () => navigate("/genres"),
              },
              {
                label: "playlists",
                onClick: () => navigate("/playlists"),
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
          songs={
            (appState()?.queue.map((song) => ({
              id: song.sha256,
              title: song.title,
              artist: song.artist_name,
              duration: song.duration_seconds,
            })) || []) as any[]
          }
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
        />
      </div>

      {/* player bar */}
      <Show when={(appState()?.queue.length || 0) > 0}>
        <PlayerBar
          song={
            currentSongData()
              ? {
                  id: currentSongData()!.sha256,
                  title: currentSongData()!.title,
                  artist: currentSongData()!.artist_name,
                  album: currentSongData()!.album_title,
                  isFavorite: false,
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
