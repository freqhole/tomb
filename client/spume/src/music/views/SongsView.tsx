// songs view - optimized with virtualization and infinite scroll

import { useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { Button } from "../../components/buttons/Button";
import { SearchSortControls } from "../../components/controls/SearchSortControls";
import { TagFilterPicker, type TagFilter } from "../../components/forms/TagFilterPicker";
import {
  VirtualSongList,
  type SortField,
  type SortDirection,
  type SortState,
} from "../../components/virtualized/VirtualSongList";
import type { Song } from "../data/types";
import { useSongsInfiniteQuery, type SongSortField } from "../queries/songs";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { useSetRatingMutation } from "../queries/ratings";
import { useTagsQuery } from "../queries/tags";
import { playQueue } from "../services/audio/queue";
import { useSongContextMenu } from "../services/contextMenu";

// narrow breakpoint for responsive layout
const NARROW_BREAKPOINT = 768;

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

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false
  );

  // responsive list height: window - header (122px) - player bar (80px)
  const HEADER_HEIGHT = 122;
  const PLAYER_HEIGHT = 80;
  const [listHeight, setListHeight] = createSignal(
    window.innerHeight - HEADER_HEIGHT - PLAYER_HEIGHT
  );

  onMount(() => {
    let resizeTimeout: number | undefined;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        setListHeight(window.innerHeight - HEADER_HEIGHT - PLAYER_HEIGHT);
        const narrow = window.innerWidth < NARROW_BREAKPOINT;
        setIsNarrow(narrow);
      }, 100);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
      clearPageInfo(); // clear page info when leaving view
    });
  });

  // sorting state
  const [sortField, setSortField] = createSignal<SongSortField>("added_at");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc");

  // tag filtering state
  const [tagFilters, setTagFilters] = createSignal<TagFilter[]>([]);

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
    pageSize: 100,
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

  // update page info for TopNav (mobile displays "songs (N)")
  createEffect(() => {
    const count = allSongs().length;
    setPageInfo({ title: "songs", count });
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

  const handleSongClick = (song: Song, index: number) => {
    props.onSongClick?.(song);
  };

  const handleSongDoubleClick = (song: Song, index: number) => {
    props.onSongDoubleClick?.(song);
  };

  // play song immediately when thumbnail is clicked
  const handlePlayClick = async (song: Song, index: number) => {
    await playQueue([song]);
  };

  // build context menu actions for a song
  const getContextMenuActions = (song: Song, index: number) => {
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
      {/* header */}
      <div class="flex items-center justify-between p-4">
        <div class="hidden md:block mr-4">
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">songs</h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {songsQuery.isLoading
              ? "loading..."
              : `${allSongs().length} ${allSongs().length === 1 ? "song" : "songs"}${songsQuery.hasNextPage ? "+" : ""}`}
          </p>
        </div>
        <div class="flex-1 flex justify-between items-center gap-4">
          <TagFilterPicker
            availableTags={availableTags()}
            selectedFilters={tagFilters()}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onToggleMode={handleToggleMode}
            onClearAll={handleClearAllTags}
            loading={tagsQuery.isLoading}
            compact={true}
          />
          {/* show sort controls only on narrow - table has sortable headers */}
          <Show when={isNarrow()}>
            <SearchSortControls
              sortFields={songSortFields}
              sortBy={sortField()}
              sortDirection={sortDirection()}
              onSortByChange={(field) => setSortField(field as SongSortField)}
              onSortDirectionChange={setSortDirection}
            />
          </Show>
        </div>
      </div>

      {/* song list */}
      <div class="flex-1 overflow-hidden">
        {allSongs().length === 0 && !songsQuery.isLoading ? (
          <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
            <div class="text-center max-w-md">
              <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                no songs in your library yet
              </p>
              <Button variant="primary" onClick={props.onAddMusic}>
                add music
              </Button>
            </div>
          </div>
        ) : isResetting() ? (
          <div class="flex items-center justify-center h-full">
            <div class="text-[var(--color-text-secondary)]">loading...</div>
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
            />
            {songsQuery.isFetchingNextPage && (
              <div class="p-4 text-center text-[var(--color-text-secondary)] text-sm">
                loading more songs...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
