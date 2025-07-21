/* @jsxImportSource solid-js */
import { createSignal, createResource, Show } from "solid-js";
import { getSongById } from "../services/indexedDBService.js";
import { createRelativeTimeSignal } from "../utils/timeUtils.js";
import { songUpdateTrigger } from "../services/songReactivity.js";
import { audioState } from "../services/audioService.js";
import { createImageUrlFromData } from "../services/imageService.js";
import type { Song } from "../types/playlist.js";

interface SongRowProps {
  songId: string;
  index: number;
  onPlay?: (song: Song) => void;
  onPause?: () => void;
  onRemove?: (songId: string) => void;
  onEdit?: (song: Song) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  showRemoveButton?: boolean;
}

export function SongRow(props: SongRowProps) {
  const [isHovered, setIsHovered] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [draggedOver, setDraggedOver] = createSignal(false);

  // Fetch song data with reactivity to global song updates
  const [song] = createResource(
    () => [props.songId, songUpdateTrigger()] as const,
    async ([songId, _trigger]) => {
      try {
        console.log(`🔄 Fetching song ${songId} (trigger: ${_trigger})`);
        const fetchedSong = await getSongById(songId);
        if (!fetchedSong) {
          console.warn(`⚠️ Song not found: ${songId}`);
          return null;
        }
        return fetchedSong;
      } catch (error) {
        console.error(`❌ Error fetching song ${songId}:`, error);
        return null;
      }
    }
  );

  // Track if this song is currently playing
  const isCurrentlyPlaying = () => {
    const current = audioState.currentSong();
    const playing = audioState.isPlaying();
    return current?.id === props.songId && playing;
  };

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handlePlayPause = () => {
    const songData = song();
    if (!songData) return;

    if (isCurrentlyPlaying()) {
      props.onPause?.();
    } else {
      props.onPlay?.(songData);
    }
  };

  const handleDragStart = (e: DragEvent) => {
    setIsDragging(true);
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", props.index.toString());
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDraggedOver(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent global handler from firing
    e.dataTransfer!.dropEffect = "move";
    setDraggedOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.stopPropagation(); // Prevent global handler from firing
    if (e.currentTarget === e.target) {
      setDraggedOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent global handler from firing
    setDraggedOver(false);

    const fromIndex = parseInt(e.dataTransfer!.getData("text/plain"), 10);
    const toIndex = props.index;

    if (fromIndex !== toIndex && props.onReorder) {
      props.onReorder(fromIndex, toIndex);
    }
  };

  return (
    <Show
      when={!song.loading}
      fallback={
        <div class="flex items-center p-3 bg-gray-800 bg-opacity-30 rounded-lg animate-pulse">
          <div class="w-12 h-12 bg-gray-700 rounded-lg mr-4"></div>
          <div class="flex-1">
            <div class="h-4 bg-gray-700 rounded mb-2 w-3/4"></div>
            <div class="h-3 bg-gray-700 rounded w-1/2"></div>
          </div>
          <div class="w-16 h-4 bg-gray-700 rounded"></div>
        </div>
      }
    >
      <Show
        when={song()}
        fallback={
          <div class="flex items-center p-3 bg-red-900 bg-opacity-20 rounded-lg border border-red-500 border-opacity-30">
            <div class="w-12 h-12 bg-red-800 rounded-lg mr-4 flex items-center justify-center">
              <svg
                class="w-6 h-6 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div class="flex-1">
              <div class="text-red-400 font-medium">song not found</div>
              <div class="text-red-300 text-sm">id: {props.songId}</div>
            </div>
          </div>
        }
      >
        {(songData) => {
          const relativeTime = createRelativeTimeSignal(songData().createdAt);

          // Calculate progress percentage for background fill
          const getProgressPercentage = () => {
            const currentSong = audioState.currentSong();
            if (!currentSong || currentSong.id !== songData().id) return 0;

            const duration = audioState.duration();
            const currentTime = audioState.currentTime();

            if (duration > 0) {
              return (currentTime / duration) * 100;
            }
            return 0;
          };

          return (
            <div
              class={`group relative flex items-center p-3 rounded-lg transition-all duration-200 overflow-hidden ${
                isCurrentlyPlaying()
                  ? "border border-magenta-500 border-opacity-50"
                  : draggedOver()
                    ? "border border-magenta-400 border-dashed"
                    : isDragging()
                      ? "border border-gray-500"
                      : "border border-transparent hover:border-gray-600"
              }`}
              draggable={true}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              {/* Progress background */}
              <div
                class="absolute inset-0 transition-all duration-200"
                style={{
                  background: isCurrentlyPlaying()
                    ? `linear-gradient(to right, rgba(236, 72, 153, 0.15) ${getProgressPercentage()}%, transparent ${getProgressPercentage()}%)`
                    : draggedOver()
                      ? "rgba(220, 38, 127, 0.2)"
                      : isDragging()
                        ? "rgba(107, 114, 128, 0.3)"
                        : "rgba(31, 41, 55, 0.3)",
                  "pointer-events": "none",
                }}
              />

              {/* Content overlay */}
              <div class="relative flex items-center w-full">
                {/* Album art / Play button */}
                <div class="relative w-12 h-12 mr-4 flex-shrink-0">
                  <Show
                    when={songData().imageData && songData().imageType}
                    fallback={
                      <div class="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center">
                        <svg
                          class="w-6 h-6 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                          />
                        </svg>
                      </div>
                    }
                  >
                    <img
                      src={createImageUrlFromData(
                        songData().imageData!,
                        songData().imageType!
                      )}
                      alt={`${songData().title} album art`}
                      class="w-12 h-12 rounded-lg object-cover"
                    />
                  </Show>

                  {/* Play/Pause overlay */}
                  <Show when={isHovered() || isCurrentlyPlaying()}>
                    <button
                      onClick={handlePlayPause}
                      class="absolute inset-0 bg-black bg-opacity-60 rounded-lg flex items-center justify-center transition-opacity hover:bg-opacity-80"
                    >
                      <Show
                        when={isCurrentlyPlaying()}
                        fallback={
                          <svg
                            class="w-5 h-5 text-white"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        }
                      >
                        <svg
                          class="w-5 h-5 text-white"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      </Show>
                    </button>
                  </Show>
                </div>

                {/* Song info */}
                <div class="flex-1 min-w-0">
                  <div
                    class={`font-medium truncate ${
                      isCurrentlyPlaying()
                        ? "text-white"
                        : "text-gray-200 group-hover:text-white"
                    }`}
                  >
                    {songData().title}
                  </div>
                  <div
                    class={`text-sm truncate ${
                      isCurrentlyPlaying()
                        ? "text-magenta-200"
                        : "text-gray-400 group-hover:text-gray-300"
                    }`}
                  >
                    {songData().artist}
                    {songData().album && <span class="mx-2">•</span>}
                    {songData().album}
                  </div>
                  <div
                    class={`text-xs mt-1 ${
                      isCurrentlyPlaying()
                        ? "text-magenta-300"
                        : "text-gray-500"
                    }`}
                  >
                    added {relativeTime.signal()}
                  </div>
                </div>
              </div>

              {/* Duration */}
              <div
                class={`text-sm font-mono mr-4 ${
                  isCurrentlyPlaying()
                    ? "text-magenta-200"
                    : "text-gray-400 group-hover:text-gray-300"
                }`}
              >
                {formatDuration(songData().duration)}
              </div>

              {/* Actions */}
              <div class="flex items-center gap-2 relative z-40">
                {/* Edit button */}
                <Show when={isHovered()}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();

                      const songData = song();
                      if (songData) {
                        props.onEdit?.(songData);
                      }
                    }}
                    class="relative z-50 p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-600 hover:bg-opacity-50"
                    style="pointer-events: auto;"
                    title="Edit song"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                </Show>

                {/* Remove button */}
                <Show when={props.showRemoveButton && isHovered()}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      props.onRemove?.(props.songId);
                    }}
                    class="relative z-50 p-2 text-red-400 hover:text-red-300 transition-colors rounded-lg hover:bg-red-600 hover:bg-opacity-20"
                    style="pointer-events: auto;"
                    title="Remove from playlist"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </Show>

                {/* Drag handle */}
                <Show when={isHovered() || isDragging()}>
                  <div
                    class={`p-2 text-gray-400 transition-colors ${
                      isDragging()
                        ? "cursor-grabbing text-magenta-400"
                        : "cursor-grab hover:text-gray-300"
                    }`}
                    title="Drag to reorder"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                  </div>
                </Show>
              </div>
            </div>
          );
        }}
      </Show>
    </Show>
  );
}
