/* @jsxImportSource solid-js */
import { createSignal, createResource, Show, onMount } from "solid-js";
import { getSongById } from "../services/indexedDBService.js";
import { createRelativeTimeSignal } from "../utils/timeUtils.js";
import { getSongSpecificTrigger } from "../services/songReactivity.js";
import {
  audioState,
  getSongDownloadProgress,
  isSongCaching,
  seek,
} from "../services/audioService.js";
import { getImageUrlForContext } from "../services/imageService.js";
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
  const [isMobile, setIsMobile] = createSignal(false);
  const [isSeekBarActive, setIsSeekBarActive] = createSignal(false);

  // check if device has touch capability
  // this is slightly different than other isMobile varz :/
  // this could probably be in hooks/ so it's the same everywhere...
  onMount(() => {
    setIsMobile("ontouchstart" in window || navigator.maxTouchPoints > 0);
  });

  // fetch song data with reactivity to specific song updates only
  const [song] = createResource(
    () => [props.songId, getSongSpecificTrigger(props.songId)()] as const,
    async ([songId, _trigger]) => {
      try {
        const fetchedSong = await getSongById(songId);
        if (!fetchedSong) {
          return null;
        }
        return fetchedSong;
      } catch (error) {
        console.error(`Error fetching song ${songId}:`, error);
        return null;
      }
    }
  );

  // track if this song is currently playing
  const isCurrentlyPlaying = () => {
    const current = audioState.currentSong();
    const playing = audioState.isPlaying();
    return current?.id === props.songId && playing;
  };

  // track if this song is currently selected (should show selected UI)
  const isCurrentlySelected = () => {
    return audioState.selectedSongId() === props.songId;
  };

  // track if this song is currently loading or being preloaded
  const isCurrentlyLoading = () => {
    return audioState.loadingSongIds().has(props.songId);
  };

  // track if this song is being preloaded
  const isPreloading = () => {
    return audioState.preloadingSongId() === props.songId;
  };

  // track download progress
  const downloadProgress = () => {
    return getSongDownloadProgress(props.songId);
  };

  // track if this song is being cached
  const isCachingActive = () => {
    return isSongCaching(props.songId);
  };

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTime = (seconds: number) => {
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
    e.stopPropagation(); // prevent global handler from firing!
    e.dataTransfer!.dropEffect = "move";
    setDraggedOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.stopPropagation(); // prevent global handler from firing!
    if (e.currentTarget === e.target) {
      setDraggedOver(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // prevent global handler from firing!
    setDraggedOver(false);

    const fromIndex = parseInt(e.dataTransfer!.getData("text/plain"), 10);
    const toIndex = props.index;

    if (fromIndex !== toIndex && props.onReorder) {
      props.onReorder(fromIndex, toIndex);
    }
  };

  const handleEditSong = () => {
    const songData = song();
    if (songData) {
      props.onEdit?.(songData);
    }
  };

  return (
    <Show
      when={!song.loading}
      fallback={
        <div class="flex items-center p-3 bg-gray-800 bg-opacity-30 animate-pulse">
          <div class="w-12 h-12 bg-gray-700 mr-4"></div>
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
          <div class="flex items-center p-3 bg-red-900 bg-opacity-20 border border-red-500 border-opacity-30">
            <div class="w-12 h-12 bg-red-800 mr-4 flex items-center justify-center">
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

          // calc progress percentage for background fill
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
              class={`group relative flex items-center p-3 group-hover:bg-opacity-70 hover:bg-magenta-500 transition-all duration-200 overflow-hidden ${
                isCurrentlyPlaying() || isCurrentlySelected()
                  ? "sticky top-0 bottom-0 bg-black z-100"
                  : draggedOver()
                    ? "border border-magenta-400 border-dashed"
                    : isDragging()
                      ? "border border-gray-500"
                      : "border border-transparent"
              }`}
              draggable={!isSeekBarActive()}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onMouseEnter={() => !isMobile() && setIsHovered(true)}
              onMouseLeave={() => !isMobile() && setIsHovered(false)}
              onClick={isMobile() ? handlePlayPause : undefined}
              onDblClick={isMobile() ? undefined : handlePlayPause}
              onContextMenu={(e) => {
                e.preventDefault();
                handleEditSong();
              }}
              style={{ "-webkit-tap-highlight-color": "transparent" }}
            >
              {/* time progress background */}
              <div
                class="absolute inset-0 transition-all duration-200"
                style={{
                  background: isCurrentlyPlaying()
                    ? `linear-gradient(to right, rgba(236, 72, 153, 0.5) ${getProgressPercentage()}%, transparent ${getProgressPercentage()}%)`
                    : isCurrentlySelected()
                      ? "rgba(236, 72, 153, 0.3)"
                      : draggedOver()
                        ? "rgba(220, 38, 127, 0.2)"
                        : isDragging()
                          ? "rgba(107, 114, 128, 0.3)"
                          : "transparent",
                  "pointer-events": "none",
                }}
              />

              {/* content overlay */}
              <div class="relative flex items-center w-full">
                {/* song index / album art / play button */}
                <div class="relative w-12 h-12 mr-4 flex-shrink-0 bg-black">
                  {/* song index */}
                  <div class="absolute inset-0 flex justify-center items-center font-mono group-hover:text-transparent">
                    <span class="bg-black">
                      {props.index.toString().padStart(3, "0")}
                    </span>
                  </div>

                  <Show
                    when={songData().imageType}
                    fallback={
                      <div class="w-12 h-12 bg-transparent flex items-center justify-center"></div>
                    }
                  >
                    {(() => {
                      const imageUrl = getImageUrlForContext(
                        songData(),
                        "thumbnail"
                      );
                      return imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={`${songData().title} album art`}
                          class="w-12 h-12 object-cover"
                        />
                      ) : (
                        <div class="w-12 h-12 bg-transparent flex items-center justify-center"></div>
                      );
                    })()}
                  </Show>

                  {/* loading overlay - show when loading or preloading */}
                  <Show
                    when={
                      isCurrentlyLoading() ||
                      isPreloading() ||
                      isCachingActive()
                    }
                  >
                    <div class="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-1">
                      <div class="relative w-8 h-8">
                        {/* circular progress background */}
                        <Show
                          when={
                            downloadProgress() > 0 && downloadProgress() < 100
                          }
                        >
                          <svg
                            class="absolute inset-0 w-8 h-8 transform -rotate-90"
                            viewBox="0 0 32 32"
                          >
                            {/* background circle */}
                            <circle
                              cx="16"
                              cy="16"
                              r="14"
                              stroke="rgba(255, 255, 255, 0.2)"
                              stroke-width="2"
                              fill="none"
                            />
                            {/* progress circle */}
                            <circle
                              cx="16"
                              cy="16"
                              r="14"
                              stroke={isPreloading() ? "#9ca3af" : "#ec4899"}
                              stroke-width="2"
                              fill="none"
                              stroke-linecap="round"
                              stroke-dasharray={`${(downloadProgress() / 100) * 87.96} 87.96`}
                              class="transition-all duration-300"
                            />
                          </svg>
                        </Show>
                        {/* rotating loading icon */}
                        <svg
                          class={`w-4 h-4 animate-spin absolute inset-0 m-auto ${
                            isPreloading()
                              ? "text-gray-400"
                              : "text-magenta-300"
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                      </div>
                    </div>
                  </Show>

                  {/* play/pause overlay (only shown when not loading or preloading) */}
                  <Show
                    when={
                      !isCurrentlyLoading() &&
                      !isPreloading() &&
                      !isCachingActive() &&
                      isHovered() &&
                      !isMobile()
                    }
                  >
                    <button
                      onClick={handlePlayPause}
                      class="absolute inset-0 bg-transparent flex items-center justify-center transition-opacity hover:bg-opacity-80 text-magenta-300 hover:text-magenta-100"
                    >
                      <Show
                        when={isCurrentlyPlaying()}
                        fallback={
                          <svg
                            class="w-5 h-5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        }
                      >
                        <svg
                          class="w-5 h-5"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      </Show>
                    </button>
                  </Show>
                </div>

                {/* song info */}
                <div class="flex-1 min-w-0 text-lg">
                  <div
                    class={`break-words ${
                      isCurrentlyPlaying() || isCurrentlySelected()
                        ? "text-magenta-200"
                        : "text-white"
                    }`}
                  >
                    {songData().title}
                  </div>
                  <div
                    class={`text-sm break-words ${
                      isCurrentlyPlaying() || isCurrentlySelected()
                        ? "text-magenta-200"
                        : "text-white"
                    }`}
                  >
                    {songData().artist}
                    {songData().album && <span class="mx-2">•</span>}
                    {songData().album}
                  </div>
                  {/* seek'n destroy! */}
                  <Show
                    when={isCurrentlySelected() && (isHovered() || isMobile())}
                  >
                    <div class="text-xs mt-1 text-magenta-200 flex items-center">
                      {/* current time with fixed width */}
                      <span class="font-mono w-12 text-left tabular-nums">
                        {isCurrentlySelected()
                          ? formatTime(audioState.currentTime())
                          : "0:00"}
                      </span>

                      {/* seek bar */}
                      <div
                        class="flex-1 relative h-4 flex items-center seek-bar-container"
                        onMouseDown={() => setIsSeekBarActive(true)}
                        onMouseUp={() => setIsSeekBarActive(false)}
                        onMouseLeave={() => setIsSeekBarActive(false)}
                      >
                        <input
                          type="range"
                          min="0"
                          max={songData().duration || 0}
                          value={
                            isCurrentlySelected() ? audioState.currentTime() : 0
                          }
                          onInput={(e) => {
                            if (isCurrentlySelected()) {
                              const seekTime = parseFloat(
                                e.currentTarget.value
                              );
                              seek(seekTime);
                            }
                          }}
                          onMouseDown={() => setIsSeekBarActive(true)}
                          onMouseUp={() => setIsSeekBarActive(false)}
                          class="w-full h-2 bg-gray-700 rounded-full appearance-none cursor-pointer hover:bg-gray-600 transition-colors seek-slider"
                          style={{
                            background: isCurrentlySelected()
                              ? `linear-gradient(to right, #ec4899 0%, #ec4899 ${(audioState.currentTime() / (songData().duration || 1)) * 100}%, #374151 ${(audioState.currentTime() / (songData().duration || 1)) * 100}%, #374151 100%)`
                              : "#374151",
                          }}
                        />
                      </div>

                      {/* total time with fixed width */}
                      <Show when={!isMobile()}>
                        <span class="font-mono w-12 text-right tabular-nums">
                          {formatDuration(songData().duration)}
                        </span>
                      </Show>
                    </div>
                  </Show>
                  <Show
                    when={
                      (isCurrentlyPlaying() || isCurrentlySelected()) &&
                      !isHovered()
                    }
                  >
                    <div class="text-xs mt-1 text-magenta-200">
                      added {relativeTime.signal()}
                    </div>
                  </Show>
                </div>
              </div>

              {/* duration */}
              <div
                class={`text-sm font-mono mr-4 ${
                  isCurrentlyPlaying() || isCurrentlySelected()
                    ? "text-magenta-200"
                    : "text-white"
                }`}
              >
                {formatDuration(songData().duration)}
              </div>

              {/* overlay actions */}
              <Show when={isHovered() && !isMobile()}>
                <div class="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1 bg-black bg-opacity-80 px-2 py-1 z-50">
                  {/* edit button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();

                      const songData = song();
                      if (songData) {
                        props.onEdit?.(songData);
                      }
                    }}
                    class="p-1 text-gray-400 hover:text-white transition-colors hover:bg-gray-600"
                    title="edit song"
                  >
                    <svg
                      class="w-3 h-3"
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

                  {/* delete/remove button */}
                  <Show when={props.showRemoveButton}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        props.onRemove?.(props.songId);
                      }}
                      class="p-1 text-red-400 hover:text-red-300 transition-colors hover:bg-red-600 hover:bg-opacity-30"
                      title="remove from playlist"
                    >
                      <svg
                        class="w-3 h-3"
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

                  {/* drag handle */}
                  <div
                    class={`p-1 text-gray-400 transition-colors cursor-grab ${
                      isDragging()
                        ? "cursor-grabbing text-magenta-400"
                        : "hover:text-gray-300"
                    }`}
                    title="drag to reorder"
                  >
                    <svg
                      class="w-3 h-3"
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
                </div>
              </Show>
            </div>
          );
        }}
      </Show>
    </Show>
  );
}
