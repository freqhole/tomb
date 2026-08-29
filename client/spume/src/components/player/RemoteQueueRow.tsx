// phase 14a: minimal queue row for a remote target's shared queue
// (`RemoteMediaRef` — title/artist/artwork_thumb_url/duration_ms only, no
// album/favorite/waveform data). deliberately NOT `QueueSongRow` reused
// with a synthesized `Song` — that would need faking ~20 required `Song`
// fields (id, sha256, artist_id, album_id, timestamps, ...) and would
// wire up download-status/waveform/blob-cache hooks that assume THIS
// device is the one playing the audio, which isn't true here (the
// remote player is).
//
// phase 14b: still resolves against the local library by blake3 (see
// getSongByBlake3 — preferred over sha256 per the user's "ripping out
// sha256" preference) so a song this device already has locally shows
// its real thumbnail instead of just whatever `artwork_thumb_url` the
// source device happened to send along.
import { createResource, createSignal, Show } from "solid-js";
import type { RemoteMediaRef } from "../../app/services/players/remotePlaybackControl";
import { getSongByBlake3 } from "../../music/services/storage/db/songs";
import { getSongDisplayImages, getWaveformImage } from "../../utils/images";
import { formatDuration } from "../../utils/formatDuration";
import { isMobile } from "../../utils/isMobile";
import { isCharnelMode } from "../../app/services/charnel";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { MarqueeText } from "../text/MarqueeText";
import { Icon } from "../icons/registry";
import { useResolvedP2PImageUrl } from "../../music/services/storage/blobResolver";
import { getCachedBlobObjectURL } from "../../music/services/storage/blobs";

export interface RemoteQueueRowProps {
  item: RemoteMediaRef;
  /** this row's index in the remote queue (0 = currently playing). */
  index: number;
  isCurrentlyPlaying: boolean;
  /** phase 18: this device's own optimistic, not-yet-acked addition (see
   * remoteQueueMirror.ts's optimisticRemoteQueue) - has no real remote
   * index yet, so drag/reorder/remove are disabled until it's confirmed. */
  isPending?: boolean;
  /** live position (ms) — only meaningful when `isCurrentlyPlaying`. */
  positionMs?: number;
  isDragging: boolean;
  isDropTarget: boolean;
  /** vertical offset for absolute positioning (fixed row height, no
   * virtualizer yet for the remote queue - see QueueSidebar.tsx). */
  top: number;
  onClick: () => void;
  onDoubleClick: () => void;
  onRemove: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  /** pointer-based drag fallback for Tauri (native HTML5 `draggable` drag
   * doesn't work in WKWebView) - only wired up when `isCharnelMode()`. */
  onPointerDown: (e: PointerEvent) => void;
}

export function RemoteQueueRow(props: RemoteQueueRowProps) {
  const [isRowHovered, setIsRowHovered] = createSignal(false);

  const [resolvedSong] = createResource(
    () => props.item.blake3_hash,
    (hash) => getSongByBlake3(hash)
  );

  // phase 14d: waveform overlay, LOCAL-RESOLVED SONGS ONLY - deliberately
  // skipped entirely for a remote-only entry that doesn't resolve to a
  // local `Song` (no bytes on this device to have generated one from, and
  // no point fetching one just to decorate a row for audio this device
  // isn't even playing). mirrors QueueSongRow.tsx's waveformUrl() exactly.
  const waveformUrl = () => {
    const song = resolvedSong();
    if (!song) return undefined;
    const waveformImg = getWaveformImage(song.images);
    if (!waveformImg) return undefined;
    if (waveformImg.local_blob_id) {
      const cached = getCachedBlobObjectURL(waveformImg.local_blob_id);
      if (cached) return cached;
    }
    return resolvedP2PWaveformUrl();
  };

  const resolvedP2PWaveformUrl = useResolvedP2PImageUrl(() => {
    const song = resolvedSong();
    if (!song) return undefined;
    const waveformImg = getWaveformImage(song.images);
    if (!waveformImg) return undefined;
    if (!waveformImg.remote_blob_id || !waveformImg.remote_server_id) return undefined;
    return {
      blobId: waveformImg.remote_blob_id,
      remoteId: waveformImg.remote_server_id,
      httpFallback: waveformImg.remote_url,
    };
  });

  const progress = (): number => {
    if (!props.isCurrentlyPlaying) return 0;
    const dur = props.item.duration_ms;
    if (!dur || props.positionMs === undefined) return 0;
    return Math.min(1, Math.max(0, props.positionMs / dur));
  };

  return (
    <div
      draggable={!isCharnelMode() && !props.isPending}
      class={`absolute top-0 left-0 w-full flex items-center py-2 pl-2 group transition-all duration-200 overflow-hidden ${
        props.isPending ? "cursor-default opacity-60" : "cursor-move"
      } ${
        props.isDropTarget
          ? "bg-[var(--color-accent-500)]/20 border-t-2 border-[var(--color-accent-500)] scale-[1.02]"
          : props.isDragging
            ? "opacity-40 bg-[var(--color-accent-500)]/5 scale-95"
            : "rounded-lg hover:bg-[var(--color-accent-500)]/10"
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
      title={props.isCurrentlyPlaying ? "currently playing" : undefined}
    >
      {/* progress fill background - only for the currently-playing row */}
      <Show when={progress() > 0}>
        <div
          class="absolute inset-y-0 left-0 pointer-events-none z-0"
          style={{ width: "60px", "background-color": "rgba(102, 0, 59, 0.55)" }}
        />
        <div
          class="absolute inset-y-0 pointer-events-none z-0"
          style={{
            left: "60px",
            right: "0",
            "background-color": "rgba(102, 0, 59, 0.55)",
            "clip-path": `inset(0 ${100 - progress() * 100}% 0 0)`,
          }}
        />
        <Show when={waveformUrl()}>
          <div
            class="absolute inset-y-0 pointer-events-none z-0 overflow-hidden"
            style={{
              left: "60px",
              right: "0",
              "clip-path": `inset(0 ${100 - progress() * 100}% 0 0)`,
            }}
          >
            <div
              class="w-full h-full"
              style={{
                "background-image": `url(${waveformUrl()})`,
                "background-position": "left center",
                "background-size": "100% 100%",
                "background-repeat": "no-repeat",
                opacity: 0.5,
                "mix-blend-mode": "screen",
                transform: "scaleY(2)",
              }}
            />
          </div>
        </Show>
      </Show>

      {/* thumbnail — resolved local song's real images take priority,
          falling back to the small artwork thumb the source device sent. */}
      <MediaThumbnail
        images={resolvedSong() ? getSongDisplayImages(resolvedSong()!) : undefined}
        thumbnailUrl={props.item.artwork_thumb_url}
        index={props.index}
        hideIndex={isRowHovered()}
        showPlayIcon={false}
        enablePlayClick={false}
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
          <MarqueeText text={props.item.title || "untitled"} isHovering={isRowHovered} />
        </h4>
        <Show when={props.item.artist}>
          <p
            class={`text-xs m-0 text-shadow-glow ${
              props.isCurrentlyPlaying
                ? "text-[var(--color-text-secondary)] font-semibold"
                : "text-[var(--color-text-tertiary)]"
            }`}
          >
            <MarqueeText text={props.item.artist ?? ""} isHovering={isRowHovered} />
          </p>
        </Show>
      </div>

      <div class="flex flex-col items-center ml-3 flex-shrink-0 relative z-10">
        <Show
          when={!props.isPending}
          fallback={
            <span class="text-xs text-shadow-glow px-1 text-[var(--color-text-muted)] italic">
              queueing…
            </span>
          }
        >
          <span
            class="text-xs text-shadow-glow px-1 tabular-nums text-center min-w-[2.5rem] text-[var(--color-text-secondary)]"
            style={{ "text-decoration": resolvedSong() ? "underline" : undefined }}
            title={resolvedSong() ? "already in your local library" : undefined}
          >
            {formatDuration(
              props.item.duration_ms !== undefined ? props.item.duration_ms / 1000 : undefined
            )}
          </span>
        </Show>
      </div>

      {/* remove button - hidden while pending (no real remote index yet) */}
      <Show when={!props.isPending}>
        <button
          class={`relative z-10 ${isMobile() ? "" : "opacity-0 group-hover:opacity-100 "}p-2 ml-2 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/20 transition-all duration-200 flex-shrink-0`}
          onClick={props.onRemove}
          title="remove from queue"
          aria-label="remove from queue"
        >
          <Icon name="close" size={14} />
        </button>
      </Show>
    </div>
  );
}
