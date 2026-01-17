import { Show, createEffect, createSignal, onMount } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { AddMusicModal } from "../components/modals/AddMusicModal";
import { PlayerBar } from "../components/player/PlayerBar";
import {
  currentTime,
  duration,
  isPlaying,
  playNext,
  playPrevious,
  playQueue,
  setPlayerVolume,
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
import { appState, initAppDB } from "./services/storage/db";

export function App() {
  const [isAddMusicOpen, setIsAddMusicOpen] = createSignal(false);
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [currentSongData, setCurrentSongData] = createSignal<MusicSong | null>(
    null,
  );

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
      // process files one at a time to avoid race conditions
      const fileArray = Array.from(files);
      for (const file of fileArray) {
        const metadata = await processMusicFiles([file]);
        if (metadata.length > 0) {
          await addSong({
            ...metadata[0],
            id: generateUUID(),
          });
        }
      }

      console.log(`added ${fileArray.length} songs to library`);
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
    // play this song and queue all songs
    const allSongIds = songs().map((s) => s.id);
    await playQueue(allSongIds);
  };

  const handleSeek = (percentage: number) => {
    const dur = duration();
    const timeInSeconds = (percentage / 100) * dur;
    const audio = document.querySelector("audio");
    if (audio) {
      audio.currentTime = timeInSeconds;
    }
  };

  return (
    <div
      class="h-screen flex flex-col bg-[var(--color-bg-primary)]"
      style={{
        "--player-bar-height": appState()?.current_song_id ? "80px" : "0px",
      }}
    >
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

      <AddMusicModal
        isOpen={isAddMusicOpen()}
        onClose={() => setIsAddMusicOpen(false)}
        onFilesSelected={handleFilesSelected}
        onUrlsSubmitted={handleUrlsSubmitted}
      />

      {/* player bar */}
      <Show when={currentSongData()}>
        {(song) => (
          <PlayerBar
            song={{
              id: song().id,
              title: song().title,
              artist: song().artist,
              album: song().album,
              isFavorite: false,
            }}
            isPlaying={isPlaying()}
            currentTime={currentTime()}
            duration={duration()}
            volume={volume()}
            queueOpen={false}
            onPlayPause={togglePlayback}
            onPrevious={playPrevious}
            onNext={playNext}
            onSeek={handleSeek}
            onVolumeChange={setPlayerVolume}
            onQueueToggle={() => console.log("queue toggle")}
            queueLength={appState()?.queue.length || 0}
          />
        )}
      </Show>
    </div>
  );
}

export default App;
