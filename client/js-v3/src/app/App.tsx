import { Show, createEffect, createSignal, onMount } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { AddMusicModal } from "../components/modals/AddMusicModal";
import { PlayerBar } from "../components/player/PlayerBar";
import { QueueSidebar } from "../components/player/QueueSidebar";
import { getDataSource } from "../music/data";
import {
  canGoNext,
  canGoPrevious,
  currentTime,
  duration,
  isLoading,
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
import { getSongById, initMusicDB } from "../music/services/storage/db";
import type { Song } from "../music/services/storage/types";
import { LibraryView } from "../music/views/LibraryView";
import { importMusicFiles } from "./services/fileImport";

import {
  appState,
  initAppDB,
  setCurrentSong,
  setQueue,
  setQueueOpen,
} from "./services/storage/db";

export function App() {
  const [isAddMusicOpen, setIsAddMusicOpen] = createSignal(false);
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [currentSongData, setCurrentSongData] = createSignal<Song | null>(null);
  const [hasSongs, setHasSongs] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [showLoading, setShowLoading] = createSignal(false);

  // queue open state (synced with persisted state)
  const queueOpen = () => appState()?.queue_open ?? false;

  // initialize databases on mount
  onMount(async () => {
    // show loading indicator after 1 second if still initializing
    const loadingTimer = setTimeout(() => {
      setShowLoading(true);
    }, 1000);

    try {
      await initAppDB();
      await initMusicDB();

      // check if we have any songs
      const source = getDataSource();
      const result = await source.getSongs({ limit: 1 });
      setHasSongs(result.total > 0);
    } finally {
      clearTimeout(loadingTimer);
      setIsInitializing(false);
      setShowLoading(false);
    }
  });

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

  const handleFilesSelected = async (files: FileList) => {
    setIsProcessing(true);
    try {
      const result = await importMusicFiles(files);
      if (result.addedCount > 0) {
        setHasSongs(true);
        // refresh the library view by re-checking songs
        const source = getDataSource();
        await source.getSongs({ limit: 1 });
      }
      setIsAddMusicOpen(false);
    } catch (error) {
      console.error("failed to process files:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUrlsSubmitted = (urls: string[]) => {
    console.log("urls submitted:", urls);
    // TODO: download and add to library
    setIsAddMusicOpen(false);
  };

  const handleSongDoubleClick = async (song: Song) => {
    // add song to end of queue and play it
    const state = appState();
    const currentQueue = state?.queue || [];

    // add to end of queue if not already there
    if (!currentQueue.some((s) => s.song_id === song.song_id)) {
      const newQueue = [...currentQueue, song];
      await setQueue(newQueue);
    }

    // play the clicked song
    await playSong(song.song_id);
  };

  const handleSeek = (percentage: number) => {
    const dur = duration();
    const timeInSeconds = (percentage / 100) * dur;
    seek(timeInSeconds);
  };

  return (
    <div
      class="h-screen flex flex-col bg-[var(--color-bg-primary)]"
      style={{
        "--player-bar-height":
          (appState()?.queue.length || 0) > 0 ? "80px" : "0px",
      }}
    >
      <div
        class="flex-1 overflow-hidden flex"
        style={{ "padding-bottom": "var(--player-bar-height)" }}
      >
        <div class="flex-1 overflow-hidden">
          <Show
            when={isInitializing()}
            fallback={
              <Show
                when={!hasSongs()}
                fallback={
                  <LibraryView
                    onAddMusic={() => setIsAddMusicOpen(true)}
                    onSongDoubleClick={handleSongDoubleClick}
                  />
                }
              >
                <EmptyState onAddMusic={() => setIsAddMusicOpen(true)} />
              </Show>
            }
          >
            <Show when={showLoading()}>
              <div class="flex items-center justify-center h-full">
                <p class="text-[var(--color-text-secondary)]">loading...</p>
              </div>
            </Show>
          </Show>
        </div>

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
          onClose={() => setQueueOpen(false)}
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

      <AddMusicModal
        isOpen={isAddMusicOpen()}
        onClose={() => setIsAddMusicOpen(false)}
        onFilesSelected={handleFilesSelected}
        onUrlsSubmitted={handleUrlsSubmitted}
      />

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
          isLoading={isLoading()}
          currentTime={currentTime()}
          duration={duration()}
          volume={volume()}
          queueOpen={queueOpen()}
          onPlayPause={togglePlayback}
          onPrevious={playPrevious}
          onNext={playNext}
          onSeek={handleSeek}
          onVolumeChange={setPlayerVolume}
          onQueueToggle={() => setQueueOpen(!queueOpen())}
          queueLength={appState()?.queue.length || 0}
          canGoNext={canGoNext()}
          canGoPrevious={canGoPrevious()}
        />
      </Show>
    </div>
  );
}

export default App;
