// videos table — simple read-only list view for browsing videos,
// mirroring AlbumsTable.tsx's table markup (see
// library/components/AlbumsTable.tsx) but without the remote-specific
// enrichment/admin machinery (not in scope for this pass). data is owned
// by the parent view (VideosView), not fetched here.
import { For, Show } from "solid-js";
import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import { MediaImage } from "../../components/media/MediaImage";
import { MarqueeText } from "../../components/text/MarqueeText";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { Icon } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { formatDuration } from "../../utils/formatDuration";
import { appState } from "../../app/services/storage/db";
import { useLocalVideoPosterUrl } from "../../video/components/VideoCard";
import type { VideoSummary } from "../../video/data/types";

export interface VideosTableProps {
  videos: VideoSummary[];
  onVideoClick?: (video: VideoSummary) => void;
  onVideoPlay?: (video: VideoSummary) => void;
  /** callback to get context menu actions for a video */
  getContextMenuActions?: (video: VideoSummary) => MenuAction[];
  /** ids of favorited videos (omit to hide the favorite column) */
  favoriteVideoIds?: Set<string>;
  onVideoFavoriteToggle?: (videoId: string, isFavorite: boolean) => void;
  class?: string;
}

function VideoRow(props: {
  video: VideoSummary;
  onVideoClick?: (video: VideoSummary) => void;
  onVideoPlay?: (video: VideoSummary) => void;
  getContextMenuActions?: (video: VideoSummary) => MenuAction[];
  favoriteVideoIds?: Set<string>;
  onVideoFavoriteToggle?: (videoId: string, isFavorite: boolean) => void;
}) {
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  const croppedSquare = () => appState()?.cropped_square_thumbnails ?? true;

  const seriesLabel = () =>
    props.video.episode_number != null ? `E${props.video.episode_number}` : "—";

  const addedLabel = () => {
    const ts = props.video.added_at;
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString();
  };

  const menuActions = () => props.getContextMenuActions?.(props.video) ?? [];

  const rowContent = (
    <>
      <td class="px-2 py-1">
        <div class="w-8 h-8 rounded overflow-hidden bg-[var(--color-bg-elevated)]">
          <Show
            when={props.video.source_type === "remote"}
            fallback={
              <Show when={localPosterUrl()}>
                {(url) => (
                  <img
                    src={url()}
                    alt={props.video.title}
                    class={`w-full h-full ${croppedSquare() ? "object-cover" : "object-contain"}`}
                  />
                )}
              </Show>
            }
          >
            <MediaImage
              remoteBlobId={props.video.poster_blob_id}
              remoteServerId={props.video.remote_server_id}
              alt={props.video.title}
              size="xs"
              objectFit={croppedSquare() ? "cover" : "contain"}
            />
          </Show>
        </div>
      </td>
      <td class="px-2 py-1 text-[var(--color-text-primary)] max-w-[260px]">
        <MarqueeText text={props.video.title} />
      </td>
      <td class="px-2 py-1 text-[var(--color-text-secondary)]">{seriesLabel()}</td>
      <td class="px-2 py-1 text-[var(--color-text-muted)]">
        {formatDuration(props.video.duration_seconds)}
      </td>
      <td class="px-2 py-1 text-[var(--color-text-muted)]">{addedLabel()}</td>
      <Show when={props.favoriteVideoIds}>
        <td class="px-2 py-1" onClick={(e) => e.stopPropagation()}>
          <FavoriteHeart
            isFavorite={props.favoriteVideoIds!.has(props.video.id)}
            onToggle={(isFavorite) => props.onVideoFavoriteToggle?.(props.video.id, isFavorite)}
            size="sm"
          />
        </td>
      </Show>
    </>
  );

  return (
    <KobalteContextMenu>
      {/* trigger IS the tr — kobalte forwards a11y attrs onto our
       *  element, layout + click handlers stay intact. */}
      <KobalteContextMenu.Trigger
        as="tr"
        class="border-b border-[var(--color-border-subtle)] cursor-pointer outline-none hover:bg-[var(--color-bg-hover)]"
        onClick={() => props.onVideoClick?.(props.video)}
        onDblClick={() => props.onVideoPlay?.(props.video)}
      >
        {rowContent}
      </KobalteContextMenu.Trigger>
      <KobalteContextMenu.Portal>
        <KobalteContextMenu.Content class="min-w-48 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl overflow-hidden z-[1200] origin-top-left">
          <div class="py-1">
            <For each={menuActions()}>
              {(action) => {
                if (action.type === "separator") {
                  return (
                    <KobalteContextMenu.Separator class="my-1 h-px bg-[var(--color-border-subtle)]" />
                  );
                }
                return (
                  <KobalteContextMenu.Item
                    class={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors body-small outline-none cursor-pointer ${
                      action.disabled
                        ? "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50"
                        : action.destructive
                          ? "text-[var(--color-error)] data-[highlighted]:bg-[var(--color-error)] data-[highlighted]:text-white"
                          : "text-[var(--color-text-primary)] data-[highlighted]:bg-[var(--color-bg-hover)]"
                    }`}
                    onSelect={() => !action.disabled && action.onClick()}
                    disabled={action.disabled}
                    closeOnSelect={true}
                  >
                    <Show when={action.icon}>
                      <Icon name={action.icon!} size={16} color="currentColor" />
                    </Show>
                    <span>{action.label}</span>
                  </KobalteContextMenu.Item>
                );
              }}
            </For>
          </div>
        </KobalteContextMenu.Content>
      </KobalteContextMenu.Portal>
    </KobalteContextMenu>
  );
}

export function VideosTable(props: VideosTableProps) {
  return (
    <div class={`flex flex-col h-full min-h-0 ${props.class || ""}`}>
      <div class="flex-1 overflow-auto min-h-0">
        <Show
          when={props.videos.length > 0}
          fallback={
            <div class="flex items-center justify-center h-32 text-sm text-[var(--color-text-disabled)]">
              no videos found
            </div>
          }
        >
          <table class="w-full text-xs border-collapse">
            <thead class="sticky top-0 bg-black z-10">
              <tr class="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                <th class="px-2 py-2 w-10"></th>
                <th class="px-2 py-2 font-medium">title</th>
                <th class="px-2 py-2 font-medium w-16">series</th>
                <th class="px-2 py-2 font-medium w-20">duration</th>
                <th class="px-2 py-2 font-medium w-24">added</th>
                <Show when={props.favoriteVideoIds}>
                  <th class="px-2 py-2 font-medium w-10"></th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={props.videos}>
                {(video) => (
                  <VideoRow
                    video={video}
                    onVideoClick={props.onVideoClick}
                    onVideoPlay={props.onVideoPlay}
                    getContextMenuActions={props.getContextMenuActions}
                    favoriteVideoIds={props.favoriteVideoIds}
                    onVideoFavoriteToggle={props.onVideoFavoriteToggle}
                  />
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  );
}

export default VideosTable;
