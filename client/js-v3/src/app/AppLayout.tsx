// main app layout with navigation, content area, and player bar
import { useLocation, useNavigate } from "@solidjs/router";
import { createEffect, createSignal, Show, type JSX } from "solid-js";
import { TopNav } from "../components/navigation/TopNav";
import { PlayerBar } from "../components/player/PlayerBar";
import { QueueSidebar } from "../components/player/QueueSidebar";
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
import { getSongById } from "../music/services/storage/db";
import type { Song } from "../music/services/storage/types";
import {
  appState,
  setCurrentSong,
  setQueue,
  setQueueOpen,
} from "./services/storage/db";

interface AppLayoutProps {
  children: JSX.Element;
}

export function AppLayout(props: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentSongData, setCurrentSongData] = createSignal<Song | null>(null);

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
    </div>
  );
}
