// data layer for PlaylistDetailPanel's interleaved song+video item list -
// extracted out of the panel itself to keep that file under the
// project's file-size budget (see docs/playlist-unification-plan.md).
// owns: fetching songs/videos for a playlist, merging them into one
// ordered position space, the video-row enrichment queries (series list,
// favorite statuses), and the reorder/remove mutations that operate on
// that merged list.
import { createEffect, createMemo, type Accessor } from "solid-js";
import {
  songToMediaItem,
  videoToMediaItem,
  type MediaItem,
} from "../../../app/services/storage/mediaItem";
import { usePlaylistSongsQuery } from "../../queries/playlists";
import type { Song } from "../../data/types";
import {
  usePlaylistVideoItemsQuery,
  useRemovePlaylistItemsMutation,
  useReorderPlaylistItemsMutation,
  type PlaylistVideoItem,
} from "../../../video/queries/playlistItems";
import { useVideoSeriesListQuery } from "../../../video/queries/series";
import { useVideoFavoriteStatuses } from "../../../video/hooks/useVideoFavoriteStatuses";
import { error as errorLog } from "../../../utils/logger";

// a merged item shared by both song and video playlist rows, sorted
// into the one shared position space `playlist_itemz` gives every item
// regardless of entity_type - used for interleaved rendering and for
// cross-type drag reorder (which needs a single ordered index space).
export type MergedPlaylistItem =
  | { kind: "song"; key: string; position: number; entityId: string; song: Song }
  | {
      kind: "video";
      key: string;
      position: number;
      entityId: string;
      videoItem: PlaylistVideoItem;
    };

// convert a merged playlist row back into the queue's domain-agnostic
// `MediaItem` shape - lets play/queue/shuffle/double-click actions feed
// one mixed song+video queue via `playQueue`/`addToQueue` (phase 4a).
export function mergedItemToMediaItem(item: MergedPlaylistItem): MediaItem {
  return item.kind === "song" ? songToMediaItem(item.song) : videoToMediaItem(item.videoItem.video);
}

export function usePlaylistMergedItems(playlistId: Accessor<string>) {
  // fetch songs for selected playlist
  const playlistSongsQuery = usePlaylistSongsQuery({ playlistId });

  // auto-fetch additional pages so playlists larger than the default
  // page size still render in full. the songs list itself isn't
  // virtualized + scroll-paged yet, so this is the simplest safety
  // net for huge (>1000-song) playlists.
  createEffect(() => {
    if (playlistSongsQuery.hasNextPage && !playlistSongsQuery.isFetchingNextPage) {
      void playlistSongsQuery.fetchNextPage();
    }
  });

  // flatten playlist songs
  const playlistSongs = createMemo(() => {
    const pages = playlistSongsQuery.data?.pages;
    if (!pages) return [];
    return pages.flatMap((page) => page.items);
  });

  // fetch video-typed items for the selected playlist (domain-generic
  // playlist_itemz table remotely, unified local indexeddb junction
  // store otherwise — see video/queries/playlistItems.ts). works for
  // both local and remote playlists, sharing one position space with
  // songs.
  const playlistVideoItemsQuery = usePlaylistVideoItemsQuery(playlistId);
  const playlistVideoItems = createMemo(() => playlistVideoItemsQuery.data ?? []);

  // series list lookup for the video-metadata subtitle shown in playlist
  // rows (content type + series/season/episode) - mirrors VideoCard.tsx's
  // pattern. fetches the whole (small) series list once and is
  // shared/cached across every row via TanStack Query's queryKey
  // deduping, so this doesn't cost one request per row. flattened once
  // here (not per-row) so every row reuses the same array instead of
  // re-flattening the same pages on every render.
  const videoSeriesListQuery = useVideoSeriesListQuery({ pageSize: 500 });
  const videoSeriesList = createMemo(
    () => videoSeriesListQuery.data?.pages.flatMap((p) => p.items) ?? []
  );

  // favorite status for every video currently in the playlist - one bulk
  // call (like videoSeriesListQuery above), not one query per row.
  const playlistVideoIds = createMemo(() => playlistVideoItems().map((i) => i.video.id));
  const videoFavoriteStatusesQuery = useVideoFavoriteStatuses(playlistVideoIds);
  const favoriteVideoIds = createMemo(() => videoFavoriteStatusesQuery.data ?? new Set<string>());

  const mergedPlaylistItems = createMemo((): MergedPlaylistItem[] => {
    const songs = playlistSongs().map((song, index): MergedPlaylistItem => ({
      kind: "song",
      key: `song:${song.id}`,
      position: song.playlist_item_position ?? index,
      entityId: song.id,
      song,
    }));
    const videos = playlistVideoItems().map((videoItem): MergedPlaylistItem => ({
      kind: "video",
      key: `video:${videoItem.video.id}`,
      position: videoItem.position,
      entityId: videoItem.video.id,
      videoItem,
    }));
    return [...songs, ...videos].sort((a, b) => a.position - b.position);
  });

  // calculate total duration (songs + videos - one combined playlist runtime)
  const totalDuration = createMemo(() => {
    const songSeconds = playlistSongs().reduce(
      (sum, song) => sum + (song.duration_seconds || 0),
      0
    );
    const videoSeconds = playlistVideoItems().reduce(
      (sum, item) => sum + (item.video.duration_seconds || 0),
      0
    );
    return songSeconds + videoSeconds;
  });

  const reorderItemsMutation = useReorderPlaylistItemsMutation();
  const removeItemsMutation = useRemovePlaylistItemsMutation();

  // reorder every item currently in the playlist (songs AND videos) by
  // moving the item at `fromKey` to `toIndex` within the merged list,
  // then submitting the FULL resulting ordered list - the backend's
  // reorder_playlist_items route requires every item, not a delta (see
  // ReorderPlaylistItemsRequest's doc comment).
  const commitReorder = async (fromKey: string, toIndex: number) => {
    const items = mergedPlaylistItems();
    const fromIndex = items.findIndex((i) => i.key === fromKey);
    if (fromIndex === -1 || fromIndex === toIndex) return;

    const id = playlistId();
    if (!id) return;

    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    try {
      await reorderItemsMutation.mutateAsync({
        playlistId: id,
        orderedItems: reordered.map((i) => ({
          entity_type: i.kind,
          entity_id: i.entityId,
        })),
      });
    } catch (error) {
      errorLog("failed to reorder playlist items:", error);
    }
  };

  // remove a single song from the currently selected playlist (used by
  // the per-row x button shown to playlist owners + admins) - goes
  // through the shared generic bulk `entities.removePlaylistItems` route
  // (mirrors how reorder was already unified).
  const handleRemoveSongFromPlaylist = async (song: Song) => {
    const id = playlistId();
    if (!id) return;
    await removeItemsMutation.mutateAsync({
      playlistId: id,
      items: [{ entity_type: "song", entity_id: song.id }],
    });
  };

  const handleRemoveVideoFromPlaylist = (item: PlaylistVideoItem) => {
    const id = playlistId();
    if (!id) return;
    removeItemsMutation.mutate({
      playlistId: id,
      items: [{ entity_type: "video", entity_id: item.video.id }],
    });
  };

  return {
    playlistSongsQuery,
    playlistSongs,
    playlistVideoItemsQuery,
    playlistVideoItems,
    videoSeriesList,
    favoriteVideoIds,
    mergedPlaylistItems,
    totalDuration,
    commitReorder,
    handleRemoveSongFromPlaylist,
    handleRemoveVideoFromPlaylist,
  };
}
