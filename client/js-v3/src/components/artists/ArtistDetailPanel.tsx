// reusable artist detail panel component for displaying artist info and albums
import { createMemo, For, Show, type JSX } from "solid-js";
import {
    AlbumSection,
    type AlbumSectionSong,
} from "../albums/AlbumSection";
import { Button } from "../buttons/Button";
import {
    formatDuration,
    formatNumber,
    StatsCard,
    StatsGrid,
} from "../cards/StatsCard";

export interface ArtistDetailPanelArtist {
  artist_id: string;
  name: string;
  song_count: number;
  album_count: number;
  total_duration: number;
}

export interface ArtistDetailPanelSong {
  song_id: string;
  title: string;
  album_id: string;
  album_title: string;
  track_number: number;
  disc_number: number;
  duration: number;
  year: number | null;
}

interface AlbumGroup {
  albumId: string;
  albumTitle: string;
  year: number | null;
  songs: AlbumSectionSong[];
  totalDuration: number;
}

export interface ArtistDetailPanelProps {
  /** artist info */
  artist: ArtistDetailPanelArtist;
  /** all songs by this artist */
  songs: ArtistDetailPanelSong[];
  /** currently playing song id */
  playingSongId?: string;
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
  /** play specific song (double click) */
  onSongDoubleClick?: (songId: string, albumId: string) => void;
  /** additional css classes */
  class?: string;
}

export function ArtistDetailPanel(props: ArtistDetailPanelProps): JSX.Element {
  // group songs by album
  const albumGroups = createMemo((): AlbumGroup[] => {
    const groups = new Map<string, AlbumGroup>();

    props.songs.forEach((song) => {
      if (!groups.has(song.album_id)) {
        groups.set(song.album_id, {
          albumId: song.album_id,
          albumTitle: song.album_title,
          year: song.year,
          songs: [],
          totalDuration: 0,
        });
      }

      const group = groups.get(song.album_id)!;
      group.songs.push({
        id: song.song_id,
        title: song.title,
        trackNumber: song.track_number,
        discNumber: song.disc_number,
        duration: song.duration,
      });
      group.totalDuration += song.duration;
    });

    // sort albums by title
    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.albumTitle.localeCompare(b.albumTitle),
    );

    // sort songs within each album by disc/track
    sortedGroups.forEach((group) => {
      group.songs.sort((a, b) => {
        if (a.discNumber !== b.discNumber) {
          return a.discNumber - b.discNumber;
        }
        return a.trackNumber - b.trackNumber;
      });
    });

    return sortedGroups;
  });

  return (
    <div class={`flex flex-col h-full overflow-y-auto ${props.class || ""}`}>
      {/* artist header with stats */}
      <div class="sticky top-0 z-10 bg-[var(--color-bg-primary)] border-b border-[var(--color-border-default)] p-6">
        <h2 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
          {props.artist.name}
        </h2>

        <StatsGrid columns={3} gap="md" class="mb-6">
          <StatsCard
            label="songs"
            value={formatNumber(props.artist.song_count)}
            icon="music"
          />
          <StatsCard
            label="albums"
            value={formatNumber(props.artist.album_count)}
            icon="album"
          />
          <StatsCard
            label="duration"
            value={formatDuration(props.artist.total_duration)}
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

      {/* albums with songs */}
      <div class="flex-1 px-6 py-4">
        <div class="mb-4">
          <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">
            albums
          </h3>
        </div>
        <Show
          when={albumGroups().length > 0}
          fallback={
            <p class="text-[var(--color-text-tertiary)] text-sm">
              no albums found
            </p>
          }
        >
          <div class="space-y-6">
            <For each={albumGroups()}>
              {(album) => (
                <AlbumSection
                  albumId={album.albumId}
                  albumTitle={album.albumTitle}
                  year={album.year}
                  songs={album.songs}
                  totalDuration={album.totalDuration}
                  playingSongId={props.playingSongId}
                  onAlbumClick={props.onAlbumClick}
                  onPlayAlbum={() => props.onPlayAlbum?.(album.albumId)}
                  onAddToQueue={() => props.onAddAlbumToQueue?.(album.albumId)}
                  onSongDoubleClick={(song) =>
                    props.onSongDoubleClick?.(song.id, album.albumId)
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
