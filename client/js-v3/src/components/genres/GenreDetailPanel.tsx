// reusable genre detail panel component for displaying genre info with albums grouped by artist
import { createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Button } from "../buttons/Button";
import { formatDuration, formatNumber, StatsCard, StatsGrid } from "../cards/StatsCard";
import { HeadingSection } from "../layout/HeadingSection";
import { type MenuAction } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";
import { VirtualGenreDetail } from "../virtualized/VirtualGenreDetail";

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
  album_images?: import("../../music/services/storage/types").ImageMetadata[];
  album_is_favorite?: boolean;
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
  /** toggle album favorite */
  onAlbumFavoriteToggle?: (albumId: string, isFavorite: boolean) => void;
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
  let containerRef: HTMLDivElement | undefined;
  const [listHeight, setListHeight] = createSignal(400); // default height

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

  // measure available height for the virtualized list
  onMount(() => {
    if (!containerRef) return;

    const calculateHeight = () => {
      if (!containerRef) return;
      // on desktop: header with stats+buttons is fixed (~160px)
      // on mobile: header is small (~60px), stats+buttons scroll with content
      const isNarrow = window.innerWidth < 768;
      const headerHeight = isNarrow ? 60 : 160;
      const padding = 16;
      const available = containerRef.clientHeight - headerHeight - padding;
      setListHeight(Math.max(200, available));
    };

    calculateHeight();

    const observer = new ResizeObserver(() => calculateHeight());
    observer.observe(containerRef);

    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={containerRef} class={`flex flex-col h-full ${props.class || ""}`}>
      {/* genre header - fixed at top */}
      <HeadingSection
        title={props.genre.name}
        titleElement={<MarqueeText text={props.genre.name} hoverOnly={true} />}
        variant="detail"
        border
        showBackButton={props.showBackButton}
        onBack={props.onBack}
        class="px-4 md:px-6 py-2 md:py-4"
      >
        {/* stats + buttons in header on desktop only - on mobile they scroll with content */}
        <div class="hidden md:block">
          <StatsGrid columns={3} gap="md" class="mb-3">
            <StatsCard label="songs" value={formatNumber(displaySongCount())} icon="music" />
            <StatsCard label="albums" value={formatNumber(displayAlbumCount())} icon="album" />
            <StatsCard label="duration" value={formatDuration(totalDuration())} icon="recent" />
          </StatsGrid>
          <div class="flex gap-3">
            <Button variant="primary" onClick={props.onPlayAll}>
              play all
            </Button>
            <Button variant="secondary" onClick={props.onShuffle}>
              shuffle
            </Button>
            <Button variant="ghost" onClick={props.onAddToQueue}>
              add to queue
            </Button>
          </div>
        </div>
      </HeadingSection>

      {/* virtualized artists with albums - owns its own scroll container */}
      <div class="flex-1 min-h-0">
        <VirtualGenreDetail
          songs={props.songs}
          onAlbumClick={props.onAlbumClick}
          onPlayAlbum={props.onPlayAlbum}
          onAlbumFavoriteToggle={props.onAlbumFavoriteToggle}
          onArtistClick={props.onArtistClick}
          getAlbumContextMenuActions={props.getAlbumContextMenuActions}
          gridColumns={5}
          height={listHeight()}
          scrollRestoreKey={`genre-detail-${props.genre.genre_id}`}
          header={
            // stats + buttons on mobile only - scrolls with content
            <div class="md:hidden px-4 py-3 space-y-3">
              <StatsGrid columns={3} gap="sm">
                <StatsCard label="songs" value={formatNumber(displaySongCount())} icon="music" />
                <StatsCard label="albums" value={formatNumber(displayAlbumCount())} icon="album" />
                <StatsCard label="duration" value={formatDuration(totalDuration())} icon="recent" />
              </StatsGrid>
              <div class="flex gap-2">
                <Button variant="primary" onClick={props.onPlayAll}>
                  play
                </Button>
                <Button variant="secondary" onClick={props.onShuffle}>
                  shuffle
                </Button>
                <Button variant="ghost" onClick={props.onAddToQueue}>
                  +queue
                </Button>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
