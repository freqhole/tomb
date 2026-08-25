// simple, non-virtualized queue row for a video (mirrors the essential
// bits of VideoCard.tsx's poster resolution, not QueueSidebar's much
// heavier song-row rendering - see docs/video-domain-phase7-spume-client.md's
// "QueueSidebar video rows" follow-up note for why this stays minimal).
import { createSignal, Show } from "solid-js";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { useLocalVideoPosterUrl } from "../../video/components/VideoCard";
import { MediaImage } from "../media/MediaImage";
import { Icon } from "../icons/registry";
import { formatDuration } from "../../utils/formatDuration";
import { MarqueeText } from "../text/MarqueeText";

export interface VideoQueueRowProps {
  video: QueuedVideo;
  isCurrentlyPlaying: boolean;
  onPlay: () => void;
  onRemove: () => void;
  /** resolved waveform image URL (local blob or P2P/remote), if the
   * video has a waveform blob linked - mirrors the song queue row's
   * waveform background, minus progress-based reveal since video queue
   * rows don't track per-item playback progress. */
  waveformUrl?: string;
}

export function VideoQueueRow(props: VideoQueueRowProps) {
  const [isRowHovered, setIsRowHovered] = createSignal(false);
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  return (
    <div
      class={`relative flex items-center py-2 pl-2 pr-2 group rounded-lg overflow-hidden transition-colors ${
        props.isCurrentlyPlaying
          ? "bg-[var(--color-accent-500)]/10"
          : "hover:bg-[var(--color-accent-500)]/10"
      }`}
      onMouseEnter={() => setIsRowHovered(true)}
      onMouseLeave={() => setIsRowHovered(false)}
      onDblClick={() => props.onPlay()}
      title="double-click to play"
    >
      <Show when={props.waveformUrl}>
        <div
          class="absolute inset-0 pointer-events-none z-0"
          style={{
            "background-image": `url(${props.waveformUrl})`,
            "background-position": "left center",
            "background-size": "100% 100%",
            "background-repeat": "no-repeat",
            opacity: props.isCurrentlyPlaying ? 0.35 : 0.12,
            "mix-blend-mode": "screen",
          }}
        />
      </Show>

      <div class="w-12 h-12 rounded overflow-hidden bg-[var(--color-bg-base)] flex-shrink-0 mr-3 relative z-10">
        <Show
          when={props.video.source_type === "remote"}
          fallback={
            <Show
              when={localPosterUrl()}
              fallback={
                <div class="w-full h-full flex items-center justify-center">
                  <Icon name="video" size={20} color="var(--color-text-tertiary)" />
                </div>
              }
            >
              {(url) => (
                <img src={url()} alt={props.video.title} class="w-full h-full object-cover" />
              )}
            </Show>
          }
        >
          <MediaImage
            remoteBlobId={props.video.poster_blob_id}
            remoteServerId={props.video.remote_server_id}
            alt={props.video.title}
            showFallback={true}
            thumbnailSize={50}
            class="w-full h-full"
          />
        </Show>
        <div class="absolute bottom-0.5 right-0.5 bg-black/70 rounded px-0.5">
          <Icon name="video" size={10} color="white" />
        </div>
      </div>

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
        class="relative z-10 opacity-0 group-hover:opacity-100 p-2 ml-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 rounded transition-all duration-200 flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
        title="remove from queue"
        aria-label="remove from queue"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
