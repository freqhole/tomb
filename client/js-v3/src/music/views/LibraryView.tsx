import { createResource, Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import {
  VirtualSongList,
  type Song as VirtualSong,
} from "../../components/virtualized/VirtualSongList";
import { getDataSource } from "../data";
import { songsVersion } from "../services/storage/db";
import type { Song } from "../services/storage/types";

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
  // fetch songs from data source - refetch when songsVersion changes
  const [songsData] = createResource(songsVersion, async () => {
    console.log("LibraryView: fetching songs, version =", songsVersion());
    const source = getDataSource();
    const result = await source.getSongs({
      limit: 1000,
      sort_by: "added_at",
      sort_direction: "desc",
    });
    console.log("LibraryView: fetched", result.items.length, "songs");
    console.log("LibraryView: first song =", result.items[0]?.title);
    return result;
  });

  // convert storage songs to virtual song list format
  const virtualSongs = () => {
    const data = songsData();
    if (!data) return [];

    const mapped = data.items.map((song) => ({
      id: song.song_id,
      title: song.title,
      artist: song.artist_name,
      album: song.album_title,
      duration: formatDuration(song.duration),
      userIsFavorite: false,
      userRating: 0,
    }));

    console.log(
      "virtualSongs: mapped",
      mapped.length,
      "songs, first 3:",
      mapped.slice(0, 3).map((s) => ({ id: s.id, title: s.title })),
    );

    return mapped;
  };

  const handleSongClick = (virtualSong: VirtualSong) => {
    // find the actual song by id
    const song = songsData()?.items.find((s) => s.song_id === virtualSong.id);
    if (song) props.onSongClick?.(song);
  };

  const handleSongDoubleClick = (virtualSong: VirtualSong) => {
    // find the actual song by id
    const song = songsData()?.items.find((s) => s.song_id === virtualSong.id);
    if (song) {
      props.onSongDoubleClick?.(song);
      console.log("play song:", song.title);
    }
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
            {songsData()?.total ?? 0}{" "}
            {songsData()?.total === 1 ? "song" : "songs"}
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
