import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { getBackgroundConfig } from "../../app/services/backgroundImage";
import type { ImageMetadata } from "../../music/services/storage/types";
import { formatDuration } from "../../utils/formatDuration";
import { getSongDisplayImages, getWaveformImage } from "../../utils/images";
import { useImageCarouselLoading } from "../../music/hooks/modals";
import { Icon, IconNames } from "../icons/registry";
import MediaImage from "../media/MediaImage";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { MarqueeText } from "../text/MarqueeText";
import { VolumeControl } from "./VolumeControl";
import { useLocalVideoPosterUrl } from "../../video/components/VideoCard";

/** poster fields the bar's thumbnail slot needs - a subset of `QueuedVideo`. */
export interface PlayerBarVideo {
  /** video id, needed for the favorite toggle callback */
  id: string;
  title: string;
  source_type?: "local" | "remote";
  poster_blob_id?: string | null;
  poster_opfs_path?: string | null;
  remote_server_id?: string;
}

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
  /** whether there's a pending "up next" song loading (shows spinner but keeps current song info) */
  hasUpNext?: boolean;
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
  /** whether the currently-playing video is favorited (video has no
   * denormalized `is_favorite` field on its own record, so this is passed
   * separately rather than nested in `video`). */
  isVideoFavorite?: boolean;
  /** callback when the currently-playing video's favorite is toggled */
  onVideoFavoriteToggle?: (videoId: string) => void;
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
  /** whether previous button should be shown */
  showPrevious?: boolean;
  /** whether next button should be shown */
  showNext?: boolean;
  /** queue length for badge */
  queueLength?: number;
  /** hide the queue toggle button (e.g., on narrow views when it's in top nav) */
  hideQueueToggle?: boolean;
  /** callback when thumbnail image is clicked */
  onImageClick?: () => void;
  /** callback when title/artist text is clicked */
  onSongMetaClick?: () => void;
  /** optional status chip rendered in the top-right corner of the bar
   * (e.g., the radio "live · N listening" indicator). */
  statusBadge?: JSX.Element;
  /** live stream mode: hide seek/progress + total duration. */
  isLiveStream?: boolean;
  /** show the removable-storage icon slot (only when a device is mounted). */
  showExternalStorageIcon?: boolean;
  /** whether a sync is in progress (reuses the comet-tail loading ring). */
  externalStorageBusy?: boolean;
  /** live per-song sync progress, if known - drives the determinate
   * progress-fill ring + "N/M" badge instead of a plain indeterminate
   * spin once at least one song's progress has been reported. */
  externalStorageProgress?: { current: number; total: number } | null;
  /** callback when the removable-storage icon is clicked (opens the storage overview). */
  onExternalStorageIconClick?: () => void;
  /** whether the active backend is playing video (mounts `videoElement`
   * into the thumbnail slot + shows a fullscreen toggle, instead of the
   * usual song artwork). */
  isVideoActive?: boolean;
  /** the singleton `<video>` element owned by the video backend — moved
   * into the bar's thumbnail slot via DOM append (not recreated), same
   * pattern as `RadioAudioSink`'s owned `<audio>` element. */
  videoElement?: HTMLVideoElement | null;
  /** currently playing video (poster shown in the thumbnail slot, icon
   * fallback when no poster exists). */
  video?: PlayerBarVideo | null;
  /** additional classes */
  class?: string;
}

// compact mode: 801-1200px, reduce progress bar width and padding
const COMPACT_MAX_WIDTH = 1200;

/** small static placeholder shown in the bar's thumbnail slot while a video
 * is active — the actual `<video>` element lives in the floating
 * `VideoMiniPlayer` above the bar (see `AppLayout.tsx`), not here, so only
 * one place ever calls `appendChild` on the shared singleton element.
 * shows the video's poster when one exists, icon otherwise. */
function VideoThumbSlot(props: { sizeClass: string; video?: PlayerBarVideo | null }) {
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video?.source_type === "local" ? (props.video.poster_opfs_path ?? null) : null
  );
  const hasPoster = () =>
    props.video?.source_type === "remote" ? !!props.video.poster_blob_id : !!localPosterUrl();

  return (
    <div
      class={`relative ${props.sizeClass} flex-shrink-0 bg-black rounded overflow-hidden flex items-center justify-center`}
    >
      <Show
        when={hasPoster()}
        fallback={<Icon name={IconNames.video} size={18} className="text-white/70" />}
      >
        <Show
          when={props.video?.source_type === "remote"}
          fallback={
            <img
              src={localPosterUrl()!}
              alt={props.video?.title}
              class="absolute inset-0 w-full h-full object-cover"
            />
          }
        >
          <MediaImage
            remoteBlobId={props.video?.poster_blob_id}
            remoteServerId={props.video?.remote_server_id}
            alt={props.video?.title ?? "video"}
            showFallback={false}
            thumbnailSize={50}
            class="absolute inset-0 w-full h-full object-cover"
          />
        </Show>
      </Show>
    </div>
  );
}

// player bar component for bottom of screen
export function PlayerBar(props: PlayerBarProps) {
  const canGoPrevious = () => props.canGoPrevious ?? true;
  const canGoNext = () => props.canGoNext ?? true;
  const showPrevious = () => props.showPrevious ?? true;
  const showNext = () => props.showNext ?? true;
  const isLiveStream = () => props.isLiveStream ?? false;
  const progress = () => (props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0);
  const songMetaClickable = () => !!props.onSongMetaClick && !!props.song;
  // fraction complete for the removable-storage sync ring, or null while
  // busy but no per-song progress has arrived yet (falls back to a plain
  // indeterminate spin).
  const externalStorageProgressPct = () => {
    const p = props.externalStorageProgress;
    if (!p || p.total <= 0) return null;
    return Math.min(100, Math.max(0, (p.current / p.total) * 100));
  };
  const externalStorageTitle = () => {
    const p = props.externalStorageProgress;
    return p ? `syncing to removable storage (${p.current}/${p.total})` : "removable storage";
  };
  // true while a click on the thumbnail is still resolving image urls
  // for the carousel — shows a spinner instead of the carousel icon.
  const imageCarouselLoading = useImageCarouselLoading();

  // track compact mode (801-1200px)
  const [isCompact, setIsCompact] = createSignal(
    typeof window !== "undefined" &&
      window.innerWidth >= 801 &&
      window.innerWidth <= COMPACT_MAX_WIDTH
  );

  // track waveform image errors (use fallback progress bar instead)
  const [waveformError, setWaveformError] = createSignal(false);

  // track the "display waveform" - the waveform shown in the progress bar
  // we delay switching to new song's waveform until loading completes
  // this is initialized as null, meaning "use incoming waveform"
  const [displayWaveform, setDisplayWaveform] = createSignal<
    ReturnType<typeof getWaveformImage> | null | undefined
  >(undefined);
  const [wasLoading, setWasLoading] = createSignal(false);

  onMount(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth >= 801 && window.innerWidth <= COMPACT_MAX_WIDTH);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  // get waveform image from current song
  const incomingWaveform = createMemo(() => {
    return props.song ? getWaveformImage(props.song.images) : undefined;
  });

  // update display waveform when loading transitions to complete
  // keep previous waveform visible while loading a new song
  createEffect(() => {
    const isLoading = props.isLoading ?? false;
    const prevLoading = wasLoading();

    if (prevLoading && !isLoading) {
      // loading just completed - update display waveform to current song
      setDisplayWaveform(incomingWaveform());
      setWaveformError(false); // reset error for new waveform
    } else if (!prevLoading && isLoading) {
      // loading just started - keep showing the current display waveform (no change)
    } else if (!isLoading && displayWaveform() === undefined) {
      // not loading and no display waveform set yet - use incoming
      setDisplayWaveform(incomingWaveform());
      setWaveformError(false);
    }

    setWasLoading(isLoading);
  });

  // the waveform to actually display in the progress bar
  const waveformImage = createMemo(() => {
    // if we have a stored display waveform, use it
    // otherwise fall back to incoming (initial state)
    return displayWaveform() ?? incomingWaveform();
  });

  // show waveform only if we have image data AND no load error
  const showWaveform = () => waveformImage() && !waveformError();

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
      class={`fixed bottom-0 left-0 right-0 ${getBackgroundConfig() ? "bg-[var(--color-bg-primary)]/40" : "bg-[var(--color-bg-primary)]/90 backdrop-blur-xl"} z-50 ${props.class || ""}`}
      style={{ height: "var(--player-height)", "padding-bottom": "var(--safe-area-bottom, 0px)" }}
    >
      {/* status badge — used by radio mode for the live + listener-count
          chip. rendered inline at the left edge of both narrow row 1 and
          the wide single-row layout so it stays clear of controls and
          the seekbar. */}
      {/* narrow layout: 2 rows — seekbar on top to avoid iOS swipe-up gesture */}
      <div class="flex flex-col h-full wide:hidden px-4 pb-4">
        {/* row 1: live mode = badge + listening time; otherwise status + seek row */}
        <div class="flex items-center gap-2 h-6">
          <span class="text-xs text-[var(--color-accent-500)] font-light min-w-[2rem] text-right tabular-nums">
            {formatDuration(props.currentTime)}
          </span>
          <Show when={props.statusBadge}>
            <div class="flex-shrink-0 min-w-[8.5rem] flex items-center justify-center">
              {props.statusBadge}
            </div>
          </Show>

          <Show when={!isLiveStream()}>
            <>
              {/* progress bar container with waveform background */}
              <div
                class="relative flex-1 h-5 cursor-pointer"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                {/* waveform image - full width, revealed by progress (no scale on narrow) */}
                <Show when={showWaveform()}>
                  {(() => {
                    const waveform = waveformImage()!;
                    return (
                      <>
                        {/* dim waveform background (unplayed portion) */}
                        <div class="absolute inset-0 opacity-20 rounded overflow-hidden">
                          <MediaImage
                            images={[waveform]}
                            alt=""
                            class="w-full h-full object-cover mix-blend-screen"
                            showFallback={false}
                            onError={() => setWaveformError(true)}
                          />
                        </div>
                        {/* bright waveform foreground (played portion) - clipped to progress */}
                        <div
                          class="absolute inset-0 opacity-80 rounded overflow-hidden"
                          style={{ "clip-path": `inset(0 ${100 - progress()}% 0 0)` }}
                        >
                          <MediaImage
                            images={[waveform]}
                            alt=""
                            class="w-full h-full object-cover  mix-blend-screen"
                            showFallback={false}
                          />
                        </div>
                        {/* progress line indicator */}
                        <div
                          class="absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent-500)] shadow-[0_0_4px_var(--color-accent-500)]"
                          style={{ left: `${progress()}%` }}
                        />
                      </>
                    );
                  })()}
                </Show>

                {/* fallback progress bar - only show if no waveform */}
                <Show when={!showWaveform()}>
                  <div class="absolute inset-y-0 left-0 right-0 flex items-center">
                    <div class="w-full h-1.5 bg-[var(--color-accent-500)]/20 rounded-full overflow-hidden">
                      <div
                        class="h-full bg-gradient-to-r from-[var(--color-accent-500)] to-[var(--color-accent-400)] rounded-full"
                        style={{ width: `${progress()}%` }}
                      />
                    </div>
                  </div>
                </Show>
              </div>

              <span class="text-xs text-[var(--color-accent-500)] font-light min-w-[2rem] tabular-nums">
                {formatDuration(props.duration)}
              </span>
            </>
          </Show>
        </div>

        {/* row 2: thumbnail, fav, title/artist, controls, queue */}
        <div class="flex items-center gap-2 flex-1 min-h-0">
          {/* removable-storage icon */}
          <Show when={props.showExternalStorageIcon}>
            <div class="relative flex-shrink-0">
              <Show when={props.externalStorageBusy}>
                <div
                  class="absolute inset-[-4px] rounded-full pointer-events-none"
                  style={{
                    background:
                      externalStorageProgressPct() !== null
                        ? `conic-gradient(from -90deg, #ec4899 ${externalStorageProgressPct()}%, #ec489930 ${externalStorageProgressPct()}%)`
                        : "conic-gradient(from 0deg, transparent 0%, #ec489920 6%, #ec489940 12%, #ec489980 20%, #ec4899cc 28%, #ec4899 38%, #c026d3 55%, #a855f7 70%, #a855f7 86%, transparent 88%)",
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                    "-webkit-mask":
                      "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                    animation:
                      externalStorageProgressPct() !== null
                        ? "external-storage-sync-pulse 1.6s ease-in-out infinite"
                        : "spin 1.5s linear infinite",
                  }}
                />
              </Show>
              <button
                class="w-8 h-8 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-colors flex items-center justify-center hover:bg-[var(--color-accent-500)]/30"
                onClick={() => props.onExternalStorageIconClick?.()}
                title={externalStorageTitle()}
                aria-label="removable storage"
              >
                <Icon name={IconNames.sdCard} size={16} />
              </button>
              <Show when={props.externalStorageBusy && props.externalStorageProgress}>
                {(p) => (
                  <span class="absolute -bottom-1 -right-1 px-1 rounded-full bg-[var(--color-bg-primary)] border border-[var(--color-accent-500)]/50 text-[8px] leading-[10px] text-[var(--color-accent-500)] font-semibold tabular-nums whitespace-nowrap pointer-events-none">
                    {p().current}/{p().total}
                  </span>
                )}
              </Show>
            </div>
          </Show>

          {/* thumbnail */}
          <Show
            when={props.isVideoActive && props.videoElement}
            fallback={
              <div
                class={`relative group w-10 h-10 flex-shrink-0 ${props.onImageClick ? "cursor-pointer" : ""}`}
                onClick={() => props.onImageClick?.()}
              >
                <MediaImage
                  images={props.song ? getSongDisplayImages(props.song) : undefined}
                  blobId={props.song?.thumbnailBlobId}
                  imageUrl={props.song?.thumbnailUrl}
                  alt={props.song?.title || "song artwork"}
                  domainType="song"
                  thumbnailSize={50}
                  class="w-10 h-10 rounded object-cover"
                />
                <Show when={props.onImageClick && props.song}>
                  <div
                    class="absolute inset-0 bg-black/0 transition-colors flex items-center justify-center rounded"
                    classList={{
                      "opacity-0 group-hover:bg-black/30 group-hover:opacity-100":
                        !imageCarouselLoading(),
                      "bg-black/30 opacity-100": imageCarouselLoading(),
                    }}
                  >
                    <Show
                      when={!imageCarouselLoading()}
                      fallback={
                        <Icon
                          name={IconNames.loader}
                          size={16}
                          className="text-white drop-shadow-lg animate-spin"
                        />
                      }
                    >
                      <Icon
                        name={IconNames.carousel}
                        size={16}
                        className="text-white drop-shadow-lg"
                      />
                    </Show>
                  </div>
                </Show>
              </div>
            }
          >
            <VideoThumbSlot sizeClass="w-10 h-10" video={props.video} />
          </Show>

          {/* favorite button */}
          <Show when={!props.isVideoActive && props.song}>
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
          <Show when={props.isVideoActive && props.video}>
            {(video) => (
              <div class="flex-shrink-0">
                <FavoriteHeart
                  isFavorite={props.isVideoFavorite || false}
                  onToggle={() => props.onVideoFavoriteToggle?.(video().id)}
                  size="sm"
                  class="opacity-80"
                />
              </div>
            )}
          </Show>

          {/* title/artist - flex-1 with truncation */}
          <div
            class="flex-1 min-w-0"
            classList={{ "cursor-pointer": songMetaClickable() }}
            onClick={() => props.onSongMetaClick?.()}
            title={songMetaClickable() ? "open album" : undefined}
          >
            <Show
              when={props.song}
              fallback={
                <div class="text-[var(--color-text-secondary)] text-sm">no song playing</div>
              }
            >
              <MarqueeText
                text={props.song!.title}
                class={`text-[var(--color-text-primary)] font-medium text-sm ${songMetaClickable() ? "hover:underline decoration-[1px] underline-offset-2" : ""}`}
              />
              <MarqueeText
                text={
                  props.song!.album
                    ? `${props.song!.artist} - ${props.song!.album}`
                    : props.song!.artist
                }
                class={`text-[var(--color-text-tertiary)] text-xs ${songMetaClickable() ? "hover:underline decoration-[1px] underline-offset-2" : ""}`}
              />
            </Show>
          </div>

          {/* compact controls */}
          <div class="flex items-center gap-1 flex-shrink-0">
            <Show when={showPrevious()}>
              <button
                class="w-8 h-8 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-colors flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => props.onPrevious()}
                disabled={!canGoPrevious()}
                title="previous"
                aria-label="previous"
              >
                <Icon name="previous" size={16} />
              </button>
            </Show>

            <div class="relative">
              {/* loading ring - gradient arc (shows for isLoading OR hasUpNext) */}
              <Show when={props.isLoading || props.hasUpNext}>
                <div
                  class="absolute inset-[-4px] rounded-full pointer-events-none"
                  style={{
                    background:
                      "conic-gradient(from 0deg, transparent 0%, #ec489920 6%, #ec489940 12%, #ec489980 20%, #ec4899cc 28%, #ec4899 38%, #c026d3 55%, #a855f7 70%, #a855f7 86%, transparent 88%)",
                    mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                    "-webkit-mask":
                      "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                    animation: "spin 1.5s linear infinite",
                  }}
                />
              </Show>
              <button
                class="w-10 h-10 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] border-none cursor-pointer transition-colors flex items-center justify-center disabled:cursor-wait"
                onClick={() => props.onPlayPause()}
                disabled={props.isLoading}
                title={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
                aria-label={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
              >
                <Icon name={props.isPlaying ? "pause" : "play"} size={20} />
              </button>
            </div>

            <Show when={showNext()}>
              <button
                class="w-8 h-8 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-colors flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => props.onNext()}
                disabled={!canGoNext()}
                title="next"
                aria-label="next"
              >
                <Icon name="next" size={16} />
              </button>
            </Show>
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
      </div>

      {/* wide layout: single row (hidden on narrow) */}
      <div
        class="hidden wide:flex items-center h-full"
        classList={{
          "gap-4 p-3": isCompact(),
          "gap-6 p-4": !isCompact(),
        }}
      >
        {/* song info - left side with flex-1 */}
        <div class="flex items-center gap-4 flex-1 min-w-0">
          <div class="flex items-center gap-4 flex-shrink-0">
            {/* removable-storage icon */}
            <Show when={props.showExternalStorageIcon}>
              <div class="relative flex-shrink-0">
                <Show when={props.externalStorageBusy}>
                  <div
                    class="absolute inset-[-4px] rounded-full pointer-events-none"
                    style={{
                      background:
                        externalStorageProgressPct() !== null
                          ? `conic-gradient(from -90deg, #ec4899 ${externalStorageProgressPct()}%, #ec489930 ${externalStorageProgressPct()}%)`
                          : "conic-gradient(from 0deg, transparent 0%, #ec489920 6%, #ec489940 12%, #ec489980 20%, #ec4899cc 28%, #ec4899 38%, #c026d3 55%, #a855f7 70%, #a855f7 86%, transparent 88%)",
                      mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                      "-webkit-mask":
                        "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                      animation:
                        externalStorageProgressPct() !== null
                          ? "external-storage-sync-pulse 1.6s ease-in-out infinite"
                          : "spin 1.5s linear infinite",
                    }}
                  />
                </Show>
                <button
                  class="w-10 h-10 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-colors flex items-center justify-center hover:bg-[var(--color-accent-500)]/30"
                  onClick={() => props.onExternalStorageIconClick?.()}
                  title={externalStorageTitle()}
                  aria-label="removable storage"
                >
                  <Icon name={IconNames.sdCard} size={20} />
                </button>
                <Show when={props.externalStorageBusy && props.externalStorageProgress}>
                  {(p) => (
                    <span class="absolute -bottom-1 -right-1 px-1 rounded-full bg-[var(--color-bg-primary)] border border-[var(--color-accent-500)]/50 text-[9px] leading-[11px] text-[var(--color-accent-500)] font-semibold tabular-nums whitespace-nowrap pointer-events-none">
                      {p().current}/{p().total}
                    </span>
                  )}
                </Show>
              </div>
            </Show>

            {/* thumbnail */}
            <Show
              when={props.isVideoActive && props.videoElement}
              fallback={
                <div
                  class={`relative group w-12 h-12 flex-shrink-0 ${props.onImageClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
                  onClick={() => props.onImageClick?.()}
                >
                  <MediaImage
                    images={props.song ? getSongDisplayImages(props.song) : undefined}
                    blobId={props.song?.thumbnailBlobId}
                    imageUrl={props.song?.thumbnailUrl}
                    alt={props.song?.title || "song artwork"}
                    domainType="song"
                    thumbnailSize={50}
                    class="w-12 h-12 rounded object-cover"
                  />
                  <Show when={props.onImageClick && props.song}>
                    <div
                      class="absolute inset-0 bg-black/0 transition-colors flex items-center justify-center rounded"
                      classList={{
                        "opacity-0 group-hover:bg-black/30 group-hover:opacity-100":
                          !imageCarouselLoading(),
                        "bg-black/30 opacity-100": imageCarouselLoading(),
                      }}
                    >
                      <Show
                        when={!imageCarouselLoading()}
                        fallback={
                          <Icon
                            name={IconNames.loader}
                            size={20}
                            className="text-white drop-shadow-lg animate-spin"
                          />
                        }
                      >
                        <Icon
                          name={IconNames.carousel}
                          size={20}
                          className="text-white drop-shadow-lg"
                        />
                      </Show>
                    </div>
                  </Show>
                </div>
              }
            >
              <VideoThumbSlot sizeClass="w-12 h-12" video={props.video} />
            </Show>

            {/* favorite button */}
            <Show when={!props.isVideoActive && props.song}>
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
            <Show when={props.isVideoActive && props.video}>
              {(video) => (
                <div class="flex-shrink-0">
                  <FavoriteHeart
                    isFavorite={props.isVideoFavorite || false}
                    onToggle={() => props.onVideoFavoriteToggle?.(video().id)}
                    size="md"
                    class="opacity-80 hover:opacity-100"
                  />
                </div>
              )}
            </Show>
          </div>

          {/* title and artist - fills remaining space */}
          <div
            class="flex-1 min-w-0"
            classList={{ "cursor-pointer": songMetaClickable() }}
            onClick={() => props.onSongMetaClick?.()}
            title={songMetaClickable() ? "open album" : undefined}
          >
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
                class={`text-[var(--color-text-primary)] font-medium text-base ${songMetaClickable() ? "hover:underline decoration-[1px] underline-offset-2" : ""}`}
              />
              <MarqueeText
                text={
                  props.song!.album
                    ? `${props.song!.artist} - ${props.song!.album}`
                    : props.song!.artist
                }
                class={`text-[var(--color-text-secondary)] font-light text-sm ${songMetaClickable() ? "hover:underline decoration-[1px] underline-offset-2" : ""}`}
              />
            </Show>

            {/* status badge is rendered in the time/progress slot so it sits
                in the same place across narrow and wide layouts. */}
          </div>
        </div>

        {/* player controls - centered */}
        <div class="flex items-center gap-3 flex-shrink-0">
          <Show when={showPrevious()}>
            <button
              class="w-10 h-10 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              onClick={() => props.onPrevious()}
              disabled={!canGoPrevious()}
              title="previous"
              aria-label="previous"
            >
              <Icon name="previous" size={20} />
            </button>
          </Show>

          <div class="relative">
            {/* loading ring - gradient arc (shows for isLoading OR hasUpNext) */}
            <Show when={props.isLoading || props.hasUpNext}>
              <div
                class="absolute inset-[-4px] rounded-full pointer-events-none"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0%, #ec489920 6%, #ec489940 12%, #ec489980 20%, #ec4899cc 28%, #ec4899 38%, #c026d3 55%, #a855f7 70%, #a855f7 86%, transparent 88%)",
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                  "-webkit-mask":
                    "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                  animation: "spin 1.5s linear infinite",
                }}
              />
            </Show>
            <button
              class="w-12 h-12 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:scale-105 disabled:cursor-wait"
              onClick={() => props.onPlayPause()}
              disabled={props.isLoading}
              title={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
              aria-label={props.isLoading ? "loading..." : props.isPlaying ? "pause" : "play"}
            >
              <Icon name={props.isPlaying ? "pause" : "play"} size={24} />
            </button>
          </div>

          <Show when={showNext()}>
            <button
              class="w-10 h-10 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-[var(--color-accent-500)]/30 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              onClick={() => props.onNext()}
              disabled={!canGoNext()}
              title="next"
              aria-label="next"
            >
              <Icon name="next" size={20} />
            </button>
          </Show>
        </div>

        {/* progress section - responsive width based on viewport */}
        <div
          class="flex items-center gap-3 flex-shrink-0"
          classList={{
            "w-48": isCompact(),
            "w-80": !isCompact(),
          }}
        >
          <span
            class="text-sm text-[var(--color-accent-500)] font-light min-w-[2.5rem] text-right tabular-nums"
            title={isLiveStream() ? "listening time" : "current time"}
          >
            {formatDuration(props.currentTime)}
          </span>

          <Show when={props.statusBadge}>
            <div class="flex-shrink-0 min-w-[10.5rem] flex items-center justify-center leading-none wide:[&_span]:text-[11px] wide:[&_span]:tracking-normal wide:[&_span]:font-semibold wide:[&_.w-1]:w-1.5 wide:[&_.h-1]:h-1.5">
              {props.statusBadge}
            </div>
          </Show>

          <Show when={!isLiveStream()}>
            <>
              {/* progress bar container with waveform background - tall on wide screens */}
              <div
                class="relative flex-1 cursor-pointer min-w-16"
                classList={{
                  "h-10": isCompact(),
                  "h-12": !isCompact(),
                }}
                onMouseDown={handleMouseDown}
              >
                {/* waveform image - full width, revealed by progress */}
                <Show when={showWaveform()}>
                  {(() => {
                    const waveform = waveformImage()!;
                    return (
                      <>
                        {/* dim waveform background (unplayed portion) */}
                        <div class="absolute inset-0 opacity-20 rounded overflow-hidden">
                          <div class="w-full h-full" style={{ transform: "scaleY(2)" }}>
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
                          <div class="w-full h-full" style={{ transform: "scaleY(2)" }}>
                            <MediaImage
                              images={[waveform]}
                              alt=""
                              class="w-full h-full object-cover  mix-blend-screen"
                              showFallback={false}
                            />
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </Show>

                {/* fallback progress bar - only show if no waveform */}
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

                {/* progress line indicator (thin line at current position) */}
                <Show when={showWaveform()}>
                  <div
                    class="absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent-500)] shadow-[0_0_4px_var(--color-accent-500)]"
                    style={{ left: `${progress()}%` }}
                  />
                </Show>
              </div>

              <span
                class="text-sm text-[var(--color-accent-500)] font-light min-w-[2.5rem] tabular-nums"
                title="total duration"
              >
                {formatDuration(props.duration)}
              </span>
            </>
          </Show>
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
