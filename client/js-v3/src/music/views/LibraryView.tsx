import { Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import {
  VirtualSongList,
  type Song,
} from "../../components/virtualized/VirtualSongList";
import { songs } from "../services/storage/db";

export interface LibraryViewProps {
  onAddMusic: () => void;
  onSongClick?: (song: Song) => void;
  onSongDoubleClick?: (song: Song) => void;
}

// format seconds to MM:SS
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function LibraryView(props: LibraryViewProps) {
  // convert music songs to virtual song list format
  const virtualSongs = () =>
    songs().map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: formatDuration(song.duration),
      userIsFavorite: false,
      userRating: 0,
    }));

  const handleSongClick = (song: Song) => {
    props.onSongClick?.(song);
  };

  const handleSongDoubleClick = (song: Song) => {
    props.onSongDoubleClick?.(song);
    console.log("play song:", song.title);
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            music library
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {songs().length} {songs().length === 1 ? "song" : "songs"}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* song list */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={virtualSongs().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <p class="text-[var(--color-text-secondary)]">no songs yet</p>
            </div>
          }
        >
          <VirtualSongList
            songs={virtualSongs()}
            height={window.innerHeight - 120}
            onSongClick={handleSongClick}
            onSongDoubleClick={handleSongDoubleClick}
          />
        </Show>
      </div>
    </div>
  );
}
