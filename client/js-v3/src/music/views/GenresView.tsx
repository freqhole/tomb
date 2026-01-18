// genres view - displays all genres in a list
import { createResource, Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import { getDataSource } from "../data";
import { songsVersion } from "../services/storage/db";

export interface GenresViewProps {
  onAddMusic: () => void;
  onGenreClick?: (genreId: string) => void;
}

export function GenresView(props: GenresViewProps) {
  // fetch genres from data source - refetch when songsVersion changes
  const [genresData] = createResource(songsVersion, async () => {
    const source = getDataSource();
    // TODO: implement getGenres in data source
    // for now, return empty
    return { items: [], total: 0, offset: 0, limit: 50, has_more: false };
  });

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            genres
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {genresData()?.total ?? 0}{" "}
            {genresData()?.total === 1 ? "genre" : "genres"}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* genre list */}
      <div class="flex-1 overflow-auto p-4">
        <Show
          when={(genresData()?.total ?? 0) > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
              <div class="text-center max-w-md">
                <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                  no genres in your library yet
                </p>
                <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                  click "add music" above to import local audio files or
                  download from urls
                </p>
                <Button variant="primary" onClick={props.onAddMusic}>
                  add music
                </Button>
              </div>
            </div>
          }
        >
          <div class="text-[var(--color-text-secondary)]">
            genre list coming soon
          </div>
        </Show>
      </div>
    </div>
  );
}
