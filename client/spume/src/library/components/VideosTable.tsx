// videos table — read-only list view for browsing videos, plus
// row selection + bulk editing, mirroring AlbumsTable.tsx's table
// markup AND its click-to-select UX (see library/components/AlbumsTable.tsx
// + library/hooks/albumSelection.ts): no checkboxes, plain click selects
// only this row, ctrl/cmd-click toggles, shift-click selects a range, and
// row click never navigates (view details is a context-menu action).
// escape clears selection, ctrl/cmd-a selects all loaded rows. selection
// and the taxon column's data are owned locally by this table since
// nothing outside it needs them (unlike the album table's selection,
// which is also read by a page-level bulk action bar).
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import { useQueryClient } from "@tanstack/solid-query";
import { MediaImage } from "../../components/media/MediaImage";
import { MarqueeText } from "../../components/text/MarqueeText";
import { FavoriteHeart } from "../../components/ratings/FavoriteHeart";
import { Rating } from "../../components/ratings/Rating";
import { Icon } from "../../components/icons/registry";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import { formatDuration } from "../../utils/formatDuration";
import { formatRelativeTime } from "../../utils/dateTime";
import { appState } from "../../app/services/storage/db";
import { useLocalVideoPosterUrl } from "../../video/components/VideoCard";
import type { VideoSummary } from "../../video/data/types";
import { getVideoDataSource } from "../../video/data";
import { formatSeasonLabel } from "../../components/forms/VideoSeasonAutocomplete";
import { getClientForRemote } from "../../app/api/client";
import { getCurrentRemote, type CurrentRemoteInfo } from "../../music/data/currentState";
import { BulkEditVideosModal } from "../../components/modals/BulkEditVideosModal";
import { TagSelectorModal } from "../../components/modals/TagSelectorModal";
import { createVideoTagAdapter } from "../../components/modals/tagAdapters/videoTagAdapter";
import { useVideoSeriesListQuery } from "../../video/queries/series";
import { useVideoEntityTagsQuery } from "../../video/queries/tags";
import { videoQueryKeys } from "../../video/queries/queryKeys";

export interface VideosTableProps {
  videos: VideoSummary[];
  onVideoPlay?: (video: VideoSummary) => void;
  /** callback to get context menu actions for a video */
  getContextMenuActions?: (video: VideoSummary) => MenuAction[];
  /** ids of favorited videos (omit to hide the favorite column) */
  favoriteVideoIds?: Set<string>;
  onVideoFavoriteToggle?: (videoId: string, isFavorite: boolean) => void;
  /** the caller's own rating per video id (omit to hide the rating column) */
  videoRatings?: Map<string, number>;
  onVideoRatingChange?: (videoId: string, rating: number) => void;
  class?: string;
}

function VideoRow(props: {
  video: VideoSummary;
  index: number;
  onVideoPlay?: (video: VideoSummary) => void;
  getContextMenuActions?: (video: VideoSummary) => MenuAction[];
  favoriteVideoIds?: Set<string>;
  onVideoFavoriteToggle?: (videoId: string, isFavorite: boolean) => void;
  videoRatings?: Map<string, number>;
  onVideoRatingChange?: (videoId: string, rating: number) => void;
  isSelected?: boolean;
  onRowClick?: (videoId: string, index: number, event: MouseEvent) => void;
  taxonLabels?: string[];
  seriesTitle?: string;
  seasonLabel?: string;
}) {
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  const croppedSquare = () => appState()?.cropped_square_thumbnails ?? true;

  // self-contained per-row tag fetch (works uniformly for local + remote
  // videos via the datasource abstraction, unlike the taxon loader below
  // which is remote-only) - mirrors useVideoContextMenu's per-row usage.
  const tagsQuery = useVideoEntityTagsQuery("video", () => props.video.id);

  const seriesLabel = () => (props.video.series_id ? (props.seriesTitle ?? "") : "");

  const episodeLabel = () =>
    props.video.episode_number != null ? String(props.video.episode_number) : "";

  const addedLabel = () => {
    const ts = props.video.added_at;
    if (!ts) return "";
    return formatRelativeTime(ts * 1000);
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
      <td class="px-2 py-1 text-[var(--color-text-secondary)]">
        {props.video.season_id ? (props.seasonLabel ?? "") : ""}
      </td>
      <td class="px-2 py-1 text-[var(--color-text-secondary)]">{episodeLabel()}</td>
      <td class="px-2 py-1 text-[var(--color-text-muted)] whitespace-nowrap">
        <MarqueeText text={props.video.release_date ?? ""} />
      </td>
      <td class="px-2 py-1 text-[var(--color-text-muted)] max-w-[200px]">
        <MarqueeText text={(props.taxonLabels ?? []).join(", ")} />
      </td>
      <td class="px-2 py-1 text-[var(--color-text-muted)] max-w-[160px]">
        <MarqueeText text={(tagsQuery.data ?? []).join(", ")} />
      </td>
      <td class="px-2 py-1 text-[var(--color-text-muted)]">
        {formatDuration(props.video.duration_seconds)}
      </td>
      <td class="px-2 py-1 text-[var(--color-text-muted)] whitespace-nowrap">{addedLabel()}</td>
      <Show when={props.onVideoRatingChange}>
        <td class="px-2 py-1" onClick={(e) => e.stopPropagation()}>
          <Rating
            rating={props.videoRatings?.get(props.video.id) ?? 0}
            size="sm"
            onRatingChange={(rating) => props.onVideoRatingChange?.(props.video.id, rating)}
          />
        </td>
      </Show>
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
        class="border-b border-[var(--color-border-subtle)] cursor-pointer outline-none"
        classList={{
          "bg-[var(--color-accent-500)]/10": props.isSelected ?? false,
          "hover:bg-[var(--color-bg-hover)]": !(props.isSelected ?? false),
        }}
        onClick={(e) => props.onRowClick?.(props.video.id, props.index, e)}
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
  // selection state — owned locally since nothing outside this table
  // consumes it (unlike the album table, whose selection also drives a
  // page-level bulk action bar). click UX mirrors
  // library/hooks/albumSelection.ts's handleAlbumClick exactly, just
  // scoped to this component instead of module-level state.
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = createSignal(false);
  const [tagSelectorOpen, setTagSelectorOpen] = createSignal(false);
  const videoTagAdapter = createVideoTagAdapter("video");
  const queryClient = useQueryClient();

  // series id -> title lookup for the series column (self-contained,
  // mirrors the taxon-loading block below's "own its data" pattern).
  const seriesListQuery = useVideoSeriesListQuery({ pageSize: 500 });
  const seriesTitleById = createMemo(() => {
    const map = new Map<string, string>();
    for (const page of seriesListQuery.data?.pages ?? []) {
      for (const series of page.items) map.set(series.id, series.title);
    }
    return map;
  });

  // season id -> label lookup for the season column. seasons are only
  // fetchable per-series (no "list all seasons" route), so fetch every
  // series' seasons in parallel once the series list is known - the
  // series count is small enough (mirrors seriesTitleById's own
  // pageSize:500 "fetch them all" assumption) that this stays cheap.
  const seriesIds = createMemo(() => {
    const ids = new Set<string>();
    for (const page of seriesListQuery.data?.pages ?? []) {
      for (const series of page.items) ids.add(series.id);
    }
    return Array.from(ids).sort();
  });
  const [seasonsBySeriesId] = createResource(seriesIds, async (ids) => {
    if (ids.length === 0) return new Map<string, string>();
    const dataSource = getVideoDataSource();
    const seasonLists = await Promise.all(ids.map((id) => dataSource.getVideoSeasons(id)));
    const map = new Map<string, string>();
    for (const seasons of seasonLists) {
      for (const season of seasons) {
        map.set(season.id, formatSeasonLabel(season.season_number, season.title));
      }
    }
    return map;
  });

  // drop selected ids that scroll out of the loaded list (e.g. a sort
  // change reset the query) so the toolbar never references stale rows.
  createEffect(() => {
    const visible = new Set(props.videos.map((v) => v.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  });

  const clearSelection = () => {
    setSelectedIds(new Set<string>());
    setLastSelectedIndex(null);
  };

  const selectAllLoaded = () => setSelectedIds(new Set(props.videos.map((v) => v.id)));

  // click handler with modifier-key support — mirrors
  // handleAlbumClick: none = select only this row, ctrl/cmd = toggle,
  // shift = range from last-selected, shift+ctrl/cmd = add range.
  const handleRowClick = (videoId: string, index: number, event: MouseEvent) => {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    if (isShift && lastSelectedIndex() !== null) {
      const ids = props.videos.map((v) => v.id);
      const start = Math.min(lastSelectedIndex()!, index);
      const end = Math.max(lastSelectedIndex()!, index);
      const rangeIds = ids.slice(start, end + 1);
      if (isCtrlOrCmd) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach((id) => next.add(id));
          return next;
        });
      } else {
        setSelectedIds(new Set(rangeIds));
      }
    } else if (isCtrlOrCmd) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(videoId)) next.delete(videoId);
        else next.add(videoId);
        return next;
      });
      setLastSelectedIndex(index);
    } else {
      setSelectedIds(new Set([videoId]));
      setLastSelectedIndex(index);
    }
  };

  // escape clears selection; ctrl/cmd-a selects all loaded rows (when not
  // focused in a text input). scoped to this component's lifetime.
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedIds().size > 0) {
        clearSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
        if (props.videos.length === 0) return;
        event.preventDefault();
        selectAllLoaded();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // taxon labels per video, fetched incrementally as new rows come into
  // view. no generic "taxons for many entity ids" batch endpoint exists
  // yet (music's `entityTaxonsBatch` only covers "album"/"artist"), so
  // this fetches one `getEntityTaxons` call per not-yet-loaded video id
  // in parallel, then resolves the resulting taxon ids to labels via
  // `getTaxon`, deduped so a label is only ever fetched once regardless
  // of how many videos share it.
  const [videoTaxonLabels, setVideoTaxonLabels] = createSignal<Map<string, string[]>>(new Map());
  const loadedOrPendingIds = new Set<string>();
  const taxonLabelCache = new Map<string, string>();
  let lastRemoteId: string | null = null;

  const loadTaxonsFor = async (ids: string[], remote: CurrentRemoteInfo) => {
    const client = await getClientForRemote(remote);
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const resp = await client.entities.getEntityTaxons({
          entity_type: "video",
          entity_id: id,
        });
        return { id, taxonIds: resp.success ? resp.data.map((l) => l.taxon_id) : [] };
      })
    );
    const byVideo = new Map<string, string[]>();
    const unresolved = new Set<string>();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      byVideo.set(r.value.id, r.value.taxonIds);
      for (const taxonId of r.value.taxonIds) {
        if (!taxonLabelCache.has(taxonId)) unresolved.add(taxonId);
      }
    }
    if (unresolved.size > 0) {
      await Promise.allSettled(
        Array.from(unresolved).map(async (taxonId) => {
          const resp = await client.music.getTaxon({ id: taxonId });
          if (resp.success) taxonLabelCache.set(taxonId, resp.data.label);
        })
      );
    }
    setVideoTaxonLabels((prev) => {
      const next = new Map(prev);
      for (const [videoId, taxonIds] of byVideo) {
        next.set(
          videoId,
          taxonIds.map((tid) => taxonLabelCache.get(tid)).filter((l): l is string => !!l)
        );
      }
      return next;
    });
  };

  createEffect(() => {
    const remote = getCurrentRemote();
    const videos = props.videos;
    const remoteId = remote?.remote_id ?? null;
    if (remoteId !== lastRemoteId) {
      lastRemoteId = remoteId;
      loadedOrPendingIds.clear();
      taxonLabelCache.clear();
      setVideoTaxonLabels(new Map());
    }
    if (!remote) return;
    const missingIds = videos.map((v) => v.id).filter((id) => !loadedOrPendingIds.has(id));
    if (missingIds.length === 0) return;
    for (const id of missingIds) loadedOrPendingIds.add(id);
    void loadTaxonsFor(missingIds, remote);
  });

  return (
    <div class={`relative flex flex-col h-full min-h-0 ${props.class || ""}`}>
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
                <th class="px-2 py-2 font-medium w-24">series</th>
                <th class="px-2 py-2 font-medium w-24">season</th>
                <th class="px-2 py-2 font-medium w-16">episode</th>
                <th class="px-2 py-2 font-medium w-24">release date</th>
                <th class="px-2 py-2 font-medium w-32">taxons</th>
                <th class="px-2 py-2 font-medium w-28">tags</th>
                <th class="px-2 py-2 font-medium w-20">duration</th>
                <th class="px-2 py-2 font-medium w-24">added</th>
                <Show when={props.onVideoRatingChange}>
                  <th class="px-2 py-2 font-medium w-24">rating</th>
                </Show>
                <Show when={props.favoriteVideoIds}>
                  <th class="px-2 py-2 font-medium w-10"></th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={props.videos}>
                {(video, index) => (
                  <VideoRow
                    video={video}
                    index={index()}
                    onVideoPlay={props.onVideoPlay}
                    getContextMenuActions={props.getContextMenuActions}
                    favoriteVideoIds={props.favoriteVideoIds}
                    onVideoFavoriteToggle={props.onVideoFavoriteToggle}
                    videoRatings={props.videoRatings}
                    onVideoRatingChange={props.onVideoRatingChange}
                    isSelected={selectedIds().has(video.id)}
                    onRowClick={handleRowClick}
                    taxonLabels={videoTaxonLabels().get(video.id)}
                    seriesTitle={
                      video.series_id ? seriesTitleById().get(video.series_id) : undefined
                    }
                    seasonLabel={
                      video.season_id ? seasonsBySeriesId()?.get(video.season_id) : undefined
                    }
                  />
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>

      <Show when={selectedIds().size > 0}>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
          <span class="text-xs text-[var(--color-text-secondary)] mr-2">
            {selectedIds().size} selected
          </span>
          <button
            type="button"
            onClick={() => setBulkEditOpen(true)}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer bg-transparent whitespace-nowrap"
          >
            <Icon name="edit" size={11} />
            edit
          </button>
          <button
            type="button"
            onClick={() => setTagSelectorOpen(true)}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer bg-transparent whitespace-nowrap"
          >
            <Icon name="tag" size={11} />
            tags
          </button>
          <button
            type="button"
            onClick={clearSelection}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer bg-transparent whitespace-nowrap"
          >
            <Icon name="close" size={11} />
            clear
          </button>
        </div>
      </Show>

      <BulkEditVideosModal
        isOpen={bulkEditOpen()}
        videoIds={Array.from(selectedIds())}
        onClose={() => setBulkEditOpen(false)}
        onSuccess={() => {
          setBulkEditOpen(false);
          clearSelection();
        }}
      />

      <Show when={tagSelectorOpen()}>
        <TagSelectorModal
          entityIds={Array.from(selectedIds())}
          entityKindLabel="videos"
          adapter={videoTagAdapter}
          onClose={() => setTagSelectorOpen(false)}
          onSave={() => {
            setTagSelectorOpen(false);
            clearSelection();
            void queryClient.invalidateQueries({ queryKey: videoQueryKeys.tags.all() });
          }}
        />
      </Show>
    </div>
  );
}

export default VideosTable;
