import { For, Show } from "solid-js";
import type { GenreStat } from "../../../../../../lib/music/schemas/genre";

interface GenreListProps {
  genres: GenreStat[];
  loading?: boolean;
  selectedGenre?: GenreStat | null;
  onGenreClick: (genre: GenreStat) => void;
  onGenreDoubleClick: (genre: GenreStat) => void;
  sortField: string;
  sortDirection: "asc" | "desc";
  class?: string;
}

export function GenreList(props: GenreListProps) {
  // Format duration from seconds to readable string
  const formatDuration = (seconds: number): string => {
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      return `${mins}m`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  // Format count with abbreviations
  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  return (
    <div class={`flex flex-col h-full ${props.class || ""}`}>
      <div class="flex-1 overflow-y-auto">
        <Show
          when={props.genres.length > 0}
          fallback={
            <Show when={!props.loading}>
              <div class="p-6 text-center text-gray-400">
                <p class="text-sm">no genres found</p>
              </div>
            </Show>
          }
        >
          <For each={props.genres}>
            {(genre) => (
              <div
                class={`
                  px-6 py-3 border-b border-gray-800/50 cursor-pointer
                  hover:bg-gray-900/50 transition-colors
                  ${
                    props.selectedGenre?.name === genre.name
                      ? "bg-magenta-900/20 border-magenta-800/50"
                      : ""
                  }
                `}
                onClick={() => props.onGenreClick(genre)}
                onDblClick={() => props.onGenreDoubleClick(genre)}
              >
                <div class="flex items-center justify-between">
                  <div class="flex-1 min-w-0">
                    <h3 class="text-white font-medium text-sm truncate">
                      {genre.name}
                    </h3>
                    <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>{formatCount(genre.song_count)} songs</span>
                      <span>{formatCount(genre.artist_count)} artists</span>
                      <span>{formatCount(genre.album_count)} albums</span>
                    </div>
                  </div>
                  <div class="flex-shrink-0 ml-3">
                    <div class="text-xs text-gray-500">
                      {formatDuration(genre.total_duration)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </Show>

        <Show when={props.loading}>
          <div class="p-6 text-center">
            <div class="text-gray-400 text-sm">loading more genres...</div>
          </div>
        </Show>
      </div>
    </div>
  );
}
