// video row for QueueSidebar's unified queue virtualizer — shares the
// same virtualizer/drag-reorder machinery as song rows (phase 4b) and
// now also shares QueueSongRow's progress-fill/waveform-overlay markup
// and the shared MediaThumbnail component (memoized image resolution +
// corner-badge support) instead of a hand-rolled thumbnail block.
import { createSignal, Show } from "solid-js";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { useLocalVideoPosterUrl } from "../../video/components/VideoCard";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { Icon } from "../icons/registry";
import { formatDuration } from "../../utils/formatDuration";
import { MarqueeText } from "../text/MarqueeText";
import { isMobile } from "../../utils/isMobile";
import { isCharnelMode } from "../../app/services/charnel";
import { getWaveformImage } from "../../utils/images";
import { useResolvedP2PImageUrl } from "../../music/services/storage/blobResolver";
import { getCachedBlobObjectURL } from "../../music/services/storage/blobs";

export interface VideoQueueRowProps {
  video: QueuedVideo;
  isCurrentlyPlaying: boolean;
  isUpNext: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  /** vertical offset (virtualizer's `start`) for absolute positioning */
  top: number;
  /** playback progress, 0..1 (only meaningful while currently playing —
   * video items don't have a stored max-progress like songs do yet) */
  progress: number;
  onClick: () => void;
  onDoubleClick: () => void;
  onRemove: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onPointerDown: (e: PointerEvent) => void;
}

export function VideoQueueRow(props: VideoQueueRowProps) {
  const [isRowHovered, setIsRowHovered] = createSignal(false);
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  // MediaThumbnail's `images` prop only understands local_blob_id/
  // remote_blob_id/remote_url, not OPFS paths — a purely-local video's
  // poster is resolved separately above and passed as `thumbnailUrl`
  // (mirrors VideoCard.tsx/PlaylistsView.tsx's video row pattern).
  const images = () =>
    props.video.poster_blob_id
      ? [
          {
            remote_blob_id: props.video.poster_blob_id,
            remote_server_id: props.video.remote_server_id ?? undefined,
            is_primary: true,
            blob_type: "thumbnail" as const,
          },
        ]
      : [];

  // get waveform URL - check local blob first, then P2P/remote (mirrors
  // QueueSongRow.tsx's waveformUrl resolution).
  const waveformImg = () =>
    getWaveformImage(
      props.video.images?.map((img) => ({
        remote_blob_id: img.blob_id,
        remote_server_id: props.video.remote_server_id,
        is_primary: !!img.is_primary,
        blob_type: img.blob_type,
      }))
    );

  const resolvedP2PWaveformUrl = useResolvedP2PImageUrl(() => {
    const img = waveformImg();
    if (!img?.remote_blob_id || !img?.remote_server_id) return undefined;
    return {
      blobId: img.remote_blob_id,
      remoteId: img.remote_server_id,
      httpFallback: img.remote_url,
    };
  });

  const waveformUrl = () => {
    const img = waveformImg();
    if (!img) return undefined;
    if (img.local_blob_id) {
      const cached = getCachedBlobObjectURL(img.local_blob_id);
      if (cached) return cached;
    }
    return resolvedP2PWaveformUrl();
  };

  return (
    <div
      draggable={!isCharnelMode()}
      class={`absolute top-0 left-0 w-full flex items-center py-2 pl-2 pr-2 group overflow-hidden cursor-move transition-all duration-200 ${
        props.isDropTarget
          ? "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]"
          : props.isDragging
            ? "opacity-40 bg-[var(--color-accent-500)]/5 scale-95"
            : props.isCurrentlyPlaying
              ? "rounded-lg"
              : props.progress > 0
                ? "rounded-lg"
                : "hover:bg-[var(--color-accent-500)]/10 rounded-lg"
      }`}
      style={{ transform: `translateY(${props.top}px)` }}
      onMouseEnter={() => setIsRowHovered(true)}
      onMouseLeave={() => setIsRowHovered(false)}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDragEnd={props.onDragEnd}
      onDrop={props.onDrop}
      onPointerDown={props.onPointerDown}
      onClick={() => {
        if (isMobile()) props.onClick();
      }}
      onDblClick={() => {
        if (!isMobile()) props.onDoubleClick();
      }}
      title={
        props.isCurrentlyPlaying
          ? "currently playing"
          : isMobile()
            ? "tap to play"
            : "double-click to play"
      }
    >
      {/* progress fill background - behind all content, mirrors
          QueueSongRow's layering (static block behind thumbnail, then a
          progressive reveal clipped to playback progress) */}
      <Show when={props.progress > 0}>
        <div
          class="absolute inset-y-0 left-0 pointer-events-none z-0"
          style={{
            width: "60px",
            "background-color": props.isCurrentlyPlaying
              ? "rgba(102, 0, 59, 0.55)"
              : "rgba(102, 0, 59, 0.22)",
          }}
        />
        <div
          class="absolute inset-y-0 pointer-events-none z-0"
          style={{
            left: "60px",
            right: "0",
            "background-color": props.isCurrentlyPlaying
              ? "rgba(102, 0, 59, 0.55)"
              : "rgba(102, 0, 59, 0.22)",
            "clip-path": `inset(0 ${100 - Math.min(props.progress * 100, 100)}% 0 0)`,
          }}
        />
        <Show when={waveformUrl()}>
          <div
            class="absolute inset-y-0 pointer-events-none z-0 overflow-hidden"
            style={{
              left: "60px",
              right: "0",
              "clip-path": `inset(0 ${100 - Math.min(props.progress * 100, 100)}% 0 0)`,
            }}
          >
            <div
              class="w-full h-full"
              style={{
                "background-image": `url(${waveformUrl()})`,
                "background-position": "left center",
                "background-size": "100% 100%",
                "background-repeat": "no-repeat",
                opacity: props.isCurrentlyPlaying ? 0.5 : 0.15,
                "mix-blend-mode": "screen",
                transform: "scaleY(2)",
              }}
            />
          </div>
        </Show>
      </Show>
      {/* flat waveform background when there's no progress yet (not
          currently playing, nothing watched) - matches the old row's
          always-on background image */}
      <Show when={props.progress === 0 && waveformUrl()}>
        <div
          class="absolute inset-0 pointer-events-none z-0"
          style={{
            "background-image": `url(${waveformUrl()})`,
            "background-position": "left center",
            "background-size": "100% 100%",
            "background-repeat": "no-repeat",
            opacity: 0.12,
            "mix-blend-mode": "screen",
          }}
        />
      </Show>

      <MediaThumbnail
        images={images()}
        thumbnailUrl={
          props.video.source_type === "local" ? (localPosterUrl() ?? undefined) : undefined
        }
        hideIndex
        isUpNext={props.isUpNext}
        onPlayClick={() => props.onDoubleClick()}
        showPlayIcon={!props.isCurrentlyPlaying}
        enablePlayClick={!props.isCurrentlyPlaying}
        fallbackIcon="video"
        cornerBadgeIcon="video"
        size={48}
        class="mr-3 relative z-10"
      />

      <div class="flex-1 min-w-0 relative z-10">
        <h4
          class={`text-sm font-medium m-0 text-shadow-glow ${
            props.isCurrentlyPlaying
              ? "text-[var(--color-accent-500)] font-semibold"
              : "text-[var(--color-text-primary)]"
          }`}
        >
          <MarqueeText text={props.video.title} isHovering={isRowHovered} />
        </h4>
        <p class="text-xs m-0 text-[var(--color-text-secondary)]">
          {formatDuration(props.video.duration_seconds ?? undefined)}
        </p>
      </div>

      <button
        class={`relative z-10 ${isMobile() ? "" : "opacity-0 group-hover:opacity-100 "}p-2 ml-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 rounded transition-all duration-200 flex-shrink-0`}
        onClick={props.onRemove}
        title="remove from queue"
        aria-label="remove from queue"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
