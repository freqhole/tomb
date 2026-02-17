import { Show, type JSX } from "solid-js";
import { Icon } from "../icons/registry";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import { VolumeControl } from "./VolumeControl";
import MediaImage from "../media/MediaImage";
import { formatDuration } from "../../utils/formatDuration";
import { getSongDisplayImages } from "../../utils/images";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface PlayerBarSong {
  /** song id */
  id: string;
  /** sha256 for favorite queue updates */
  sha256?: string;
  /** song title */
  title: string;
  /** artist name */
  artist: string;
  /** album name */
  album?: string;
  /** structured image metadata array (preferred) */
  images?: ImageMetadata[];
  /** album images for fallback when song has no images */
  album_images?: ImageMetadata[];
  /** thumbnail blob id (legacy, for backward compatibility) */
  thumbnailBlobId?: string;
  /** thumbnail image url (legacy, fallback for remote) */
  thumbnailUrl?: string;
  /** whether song is favorited */
  isFavorite?: boolean;
}

export interface PlayerBarProps {
  /** currently playing song */
  song?: PlayerBarSong;
  /** whether audio is playing */
  isPlaying: boolean;
  /** whether audio is loading */
  isLoading?: boolean;
  /** current time in seconds */
  currentTime: number;
  /** total duration in seconds */
  duration: number;
  /** volume (0-1) */
  volume: number;
  /** whether queue is open */
  queueOpen: boolean;
  /** callback when play/pause clicked */
  onPlayPause: () => void;
  /** callback when previous clicked */
  onPrevious: () => void;
  /** callback when next clicked */
  onNext: () => void;
  /** callback when favorite toggled */
  onFavoriteToggle?: (songId: string) => void;
  /** callback when seeking on progress bar */
  onSeek: (percentage: number) => void;
  /** callback when volume changes */
  onVolumeChange: (volume: number) => void;
  /** callback when queue toggle clicked */
  onQueueToggle: () => void;
  /** whether previous button is disabled */
  canGoPrevious?: boolean;
  /** whether next button is disabled */
  canGoNext?: boolean;
  /** queue length for badge */
  queueLength?: number;
  /** hide the queue toggle button (e.g., on narrow views when it's in top nav) */
  hideQueueToggle?: boolean;
  /** callback when thumbnail image is clicked */
  onImageClick?: () => void;
  /** additional classes */
  class?: string;
}

// player bar component for bottom of screen
export function PlayerBar(props: PlayerBarProps) {
  const canGoPrevious = () => props.canGoPrevious ?? true;
  const canGoNext = () => props.canGoNext ?? true;
  const progress = () => (props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0);

  let isDragging = false;

  const updateProgress = (e: MouseEvent | Touch, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // clamp between 0 and rect.width, then convert to percentage
    const clampedX = Math.max(0, Math.min(x, rect.width));
    const percentage = (clampedX / rect.width) * 100;
    props.onSeek(percentage);
  };

  const handleMouseDown = (e: MouseEvent) => {
    isDragging = true;
    const target = e.currentTarget as HTMLElement;
    updateProgress(e, target);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (isDragging) {
        updateProgress(moveEvent, target);
      }
    };

    const handleMouseUp = () => {
      isDragging = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // touch support for progress bar
  const handleTouchStart = (e: TouchEvent) => {
    isDragging = true;
    const target = e.currentTarget as HTMLElement;
    const touch = e.touches[0];
    updateProgress(touch, target);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isDragging) {
      const target = e.currentTarget as HTMLElement;
      const touch = e.touches[0];
      updateProgress(touch, target);
    }
  };

  const handleTouchEnd = () => {
    isDragging = false;
  };

  return (
    <div
      class={`fixed bottom-0 left-0 right-0 bg-[var(--color-bg-primary)]/90 backdrop-blur-xl z-50 ${props.class || ""}`}
      style={{ height: "var(--player-height)" }}
    >
      {/* narrow layout: 2 rows */}
      <div class="flex flex-col h-full md:hidden p-2 gap-1">
        {/* row 1: thumbnail, fav, title/artist, controls, queue */}
        <div class="flex items-center gap-2 flex-1 min-h-0">
          {/* thumbnail */}
          <div
            class={`w-10 h-10 flex-shrink-0 ${props.onImageClick ? "cursor-pointer" : ""}`}
            onClick={() => props.onImageClick?.()}
          >
            <MediaImage
              images={props.song ? getSongDisplayImages(props.song) : undefined}
              blobId={props.song?.thumbnailBlobId}
              imageUrl={props.song?.thumbnailUrl}
              alt={props.song?.title || "song artwork"}
              domainType="song"
              class="w-10 h-10 rounded object-cover"
            />
          </div>

          {/* favorite button */}
          <Show when={props.song}>
            {(song) => (
              <div class="flex-shrink-0">
                <FavoriteHeart
                  isFavorite={song().isFavorite || false}
                  onToggle={() => props.onFavoriteToggle?.(song().id)}
                  size="sm"
                  class="opacity-80"
                />
              </div>
            )}
          </Show>

          {/* title/artist - flex-1 with truncation */}
          <div class="flex-1 min-w-0">
            <Show
              when={props.song}
              fallback={
                <div class="text-[var(--color-text-secondary)] text-sm">no song playing</div>
              }
            >
              <MarqueeText
                text={props.song!.title}
                class="text-[var(--color-text-primary)] font-medium text-sm"
              />
              <MarqueeText
                text={
                  props.song!.album
                    ? `${props.song!.artist} - ${props.song!.album}`
                    : props.song!.artist
                }
                class="text-[var(--color-text-tertiary)] text-xs"
              />
            </Show>
          </div>

          {/* compact controls */}
          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              class="w-8 h-8 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-colors flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => props.onPrevious()}
              disabled={!canGoPrevious()}
              title="previous"
              aria-label="previous"
            >
              <Icon name="previous" size={16} />
            </button>

            <button
              class="w-10 h-10 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] border-none cursor-pointer transition-colors flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={() => props.onPlayPause()}
              disabled={props.isLoading}
              title={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
              aria-label={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
            >
              <Show
                when={!props.isLoading}
                fallback={
                  <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                }
              >
                <Icon name={props.isPlaying ? "pause" : "play"} size={20} />
              </Show>
            </button>

            <button
              class="w-8 h-8 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-colors flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => props.onNext()}
              disabled={!canGoNext()}
              title="next"
              aria-label="next"
            >
              <Icon name="next" size={16} />
            </button>
          </div>

          {/* queue toggle */}
          <Show when={!props.hideQueueToggle}>
            <button
              class={`w-8 h-8 rounded-full border-none cursor-pointer transition-colors flex items-center justify-center relative flex-shrink-0 ${
                props.queueOpen
                  ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                  : "bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/30"
              }`}
              onClick={() => props.onQueueToggle()}
              title={props.queueOpen ? "hide queue" : "show queue"}
              aria-label={props.queueOpen ? "hide queue" : "show queue"}
            >
              <Icon name="queue" size={16} />
              <Show when={(props.queueLength || 0) > 0}>
                <span class="absolute -top-1 -right-1 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-medium">
                  {props.queueLength}
                </span>
              </Show>
            </button>
          </Show>
        </div>

        {/* row 2: time + full-width progress + duration */}
        <div class="flex items-center gap-2 h-6">
          <span class="text-xs text-[var(--color-accent-500)] font-light min-w-[2rem] text-right tabular-nums">
            {formatDuration(props.currentTime)}
          </span>

          <div
            class="flex-1 h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden cursor-pointer"
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div
              class="h-full bg-gradient-to-r from-[var(--color-accent-500)] to-[var(--color-accent-400)] rounded-full"
              style={{ width: `${progress()}%` }}
            />
          </div>

          <span class="text-xs text-[var(--color-accent-500)] font-light min-w-[2rem] tabular-nums">
            {formatDuration(props.duration)}
          </span>
        </div>
      </div>

      {/* wide layout: single row (hidden on narrow) */}
      <div class="hidden md:flex items-center gap-6 h-full p-4">
        {/* song info - left side with flex-1 */}
        <div class="flex items-center gap-4 flex-1 min-w-0">
          {/* thumbnail */}
          <div
            class={`w-12 h-12 flex-shrink-0 ${props.onImageClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
            onClick={() => props.onImageClick?.()}
          >
            <MediaImage
              images={props.song ? getSongDisplayImages(props.song) : undefined}
              blobId={props.song?.thumbnailBlobId}
              imageUrl={props.song?.thumbnailUrl}
              alt={props.song?.title || "song artwork"}
              domainType="song"
              class="w-12 h-12 rounded object-cover"
            />
          </div>

          {/* favorite button */}
          <Show when={props.song}>
            {(song) => (
              <div class="flex-shrink-0">
                <FavoriteHeart
                  isFavorite={song().isFavorite || false}
                  onToggle={() => props.onFavoriteToggle?.(song().id)}
                  size="md"
                  class="opacity-80 hover:opacity-100"
                />
              </div>
            )}
          </Show>

          {/* title and artist - fills remaining space */}
          <div class="flex-1 min-w-0">
            <Show
              when={props.song}
              fallback={
                <>
                  <div class="text-[var(--color-text-primary)] font-medium text-base">
                    no song playing
                  </div>
                  <div class="text-[var(--color-text-secondary)] font-light text-sm">
                    press play to start queue
                  </div>
                </>
              }
            >
              <MarqueeText
                text={props.song!.title}
                class="text-[var(--color-text-primary)] font-medium text-base"
              />
              <MarqueeText
                text={
                  props.song!.album
                    ? `${props.song!.artist} - ${props.song!.album}`
                    : props.song!.artist
                }
                class="text-[var(--color-text-secondary)] font-light text-sm"
              />
            </Show>
          </div>
        </div>

        {/* player controls - centered */}
        <div class="flex items-center gap-3 flex-shrink-0">
          <button
            class="w-10 h-10 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={() => props.onPrevious()}
            disabled={!canGoPrevious()}
            title="previous"
            aria-label="previous"
          >
            <Icon name="previous" size={20} />
          </button>

          <button
            class="w-12 h-12 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:scale-105 disabled:opacity-70 disabled:cursor-not-allowed"
            onClick={() => props.onPlayPause()}
            disabled={props.isLoading}
            title={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
            aria-label={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
          >
            <Show
              when={!props.isLoading}
              fallback={
                <div class="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              }
            >
              <Icon name={props.isPlaying ? "pause" : "play"} size={24} />
            </Show>
          </button>

          <button
            class="w-10 h-10 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={() => props.onNext()}
            disabled={!canGoNext()}
            title="next"
            aria-label="next"
          >
            <Icon name="next" size={20} />
          </button>
        </div>

        {/* progress section - fixed width */}
        <div class="flex items-center gap-3 w-80 flex-shrink-0">
          <span
            class="text-sm text-[var(--color-accent-500)] font-light min-w-[2.5rem] text-right"
            title="current time"
          >
            {formatDuration(props.currentTime)}
          </span>

          <div
            class="flex-1 h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:h-2 min-w-24"
            onMouseDown={handleMouseDown}
          >
            <div
              class="h-full bg-gradient-to-r from-[var(--color-accent-500)] to-[var(--color-accent-400)] transition-all duration-100 rounded-full"
              style={{
                width: `${progress()}%`,
              }}
            />
          </div>

          <span
            class="text-sm text-[var(--color-accent-500)] font-light min-w-[2.5rem]"
            title="total duration"
          >
            {formatDuration(props.duration)}
          </span>
        </div>

        {/* volume control */}
        <VolumeControl
          volume={props.volume}
          onVolumeChange={props.onVolumeChange}
          class="flex-shrink-0"
        />

        {/* queue toggle */}
        <div class="flex items-center flex-shrink-0">
          <button
            class={`w-10 h-10 rounded-full border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:scale-110 relative ${
              props.queueOpen
                ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                : "bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/30"
            }`}
            onClick={() => props.onQueueToggle()}
            title={props.queueOpen ? "hide queue" : "show queue"}
            aria-label={props.queueOpen ? "hide queue" : "show queue"}
          >
            <Icon name="queue" size={20} />
            <Show when={(props.queueLength || 0) > 0}>
              <span class="absolute -top-1 -right-1 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                {props.queueLength}
              </span>
            </Show>
          </button>
        </div>
      </div>
    </div>
  );
}
