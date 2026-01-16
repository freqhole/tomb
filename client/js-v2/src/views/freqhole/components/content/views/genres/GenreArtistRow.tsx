import { createSignal, createResource, Show, For } from "solid-js";
import { useReactiveActions } from "../../../../store";
import { GenreAlbumGrid } from "./GenreAlbumGrid";
import type { GenreArtist } from "../../../../../../lib/music/schemas/genre";

interface GenreArtistRowProps {
  artist: GenreArtist;
  genreName: string;
  genreSlug: string;
  forceExpanded?: boolean;
  class?: string;
}

export function GenreArtistRow(props: GenreArtistRowProps) {
  const reactiveActions = useReactiveActions();
  const [expanded, setExpanded] = createSignal(false);

  // Use forceExpanded or local expanded state
  const isExpanded = () => props.forceExpanded || expanded();

  // format duration helper
  const formatDuration = (seconds: number | string): string => {
    const secs = typeof seconds === "string" ? parseFloat(seconds) : seconds;
    if (isNaN(secs) || secs < 60) {
      return `${Math.floor(secs)}s`;
    }
    if (secs < 3600) {
      const mins = Math.floor(secs / 60);
      const remainSecs = Math.floor(secs % 60);
      return `${mins}:${remainSecs.toString().padStart(2, "0")}`;
    }
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  // format count helper
  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  // fetch albums when expanded
  const [albumsResource] = createResource(
    () =>
      isExpanded()
        ? { genreSlug: props.genreSlug, artist: props.artist.artist }
        : false,
    async (params) => {
      if (!params) return null;

      try {
        const result = await reactiveActions.searchGenres({
          genre_slug: params.genreSlug,
          artist: params.artist,
          page_size: 50,
        });

        if (result && "albums" in result) {
          return result.albums || [];
        }
        return [];
      } catch (error) {
        console.error("failed to fetch artist albums:", error);
        throw error;
      }
    }
  );

  const handleToggleExpand = () => {
    // Only allow manual toggle if not force expanded
    if (!props.forceExpanded) {
      setExpanded(!expanded());
    }
  };

  const albums = () => albumsResource() || [];
  const albumsLoading = () => albumsResource.loading;
  const albumsError = () => albumsResource.error;

  return (
    <div class={`border-b border-gray-800/50 ${props.class || ""}`}>
      {/* Artist header row */}
      <div
        class="px-6 py-4 hover:bg-gray-900/50 transition-colors cursor-pointer"
        onClick={handleToggleExpand}
      >
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3">
              {/* Expand/collapse chevron */}
              <div
                class={`text-gray-400 transition-transform duration-200 ${
                  isExpanded() ? "rotate-90" : ""
                }`}
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>

              {/* Artist info */}
              <div class="flex-1 min-w-0">
                <h3 class="text-white font-medium text-sm truncate">
                  {props.artist.artist}
                </h3>
                <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                  <span>
                    {formatCount(props.artist.song_count)} song
                    {props.artist.song_count !== 1 ? "s" : ""}
                  </span>
                  <span>
                    {formatCount(props.artist.album_count)} album
                    {props.artist.album_count !== 1 ? "s" : ""}
                  </span>
                  <span>{formatDuration(props.artist.total_duration)}</span>
                  <Show when={props.artist.avg_rating}>
                    <span>★ {props.artist.avg_rating!.toFixed(1)}</span>
                  </Show>
                  <Show when={props.artist.favorite_count > 0}>
                    <span>♥ {formatCount(props.artist.favorite_count)}</span>
                  </Show>
                </div>

                {/* Sub-genre tags - only show if different from main genre */}
                <Show
                  when={props.artist.genres && props.artist.genres.length > 1}
                >
                  <div class="mt-2">
                    <div class="flex flex-wrap gap-1">
                      <For
                        each={props.artist.genres
                          .filter((g) => g !== props.genreName)
                          .slice(0, 3)}
                      >
                        {(subGenre) => (
                          <span class="text-xs px-2 py-1 bg-gray-800 text-gray-300">
                            {subGenre}
                          </span>
                        )}
                      </For>
                      <Show
                        when={
                          props.artist.genres.filter(
                            (g) => g !== props.genreName
                          ).length > 3
                        }
                      >
                        <span class="text-xs text-gray-500">
                          +
                          {props.artist.genres.filter(
                            (g) => g !== props.genreName
                          ).length - 3}{" "}
                          more
                        </span>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>

          {/* Expand indicator */}
          <div class="flex-shrink-0 ml-3 text-xs text-gray-500">
            {isExpanded() ? "collapse" : "expand"}
          </div>
        </div>
      </div>

      {/* Expanded albums section */}
      <Show when={isExpanded()}>
        <div class="bg-gray-900/30 border-t border-gray-800/30">
          <Show when={albumsError()}>
            <div class="p-6 text-center">
              <div class="text-red-400 text-sm mb-2">failed to load albums</div>
              <button
                class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors"
                onClick={() => window.location.reload()}
              >
                try again
              </button>
            </div>
          </Show>

          <Show when={albumsLoading() && !albums().length}>
            <div class="p-6 text-center">
              <div class="text-gray-400 text-sm">loading albums...</div>
            </div>
          </Show>

          <Show
            when={!albumsError() && !albumsLoading() && albums().length === 0}
          >
            <div class="p-6 text-center text-gray-400">
              <p class="text-sm">no albums found for this artist</p>
            </div>
          </Show>

          <Show when={!albumsError() && albums().length > 0}>
            <GenreAlbumGrid
              albums={albums()}
              loading={albumsLoading()}
              class="p-6"
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
