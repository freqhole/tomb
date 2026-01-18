// songs view - displays all songs with infinite scroll using tanstack query
import { createMemo, createSignal } from "solid-js";
import { Button } from "../../components/buttons/Button";
import {
  VirtualSongList,
  type SortDirection,
  type SortField,
  type Song as VirtualSong,
} from "../../components/virtualized/VirtualSongList";
import { useSongsInfiniteQuery, type SongSortField } from "../queries/songs";
import type { Song } from "../services/storage/types";

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
  // sorting state - maps to query key so changes trigger refetch
  const [sortField, setSortField] = createSignal<SongSortField>("added_at");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc");

  // infinite query hook
  const songsQuery = useSongsInfiniteQuery({
    sortField: () => sortField(),
    sortDirection: () => sortDirection(),
    pageSize: 100,
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
  const allSongs = () => songsQuery.data?.pages.flat() ?? [];

  // convert to virtual song list format - memoized to prevent unnecessary recreations
  const virtualSongs = createMemo((): VirtualSong[] => {
    return allSongs().map((result) => ({
      id: result.song.song_id,
      title: result.song.title,
      artist: result.song.artist_name,
      album: result.song.album_title,
      genre: result.genre?.name,
      duration: formatDuration(result.song.duration),
      year: result.song.year ?? undefined,
      trackNumber: result.song.track_number,
      discNumber: result.song.disc_number,
      userIsFavorite: result.is_favorite,
      userRating: result.rating ?? 0,
    }));
  });

  // track if we're already loading to prevent duplicate requests
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);

  // trigger loading next page with debouncing
  const loadMore = () => {
    if (isLoadingMore()) return;
    if (!songsQuery.hasNextPage || songsQuery.isFetchingNextPage) return;

    setIsLoadingMore(true);
    songsQuery.fetchNextPage().finally(() => {
      // add small delay before allowing next trigger
      setTimeout(() => setIsLoadingMore(false), 500);
    });
  };

  const handleSongClick = (virtualSong: VirtualSong) => {
    const result = allSongs().find((r) => r.song.song_id === virtualSong.id);
    if (result) props.onSongClick?.(result.song);
  };

  const handleSongDoubleClick = (virtualSong: VirtualSong) => {
    const result = allSongs().find((r) => r.song.song_id === virtualSong.id);
    if (result) props.onSongDoubleClick?.(result.song);
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
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
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
              onNearEnd={loadMore}
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
