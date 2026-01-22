// reusable artist detail panel component for displaying artist info and albums
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  useAlbumContextMenu,
  useArtistContextMenu,
  useSongContextMenu,
} from "../../music/services/contextMenu";
import { getBlobImageUrl } from "../../music/utils/images";
import { AlbumSection, type AlbumSectionSong } from "../albums/AlbumSection";
import { Button } from "../buttons/Button";
import {
  formatDuration,
  formatNumber,
  StatsCard,
  StatsGrid,
} from "../cards/StatsCard";
import { ContextMenu } from "../overlays/ContextMenu";
import { MarqueeText } from "../text/MarqueeText";

export interface ArtistDetailPanelArtist {
  artist_id: string;
  name: string;
  song_count: number;
  album_count: number;
  total_duration: number;
}

export interface ArtistDetailPanelSong {
  id: string;
  sha256: string;
  title: string;
  album_id: string;
  album_title: string;
  track_number: number;
  disc_number: number;
  duration_seconds: number;
  year: number | null;
  thumbnail_blob_id: string | null;
  is_favorite?: boolean;
}

interface AlbumGroup {
  albumId: string;
  albumTitle: string;
  year: number | null;
  songs: AlbumSectionSong[];
  totalDuration: number;
  artworkUrl: string | null;
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
  /** callback to get full song data for context menu (needed to convert AlbumSectionSong to full Song) */
  getSongData?: (songId: string) => any;
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
          artworkUrl: getBlobImageUrl(song.thumbnail_blob_id),
        });
      }

      const group = groups.get(song.album_id)!;
      group.songs.push({
        id: song.id,
        sha256: song.sha256,
        title: song.title,
        trackNumber: song.track_number,
        discNumber: song.disc_number,
        duration: song.duration_seconds,
        isFavorite: song.is_favorite,
      });
      group.totalDuration += song.duration_seconds;
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
          <MarqueeText text={props.artist.name} hoverOnly={true} />
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
                  artworkUrl={album.artworkUrl}
                  playingSongId={props.playingSongId}
                  onAlbumClick={props.onAlbumClick}
                  onPlayAlbum={() => props.onPlayAlbum?.(album.albumId)}
                  onAddToQueue={() => props.onAddAlbumToQueue?.(album.albumId)}
                  onSongDoubleClick={(song) =>
                    props.onSongDoubleClick?.(song.id, album.albumId)
                  }
                  getAlbumContextMenuActions={() => {
                    // get favorite status from any song in the album
                    const firstSongData = album.songs[0]
                      ? props.getSongData?.(album.songs[0].id)
                      : null;
                    return useAlbumContextMenu(
                      {
                        id: album.albumId,
                        title: album.albumTitle,
                        artist_name: props.artist.name,
                        song_count: album.songs.length,
                      },
                      {
                        showPlayActions: true,
                        isFavorite: false, // album-level favorites not yet implemented on frontend
                      },
                    );
                  }}
                  getSongContextMenuActions={(song) => {
                    const songData = props.getSongData?.(song.id);
                    if (!songData) return [];
                    return useSongContextMenu(songData, {
                      showPlayActions: true,
                      isFavorite: songData.is_favorite ?? false,
                    });
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
