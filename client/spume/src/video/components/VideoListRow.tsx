// shared video list row - thumbnail (with a hover play button), title,
// play count, duration, and a right-click context menu. clicking the row
// itself navigates to the video's own detail page; the thumbnail's play
// button plays it directly (mirrors VideoCard's poster/hover-play split).
// used by VideoSeriesDetailPanel.tsx (episode rows, numbered) and
// VideoDetailView.tsx (a movie's flat "extras" list, unnumbered).
import { createMemo, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { MediaImage } from "../../components/media/MediaImage";
import { ContextMenu } from "../../components/overlays/ContextMenu";
import { PlayIcon } from "../../components/icons/registry";
import { formatDuration } from "../../utils/formatDuration";
import { buildRoute } from "../../music/utils/routing";
import { useVideoContextMenu } from "../hooks/contextMenu";
import { useLocalVideoPosterUrl } from "./VideoCard";
import type { VideoSummary } from "../data/types";

export interface VideoListRowProps {
  video: VideoSummary;
  /** leading numeric label (falls back to `index + 1` when the video has
   *  no `episode_number` of its own) - omit entirely for a list with no
   *  natural order, e.g. a movie's flat extras list. */
  index?: number;
  onPlay: () => void;
  onTagsSaved?: () => void;
}

export function VideoListRow(props: VideoListRowProps) {
  const navigate = useNavigate();
  const contextMenuActions = createMemo(() =>
    useVideoContextMenu(props.video, { showPlayActions: true, onSave: props.onTagsSaved })
  );
  // mirrors VideoCard.tsx's local-poster handling: a local video's
  // auto-imported poster lives in OPFS (poster_opfs_path), not the
  // reliquary blob store poster_blob_id points at.
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  return (
    <ContextMenu actions={contextMenuActions()}>
      <div
        onClick={() => navigate(buildRoute(`/video/${props.video.id}`))}
        class="flex items-center gap-3 px-2 py-2 rounded cursor-pointer hover:bg-[var(--color-bg-elevated)] transition-colors group"
      >
        <Show when={props.index !== undefined}>
          <span class="w-8 text-sm text-[var(--color-text-tertiary)] text-right flex-shrink-0">
            {props.video.episode_number ?? props.index! + 1}
          </span>
        </Show>
        <div class="relative w-16 h-9 flex-shrink-0 rounded overflow-hidden bg-[var(--color-bg-elevated)]">
          <Show
            when={props.video.source_type === "remote"}
            fallback={
              <Show
                when={localPosterUrl()}
                fallback={
                  <MediaImage
                    blobId={props.video.poster_blob_id}
                    alt={props.video.title}
                    showFallback={true}
                    thumbnailSize={50}
                    domainType="video"
                    objectFit="cover"
                    class="w-full h-full"
                  />
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
              domainType="video"
              objectFit="cover"
              class="w-full h-full"
            />
          </Show>
          <div class="absolute inset-0 z-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onPlay();
              }}
              class="w-6 h-6 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center transition-colors"
              title="play"
              aria-label="play"
            >
              <PlayIcon size={12} className="ml-0.5" />
            </button>
          </div>
        </div>
        <span class="flex-1 min-w-0 truncate text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-500)] transition-colors">
          {props.video.title}
        </span>
        <Show when={props.video.play_count != null && props.video.play_count > 0}>
          <span
            class="text-xs text-[var(--color-text-muted)] flex-shrink-0"
            title={`${props.video.play_count} plays`}
          >
            {props.video.play_count}×
          </span>
        </Show>
        <span class="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
          {formatDuration(props.video.duration_seconds)}
        </span>
      </div>
    </ContextMenu>
  );
}
