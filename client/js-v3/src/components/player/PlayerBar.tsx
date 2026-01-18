import { Show, type JSX } from "solid-js";
import { Icon } from "../icons/registry";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import { VolumeControl } from "./VolumeControl";

export interface PlayerBarSong {
  /** song id */
  id: string;
  /** song title */
  title: string;
  /** artist name */
  artist: string;
  /** album name */
  album?: string;
  /** thumbnail image url */
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
  /** additional classes */
  class?: string;
}

// format seconds to MM:SS
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// player bar component for bottom of screen
export function PlayerBar(props: PlayerBarProps) {
  const canGoPrevious = () => props.canGoPrevious ?? true;
  const canGoNext = () => props.canGoNext ?? true;
  const progress = () =>
    props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0;

  let isDragging = false;

  const updateProgress = (e: MouseEvent, target: HTMLElement) => {
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

  return (
    <div
      class={`fixed bottom-0 left-0 right-0 bg-[var(--color-bg-primary)]/90 backdrop-blur-xl p-4 z-50 ${props.class || ""}`}
    >
      <div class="flex items-center gap-6">
        {/* song info - left side with flex-1 */}
        <div class="flex items-center gap-4 flex-1 min-w-0">
          {/* thumbnail */}
          <div class="w-12 h-12 flex-shrink-0">
            <Show
              when={props.song?.thumbnailUrl}
              fallback={
                <div class="w-12 h-12 bg-gradient-to-br from-[var(--color-accent-500)]/20 to-[var(--color-accent-500)]/40 rounded flex items-center justify-center">
                  <Icon
                    name="music"
                    size={24}
                    color="var(--color-accent-500)"
                  />
                </div>
              }
            >
              <img
                src={props.song!.thumbnailUrl}
                alt={props.song!.title}
                class="w-12 h-12 rounded object-cover"
              />
            </Show>
          </div>

          {/* favorite button */}
          <Show when={props.song}>
            <div class="flex-shrink-0">
              <FavoriteHeart
                isFavorite={props.song!.isFavorite || false}
                onToggle={() => props.onFavoriteToggle?.(props.song!.id)}
                size="md"
                class="opacity-80 hover:opacity-100"
              />
            </div>
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
                text={props.song!.artist}
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
            title={
              props.isLoading
                ? "loading..."
                : props.isPlaying
                  ? "pause"
                  : "play"
            }
            aria-label={
              props.isLoading
                ? "loading..."
                : props.isPlaying
                  ? "pause"
                  : "play"
            }
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
            {formatTime(props.currentTime)}
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
            {formatTime(props.duration)}
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
