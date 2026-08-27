// floating detail cards for video-domain nodes (video / video_series /
// video_season) — mirrors AlbumDetailPopover/ArtistDetailPopover's layout
// (header tile, action row, child list) so video content gets the same
// play/shuffle/queue/favorite/open/edit UX music already has. simpler
// than the music popovers: no bio/genre pills/carousel/related-entity
// clustering, since none of that has a video-domain equivalent yet.
import { For, Show } from "solid-js";
import type { VideoNodeData, VideoSeasonNodeData, VideoSeriesNodeData } from "./types";
import { IconNames } from "../icons/registry";
import { MarqueeText } from "../text/MarqueeText";
import { MediaImage } from "../media/MediaImage";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { ActionButton } from "./AlbumDetailPopover";
import { RemoteSplitButton, type ContributingRemote } from "./RemoteSplitButton";
import { useLocalVideoPosterUrl } from "../../video/components/VideoCard";

const POPOVER_CLASS =
  "rounded-lg bg-[var(--color-bg-elevated)] border border-white/10 shadow-xl text-[var(--color-text)] w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-var(--nav-height,56px)-var(--player-bar-height,0px)-3.5rem)] overflow-y-auto flex flex-col";

function positionStyle(x?: number, y?: number) {
  if (x === undefined || y === undefined) return undefined;
  return {
    position: "absolute" as const,
    left: `${x}px`,
    top: `${y}px`,
    "pointer-events": "auto" as const,
    "z-index": 20,
  };
}

/** poster tile that resolves either an auto-extracted local (opfs) video
 *  poster or a blob-store-backed poster (remote video, or any series/
 *  season poster — those always go through the blob store, even for
 *  local libraries; see video/data/types.ts's VideoSeries doc comment). */
function VideoPosterTile(props: {
  title: string;
  size: number;
  posterOpfsPath?: string | null;
  posterBlobId?: string | null;
  remoteServerId?: string | null;
  domainType: "video" | "video_series" | "video_season";
  onClick?: () => void;
}) {
  const localUrl = useLocalVideoPosterUrl(() => props.posterOpfsPath);
  return (
    <div
      class="relative rounded-md overflow-hidden bg-[var(--color-bg)] border border-white/10 shrink-0"
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      classList={{ "cursor-pointer hover:opacity-90 transition-opacity": !!props.onClick }}
      onClick={props.onClick}
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
    >
      <Show
        when={localUrl()}
        fallback={
          <MediaImage
            alt={props.title}
            blobId={props.posterBlobId}
            remoteBlobId={props.posterBlobId}
            remoteServerId={props.remoteServerId}
            domainType={props.domainType}
            class="w-full h-full object-cover"
          />
        }
      >
        {(url) => <img src={url()} alt={props.title} class="w-full h-full object-cover" />}
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------
// video (standalone leaf node)
// ---------------------------------------------------------------------

export interface VideoDetailPopoverProps {
  video: VideoNodeData;
  x?: number;
  y?: number;
  /** resolved series/season titles — the graph node only carries bare
   *  ids, so the parent looks these up from its already-loaded node
   *  maps and passes the display text through. */
  seriesTitle?: string | null;
  seasonTitle?: string | null;
  onPlay?: (video: VideoNodeData) => void;
  onAddToQueue?: (video: VideoNodeData) => void;
  /** disables play/queue while a fetch is in flight. */
  isLoadingPlay?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (video: VideoNodeData, next: boolean) => void;
  onViewVideo?: (video: VideoNodeData, remoteId?: string) => void;
  onEdit?: (video: VideoNodeData, remoteId?: string) => void;
  contributingRemotes?: ContributingRemote[];
  /** click the series/season label — parent typically focuses that node. */
  onSelectSeries?: (video: VideoNodeData) => void;
  onSelectSeason?: (video: VideoNodeData) => void;
  onImageClick?: (video: VideoNodeData) => void;
  onClose?: () => void;
}

export function VideoDetailPopover(props: VideoDetailPopoverProps) {
  const hasAnyAction = () =>
    !!(
      props.onPlay ||
      props.onAddToQueue ||
      props.onToggleFavorite ||
      props.onViewVideo ||
      props.onEdit
    );

  return (
    <div
      class={POPOVER_CLASS}
      style={positionStyle(props.x, props.y)}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="flex gap-3 p-3">
        <VideoPosterTile
          title={props.video.title}
          size={72}
          posterOpfsPath={props.video.posterOpfsPath}
          posterBlobId={props.video.posterBlobId}
          remoteServerId={props.video.remoteServerId}
          domainType="video"
          onClick={props.onImageClick ? () => props.onImageClick!(props.video) : undefined}
        />
        <div class="flex-1 min-w-0">
          <MarqueeText text={props.video.title} class="font-semibold text-sm leading-tight" />
          <div class="text-[11px] text-white/65 mt-1 flex flex-col gap-0.5">
            <Show when={props.seriesTitle}>
              <button
                type="button"
                class="text-left truncate hover:text-white/90 cursor-pointer underline-offset-2 hover:underline w-fit"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onSelectSeries?.(props.video);
                }}
              >
                {props.seriesTitle}
                <Show when={props.seasonTitle}> · {props.seasonTitle}</Show>
              </button>
            </Show>
          </div>
        </div>
      </div>

      <Show when={hasAnyAction()}>
        <div class="px-3 pb-3 flex flex-wrap items-center gap-1">
          <Show when={props.onPlay}>
            <ActionButton
              icon={props.isLoadingPlay ? IconNames.loader : IconNames.play}
              label={props.isLoadingPlay ? "loading..." : "play"}
              onClick={() => !props.isLoadingPlay && props.onPlay?.(props.video)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onAddToQueue}>
            <ActionButton
              icon={IconNames.queue}
              label="queue"
              onClick={() => !props.isLoadingPlay && props.onAddToQueue?.(props.video)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onToggleFavorite}>
            <FavoriteHeart
              isFavorite={!!props.isFavorite}
              size="sm"
              onToggle={(next) => props.onToggleFavorite?.(props.video, next)}
            />
          </Show>
          <Show when={props.onViewVideo}>
            <RemoteSplitButton
              icon={IconNames.video}
              label="open"
              remotes={props.contributingRemotes}
              onPick={(remoteId) => props.onViewVideo?.(props.video, remoteId)}
            />
          </Show>
          <Show when={props.onEdit}>
            <RemoteSplitButton
              icon={IconNames.edit}
              label="edit"
              remotes={props.contributingRemotes}
              onPick={(remoteId) => props.onEdit?.(props.video, remoteId)}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------
// video series
// ---------------------------------------------------------------------

export interface VideoSeriesDetailPopoverProps {
  series: VideoSeriesNodeData;
  x?: number;
  y?: number;
  /** in-library episodes for this series (parent supplies from its
   *  already-loaded node maps, filtered by seriesId — mirrors
   *  ArtistDetailPopover's `albums` list). */
  videos?: VideoNodeData[];
  onSelectVideo?: (video: VideoNodeData) => void;
  onPlay?: (series: VideoSeriesNodeData) => void;
  onShuffle?: (series: VideoSeriesNodeData) => void;
  onAddToQueue?: (series: VideoSeriesNodeData) => void;
  isLoadingPlay?: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: (series: VideoSeriesNodeData, next: boolean) => void;
  onViewSeries?: (series: VideoSeriesNodeData, remoteId?: string) => void;
  onEdit?: (series: VideoSeriesNodeData, remoteId?: string) => void;
  contributingRemotes?: ContributingRemote[];
  onImageClick?: (series: VideoSeriesNodeData) => void;
}

export function VideoSeriesDetailPopover(props: VideoSeriesDetailPopoverProps) {
  const hasAnyAction = () =>
    !!(
      props.onPlay ||
      props.onShuffle ||
      props.onAddToQueue ||
      props.onToggleFavorite ||
      props.onViewSeries ||
      props.onEdit
    );

  return (
    <div
      class={POPOVER_CLASS}
      style={positionStyle(props.x, props.y)}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="flex gap-3 p-3">
        <VideoPosterTile
          title={props.series.title}
          size={72}
          posterBlobId={props.series.posterBlobId}
          remoteServerId={props.series.remoteServerId}
          domainType="video_series"
          onClick={props.onImageClick ? () => props.onImageClick!(props.series) : undefined}
        />
        <div class="flex-1 min-w-0">
          <MarqueeText text={props.series.title} class="font-semibold text-sm leading-tight" />
          <div class="text-[11px] text-white/65 mt-1">
            <Show when={props.series.videoCount > 0}>
              <span>
                {props.series.videoCount} video{props.series.videoCount === 1 ? "" : "s"}
              </span>
            </Show>
          </div>
        </div>
      </div>

      <Show when={hasAnyAction()}>
        <div class="px-3 pb-2 flex flex-wrap items-center gap-1">
          <Show when={props.onPlay}>
            <ActionButton
              icon={props.isLoadingPlay ? IconNames.loader : IconNames.play}
              label={props.isLoadingPlay ? "loading..." : "play"}
              onClick={() => !props.isLoadingPlay && props.onPlay?.(props.series)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onShuffle}>
            <ActionButton
              icon={IconNames.shuffle}
              label="shuffle"
              onClick={() => !props.isLoadingPlay && props.onShuffle?.(props.series)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onAddToQueue}>
            <ActionButton
              icon={IconNames.queue}
              label="queue"
              onClick={() => !props.isLoadingPlay && props.onAddToQueue?.(props.series)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onToggleFavorite}>
            <FavoriteHeart
              isFavorite={!!props.isFavorite}
              size="sm"
              onToggle={(next) => props.onToggleFavorite?.(props.series, next)}
            />
          </Show>
          <Show when={props.onViewSeries}>
            <RemoteSplitButton
              icon={IconNames.videoSeries}
              label="open"
              remotes={props.contributingRemotes}
              onPick={(remoteId) => props.onViewSeries?.(props.series, remoteId)}
            />
          </Show>
          <Show when={props.onEdit}>
            <RemoteSplitButton
              icon={IconNames.edit}
              label="edit"
              remotes={props.contributingRemotes}
              onPick={(remoteId) => props.onEdit?.(props.series, remoteId)}
            />
          </Show>
        </div>
      </Show>

      <Show when={(props.videos ?? []).length > 0}>
        <div class="px-3 pb-3">
          <div class="text-[10px] uppercase tracking-wide text-white/55 mb-1">
            episodes ({(props.videos ?? []).length})
          </div>
          <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
            <For each={props.videos}>
              {(v) => {
                const clickable = !!props.onSelectVideo;
                return (
                  <button
                    type="button"
                    class="flex items-center gap-2 px-1.5 py-1 rounded border border-transparent text-left transition-colors"
                    classList={{
                      "hover:bg-white/5 hover:border-white/10 cursor-pointer": clickable,
                      "cursor-default": !clickable,
                    }}
                    disabled={!clickable}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onSelectVideo?.(v);
                    }}
                  >
                    <VideoPosterTile
                      title={v.title}
                      size={36}
                      posterOpfsPath={v.posterOpfsPath}
                      posterBlobId={v.posterBlobId}
                      remoteServerId={v.remoteServerId}
                      domainType="video"
                    />
                    <MarqueeText
                      text={v.title}
                      class="flex-1 min-w-0 text-[11px] text-white/90 leading-tight"
                      hoverOnly={true}
                    />
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------
// video season
// ---------------------------------------------------------------------

export interface VideoSeasonDetailPopoverProps {
  season: VideoSeasonNodeData;
  x?: number;
  y?: number;
  videos?: VideoNodeData[];
  onSelectVideo?: (video: VideoNodeData) => void;
  onPlay?: (season: VideoSeasonNodeData) => void;
  onShuffle?: (season: VideoSeasonNodeData) => void;
  onAddToQueue?: (season: VideoSeasonNodeData) => void;
  isLoadingPlay?: boolean;
  /** "open" navigates to the parent series (no dedicated season route
   *  exists yet), so this is deliberately named after the series action. */
  onViewSeries?: (season: VideoSeasonNodeData, remoteId?: string) => void;
  contributingRemotes?: ContributingRemote[];
  onImageClick?: (season: VideoSeasonNodeData) => void;
}

export function VideoSeasonDetailPopover(props: VideoSeasonDetailPopoverProps) {
  const hasAnyAction = () =>
    !!(props.onPlay || props.onShuffle || props.onAddToQueue || props.onViewSeries);

  return (
    <div
      class={POPOVER_CLASS}
      style={positionStyle(props.x, props.y)}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="flex gap-3 p-3">
        <VideoPosterTile
          title={props.season.title}
          size={72}
          posterBlobId={props.season.posterBlobId}
          remoteServerId={props.season.remoteServerId}
          domainType="video_season"
          onClick={props.onImageClick ? () => props.onImageClick!(props.season) : undefined}
        />
        <div class="flex-1 min-w-0">
          <MarqueeText text={props.season.title} class="font-semibold text-sm leading-tight" />
          <div class="text-[11px] text-white/65 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            <span>season {props.season.seasonNumber}</span>
            <Show when={props.season.videoCount > 0}>
              <span>
                · {props.season.videoCount} video{props.season.videoCount === 1 ? "" : "s"}
              </span>
            </Show>
          </div>
        </div>
      </div>

      <Show when={hasAnyAction()}>
        <div class="px-3 pb-2 flex flex-wrap items-center gap-1">
          <Show when={props.onPlay}>
            <ActionButton
              icon={props.isLoadingPlay ? IconNames.loader : IconNames.play}
              label={props.isLoadingPlay ? "loading..." : "play"}
              onClick={() => !props.isLoadingPlay && props.onPlay?.(props.season)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onShuffle}>
            <ActionButton
              icon={IconNames.shuffle}
              label="shuffle"
              onClick={() => !props.isLoadingPlay && props.onShuffle?.(props.season)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onAddToQueue}>
            <ActionButton
              icon={IconNames.queue}
              label="queue"
              onClick={() => !props.isLoadingPlay && props.onAddToQueue?.(props.season)}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onViewSeries}>
            <RemoteSplitButton
              icon={IconNames.videoSeries}
              label="open series"
              remotes={props.contributingRemotes}
              onPick={(remoteId) => props.onViewSeries?.(props.season, remoteId)}
            />
          </Show>
        </div>
      </Show>

      <Show when={(props.videos ?? []).length > 0}>
        <div class="px-3 pb-3">
          <div class="text-[10px] uppercase tracking-wide text-white/55 mb-1">
            episodes ({(props.videos ?? []).length})
          </div>
          <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
            <For each={props.videos}>
              {(v) => {
                const clickable = !!props.onSelectVideo;
                return (
                  <button
                    type="button"
                    class="flex items-center gap-2 px-1.5 py-1 rounded border border-transparent text-left transition-colors"
                    classList={{
                      "hover:bg-white/5 hover:border-white/10 cursor-pointer": clickable,
                      "cursor-default": !clickable,
                    }}
                    disabled={!clickable}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onSelectVideo?.(v);
                    }}
                  >
                    <VideoPosterTile
                      title={v.title}
                      size={36}
                      posterOpfsPath={v.posterOpfsPath}
                      posterBlobId={v.posterBlobId}
                      remoteServerId={v.remoteServerId}
                      domainType="video"
                    />
                    <MarqueeText
                      text={v.title}
                      class="flex-1 min-w-0 text-[11px] text-white/90 leading-tight"
                      hoverOnly={true}
                    />
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
