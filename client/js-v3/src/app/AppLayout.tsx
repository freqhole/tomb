// main app layout with navigation, content area, and player bar
import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createSignal, onMount, Show, type JSX } from "solid-js";
import { AddRemoteModal } from "../components/modals/AddRemoteModal";
import { TopNav } from "../components/navigation/TopNav";
import { PlayerBar } from "../components/player/PlayerBar";
import { QueueSidebar } from "../components/player/QueueSidebar";
import { getCurrentRemote, useLocalSource } from "../music/data";
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
  setActiveRemote,
} from "../music/services/remotes/remoteManager";
import { getSongById } from "../music/services/storage/db";
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
  const [currentSongData, setCurrentSongData] = createSignal<Song | null>(null);
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
      window.location.reload();
    } catch (error) {
      console.error("failed to switch to local:", error);
    }
  };

  // handle switching to remote source
  const handleSwitchToRemote = async (remoteId: string) => {
    try {
      await setActiveRemote(remoteId);
      window.location.reload();
    } catch (error) {
      console.error("failed to switch to remote:", error);
    }
  };

  const currentRemote = getCurrentRemote();
  const currentSourceName = () =>
    currentRemote ? currentRemote.name : "local library";

  // watch for current song changes and load song data
  createEffect(async () => {
    const state = appState();
    if (state?.current_song_id) {
      const song = await getSongById(state.current_song_id);
      setCurrentSongData(song || null);
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
              id: song.song_id,
              title: song.title,
              artist: song.artist_name,
              duration: song.duration,
            })) || []) as any[]
          }
          currentIndex={
            appState()?.current_song_id
              ? appState()!.queue.findIndex(
                  (s) => s.song_id === appState()!.current_song_id,
                )
              : -1
          }
          onClose={async () => await setQueueOpen(false)}
          onSongClick={async (index) => {
            const state = appState();
            if (state?.queue[index]) {
              await playSong(state.queue[index].song_id);
            }
          }}
          onSongDoubleClick={async (index) => {
            const state = appState();
            if (state?.queue[index]) {
              await playSong(state.queue[index].song_id);
            }
          }}
          onRemoveSong={async (index) => {
            const state = appState();
            if (state?.queue) {
              const removedSong = state.queue[index];
              const newQueue = state.queue.filter((_, i) => i !== index);
              await setQueue(newQueue);

              // if we removed the currently playing song, stop playback and clear it
              if (removedSong.song_id === state.current_song_id) {
                stop();
                await setCurrentSong(null);
              }
            }
          }}
          onClearAll={async () => {
            // stop playback and clear current song
            stop();
            await setCurrentSong(null);
            await setQueue([]);
          }}
        />
      </div>

      {/* player bar */}
      <Show when={(appState()?.queue.length || 0) > 0}>
        <PlayerBar
          song={
            currentSongData()
              ? {
                  id: currentSongData()!.song_id,
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
        onSuccess={async () => {
          console.log("remote added successfully");
          // reload remotes list
          const allRemotes = await getAllRemotes();
          setRemotes(allRemotes);
        }}
      />
    </div>
  );
}
