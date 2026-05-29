// albums view - displays all albums in a grid with infinite scroll
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { useHistoryState } from "../../utils/historyState";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Button } from "../../components/buttons/Button";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import type { CollectionCardData } from "../../components/cards/CollectionCard";
import type { TagFilter } from "../../components/forms/TagFilterPicker";
import { VirtualAlbumGrid } from "../../components/virtualized/VirtualAlbumGrid";
import { getDataSource } from "../data";
import { RemoteOfflineError } from "../data";
import { appState } from "../../app/services/storage/db";
import { useAlbumsQuery, type AlbumSortField } from "../queries/songs";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { useTagsQuery } from "../queries/tags";
import { playQueue } from "../services/queue/queue";
import { useAlbumContextMenu } from "../hooks/contextMenu";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";
import { formatLongDuration } from "../../utils/formatDuration";
import { Icon } from "../../components/icons/registry";
import { AlbumsTable } from "../../library/components/AlbumsTable";
import { AlbumBulkActionBar } from "../../library/components/AlbumBulkActionBar";
import { MbProgressStrip } from "../../library/components/MbProgressStrip";
import { BulkEditAlbumsModal } from "../../components/modals/BulkEditAlbumsModal";
import { TagSelectorModal } from "../../components/modals/TagSelectorModal";
import {
  useAlbumSelectionLifecycle,
  useSelectedAlbumIds,
} from "../../library/hooks/albumSelection";
import { useRemoteIsAdmin } from "../../library/hooks/useRemoteRole";
import {
  enqueueAlbumEnrichment,
  rehydrateInflightForRemote,
} from "../../library/hooks/useMbLookupJobs";
import { startBulkEnrichmentReview } from "../hooks/bulkEnrichmentReview";
import { getClientForRemote } from "../../app/api/client";
import { createCurrentRemoteFull } from "../../app/services/remotes/currentRemoteFull";
import { queryClient } from "../../queryClient";
import { toast } from "../../components/feedback/Toast";

export interface AlbumsViewProps {
  onAddMusic: () => void;
  onAlbumClick?: (albumId: string) => void;
}

const albumSortFields = [
  { value: "added_at", label: "date added", description: "sort by date added" },
  { value: "title", label: "title", description: "sort by album title" },
  { value: "artist", label: "artist", description: "sort by artist name" },
  { value: "year", label: "year", description: "sort by release year" },
  { value: "song_count", label: "tracks", description: "sort by track count" },
];

export function AlbumsView(props: AlbumsViewProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // responsive grid height — reactive to safari toolbar changes
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const gridHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  onMount(() => {
    onCleanup(() => {
      clearPageInfo(); // clear page info when leaving view
    });
  });

  // track query changes to force grid reset
  const [isResetting, setIsResetting] = createSignal(false);

  // sorting state (persisted in browser history)
  const [sortField, setSortField] = useHistoryState<AlbumSortField>("albums.sortField", "added_at");
  const [sortDirection, setSortDirection] = useHistoryState<"asc" | "desc">(
    "albums.sortDirection",
    "desc"
  );

  // tag filtering state (persisted in browser history)
  const [tagFilters, setTagFilters] = useHistoryState<TagFilter[]>("albums.tagFilters", []);

  // fetch available tags
  const tagsQuery = useTagsQuery();

  // favorites mutation
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // get search query from URL params
  const searchQuery = () => {
    const q = searchParams.q;
    return Array.isArray(q) ? q[0] : q;
  };

  // fetch albums using query hook with sorting
  const albumsQuery = useAlbumsQuery({
    pageSize: 250,
    query: searchQuery,
    tagFilters: () => tagFilters(),
    sortField: () => sortField(),
    sortDirection: () => sortDirection(),
  });

  // reset virtual grid when query param or tag filters change
  createEffect(
    on(
      () => [searchQuery(), tagFilters(), sortField(), sortDirection()] as const,
      () => {
        setIsResetting(true);
        setTimeout(() => setIsResetting(false), 0);
      },
      { defer: true }
    )
  );

  // load more when near end
  const loadMore = () => {
    if (albumsQuery.hasNextPage && !albumsQuery.isFetchingNextPage) {
      albumsQuery.fetchNextPage();
    }
  };

  // flatten all pages into albums list
  const albums = createMemo((): CollectionCardData[] => {
    const pages = albumsQuery.data?.pages ?? [];
    const allAlbums = pages.flatMap((page) => page.items);

    // map AlbumSummary to CollectionCardData format
    return allAlbums.map((album) => {
      // format genres (GenreRef[] -> string), augmented with non-genre
      // taxons (label, mood, era, ...) so cross-kind classification is
      // visible at a glance in the grid.
      const genreNames = (album.genres || []).map((g) => g.name);
      const otherTaxonLabels = (album.taxons || [])
        .filter((t) => t.kind_slug !== "genre")
        .map((t) => `${t.kind_slug}·${t.label}`);
      const allLabels = [...genreNames, ...otherTaxonLabels];
      const genreText = allLabels.length > 0 ? allLabels.join(" • ") : null;

      // extract year from release_date (YYYY, YYYY-MM, or YYYY-MM-DD)
      const year = album.release_date
        ? parseInt(album.release_date.substring(0, 4), 10)
        : album.year || null;

      return {
        id: album.album_id,
        title: album.title,
        subtitle: album.artist_name,
        domainType: "album" as const,
        artist: album.artist_name,
        year: year,
        trackCount: album.song_count,
        totalDuration: formatLongDuration(album.total_duration),
        imageUrl: undefined,
        images: album.images,
        isFavorite: album.is_favorite ?? false,
        genres: genreText,
        tags: album.tags,
      };
    });
  });

  // update page info for TopNav
  createEffect(() => {
    const count = albums().length;
    setPageInfo({
      title: "albums",
      count,
      sortFields: albumSortFields,
      sortBy: sortField(),
      sortDirection: sortDirection(),
      defaultSortBy: "added_at",
      defaultSortDirection: "desc",
      onSortChange: (field, direction) => {
        setSortField(field as AlbumSortField);
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

  // play album: load all songs and start playing
  const handleAlbumPlay = async (album: CollectionCardData) => {
    try {
      const dataSource = getDataSource();
      if (!dataSource.getAlbumSongs) {
        console.error("album songs not supported by current data source");
        return;
      }

      // load all songs for this album
      const response = await dataSource.getAlbumSongs(album.id, {
        limit: 1000,
      });
      const songs = response.items;

      if (songs.length === 0) return;

      // sort canonically (disc -> track)
      const sortedSongs = sortSongsCanonical(songs);

      // set queue and play first song
      await playQueue(sortedSongs, {
        source: { type: "album", label: album.title, entity_id: album.id },
      });
    } catch (error) {
      console.error("failed to play album:", error);
    }
  };

  const handleAlbumClick = (album: CollectionCardData) => {
    navigate(buildRoute(`/albums/${album.id}`));
  };

  const handleFavoriteToggle = (albumId: string, isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "album",
      targetId: albumId,
      isFavorite,
    });
  };

  // build context menu actions for each album
  const getContextMenuActions = (album: CollectionCardData) => {
    // look up original AlbumSummary to get artist_id
    const pages = albumsQuery.data?.pages ?? [];
    const allAlbums = pages.flatMap((page) => page.items);
    const original = allAlbums.find((a) => a.album_id === album.id);

    return useAlbumContextMenu(
      {
        id: album.id,
        title: album.title,
        artist_name: album.artist,
        artist_id: original?.artist_id,
        song_count: album.trackCount ?? undefined,
      },
      {
        showPlayActions: true,
        isFavorite: album.isFavorite ?? false,
      }
    );
  };

  // table mode: reactive full remote record (for AlbumsTable + admin checks)
  const currentRemote = createCurrentRemoteFull();

  // view mode switcher: grid (default) or table (enrichment table).
  // table mode only available in remote context.
  const [viewMode, setViewMode] = createSignal<"grid" | "table">("grid");

  // reset to grid when navigating to local (no remote)
  createEffect(() => {
    if (!currentRemote()) setViewMode("grid");
  });

  // selection lifecycle for table mode
  useAlbumSelectionLifecycle(() => viewMode() === "table");
  const selectedAlbumIds = useSelectedAlbumIds();

  // reconnect to any in-flight enrichment jobs when the remote changes
  createEffect(() => {
    const remote = currentRemote();
    if (!remote) return;
    rehydrateInflightForRemote(remote);
  });

  const isRemoteAdmin = useRemoteIsAdmin(() => currentRemote() ?? undefined);

  // bulk-action modal state
  const [bulkEditMode, setBulkEditMode] = createSignal<"metadata" | "disc">("metadata");
  const [showBulkEditModal, setShowBulkEditModal] = createSignal(false);
  const [bulkEditAlbumIds, setBulkEditAlbumIds] = createSignal<string[]>([]);
  const [showTagSelectorModal, setShowTagSelectorModal] = createSignal(false);
  const [tagSelectorAlbumIds, setTagSelectorAlbumIds] = createSignal<string[]>([]);

  const triggerEnrichment = (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = currentRemote();
    if (!remote) return;
    void enqueueAlbumEnrichment(remote, albumIds);
  };

  const triggerReview = (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = currentRemote();
    if (!remote) return;
    void startBulkEnrichmentReview(remote, albumIds);
  };

  const markSelectedDone = async (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = currentRemote();
    if (!remote) return;
    let client;
    try {
      client = await getClientForRemote(remote);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const id of albumIds) {
      try {
        const resp = await client.music.setMbLookupStatus({ album_id: id, status: "enriched" });
        if (resp.success) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["library-albums", remote.remote_id] });
    if (failed > 0) toast.error(`marked ${ok} done, ${failed} failed`);
    else toast.success(`marked ${ok} album${ok === 1 ? "" : "s"} done`);
  };

  const skipSelected = async (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = currentRemote();
    if (!remote) return;
    let client;
    try {
      client = await getClientForRemote(remote);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const id of albumIds) {
      try {
        const resp = await client.music.setMbLookupStatus({ album_id: id, status: "skipped" });
        if (resp.success) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["library-albums", remote.remote_id] });
    if (failed > 0) toast.error(`skipped ${ok}, ${failed} failed`);
    else toast.success(`skipped ${ok} album${ok === 1 ? "" : "s"} from future lookups`);
  };

  const unskipSelected = async (albumIds: string[]) => {
    if (albumIds.length === 0) return;
    const remote = currentRemote();
    if (!remote) return;
    let client;
    try {
      client = await getClientForRemote(remote);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const id of albumIds) {
      try {
        const resp = await client.music.setMbLookupStatus({
          album_id: id,
          status: "not_attempted",
        });
        if (resp.success) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    void queryClient.invalidateQueries({ queryKey: ["library-albums", remote.remote_id] });
    if (failed > 0) toast.error(`un-skipped ${ok}, ${failed} failed`);
    else
      toast.success(
        `un-skipped ${ok} album${ok === 1 ? "" : "s"} — they'll appear in future lookups`
      );
  };

  // shared switcher buttons (rendered inline above table mode, or
  // floated as an overlay in the top-right of the grid so the grid
  // can take the entire viewport height).
  const viewModeSwitcher = () => (
    <div
      class="inline-flex items-center gap-1 p-1 rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]"
      role="tablist"
      aria-label="albums view"
    >
      <button
        type="button"
        role="tab"
        aria-selected={viewMode() === "grid"}
        class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors border-none cursor-pointer"
        classList={{
          "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)]": viewMode() === "grid",
          "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]":
            viewMode() !== "grid",
        }}
        onClick={() => setViewMode("grid")}
      >
        <Icon name="grid" size={12} />
        <span>grid</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode() === "table"}
        class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors border-none cursor-pointer"
        classList={{
          "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)]": viewMode() === "table",
          "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]":
            viewMode() !== "table",
        }}
        onClick={() => setViewMode("table")}
      >
        <Icon name="list" size={12} />
        <span>table</span>
      </button>
    </div>
  );

  return (
    <div class="flex flex-col h-full">
      {/* view-mode switcher — inline above table mode only.
          in grid mode the switcher floats over the grid (see below) so
          the album grid can fill the full viewport height. */}
      <Show when={!!currentRemote() && viewMode() === "table"}>
        <div class="flex items-center justify-end gap-3 px-4 pt-3 pb-2 flex-wrap">
          <MbProgressStrip />
          {viewModeSwitcher()}
        </div>
      </Show>

      {/* album grid or table */}
      <div class="flex-1 min-h-0 overflow-hidden relative">
        {/* floating switcher overlay — grid mode only, top-right */}
        <Show when={!!currentRemote() && viewMode() === "grid"}>
          <div class="absolute top-2 right-4 z-20">{viewModeSwitcher()}</div>
        </Show>
        <Show
          when={viewMode() === "table" && !!currentRemote()}
          fallback={
            <div class="h-full overflow-hidden">
              {albumsQuery.isLoading || isResetting() ? (
                <div class="flex items-center justify-center h-full">
                  <LoadingState text="loading albums..." />
                </div>
              ) : albumsQuery.isError ? (
                <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                  <div class="text-center max-w-md">
                    {albumsQuery.error instanceof RemoteOfflineError ? (
                      <>
                        <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                          {(albumsQuery.error as RemoteOfflineError).remoteName} is offline
                        </p>
                        <p class="text-sm text-[var(--color-text-muted)]">
                          switch to a different remote or use local library
                        </p>
                      </>
                    ) : (
                      <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                        failed to load albums
                      </p>
                    )}
                  </div>
                </div>
              ) : albums().length === 0 ? (
                <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                  <div class="text-center max-w-md">
                    <p class="text-lg text-[var(--color-text-secondary)] mb-2">no albums found!</p>
                    <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                      add music to import local audio files or download from urls
                    </p>
                    <Button variant="primary" onClick={props.onAddMusic}>
                      add music
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <VirtualAlbumGrid
                    albums={albums()}
                    onAlbumClick={handleAlbumClick}
                    onAlbumPlay={handleAlbumPlay}
                    onFavoriteToggle={(album, isFavorite) =>
                      handleFavoriteToggle(album.id, isFavorite)
                    }
                    getContextMenuActions={getContextMenuActions}
                    onNearEnd={loadMore}
                    showYear={true}
                    showGenres={true}
                    cardSize="medium"
                    height={gridHeight()}
                    scrollPaddingTop={100}
                    scrollRestoreKey={`albums-${searchQuery() || ""}-${tagFilters()
                      .map((f) => f.tag)
                      .join(",")}`}
                  />
                  <LoadingMoreIndicator isLoading={albumsQuery.isFetchingNextPage} />
                </>
              )}
            </div>
          }
        >
          <AlbumsTable remote={currentRemote()!} onEnrichAllMatching={triggerEnrichment} />
        </Show>
        <Show when={viewMode() === "table" && !!currentRemote()}>
          <AlbumBulkActionBar
            isAdmin={isRemoteAdmin()}
            onEnrich={() => triggerEnrichment(selectedAlbumIds())}
            onReview={() => triggerReview(selectedAlbumIds())}
            onMarkDone={() => void markSelectedDone(selectedAlbumIds())}
            onEditMetadata={() => {
              const ids = selectedAlbumIds();
              if (ids.length === 0) return;
              setBulkEditAlbumIds(ids);
              setBulkEditMode("metadata");
              setShowBulkEditModal(true);
            }}
            onSetDiscNumber={() => {
              const ids = selectedAlbumIds();
              if (ids.length === 0) return;
              setBulkEditAlbumIds(ids);
              setBulkEditMode("disc");
              setShowBulkEditModal(true);
            }}
            onManageTags={() => {
              const ids = selectedAlbumIds();
              if (ids.length === 0) return;
              setTagSelectorAlbumIds(ids);
              setShowTagSelectorModal(true);
            }}
            onSkip={() => void skipSelected(selectedAlbumIds())}
            onUnskip={() => void unskipSelected(selectedAlbumIds())}
          />
        </Show>
      </div>

      <Show when={showBulkEditModal() && !!currentRemote() && bulkEditAlbumIds().length > 0}>
        <BulkEditAlbumsModal
          isOpen={true}
          onClose={() => {
            setShowBulkEditModal(false);
            setBulkEditAlbumIds([]);
          }}
          albumIds={bulkEditAlbumIds()}
          remote={currentRemote()!}
          mode={bulkEditMode()}
          onSuccess={() => {
            void queryClient.invalidateQueries({
              queryKey: ["library-albums", currentRemote()!.remote_id],
            });
          }}
        />
      </Show>

      <Show when={showTagSelectorModal() && !!currentRemote() && tagSelectorAlbumIds().length > 0}>
        <TagSelectorModal
          albumIds={tagSelectorAlbumIds()}
          remote={currentRemote()!}
          onClose={() => {
            setShowTagSelectorModal(false);
            setTagSelectorAlbumIds([]);
          }}
          onSave={() => {
            const r = currentRemote();
            if (!r) return;
            void queryClient.invalidateQueries({
              queryKey: ["library-albums", r.remote_id],
            });
          }}
        />
      </Show>
    </div>
  );
}
