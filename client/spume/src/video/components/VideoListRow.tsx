// shared video list row - thumbnail (with a hover play button), title,
// play count, duration, and a right-click context menu. clicking the row
// itself navigates to the video's own detail page; the thumbnail's play
// button plays it directly (mirrors VideoCard's poster/hover-play split).
// used by VideoSeriesDetailPanel.tsx (episode rows, numbered) and
// VideoDetailView.tsx (a movie's flat "extras" list, unnumbered).
import { createMemo, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { MediaImage } from "../../components/media/MediaImage";
import { hasBackgroundImage } from "../../app/services/backgroundImage";
import { ContextMenu, ClickDropdownMenu } from "../../components/overlays/ContextMenu";
import { PlayIcon } from "../../components/icons/registry";
import { Rating } from "../../components/ratings/Rating";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { MarqueeText } from "../../components/text/MarqueeText";
import { formatDuration } from "../../utils/formatDuration";
import { buildRoute } from "../../music/utils/routing";
import { useVideoContextMenu } from "../hooks/contextMenu";
import {
  useVideoStreamContextMenuActions,
  spliceStreamMenuActions,
} from "../hooks/useVideoStreamContextMenuActions";
import { createShareSourceRemote } from "../../app/services/remotes/shareSource";
import { useLocalVideoPosterUrl } from "./VideoCard";
import { contentTypeLabel } from "../utils/contentType";
import { getWaveformImage } from "../../utils/images";
import { useResolvedP2PImageUrl } from "../../music/services/storage/blobResolver";
import { getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import type { VideoSummary } from "../data/types";

export interface VideoListRowProps {
  video: VideoSummary;
  /** leading numeric label (falls back to `index + 1` when the video has
   *  no `episode_number` of its own) - omit entirely for a list with no
   *  natural order, e.g. a movie's flat extras list. */
  index?: number;
  onPlay: () => void;
  onTagsSaved?: () => void;
  /** show the content type ("music video", "karaoke", ...) next to the title. */
  showContentType?: boolean;
  /** the caller's own rating (0-5) - omit the whole control by leaving
   *  `onRatingChange` unset (mirrors VideosTable.tsx's `<Show>` gating). */
  rating?: number;
  onRatingChange?: (rating: number) => void;
  isFavorite?: boolean;
  onFavoriteToggle?: (isFavorite: boolean) => void;
  /** watch progress (0..1), when known - renders the same accent-fill +
   *  waveform-overlay treatment VideoQueueRow/QueueSongRow use for queue
   *  rows (see queries/progress.ts's useVideoProgressQuery, used by both
   *  VideoSeriesDetailPanel and VideoDetailView's extras section).
   *  omit (or 0) for "no progress data" - renders a plain row, same as
   *  before this prop existed. */
  progress?: number;
}

export function VideoListRow(props: VideoListRowProps) {
  const navigate = useNavigate();
  const streamRemote = createShareSourceRemote();
  // shared by both the context menu's "stream on X" entry and the hover
  // play button's own flyout trigger below - one station lookup serves
  // both surfaces.
  const playFlyout = useVideoStreamContextMenuActions(props.video, streamRemote);
  const contextMenuActions = createMemo(() =>
    spliceStreamMenuActions(
      useVideoContextMenu(props.video, { showPlayActions: true, onSave: props.onTagsSaved }),
      playFlyout.menuActions()
    )
  );
  // mirrors VideoCard.tsx's local-poster handling: a local video's
  // auto-imported poster lives in OPFS (poster_opfs_path), not the
  // reliquary blob store poster_blob_id points at.
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  // waveform resolution for the progress-fill background - mirrors
  // VideoQueueRow.tsx's identical waveformImg/resolvedP2PWaveformUrl/
  // waveformUrl trio (local blob first, then P2P/remote).
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

  const progress = () => Math.min(Math.max(props.progress ?? 0, 0), 1);

  return (
    <ContextMenu actions={contextMenuActions()}>
      <div
        onClick={() => navigate(buildRoute(`/video/${props.video.id}`))}
        class={`relative overflow-hidden rounded cursor-pointer transition-colors group ${
          hasBackgroundImage() ? "hover:bg-black/40" : "hover:bg-[var(--color-bg-elevated)]"
        }`}
      >
        {/* progress fill + waveform overlay - behind all content, mirrors
            VideoQueueRow/QueueSongRow's layering (a clipped accent-color
            reveal plus a clipped waveform image on top of it, scaled up
            2x vertically and blended for a subtle texture) */}
        <Show when={progress() > 0}>
          <div
            class="absolute inset-0 pointer-events-none z-0"
            style={{
              "background-color": "rgba(102, 0, 59, 0.22)",
              "clip-path": `inset(0 ${100 - progress() * 100}% 0 0)`,
            }}
          />
          <Show when={waveformUrl()}>
            <div
              class="absolute inset-0 pointer-events-none z-0 overflow-hidden"
              style={{ "clip-path": `inset(0 ${100 - progress() * 100}% 0 0)` }}
            >
              <div
                class="w-full h-full"
                style={{
                  "background-image": `url(${waveformUrl()})`,
                  "background-position": "left center",
                  "background-size": "100% 100%",
                  "background-repeat": "no-repeat",
                  opacity: 0.18,
                  "mix-blend-mode": "screen",
                  transform: "scaleY(2)",
                }}
              />
            </div>
          </Show>
        </Show>

        <div class="relative z-10 flex items-center gap-2 @[480px]:gap-3 px-2 py-2">
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
            {/* episode number overlaid on the thumbnail - mirrors
                MediaThumbnail's index badge (used by the queue/playlist
                rows) instead of reserving its own flex column, which
                wasted space to the thumbnail's left and squeezed the
                title on narrow widths. fades out on hover, same as
                MediaThumbnail's own hideIndex-on-hover treatment, so it
                doesn't fight the play button overlay below. */}
            <Show when={props.index !== undefined}>
              <div class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none opacity-100 group-hover:opacity-0 transition-opacity">
                <span class="bg-black/70 text-white text-xs font-medium leading-none px-1">
                  {props.video.episode_number ?? props.index! + 1}
                </span>
              </div>
            </Show>
            <div class="absolute inset-0 z-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
              <Show
                when={playFlyout.showCaret()}
                fallback={
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
                }
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <ClickDropdownMenu
                    align="left"
                    trigger={
                      <button
                        class="w-6 h-6 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center transition-colors"
                        title="play"
                        aria-label="play"
                      >
                        <PlayIcon size={12} className="ml-0.5" />
                      </button>
                    }
                    actions={[
                      { label: "play", icon: "play", onClick: props.onPlay },
                      ...playFlyout.menuActions(),
                    ]}
                  />
                </div>
              </Show>
            </div>
          </div>
          {/* narrow: let the title wrap onto 2 lines instead of a single
              marquee-scrolled line - there's no room on a phone-width
              row for a long title plus duration/rating/favorite, and a
              static 2-line clamp reads better than a tiny scrolling
              strip. wide: unchanged single-line marquee. */}
          <span class="flex-1 min-w-0 @[480px]:hidden text-sm text-[var(--color-text-primary)] line-clamp-2">
            {props.video.title}
          </span>
          <MarqueeText
            text={props.video.title}
            hoverOnly={true}
            class="hidden @[480px]:block flex-1 min-w-0 text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-500)] transition-colors"
          />
          <Show when={props.showContentType && props.video.content_type}>
            <span class="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
              {contentTypeLabel(props.video.content_type)}
            </span>
          </Show>
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
          <Show when={props.onRatingChange}>
            <div class="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <Rating rating={props.rating ?? 0} size="sm" onRatingChange={props.onRatingChange} />
            </div>
          </Show>
          <Show when={props.onFavoriteToggle}>
            <div class="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <FavoriteHeart
                isFavorite={props.isFavorite ?? false}
                onToggle={props.onFavoriteToggle}
                size="sm"
              />
            </div>
          </Show>
        </div>
      </div>
    </ContextMenu>
  );
}
