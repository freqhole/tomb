// shared playback progress bar - current time, a waveform-fill (or plain
// gradient fallback) seek bar, and total duration, laid out the same way
// PlayerBar.tsx has always done it. extracted so other playback surfaces
// (e.g. the cenotaph player view) can reuse the exact same UI/behavior
// instead of re-implementing a time readout from scratch.
import { createSignal, Show, type JSX } from "solid-js";
import MediaImage from "../media/MediaImage";
import { formatDuration } from "../../utils/formatDuration";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface PlaybackProgressBarProps {
  currentTime: number;
  duration: number;
  /** waveform image to progressively reveal as playback advances; omit to
   *  fall back to a plain gradient bar fill. */
  waveformImage?: ImageMetadata;
  /** omit to render a non-interactive (no click-to-seek) bar. */
  onSeek?: (percentage: number) => void;
  /** the thin vertical line marking the current position over the
   *  waveform - PlayerBar always wants it; other embeds may not. default
   *  true. */
  showPlayhead?: boolean;
  /** tailwind classes for the bar container itself (height, min-width,
   *  etc). default "h-5". */
  barClass?: string;
  /** vertically stretches the waveform image 2x - PlayerBar's wide
   *  layout does this so a thin source image reads as a taller bar. */
  scaleWaveform?: boolean;
  /** classes for the outer flex row (time - bar - time). */
  class?: string;
  /** classes applied to both time labels (font size, min-width, etc). */
  timeClass?: string;
  /** title attribute for the current-time (left) label. */
  currentTimeTitle?: string;
  /** title attribute for the duration (right) label. */
  durationTitle?: string;
  /** optional chip rendered between the current-time label and the bar
   *  (e.g. PlayerBar's radio "live · N listening" status badge). */
  statusBadge?: JSX.Element;
  /** classes for the status badge's wrapper div (width, typography overrides). */
  statusBadgeClass?: string;
  /** hides the bar + total-duration label, keeping only the current-time
   *  label - mirrors PlayerBar's live-stream ("listening time", no
   *  seekable duration) mode. default false. */
  hideBarAndDuration?: boolean;
  /** tailwind gap class between time labels/badge/bar. default "gap-3". */
  gapClass?: string;
}

export function PlaybackProgressBar(props: PlaybackProgressBarProps) {
  const [waveformError, setWaveformError] = createSignal(false);
  const progress = () => (props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0);
  const showWaveform = () => !!props.waveformImage && !waveformError();
  const showPlayhead = () => props.showPlayhead !== false;

  let isDragging = false;
  const updateProgress = (point: MouseEvent | Touch, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const x = point.clientX - rect.left;
    const clampedX = Math.max(0, Math.min(x, rect.width));
    props.onSeek?.((clampedX / rect.width) * 100);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!props.onSeek) return;
    isDragging = true;
    const target = e.currentTarget as HTMLElement;
    updateProgress(e, target);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (isDragging) updateProgress(moveEvent, target);
    };
    const handleMouseUp = () => {
      isDragging = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (!props.onSeek) return;
    isDragging = true;
    updateProgress(e.touches[0], e.currentTarget as HTMLElement);
  };
  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging) return;
    updateProgress(e.touches[0], e.currentTarget as HTMLElement);
  };
  const handleTouchEnd = () => {
    isDragging = false;
  };

  return (
    <div class={`flex items-center ${props.gapClass ?? "gap-3"} ${props.class ?? ""}`}>
      <span
        class={`text-xs text-[var(--color-accent-500)] font-light min-w-[2rem] text-right tabular-nums ${props.timeClass ?? ""}`}
        title={props.currentTimeTitle}
      >
        {formatDuration(props.currentTime)}
      </span>

      <Show when={props.statusBadge}>
        <div
          class={`flex-shrink-0 flex items-center justify-center ${props.statusBadgeClass ?? ""}`}
        >
          {props.statusBadge}
        </div>
      </Show>

      <Show when={!props.hideBarAndDuration}>
        <>
          <div
            class={`relative flex-1 ${props.barClass ?? "h-5"} ${props.onSeek ? "cursor-pointer" : ""}`}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* waveform image - full width, revealed by progress */}
            <Show when={showWaveform()}>
              {(() => {
                const waveform = props.waveformImage!;
                return (
                  <>
                    {/* dim waveform background (unplayed portion) */}
                    <div class="absolute inset-0 opacity-20 rounded overflow-hidden">
                      <div
                        class="w-full h-full"
                        style={props.scaleWaveform ? { transform: "scaleY(2)" } : undefined}
                      >
                        <MediaImage
                          images={[waveform]}
                          alt=""
                          class="w-full h-full object-cover mix-blend-screen"
                          showFallback={false}
                          onError={() => setWaveformError(true)}
                        />
                      </div>
                    </div>
                    {/* bright waveform foreground (played portion) - clipped to progress */}
                    <div
                      class="absolute inset-0 opacity-80 rounded overflow-hidden"
                      style={{ "clip-path": `inset(0 ${100 - progress()}% 0 0)` }}
                    >
                      <div
                        class="w-full h-full"
                        style={props.scaleWaveform ? { transform: "scaleY(2)" } : undefined}
                      >
                        <MediaImage
                          images={[waveform]}
                          alt=""
                          class="w-full h-full object-cover  mix-blend-screen"
                          showFallback={false}
                        />
                      </div>
                    </div>
                    <Show when={showPlayhead()}>
                      <div
                        class="absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent-500)] shadow-[0_0_4px_var(--color-accent-500)]"
                        style={{ left: `${progress()}%` }}
                      />
                    </Show>
                  </>
                );
              })()}
            </Show>

            {/* fallback progress bar - only shown if no waveform */}
            <Show when={!showWaveform()}>
              <div class="absolute inset-y-0 left-0 right-0 flex items-center">
                <div class="w-full h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden transition-all duration-200 hover:h-2">
                  <div
                    class="h-full bg-gradient-to-r from-[var(--color-accent-500)] to-[var(--color-accent-400)] transition-all duration-100 rounded-full"
                    style={{ width: `${progress()}%` }}
                  />
                </div>
              </div>
            </Show>
          </div>

          <span
            class={`text-xs text-[var(--color-accent-500)] font-light min-w-[2rem] tabular-nums ${props.timeClass ?? ""}`}
            title={props.durationTitle}
          >
            {formatDuration(props.duration)}
          </span>
        </>
      </Show>
    </div>
  );
}
