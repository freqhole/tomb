import { For, Show } from "solid-js";
import type { GenreAlbum } from "../../../../../../lib/music/schemas/genre";

interface GenreAlbumGridProps {
  albums: GenreAlbum[];
  loading?: boolean;
  class?: string;
  onAlbumClick?: (album: GenreAlbum) => void;
  onAlbumDoubleClick?: (album: GenreAlbum) => void;
}

export function GenreAlbumGrid(props: GenreAlbumGridProps) {
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

  const handleAlbumClick = (album: GenreAlbum) => {
    props.onAlbumClick?.(album);
  };

  const handleAlbumDoubleClick = (album: GenreAlbum) => {
    props.onAlbumDoubleClick?.(album);
  };

  return (
    <div class={`${props.class || ""}`}>
      <Show
        when={props.albums.length > 0}
        fallback={
          <Show when={!props.loading}>
            <div class="text-center text-gray-400">
              <p class="text-sm">no albums found</p>
            </div>
          </Show>
        }
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          <For each={props.albums}>
            {(album) => (
              <div
                class="group cursor-pointer"
                onClick={() => handleAlbumClick(album)}
                onDblClick={() => handleAlbumDoubleClick(album)}
              >
                <div class="bg-gray-800 hover:bg-gray-750 transition-colors">
                  {/* Album artwork */}
                  <div class="aspect-square bg-gray-700 flex items-center justify-center relative overflow-hidden">
                    <Show
                      when={album.album_thumbnail_id}
                      fallback={<div class="text-4xl text-gray-500">♪</div>}
                    >
                      <img
                        src={`/api/admin/images/${album.album_thumbnail_id}`}
                        alt={album.album || "album"}
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </Show>

                    {/* Hover overlay with play button */}
                    <div class="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div class="w-12 h-12 bg-magenta-600 text-white flex items-center justify-center hover:bg-magenta-500 transition-colors">
                        <svg
                          class="w-6 h-6 ml-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Album info */}
                  <div class="p-3">
                    <div class="space-y-1">
                      <h4
                        class="text-white font-medium text-sm truncate"
                        title={album.album || "untitled"}
                      >
                        {album.album || "untitled"}
                      </h4>

                      <Show when={album.artist}>
                        <div
                          class="text-xs text-gray-400 truncate"
                          title={album.artist || undefined}
                        >
                          {album.artist}
                        </div>
                      </Show>

                      <div class="flex items-center justify-between text-xs text-gray-500 mt-2">
                        <div class="flex items-center gap-2">
                          <span>
                            {album.track_count || 0} track
                            {album.track_count !== 1 ? "s" : ""}
                          </span>
                          <Show when={album.disc_count > 1}>
                            <span>• {album.disc_count} discs</span>
                          </Show>
                        </div>
                        <Show when={album.year}>
                          <span>{album.year}</span>
                        </Show>
                      </div>

                      <Show when={album.total_duration}>
                        <div class="text-xs text-gray-500">
                          {formatDuration(album.total_duration!)}
                        </div>
                      </Show>

                      {/* Rating and favorites */}
                      <div class="flex items-center justify-between text-xs">
                        <div class="flex items-center gap-2">
                          <Show when={album.avg_rating}>
                            <span class="text-yellow-400">
                              ★ {album.avg_rating!.toFixed(1)}
                            </span>
                          </Show>
                          <Show when={album.favorite_count > 0}>
                            <span class="text-red-400">
                              ♥ {formatCount(album.favorite_count)}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.loading}>
        <div class="text-center">
          <div class="text-gray-400 text-sm">loading albums...</div>
        </div>
      </Show>
    </div>
  );
}
