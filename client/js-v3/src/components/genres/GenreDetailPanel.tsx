// reusable genre detail panel component for displaying genre info with albums grouped by artist
import { createMemo, type JSX } from "solid-js";
import { Button } from "../buttons/Button";
import {
  formatDuration,
  formatNumber,
  StatsCard,
  StatsGrid,
} from "../cards/StatsCard";
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
  thumbnail_blob_id: string | null;
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
  /** additional css classes */
  class?: string;
}

export function GenreDetailPanel(props: GenreDetailPanelProps): JSX.Element {
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
    props.genre.song_count > 0 ? props.genre.song_count : actualSongCount(),
  );
  const displayAlbumCount = createMemo(() =>
    props.genre.album_count > 0 ? props.genre.album_count : actualAlbumCount(),
  );

  return (
    <div class={`flex flex-col h-full overflow-y-auto ${props.class || ""}`}>
      {/* genre header with stats */}
      <div class="sticky top-0 z-10 bg-[var(--color-bg-primary)] border-b border-[var(--color-border-default)] p-6">
        <h2 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
          <MarqueeText text={props.genre.name} hoverOnly={true} />
        </h2>

        <StatsGrid columns={3} gap="md" class="mb-6">
          <StatsCard
            label="songs"
            value={formatNumber(displaySongCount())}
            icon="music"
          />
          <StatsCard
            label="albums"
            value={formatNumber(displayAlbumCount())}
            icon="album"
          />
          <StatsCard
            label="duration"
            value={formatDuration(totalDuration())}
            icon="recent"
          />
        </StatsGrid>

        {/* action buttons */}
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

      {/* virtualized artists with albums */}
      <div class="flex-1 px-6 py-4">
        <VirtualGenreDetail
          songs={props.songs}
          onAlbumClick={props.onAlbumClick}
          onPlayAlbum={props.onPlayAlbum}
          onArtistClick={props.onArtistClick}
          getAlbumContextMenuActions={props.getAlbumContextMenuActions}
          gridColumns={5}
        />
      </div>
    </div>
  );
}
