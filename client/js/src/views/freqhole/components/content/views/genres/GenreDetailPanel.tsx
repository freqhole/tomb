import { createSignal, Show, For } from "solid-js";
import type {
  GenreStat,
  GenreSearchResponse,
  GenreArtist,
  GenreAlbum,
} from "../../../../../../lib/music/schemas/genre";

interface GenreDetailPanelProps {
  genre: GenreStat;
  genreDetails: GenreSearchResponse | null | undefined;
  loading: boolean;
  error?: any;
  viewMode: "artists" | "albums";
  onViewModeChange: (mode: "artists" | "albums") => void;
}

export function GenreDetailPanel(props: GenreDetailPanelProps) {
  // Format duration helper
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

  // Format count helper
  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  // Get artists data if available
  const artists = (): GenreArtist[] => {
    if (!props.genreDetails || !("artists" in props.genreDetails)) {
      return [];
    }
    return props.genreDetails.artists || [];
  };

  // Get albums data if available
  const albums = (): GenreAlbum[] => {
    if (!props.genreDetails || !("albums" in props.genreDetails)) {
      return [];
    }
    return props.genreDetails.albums || [];
  };

  // Get pagination info
  const pagination = () => {
    if (!props.genreDetails) return null;
    if ("artists" in props.genreDetails) {
      return {
        total: props.genreDetails.total,
        page: props.genreDetails.page,
        total_pages: props.genreDetails.total_pages,
        has_next: props.genreDetails.has_next,
        has_prev: props.genreDetails.has_prev,
      };
    }
    if ("albums" in props.genreDetails) {
      return {
        total: props.genreDetails.total,
        page: props.genreDetails.page,
        total_pages: props.genreDetails.total_pages,
        has_next: props.genreDetails.has_next,
        has_prev: props.genreDetails.has_prev,
      };
    }
    return null;
  };

  return (
    <div class="flex-1 flex flex-col h-full">
      {/* Header */}
      <div class="flex-shrink-0 p-6 border-b border-gray-800/50">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-xl font-semibold text-white mb-1">
              {props.genre.name}
            </h2>
            <div class="flex items-center gap-4 text-sm text-gray-400">
              <span>{formatCount(props.genre.song_count)} songs</span>
              <span>{formatCount(props.genre.artist_count)} artists</span>
              <span>{formatCount(props.genre.album_count)} albums</span>
              <span>{formatDuration(props.genre.total_duration)}</span>
            </div>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div class="flex items-center gap-4 mb-4">
          <div class="flex bg-gray-900 rounded-none">
            <button
              class={`px-4 py-2 text-sm transition-colors ${
                props.viewMode === "artists"
                  ? "bg-magenta-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
              onClick={() => props.onViewModeChange("artists")}
            >
              artists
            </button>
            <button
              class={`px-4 py-2 text-sm transition-colors ${
                props.viewMode === "albums"
                  ? "bg-magenta-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
              onClick={() => props.onViewModeChange("albums")}
            >
              albums
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div class="flex-1 min-h-0 overflow-y-auto">
        <Show when={props.error}>
          <div class="p-6 text-center">
            <div class="text-red-400 text-sm mb-2">
              failed to load {props.viewMode}
            </div>
            <button class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors">
              try again
            </button>
          </div>
        </Show>

        <Show when={props.loading && !props.genreDetails}>
          <div class="p-6 text-center">
            <div class="text-gray-400 text-sm">loading {props.viewMode}...</div>
          </div>
        </Show>

        <Show when={!props.error && !props.loading && props.genreDetails}>
          <Show when={props.viewMode === "artists"}>
            <div class="divide-y divide-gray-800/50">
              <For
                each={artists()}
                fallback={
                  <div class="p-6 text-center text-gray-400">
                    <p class="text-sm">no artists found</p>
                  </div>
                }
              >
                {(artist) => (
                  <div class="px-6 py-4 hover:bg-gray-900/50 transition-colors cursor-pointer">
                    <div class="flex items-center justify-between">
                      <div class="flex-1 min-w-0">
                        <h3 class="text-white font-medium text-sm truncate">
                          {artist.artist}
                        </h3>
                        <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{formatCount(artist.song_count)} songs</span>
                          <span>{formatCount(artist.album_count)} albums</span>
                          <span>{formatDuration(artist.total_duration)}</span>
                          <Show when={artist.avg_rating}>
                            <span>★ {artist.avg_rating!.toFixed(1)}</span>
                          </Show>
                          <Show when={artist.favorite_count > 0}>
                            <span>♥ {formatCount(artist.favorite_count)}</span>
                          </Show>
                        </div>
                        <Show when={artist.genres && artist.genres.length > 0}>
                          <div class="mt-2">
                            <div class="flex flex-wrap gap-1">
                              <For each={artist.genres.slice(0, 3)}>
                                {(genre) => (
                                  <span class="text-xs px-2 py-1 bg-gray-800 text-gray-300">
                                    {genre}
                                  </span>
                                )}
                              </For>
                              <Show when={artist.genres.length > 3}>
                                <span class="text-xs text-gray-500">
                                  +{artist.genres.length - 3} more
                                </span>
                              </Show>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={props.viewMode === "albums"}>
            <div class="divide-y divide-gray-800/50">
              <For
                each={albums()}
                fallback={
                  <div class="p-6 text-center text-gray-400">
                    <p class="text-sm">no albums found</p>
                  </div>
                }
              >
                {(album) => (
                  <div class="px-6 py-4 hover:bg-gray-900/50 transition-colors cursor-pointer">
                    <div class="flex items-center justify-between">
                      <div class="flex-1 min-w-0">
                        <h3 class="text-white font-medium text-sm truncate">
                          {album.album || "unknown album"}
                        </h3>
                        <div class="text-xs text-gray-400 mt-1">
                          <Show when={album.artist}>
                            <span>by {album.artist}</span>
                          </Show>
                          <Show when={album.year}>
                            <span class="ml-2">• {album.year}</span>
                          </Show>
                        </div>
                        <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span>{formatCount(album.track_count)} tracks</span>
                          <Show when={album.disc_count > 1}>
                            <span>{album.disc_count} discs</span>
                          </Show>
                          <Show when={album.total_duration}>
                            <span>{formatDuration(album.total_duration!)}</span>
                          </Show>
                          <Show when={album.avg_rating}>
                            <span>★ {album.avg_rating!.toFixed(1)}</span>
                          </Show>
                          <Show when={album.favorite_count > 0}>
                            <span>♥ {formatCount(album.favorite_count)}</span>
                          </Show>
                        </div>
                      </div>
                      <Show when={album.album_thumbnail_id}>
                        <div class="flex-shrink-0 ml-3">
                          <img
                            src={`/api/admin/images/${album.album_thumbnail_id}`}
                            alt={album.album || "album"}
                            class="w-12 h-12 object-cover"
                          />
                        </div>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Pagination info */}
          <Show when={pagination()}>
            <div class="p-4 border-t border-gray-800/50 text-center text-xs text-gray-500">
              showing page {pagination()!.page} of {pagination()!.total_pages}(
              {pagination()!.total} total {props.viewMode})
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
