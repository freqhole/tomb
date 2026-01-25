import { createResource, Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import { VirtualSongList } from "../../components/virtualized/VirtualSongList";
import { getDataSource } from "../data";
import { songsVersion } from "../services/storage/db";
import type { Song } from "../services/storage/types";

export interface LibraryViewProps {
  onAddMusic: () => void;
  onSongClick?: (song: Song) => void;
  onSongDoubleClick?: (song: Song) => void;
}

export function LibraryView(props: LibraryViewProps) {
  // fetch songs from data source - refetch when songsVersion changes
  const [songsData] = createResource(songsVersion, async () => {
    const source = getDataSource();
    return source.getSongs({
      limit: 1000,
      sort_by: "added_at",
      sort_direction: "desc",
    });
  });

  const songs = () => songsData()?.items ?? [];

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
      <div class="flex items-center justify-between p-4">
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
          when={songs().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full">
              <p class="text-[var(--color-text-secondary)]">no songs yet</p>
            </div>
          }
        >
          <VirtualSongList
            songs={songs()}
            height={window.innerHeight - 120}
            onSongClick={handleSongClick}
            onSongDoubleClick={handleSongDoubleClick}
          />
        </Show>
      </div>
    </div>
  );
}
