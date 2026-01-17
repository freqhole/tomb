import { Show, createEffect, createSignal, onMount } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { AddMusicModal } from "../components/modals/AddMusicModal";
import { PlayerBar } from "../components/player/PlayerBar";
import { QueueSidebar } from "../components/player/QueueSidebar";
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
import { processMusicFiles } from "../music/services/metadata/fileProcessor";
import {
  addSong,
  getSongById,
  initMusicDB,
  songs,
} from "../music/services/storage/db";
import type { MusicSong } from "../music/services/storage/types";
import { LibraryView } from "../music/views/LibraryView";
import { generateUUID } from "../utils/uuid";
import {
  appState,
  initAppDB,
  setCurrentSong,
  setQueue,
} from "./services/storage/db";

export function App() {
  const [isAddMusicOpen, setIsAddMusicOpen] = createSignal(false);
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [currentSongData, setCurrentSongData] = createSignal<MusicSong | null>(
    null,
  );
  const [queueOpen, setQueueOpen] = createSignal(false);

  // initialize databases on mount
  onMount(async () => {
    await initAppDB();
    await initMusicDB();
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
      const fileArray = Array.from(files);
      let addedCount = 0;
      let skippedCount = 0;

      // generate song ids upfront (needed for opfs storage)
      const songIds = fileArray.map(() => generateUUID());

      // process files with their ids
      const metadata = await processMusicFiles(fileArray, songIds);

      for (let i = 0; i < metadata.length; i++) {
        const songData = metadata[i];

        // check for duplicates - match on filename, file size, and last modified
        const isDuplicate = songs().some(
          (existing) =>
            existing.source_type === "local" &&
            existing.file_name === songData.file_name &&
            existing.file_size === songData.file_size &&
            existing.last_modified === songData.last_modified,
        );

        if (isDuplicate) {
          console.log(
            `skipping duplicate: ${songData.file_name} (${songData.file_size} bytes)`,
          );
          skippedCount++;
        } else {
          await addSong({
            ...songData,
            id: songIds[i],
          });
          addedCount++;
        }
      }

      console.log(
        `added ${addedCount} songs, skipped ${skippedCount} duplicates`,
      );
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

  const handleSongDoubleClick = async (songId: string) => {
    // add song to end of queue and play it
    const state = appState();
    const currentQueue = state?.queue || [];

    // add to end of queue if not already there
    if (!currentQueue.includes(songId)) {
      const newQueue = [...currentQueue, songId];
      await setQueue(newQueue);
    }

    // play the clicked song
    await playSong(songId);
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
            when={songs().length === 0}
            fallback={
              <LibraryView
                onAddMusic={() => setIsAddMusicOpen(true)}
                onSongDoubleClick={(song) => handleSongDoubleClick(song.id)}
              />
            }
          >
            <EmptyState onAddMusic={() => setIsAddMusicOpen(true)} />
          </Show>
        </div>

        {/* queue sidebar */}
        <QueueSidebar
          isOpen={queueOpen()}
          variant="inline"
          songs={
            (appState()
              ?.queue.map((songId) => {
                const song = songs().find((s) => s.id === songId);
                return song
                  ? {
                      id: song.id,
                      title: song.title,
                      artist: song.artist,
                      duration: song.duration,
                    }
                  : null;
              })
              .filter(Boolean) as any[]) || []
          }
          currentIndex={
            appState()?.current_song_id
              ? appState()!.queue.indexOf(appState()!.current_song_id)
              : -1
          }
          onClose={() => setQueueOpen(false)}
          onSongClick={async (index) => {
            const state = appState();
            if (state?.queue[index]) {
              await playSong(state.queue[index]);
            }
          }}
          onSongDoubleClick={async (index) => {
            const state = appState();
            if (state?.queue[index]) {
              await playSong(state.queue[index]);
            }
          }}
          onRemoveSong={async (index) => {
            const state = appState();
            if (state?.queue) {
              const removedSongId = state.queue[index];
              const newQueue = state.queue.filter((_, i) => i !== index);
              await setQueue(newQueue);

              // if we removed the currently playing song, stop playback and clear it
              if (removedSongId === state.current_song_id) {
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
                  id: currentSongData()!.id,
                  title: currentSongData()!.title,
                  artist: currentSongData()!.artist,
                  album: currentSongData()!.album,
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
