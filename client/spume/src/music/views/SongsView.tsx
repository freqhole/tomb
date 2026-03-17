// songs view - optimized with virtualization and infinite scroll

import { useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { useHistoryState } from "../../utils/historyState";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Button } from "../../components/buttons/Button";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import type { TagFilter } from "../../components/forms/TagFilterPicker";
import { SelectionActionBar } from "../../components/layout/SelectionActionBar";
import { BulkEditSongsModal } from "../../components/modals/BulkEditSongsModal";
import {
  VirtualSongList,
  type SortField,
  type SortDirection,
  type SortState,
} from "../../components/virtualized/VirtualSongList";
import type { Song } from "../data/types";
import {
  useSongsInfiniteQuery,
  type SongSortField,
  type SongSortDirection,
} from "../queries/songs";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { useSetRatingMutation } from "../queries/ratings";
import { useTagsQuery } from "../queries/tags";
import { playQueue, addToQueue } from "../services/queue/queue";
import { useSongContextMenu } from "../hooks/contextMenu";
import { isNarrowViewport } from "../../config/breakpoints";
import { RemoteOfflineError } from "../data";
import { isAdmin } from "../data/permissions";
import { showPlaylistSelector } from "../hooks/playlistSelectorState";
import { confirm } from "../../app/services/confirmState";
import { useBulkDeleteSongsMutation, useBulkClearSongArtworkMutation } from "../queries/songs";
import {
  clearSelection,
  getSelectedSongIds,
  handleSongClick as handleSelectionClick,
  updateSongIdList,
  useClearSelectionOnNavigate,
  useSelectionCount,
} from "../hooks/songSelection";

const songSortFields = [
  { value: "added_at", label: "date added", description: "sort by date added" },
  { value: "title", label: "title", description: "sort by song title" },
  { value: "artist", label: "artist", description: "sort by artist name" },
  { value: "album", label: "album", description: "sort by album name" },
  { value: "year", label: "year", description: "sort by release year" },
  { value: "duration", label: "duration", description: "sort by track length" },
];

export interface SongsViewProps {
  onAddMusic: () => void;
  onSongClick?: (song: Song) => void;
  onSongDoubleClick?: (song: Song) => void;
}

export function SongsView(props: SongsViewProps) {
  const [searchParams] = useSearchParams();

  // clear selection when navigating away
  useClearSelectionOnNavigate();

  // selection state
  const selectionCount = useSelectionCount();
  const [showBulkEditModal, setShowBulkEditModal] = createSignal(false);
  const [bulkEditMode, setBulkEditMode] = createSignal<"metadata" | "disc">("metadata");

  // container ref for action bar centering
  let contentContainerRef: HTMLDivElement | undefined;

  // responsive: track narrow viewport
  const [_isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  // responsive list height — reactive to safari toolbar changes
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const listHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  onMount(() => {
    const handleResize = () => {
      const narrow = isNarrowViewport();
      setIsNarrow(narrow);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearPageInfo(); // clear page info when leaving view
    });
  });

  // sorting state (persisted in browser history)
  const [sortField, setSortField] = useHistoryState<SongSortField>("songs.sortField", "added_at");
  const [sortDirection, setSortDirection] = useHistoryState<SongSortDirection>(
    "songs.sortDirection",
    "desc"
  );

  // tag filtering state (persisted in browser history)
  const [tagFilters, setTagFilters] = useHistoryState<TagFilter[]>("songs.tagFilters", []);

  // track query/filter changes to force list reset
  const [isResetting, setIsResetting] = createSignal(false);

  // mutations for favorites and ratings
  const toggleFavoriteMutation = useToggleFavoriteMutation();
  const setRatingMutation = useSetRatingMutation();

  // fetch available tags
  const tagsQuery = useTagsQuery();

  // get search query from URL params
  const searchQuery = () => {
    const q = searchParams.q;
    return Array.isArray(q) ? q[0] : q;
  };

  // infinite query
  const songsQuery = useSongsInfiniteQuery({
    sortField: () => sortField(),
    sortDirection: () => sortDirection(),
    pageSize: 250,
    query: searchQuery,
    tagFilters: () => tagFilters(),
  });

  // reset virtual list when query param or tag filters change
  createEffect(
    on(
      () => [searchQuery(), tagFilters()] as const,
      () => {
        setIsResetting(true);
        setTimeout(() => setIsResetting(false), 0);
      },
      { defer: true }
    )
  );

  // flatten pages into single array - memoized to avoid recomputation
  const allSongs = createMemo(() => {
    const pages = songsQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.items);
  });

  // keep song ID list in sync for range selection
  createEffect(() => {
    const songs = allSongs();
    updateSongIdList(songs.map((s) => s.id));
  });

  // update page info for TopNav
  createEffect(() => {
    const count = allSongs().length;
    setPageInfo({
      title: "songs",
      count,
      sortFields: songSortFields,
      sortBy: sortField(),
      sortDirection: sortDirection(),
      defaultSortBy: "added_at",
      defaultSortDirection: "desc",
      onSortChange: (field, direction) => {
        setSortField(field as SongSortField);
        setSortDirection(direction);
      },
      availableTags: availableTags(),
      selectedTagFilters: tagFilters(),
      tagsLoading: tagsQuery.isLoading,
      onAddTag: handleAddTag,
      onRemoveTag: handleRemoveTag,
      onToggleTagMode: handleToggleMode,
      onClearAllTags: handleClearAllTags,
    });
  });

  // load more handler
  const loadMore = () => {
    if (!songsQuery.hasNextPage || songsQuery.isFetchingNextPage) return;
    songsQuery.fetchNextPage();
  };

  // tag filter handlers
  const handleAddTag = (tag: string) => {
    setTagFilters([...tagFilters(), { tag, mode: "include" }]);
  };

  const handleRemoveTag = (tag: string) => {
    setTagFilters(tagFilters().filter((f) => f.tag !== tag));
  };

  const handleToggleMode = (tag: string) => {
    setTagFilters(
      tagFilters().map((f) =>
        f.tag === tag
          ? {
              tag: f.tag,
              mode: (f.mode === "include" ? "exclude" : "include") as "include" | "exclude",
            }
          : f
      )
    );
  };

  const handleClearAllTags = () => {
    setTagFilters([]);
  };

  // convert tags to tag options for picker
  const availableTags = createMemo(() => {
    return (tagsQuery.data || []).map((tag) => ({
      value: tag.name,
      label: tag.name,
    }));
  });

  const handleSongClick = (song: Song, _index: number) => {
    props.onSongClick?.(song);
  };

  const handleSongDoubleClick = (song: Song, _index: number) => {
    props.onSongDoubleClick?.(song);
  };

  // play song immediately when thumbnail is clicked
  const handlePlayClick = async (song: Song, _index: number) => {
    await playQueue([song], { source: { type: "song", label: song.title } });
  };

  // build context menu actions for a song
  const getContextMenuActions = (song: Song, _index: number) => {
    return useSongContextMenu(song, {
      showPlayActions: true,
      isFavorite: song.is_favorite,
    });
  };

  // handle favorite toggle
  const handleFavoriteToggle = (song: Song, isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "song",
      targetId: song.id,
      sha256: song.sha256,
      isFavorite,
    });
  };

  // handle rating change
  const handleRatingChange = (song: Song, rating: number) => {
    setRatingMutation.mutate({
      targetType: "song",
      targetId: song.id,
      rating,
    });
  };

  // selection click handler for multi-select
  const onSelectionClick = (song: Song, index: number, event: MouseEvent) => {
    handleSelectionClick(song.id, index, event);
  };

  // action bar handlers
  const handleEditMetadata = () => {
    setBulkEditMode("metadata");
    setShowBulkEditModal(true);
  };

  const handleSetDiscNumber = () => {
    setBulkEditMode("disc");
    setShowBulkEditModal(true);
  };

  const handleDeleteImages = async () => {
    const selectedIds = Array.from(getSelectedSongIds());
    const count = selectedIds.length;

    const confirmed = await confirm({
      title: "clear images",
      message: `this will clear the primary image from ${count} songs. waveform images will be preserved.`,
      confirmText: "clear images",
      variant: "danger",
    });

    if (!confirmed) return;

    try {
      await bulkClearArtworkMutation.mutateAsync(selectedIds);
      clearSelection();
    } catch (error) {
      console.error("bulk clear artwork failed:", error);
    }
  };

  const handleAddToPlaylist = async () => {
    const selectedIds = Array.from(getSelectedSongIds());
    await showPlaylistSelector(selectedIds);
    clearSelection();
  };

  const handleAddToQueue = async () => {
    const selectedIds = getSelectedSongIds();
    const selectedSongs = allSongs().filter((s) => selectedIds.has(s.id));
    await addToQueue(selectedSongs);
    clearSelection();
  };

  const bulkDeleteMutation = useBulkDeleteSongsMutation();
  const bulkClearArtworkMutation = useBulkClearSongArtworkMutation();

  const handleDeleteSongs = async () => {
    const selectedIds = Array.from(getSelectedSongIds());
    const count = selectedIds.length;

    const confirmed = await confirm({
      title: "delete songs",
      message: `are you sure you want to delete ${count} songs? this cannot be undone.`,
      confirmText: "delete",
      variant: "danger",
    });

    if (!confirmed) return;

    try {
      await bulkDeleteMutation.mutateAsync(selectedIds);
      clearSelection();
    } catch (error) {
      console.error("bulk delete failed:", error);
    }
  };

  // map UI sort field to query sort field
  const uiToQueryField: Record<SortField, SongSortField> = {
    title: "title",
    artist: "artist",
    album: "album",
    genre: "genre",
    year: "year",
    duration: "duration",
    added_at: "added_at",
  };

  // map query sort field to UI sort field
  const queryToUiField: Record<SongSortField, SortField> = {
    title: "title",
    artist: "artist",
    album: "album",
    genre: "genre",
    year: "year",
    duration: "duration",
    added_at: "added_at",
  };

  // current sort state for UI
  const sortState = (): SortState => ({
    field: queryToUiField[sortField()],
    direction: sortDirection(),
  });

  // handle sort change from UI
  const handleSortChange = (field: SortField, direction: SortDirection) => {
    if (direction === null) {
      // reset to default
      setSortField("added_at");
      setSortDirection("desc");
    } else {
      setSortField(uiToQueryField[field]);
      setSortDirection(direction);
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* song list */}
      <div ref={contentContainerRef} class="flex-1 overflow-hidden">
        {songsQuery.isError ? (
          <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
            <div class="text-center max-w-md">
              {songsQuery.error instanceof RemoteOfflineError ? (
                <>
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                    {(songsQuery.error as RemoteOfflineError).remoteName} is offline
                  </p>
                  <p class="text-sm text-[var(--color-text-muted)]">
                    switch to a different remote or use local library
                  </p>
                </>
              ) : (
                <p class="text-lg text-[var(--color-text-secondary)] mb-2">failed to load songs</p>
              )}
            </div>
          </div>
        ) : songsQuery.isLoading || isResetting() ? (
          <div class="flex items-center justify-center h-full">
            <LoadingState text="loading songs..." />
          </div>
        ) : allSongs().length === 0 ? (
          <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
            <div class="text-center max-w-md">
              <p class="text-lg text-[var(--color-text-secondary)] mb-2">no songs found!</p>
              <Button variant="primary" onClick={props.onAddMusic}>
                add music
              </Button>
            </div>
          </div>
        ) : (
          <>
            <VirtualSongList
              songs={allSongs()}
              height={listHeight()}
              onSongClick={handleSongClick}
              onSongDoubleClick={handleSongDoubleClick}
              onPlayClick={handlePlayClick}
              onNearEnd={loadMore}
              getContextMenuActions={getContextMenuActions}
              scrollKey={`songs-view-${searchQuery() || ""}-${tagFilters()
                .map((f) => f.tag)
                .join(",")}`}
              playingSongId={appState()?.current_sha256 ?? undefined}
              sortState={sortState()}
              onSortChange={handleSortChange}
              onFavoriteToggle={handleFavoriteToggle}
              onRatingChange={handleRatingChange}
              selectedSongIds={getSelectedSongIds()}
              onSelectionClick={isAdmin() ? onSelectionClick : undefined}
              showSelectionHighlight={isAdmin() && selectionCount() > 1}
              onContextMenuOpen={clearSelection}
              scrollPaddingTop={72}
            />
            <LoadingMoreIndicator isLoading={songsQuery.isFetchingNextPage} />
            {isAdmin() && (
              <SelectionActionBar
                count={selectionCount()}
                hasPlayerBar={playerBarHeight() > 0}
                containerRef={contentContainerRef}
                onEditMetadata={handleEditMetadata}
                onSetDiscNumber={handleSetDiscNumber}
                onDeleteImages={handleDeleteImages}
                onAddToPlaylist={handleAddToPlaylist}
                onAddToQueue={handleAddToQueue}
                onDeleteSongs={handleDeleteSongs}
                onClearSelection={clearSelection}
              />
            )}
          </>
        )}
      </div>

      {/* bulk edit modal */}
      <BulkEditSongsModal
        isOpen={showBulkEditModal()}
        onClose={() => setShowBulkEditModal(false)}
        songIds={Array.from(getSelectedSongIds())}
        mode={bulkEditMode()}
        onSuccess={() => {
          clearSelection();
          songsQuery.refetch();
        }}
      />
    </div>
  );
}
