// songs view - displays all songs with infinite scroll using tanstack query
import { useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal } from "solid-js";
import { Button } from "../../components/buttons/Button";
import {
  TagFilterPicker,
  type TagFilter,
} from "../../components/forms/TagFilterPicker";
import {
  VirtualSongList,
  type SortDirection,
  type SortField,
  type VirtualSong,
} from "../../components/virtualized/VirtualSongList";
import { getCurrentRemote } from "../data";
import type { Song } from "../data/types";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { useSongsInfiniteQuery, type SongSortField } from "../queries/songs";
import { useTagsQuery } from "../queries/tags";
import { useSongContextMenu } from "../services/contextMenu";

export interface SongsViewProps {
  onAddMusic: () => void;
  onSongClick?: (song: Song) => void;
  onSongDoubleClick?: (song: Song) => void;
}

// format seconds to MM:SS
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function SongsView(props: SongsViewProps) {
  // get search params from URL
  const [searchParams] = useSearchParams();

  // track query changes to force list reset
  const [isResetting, setIsResetting] = createSignal(false);

  // sorting state - maps to query key so changes trigger refetch
  const [sortField, setSortField] = createSignal<SongSortField>("added_at");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc");

  // tag filtering state
  const [tagFilters, setTagFilters] = createSignal<TagFilter[]>([]);

  // fetch available tags
  const tagsQuery = useTagsQuery();

  // favorites mutation
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // infinite query hook
  const songsQuery = useSongsInfiniteQuery({
    sortField: () => sortField(),
    sortDirection: () => sortDirection(),
    pageSize: 100,
    query: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
    tagFilters: () => tagFilters(),
  });

  // reset virtual list when query param or tag filters change
  createEffect(() => {
    const q = searchParams.q;
    const queryParam = Array.isArray(q) ? q[0] : q;
    const filters = tagFilters();
    // briefly show resetting state to force virtual list to remount
    setIsResetting(true);
    setTimeout(() => setIsResetting(false), 0);
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
              mode: (f.mode === "include" ? "exclude" : "include") as
                | "include"
                | "exclude",
            }
          : f,
      ),
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

  // map query sort field to UI sort field for display
  const uiSortField = (): SortField => {
    const field = sortField();
    const reverseMap: Record<SongSortField, SortField> = {
      added_at: "track",
      title: "title",
      artist: "artist",
      album: "album",
      genre: "genre",
      year: "year",
    };
    return reverseMap[field] || "track";
  };

  // all songs accumulated across pages
  const allSongs = () => {
    const pages = songsQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.items);
  };

  // convert to virtual song list format - memoized to prevent unnecessary recreations
  const virtualSongs = createMemo((): VirtualSong[] => {
    return allSongs().map((song) => ({
      id: song.id,
      sha256: song.sha256,
      title: song.title,
      artist: song.artist_name,
      album: song.album_title,
      genre: undefined, // TODO: add genre_name to Song type or fetch from genre_id
      duration: formatDuration(song.duration_seconds),
      year: song.year ?? undefined,
      trackNumber: song.track_number,
      discNumber: song.disc_number,
      thumbnailUrl: song.thumbnail_blob_id
        ? `${getCurrentRemote()?.base_url || ""}/api/blobs/${song.thumbnail_blob_id}`
        : null,
      userIsFavorite: song.is_favorite || false,
      userRating: song.user_rating || 0,
      tags: song.album_tags ?? undefined,
    }));
  });

  // trigger loading next page - tanstack query handles deduplication
  const loadMore = () => {
    if (!songsQuery.hasNextPage || songsQuery.isFetchingNextPage) return;
    songsQuery.fetchNextPage();
  };

  const handleSongClick = (virtualSong: VirtualSong) => {
    const song = allSongs().find((s) => s.id === virtualSong.id);
    if (song) props.onSongClick?.(song);
  };

  const handleSongDoubleClick = (virtualSong: VirtualSong) => {
    const song = allSongs().find((s) => s.id === virtualSong.id);
    if (song) props.onSongDoubleClick?.(song);
  };

  // build context menu actions for each song
  const getContextMenuActions = (virtualSong: VirtualSong, index: number) => {
    const song = allSongs().find((s) => s.id === virtualSong.id);
    if (!song) return [];
    return useSongContextMenu(song, {
      showPlayActions: true,
      isFavorite: virtualSong.userIsFavorite,
    });
  };

  // handle favorite toggle
  const handleFavoriteToggle = (
    virtualSong: VirtualSong,
    isFavorite: boolean,
  ) => {
    const song = allSongs().find((s) => s.id === virtualSong.id);
    if (!song) return;

    // mutation handles optimistic update automatically
    toggleFavoriteMutation.mutate({
      targetType: "song",
      targetId: song.id,
      sha256: song.sha256,
      isFavorite,
    });
  };

  // handle sort changes - this triggers query refetch via key change
  const handleSortChange = (field: SortField, direction: SortDirection) => {
    // map UI sort field to query sort field
    const fieldMap: Record<SortField, SongSortField> = {
      track: "added_at", // track sort not applicable to global view
      title: "title",
      artist: "artist",
      album: "album",
      genre: "genre",
      year: "year",
      duration: "added_at", // duration sort not supported yet
      favorite: "added_at", // favorite sort not supported yet
      rating: "added_at", // rating sort not supported yet
    };
    setSortField(fieldMap[field]);
    setSortDirection(direction);
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="p-4 ml-[150px]">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
              songs
            </h1>
            <p class="text-sm text-[var(--color-text-secondary)]">
              {songsQuery.isLoading
                ? "loading..."
                : `${virtualSongs().length} ${virtualSongs().length === 1 ? "song" : "songs"}`}
            </p>
          </div>
          <Button variant="primary" onClick={props.onAddMusic}>
            add music
          </Button>
        </div>

        {/* tag filter picker */}
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
      </div>

      {/* song list */}
      <div class="flex-1 overflow-hidden">
        {virtualSongs().length === 0 && !songsQuery.isLoading ? (
          <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
            <div class="text-center max-w-md">
              <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                no songs in your library yet
              </p>
              <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                click "add music" above to import local audio files or download
                from urls
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
              songs={virtualSongs()}
              height={window.innerHeight - 120}
              sortState={{
                field: uiSortField(),
                direction: sortDirection(),
              }}
              onSortChange={handleSortChange}
              onSongClick={handleSongClick}
              onSongDoubleClick={handleSongDoubleClick}
              getContextMenuActions={getContextMenuActions}
              onNearEnd={loadMore}
              showFavorites={true}
              showTags={true}
              onFavoriteToggle={handleFavoriteToggle}
            />
            {songsQuery.isFetchingNextPage && (
              <div class="p-4 text-center text-[var(--color-text-secondary)] text-sm">
                loading more songs...
              </div>
            )}
            {!songsQuery.hasNextPage && virtualSongs().length > 0 && (
              <div class="p-4 text-center text-[var(--color-text-tertiary)] text-sm">
                end of list
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
