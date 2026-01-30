import { createResource, Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { VirtualSongList } from "../../components/virtualized/VirtualSongList";
import { getDataSource } from "../data";
import type { Song } from "../data/types";

export interface LibraryViewProps {
  onAddMusic: () => void;
  onSongClick?: (song: Song) => void;
  onSongDoubleClick?: (song: Song) => void;
}

export function LibraryView(props: LibraryViewProps) {
  // fetch songs from data source
  const [songsData] = createResource(async () => {
    const source = getDataSource();
    return source.getSongs({
      limit: 1000,
      sort_by: "added_at",
      sort_direction: "desc",
    });
  });

  const songs = () => songsData()?.items ?? [];

  const handleSongClick = (song: Song, _index: number) => {
    props.onSongClick?.(song);
  };

  const handleSongDoubleClick = (song: Song, _index: number) => {
    props.onSongDoubleClick?.(song);
    console.log("play song:", song.title);
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <HeadingSection
        title="music library"
        count={songsData()?.total ?? 0}
        countLabel={songsData()?.total === 1 ? "song" : "songs"}
        loading={songsData.loading}
        actions={
          <Button variant="primary" onClick={props.onAddMusic}>
            add music
          </Button>
        }
      />

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
