// reusable genre detail panel component for displaying genre info with albums grouped by artist
import { createMemo, createSignal, onMount, Show, type JSX } from "solid-js";
import { Button } from "../buttons/Button";
import { formatDuration, formatNumber, StatsCard, StatsGrid } from "../cards/StatsCard";
import { HeadingSection } from "../layout/HeadingSection";
import { type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { VirtualGenreDetail } from "../virtualized/VirtualGenreDetail";
import { useScrollRestore } from "../../utils/scrollRestore";

export interface GenreDetailPanelGenre {
  genre_id: string;
  name: string;
  song_count: number;
  album_count: number;
}

export interface GenreDetailPanelSong {
  sha256: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_title: string;
  duration_seconds: number;
  year: number | null;
}

export interface GenreDetailPanelProps {
  /** genre info */
  genre: GenreDetailPanelGenre;
  /** all songs in this genre */
  songs: GenreDetailPanelSong[];
  /** play all songs handler */
  onPlayAll?: () => void;
  /** shuffle all songs handler */
  onShuffle?: () => void;
  /** add all songs to queue handler */
  onAddToQueue?: () => void;
  /** navigate to album detail */
  onAlbumClick?: (albumId: string) => void;
  /** play specific album */
  onPlayAlbum?: (albumId: string) => void;
  /** add album to queue */
  onAddAlbumToQueue?: (albumId: string) => void;
  /** navigate to artist detail */
  onArtistClick?: (artistId: string) => void;
  /** callback to get context menu actions for an album */
  getAlbumContextMenuActions?: (albumId: string) => MenuAction[];
  /** show back button for mobile navigation */
  showBackButton?: boolean;
  /** callback when back button clicked */
  onBack?: () => void;
  /** additional css classes */
  class?: string;
}

export function GenreDetailPanel(props: GenreDetailPanelProps): JSX.Element {
  const [scrollContainerRef, setScrollContainerRef] = createSignal<HTMLDivElement | null>(null);

  // scroll restoration using browser history state
  const { restoreScroll, saveScroll } = useScrollRestore(`genre-detail-${props.genre.genre_id}`);

  // restore scroll position on mount
  onMount(() => {
    const container = scrollContainerRef();
    if (container) {
      // use double RAF to ensure virtualizer has calculated sizes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          restoreScroll(scrollContainerRef());
        });
      });
    }
  });

  const handleScroll = () => {
    saveScroll(scrollContainerRef());
  };

  const totalDuration = createMemo(() => {
    return props.songs.reduce((sum, song) => sum + song.duration_seconds, 0);
  });

  // calculate actual stats from songs data (use as fallback if genre stats are 0)
  const actualSongCount = createMemo(() => props.songs.length);
  const actualAlbumCount = createMemo(() => {
    const uniqueAlbums = new Set(props.songs.map((s) => s.album_id));
    return uniqueAlbums.size;
  });

  // use actual counts if genre stats are missing or 0
  const displaySongCount = createMemo(() =>
    props.genre.song_count > 0 ? props.genre.song_count : actualSongCount()
  );
  const displayAlbumCount = createMemo(() =>
    props.genre.album_count > 0 ? props.genre.album_count : actualAlbumCount()
  );

  return (
    <div class={`flex flex-col h-full ${props.class || ""}`}>
      {/* scrollable content */}
      <div ref={setScrollContainerRef} class="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {/* genre header - sticky on desktop, scrolls on narrow */}
        <HeadingSection
          title={props.genre.name}
          titleElement={<MarqueeText text={props.genre.name} hoverOnly={true} />}
          variant="detail"
          sticky
          border
          showBackButton={props.showBackButton}
          onBack={props.onBack}
          class="px-4 md:px-6 py-3 md:py-4"
        >
          {/* stats hidden on narrow - they scroll below */}
          <div class="hidden md:block">
            <StatsGrid columns={3} gap="md" class="mb-2">
              <StatsCard label="songs" value={formatNumber(displaySongCount())} icon="music" />
              <StatsCard label="albums" value={formatNumber(displayAlbumCount())} icon="album" />
              <StatsCard label="duration" value={formatDuration(totalDuration())} icon="recent" />
            </StatsGrid>
          </div>
        </HeadingSection>

        {/* stats shown inline on narrow - scrolls with content */}
        <div class="md:hidden px-4 py-3">
          <StatsGrid columns={3} gap="sm">
            <StatsCard label="songs" value={formatNumber(displaySongCount())} icon="music" />
            <StatsCard label="albums" value={formatNumber(displayAlbumCount())} icon="album" />
            <StatsCard label="duration" value={formatDuration(totalDuration())} icon="recent" />
          </StatsGrid>
        </div>

        {/* virtualized artists with albums */}
        <div class="flex-1 px-4 md:px-6 py-3 md:py-4">
          <Show when={scrollContainerRef()}>
            <VirtualGenreDetail
              songs={props.songs}
              onAlbumClick={props.onAlbumClick}
              onPlayAlbum={props.onPlayAlbum}
              onArtistClick={props.onArtistClick}
              getAlbumContextMenuActions={props.getAlbumContextMenuActions}
              gridColumns={5}
              getScrollElement={() => scrollContainerRef()}
            />
          </Show>
        </div>
      </div>

      {/* sticky action buttons */}
      <div class="sticky bottom-0 z-10 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-tertiary)] px-3 md:px-6 py-2 md:py-3 flex gap-2 md:gap-3">
        <Button variant="primary" onClick={props.onPlayAll}>
          <span class="hidden md:inline">play all</span>
          <span class="md:hidden">play</span>
        </Button>
        <Button variant="secondary" onClick={props.onShuffle}>
          shuffle
        </Button>
        <Button variant="ghost" onClick={props.onAddToQueue}>
          <span class="hidden md:inline">add to queue</span>
          <span class="md:hidden">+queue</span>
        </Button>
      </div>
    </div>
  );
}
