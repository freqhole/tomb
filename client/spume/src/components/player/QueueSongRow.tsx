// single song row for QueueSidebar's unified queue virtualizer — extracted
// from QueueSidebar.tsx so each row resolves its own waveform/progress
// image independently (tight reactive scoping keeps an unrelated
// sibling row from re-rendering when only this row's own state changes).
import { createSignal, Show } from "solid-js";
import type { Song } from "../../music/data/types";
import { isMobile } from "../../utils/isMobile";
import { formatDuration } from "../../utils/formatDuration";
import { getSongDisplayImages, getWaveformImage } from "../../utils/images";
import { isCharnelMode } from "../../app/services/charnel";
import { Icon } from "../icons/registry";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { MarqueeText } from "../text/MarqueeText";
import { isRemoteBlobCachedReactive } from "../../music/services/cache/blobCache";
import {
  isSongOnDiskEphemeral,
  isSongSyncedLocally,
  getLoadingProgress,
} from "../../music/services/download";
import { isPlayingDirectURLReactive } from "../../music/services/storage/audioAccess";
import { useResolvedP2PImageUrl } from "../../music/services/storage/blobResolver";
import { getCachedBlobObjectURL } from "../../music/services/storage/blobs";

export interface QueueSongRowProps {
  song: Song;
  /** this row's index in the unified queue (used for drag/remove wiring) */
  index: number;
  isCurrentlyPlaying: boolean;
  isUpNext: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  /** vertical offset (virtualizer's `start`) for absolute positioning */
  top: number;
  /** playback progress, 0..1 (only meaningful while currently playing or
   * for a song with stored max progress) */
  progress: number;
  loadingIds?: Set<string>;
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

export function QueueSongRow(props: QueueSongRowProps) {
  const [isRowHovered, setIsRowHovered] = createSignal(false);

  // get waveform URL - check local blob first, then P2P/remote
  const waveformUrl = () => {
    const waveformImg = getWaveformImage(props.song.images);
    if (!waveformImg) return undefined;

    // local blob takes priority when actually present in the browser-side
    // cache (opfs/idb). in charnel mode, db-stored waveforms carry a
    // local_blob_id but live in charnel's sqlite — that lookup will miss,
    // so we fall through to the remote_blob_id path which resolves via
    // the charnel-managed self remote (transport.getBlobUrl).
    if (waveformImg.local_blob_id) {
      const cached = getCachedBlobObjectURL(waveformImg.local_blob_id);
      if (cached) return cached;
    }

    // fall back to remote/P2P resolution
    return resolvedP2PWaveformUrl();
  };

  // P2P waveform resolver (also used for charnel-managed self remote).
  // only skip when there's no remote_* pair to try.
  const resolvedP2PWaveformUrl = useResolvedP2PImageUrl(() => {
    const waveformImg = getWaveformImage(props.song.images);
    if (!waveformImg) return undefined;
    if (!waveformImg.remote_blob_id || !waveformImg.remote_server_id) {
      return undefined;
    }

    return {
      blobId: waveformImg.remote_blob_id,
      remoteId: waveformImg.remote_server_id,
      httpFallback: waveformImg.remote_url,
    };
  });

  return (
    <div
      draggable={!isCharnelMode()}
      class={`absolute top-0 left-0 w-full flex items-center py-2 pl-2 group transition-all duration-200 cursor-move overflow-hidden ${
        props.isDropTarget
          ? "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]"
          : props.isDragging
            ? "opacity-40 bg-[var(--color-accent-500)]/5 scale-95"
            : props.isCurrentlyPlaying
              ? "rounded-lg"
              : props.progress > 0
                ? "rounded-lg"
                : "hover:bg-[var(--color-accent-500)]/10"
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
      {/* progress fill background - behind all content */}
      <Show when={props.progress > 0}>
        {/* static background behind thumbnail */}
        <div
          class="absolute inset-y-0 left-0 pointer-events-none z-0"
          style={{
            width: "60px",
            "background-color": props.isCurrentlyPlaying
              ? "rgba(102, 0, 59, 0.55)"
              : "rgba(102, 0, 59, 0.22)",
          }}
        />
        {/* progress fill layer (starts after thumbnail, reveals progressively) */}
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
        {/* waveform overlay layer (starts after thumbnail, reveals progressively, scaled 2x height) */}
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

      {/* thumbnail with index overlay */}
      <MediaThumbnail
        images={getSongDisplayImages(props.song)}
        index={props.index}
        hideIndex={isRowHovered()}
        isUpNext={props.isUpNext}
        onPlayClick={() => props.onDoubleClick()}
        showPlayIcon={!props.isCurrentlyPlaying}
        enablePlayClick={!props.isCurrentlyPlaying}
        size={48}
        class="mr-3 relative z-10"
      />

      {/* song info */}
      <div class="flex-1 min-w-0 relative z-10">
        <h4
          class={`text-sm font-medium m-0 text-shadow-glow ${
            props.isCurrentlyPlaying
              ? "text-[var(--color-accent-500)] font-semibold"
              : "text-[var(--color-text-primary)]"
          }`}
        >
          <MarqueeText text={props.song.title || ""} isHovering={isRowHovered} />
        </h4>
        <p
          class={`text-xs m-0 text-shadow-glow ${
            props.isCurrentlyPlaying
              ? "text-[var(--color-text-primary)] font-semibold"
              : "text-[var(--color-text-secondary)]"
          }`}
        >
          <MarqueeText
            text={
              props.song.album_type === "compilation" && props.song.track_artist?.trim()
                ? props.song.track_artist!
                : props.song.artist_name || ""
            }
            isHovering={isRowHovered}
          />
        </p>
        <Show when={props.song.album_title}>
          <p
            class={`text-xs m-0 text-shadow-glow ${
              props.isCurrentlyPlaying
                ? "text-[var(--color-text-secondary)] font-semibold"
                : "text-[var(--color-text-tertiary)]"
            }`}
          >
            <MarqueeText text={props.song.album_title || ""} isHovering={isRowHovered} />
          </p>
        </Show>
      </div>

      {/* duration and favorite indicator */}
      <div class="flex flex-col items-center ml-3 flex-shrink-0 relative z-10">
        {/* favorite icon above duration */}
        <div class="h-3 flex items-center -mt-2 mb-1.5">
          <Show when={props.song.is_favorite}>
            <Icon name="favorite" size={10} color="var(--color-accent-500)" />
          </Show>
        </div>
        {/* duration with loading underline */}
        <div class="relative inline-flex flex-col items-center">
          <span
            class="text-xs text-shadow-glow px-1 tabular-nums text-center min-w-[2.5rem]"
            style={{
              color: (() => {
                const isLoading = props.loadingIds?.has(props.song.sha256 ?? "");
                // if loading, let animation handle color
                if (isLoading) return undefined;
                return "var(--color-text-secondary)";
              })(),
              animation: props.loadingIds?.has(props.song.sha256 ?? "")
                ? "pulse-text 4s ease-in-out infinite"
                : undefined,
              "text-decoration": (() => {
                const isLoading = props.loadingIds?.has(props.song.sha256 ?? "");
                // don't underline if currently loading
                if (isLoading) return undefined;

                // local/downloaded/synced songs are always available offline
                const sourceType = props.song.source_type;
                if (
                  sourceType === "local" ||
                  sourceType === "downloaded" ||
                  sourceType === "synced"
                ) {
                  return "underline";
                }

                // check if remote song has been synced to local storage
                if (isSongSyncedLocally(props.song.sha256)) {
                  return "underline";
                }

                // rodio + sync_queue_to_local=off lands audio in
                // `<fetch_dir>/_ephemeral/` without writing any sqlite
                // rows; flip the underline on for those songs too so the
                // row reflects what's actually playable instantly. keyed
                // by blake3 (the disk identifier).
                if (props.song.blake3 && isSongOnDiskEphemeral(props.song.blake3)) {
                  return "underline";
                }

                // for remote songs, underline only when cached (not when playing direct URL)
                const isCached = isRemoteBlobCachedReactive(
                  props.song.remote_server_id,
                  props.song.sha256
                );
                const isPlayingDirect =
                  props.isCurrentlyPlaying && isPlayingDirectURLReactive(props.song.sha256);
                return isCached && !isPlayingDirect ? "underline" : undefined;
              })(),
            }}
          >
            {formatDuration(props.song.duration_seconds)}
          </span>
          {/* loading underline - shows progress or bouncing bar */}
          <Show when={props.loadingIds?.has(props.song.sha256 ?? "")}>
            {(() => {
              const sha256 = props.song.sha256;
              const progress = sha256 ? getLoadingProgress(sha256) : undefined;
              const hasProgress = typeof progress === "number" && progress >= 0;

              return (
                <div
                  class="w-full h-0.5 overflow-hidden rounded-full"
                  style={{ "margin-top": "-2px", background: "rgba(168, 85, 247, 0.2)" }}
                >
                  <div
                    style={{
                      width: hasProgress ? `${Math.min(progress * 100, 100)}%` : "100%",
                      height: "100%",
                      background: "linear-gradient(90deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)",
                      animation: hasProgress ? undefined : "bounce-bar 2s ease-in-out infinite",
                      "border-radius": "9999px",
                      transition: hasProgress ? "width 150ms ease-out" : undefined,
                    }}
                  />
                </div>
              );
            })()}
          </Show>
        </div>
      </div>

      {/* remove button */}
      <button
        class={`relative z-10 ${isMobile() ? "" : "opacity-0 group-hover:opacity-100 "}p-2 ml-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 transition-all duration-200 flex-shrink-0`}
        onClick={props.onRemove}
        title="remove from queue"
        aria-label="remove from queue"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
