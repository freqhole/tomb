import { For, Show } from "solid-js";
import { apiClient } from "../../../../../../lib/api-client";
import type { GenreAlbum } from "../../../../../../lib/music/schemas/genre";

interface GenreAlbumGridProps {
  albums: GenreAlbum[];
  loading?: boolean;
  class?: string;
  onAlbumClick?: (album: GenreAlbum) => void;
  onAlbumDoubleClick?: (album: GenreAlbum) => void;
}

export function GenreAlbumGrid(props: GenreAlbumGridProps) {
  // Helper function for getting album image URLs
  const getAlbumImageUrl = (albumThumbnailId: string | null) => {
    if (!albumThumbnailId) return null;
    return `${apiClient.getBaseUrl()}/api/blobs/${albumThumbnailId}`;
  };

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
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          <For each={props.albums}>
            {(album) => (
              <div
                class="group cursor-pointer"
                onClick={() => handleAlbumClick(album)}
                onDblClick={() => handleAlbumDoubleClick(album)}
              >
                <div class="transition-colors">
                  {/* Album artwork */}
                  <div class="aspect-square bg-magenta-800/30 flex items-center justify-center relative overflow-hidden mb-2">
                    <Show
                      when={getAlbumImageUrl(album.album_thumbnail_id)}
                      fallback={
                        <div class="w-full h-full flex items-center justify-center">
                          <svg
                            class="w-12 h-12 text-magenta-400"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                          </svg>
                        </div>
                      }
                    >
                      <img
                        src={getAlbumImageUrl(album.album_thumbnail_id)!}
                        alt={`${album.album || "album"} by ${album.artist || "unknown artist"}`}
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </Show>

                    {/* Hover overlay with play button */}
                    <div class="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        class="w-12 h-12 bg-magenta-600 text-white flex items-center justify-center hover:bg-magenta-500 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          // TODO: implement play album functionality
                          console.log("play album:", album.album);
                        }}
                      >
                        <svg
                          class="w-6 h-6 ml-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Album info */}
                  <div class="space-y-1">
                    <h4
                      class="text-white font-medium text-sm truncate"
                      title={album.album || "untitled"}
                    >
                      {album.album || "untitled"}
                    </h4>

                    <div
                      class="text-xs text-gray-400 truncate"
                      title={album.artist || undefined}
                    >
                      {album.artist || "unknown artist"}
                    </div>

                    <div class="text-xs text-gray-500">
                      <Show when={album.year}>
                        <span>{album.year} • </span>
                      </Show>
                      <span>
                        {album.track_count || 0} track
                        {album.track_count !== 1 ? "s" : ""}
                      </span>
                    </div>

                    <Show when={album.total_duration}>
                      <div class="text-xs text-gray-500">
                        {formatDuration(album.total_duration!)}
                      </div>
                    </Show>
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
