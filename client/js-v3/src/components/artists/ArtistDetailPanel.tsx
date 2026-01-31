// reusable artist detail panel component for displaying artist info and albums
import { createMemo, For, Show, type JSX } from "solid-js";
import {
  useAlbumContextMenu,
  useArtistContextMenu,
  useSongContextMenu,
} from "../../music/services/contextMenu";
import type { Song } from "../../music/services/storage/types";
import { getArtistAbbreviation } from "../../music/utils/format";
import { AlbumSection } from "../albums/AlbumSection";
import { Button } from "../buttons/Button";
import { formatDuration, formatNumber, StatsCard, StatsGrid } from "../cards/StatsCard";
import { ContextMenu } from "../overlays/ContextMenu";
import { Icon, IconNames } from "../icons/registry";
import { HeadingSection } from "../layout/HeadingSection";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { Rating } from "../ratings/Rating";
import { MarqueeText } from "../text/MarqueeText";
import MediaImage from "../media/MediaImage";

export interface ArtistDetailPanelArtist {
  artist_id: string;
  name: string;
  bio?: string | null;
  song_count: number;
  album_count: number;
  total_duration: number;
  images?: import("../../music/services/storage/types").ImageMetadata[];
  is_favorite?: boolean;
  user_rating?: number;
}

interface AlbumGroup {
  albumId: string;
  albumTitle: string;
  year: number | null;
  songs: Song[];
  totalDuration: number;
  images?: import("../../music/services/storage/types").ImageMetadata[];
  artworkUrl: string | null;
  blobId?: string | null;
  isFavorite: boolean;
  rating?: number;
  genre?: string | null;
  subGenres?: string[];
  tags?: string[];
}

export interface ArtistDetailPanelProps {
  /** artist info */
  artist: ArtistDetailPanelArtist;
  /** all songs by this artist */
  songs: Song[];
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
  /** rating change handler */
  onRatingChange?: (rating: number) => void;
  /** song rating change handler */
  onSongRatingChange?: (songId: string, rating: number) => void;
  /** album rating change handler */
  onAlbumRatingChange?: (albumId: string, rating: number) => void;
  /** album favorite toggle handler */
  onAlbumFavoriteToggle?: (albumId: string, isFavorite: boolean) => void;
  /** song favorite toggle handler */
  onSongFavoriteToggle?: (songId: string, isFavorite: boolean) => void;
  /** artist favorite toggle handler */
  onFavoriteToggle?: (isFavorite: boolean) => void;
  /** edit artist handler */
  onEditArtist?: () => void;
  /** click artist image handler (for carousel) */
  onImageClick?: () => void;
  /** navigate to genre detail */
  onGenreClick?: (genreId: string, genreName: string) => void;
  /** show back button for mobile navigation */
  showBackButton?: boolean;
  /** callback when back button clicked */
  onBack?: () => void;
  /** additional css classes */
  class?: string;
}

export function ArtistDetailPanel(props: ArtistDetailPanelProps): JSX.Element {
  // group songs by album
  const albumGroups = createMemo((): AlbumGroup[] => {
    const groups = new Map<string, AlbumGroup>();

    props.songs.forEach((song, index) => {
      if (!groups.has(song.album_id)) {
        // get first image URL from album_images if available
        const firstImage = song.album_images?.[0];
        const artworkUrl = firstImage?.local_blob_id || firstImage?.remote_url || null;

        groups.set(song.album_id, {
          albumId: song.album_id,
          albumTitle: song.album_title,
          year: song.year,
          songs: [],
          totalDuration: 0,
          images: song.album_images,
          artworkUrl,
          isFavorite: song.album_is_favorite ?? false,
          rating: song.album_rating,
          genre: song.album_primary_genre_name,
          subGenres: song.album_sub_genres,
          tags: song.album_tags,
        });
      } else if (
        song.album_rating !== undefined &&
        groups.get(song.album_id)!.rating === undefined
      ) {
        // update album rating if this song has one and the group doesn't yet
        groups.get(song.album_id)!.rating = song.album_rating;
      }

      const group = groups.get(song.album_id)!;
      group.songs.push(song);
      group.totalDuration += song.duration_seconds;
    });

    // sort albums by title
    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.albumTitle.localeCompare(b.albumTitle)
    );

    // sort songs within each album by disc/track
    sortedGroups.forEach((group) => {
      group.songs.sort((a, b) => {
        if (a.disc_number !== b.disc_number) {
          return a.disc_number - b.disc_number;
        }
        return a.track_number - b.track_number;
      });
    });

    return sortedGroups;
  });

  // collect unique genre names from all albums with their IDs
  const artistGenres = createMemo(() => {
    const genreMap = new Map<string, { id: string | null; name: string }>();
    props.songs.forEach((song) => {
      // prefer genre name, fallback to ID
      const name = song.album_primary_genre_name || song.album_primary_genre_id;
      const id = song.album_primary_genre_id;
      if (name) {
        genreMap.set(name, { id, name });
      }
      if (song.album_sub_genres) {
        song.album_sub_genres.forEach((sg) => {
          genreMap.set(sg, { id: null, name: sg }); // sub-genres don't have IDs
        });
      }
    });
    return Array.from(genreMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  });

  // collect unique tags from all albums
  const artistTags = createMemo(() => {
    const tagSet = new Set<string>();
    props.songs.forEach((song) => {
      if (song.album_tags) {
        song.album_tags.forEach((tag) => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  });

  // create artist abbreviation (up to 3 letters from first words)
  const artistAbbreviation = createMemo(() => getArtistAbbreviation(props.artist.name));

  // context menu for artist
  const artistContextMenuActions = createMemo(() => {
    return useArtistContextMenu(
      {
        id: props.artist.artist_id,
        name: props.artist.name,
        song_count: props.artist.song_count,
      },
      {
        showPlayActions: false, // we have buttons for this
        onPlayAll: props.onPlayAll,
        onShuffle: props.onShuffle,
        onAddToQueue: props.onAddToQueue,
        isFavorite: props.artist.is_favorite ?? false,
      }
    );
  });

  return (
    <div class={`flex flex-col h-full ${props.class || ""}`}>
      {/* sticky header with back button for mobile */}
      <Show when={props.showBackButton}>
        <HeadingSection
          title={props.artist.name}
          titleElement={<MarqueeText text={props.artist.name} hoverOnly={true} />}
          variant="detail"
          sticky
          border
          showBackButton={props.showBackButton}
          onBack={props.onBack}
          class="px-4 py-3"
        />
      </Show>

      {/* scrollable content */}
      <div class="flex-1 overflow-y-auto">
        {/* artist header with image, info, and actions */}
        <div class="p-4 md:p-6 space-y-4 md:space-y-6">
          <div class="flex flex-col md:flex-row gap-4 md:gap-6 items-center md:items-start">
            {/* artist avatar */}
            <ContextMenu actions={artistContextMenuActions()}>
              <div
                class="w-32 h-32 md:w-48 md:h-48 bg-[var(--color-bg-elevated)] rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity overflow-hidden"
                onClick={props.onImageClick}
              >
                <MediaImage
                  images={props.artist.images}
                  alt={props.artist.name}
                  class="w-full h-full object-cover"
                  domainType="artist"
                />
              </div>
            </ContextMenu>

            {/* artist info */}
            <div class="flex flex-col justify-center gap-1 md:gap-2 min-w-0 text-center md:text-left w-full">
              <h1 class="text-2xl md:text-5xl font-bold text-[var(--color-text-primary)]">
                <MarqueeText text={props.artist.name} hoverOnly={true} />
              </h1>

              {/* bio */}
              <Show when={props.artist.bio}>
                <p class="text-xs md:text-sm text-[var(--color-text-secondary)] line-clamp-3 max-w-2xl">
                  {props.artist.bio}
                </p>
              </Show>

              {/* genres and tags */}
              <div class="flex flex-wrap gap-2 items-center justify-center md:justify-start text-sm">
                <Show when={artistGenres().length > 0}>
                  <div class="flex flex-wrap gap-1.5 justify-center md:justify-start">
                    <For each={artistGenres()}>
                      {(genre) => (
                        <button
                          class="px-2 py-0.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded-full text-xs hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
                          onClick={() => genre.id && props.onGenreClick?.(genre.id, genre.name)}
                          disabled={!genre.id}
                        >
                          {genre.name}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={artistTags().length > 0}>
                  <div class="flex flex-wrap gap-1.5 justify-center md:justify-start">
                    <For each={artistTags()}>
                      {(tag) => (
                        <span class="px-2 py-0.5 bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] rounded-full text-xs">
                          {tag}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* artist actions (edit, favorite, rating) */}
              <div class="mt-2 md:mt-4 flex items-center justify-center md:justify-start gap-2 md:gap-3">
                <Show when={props.onEditArtist}>
                  <button
                    onClick={props.onEditArtist}
                    class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                    title="edit artist info"
                    aria-label="edit artist info"
                  >
                    <Icon name={IconNames.edit} size={20} />
                  </button>
                </Show>
                <FavoriteHeart
                  isFavorite={props.artist.is_favorite ?? false}
                  onToggle={props.onFavoriteToggle}
                />
                <Rating
                  rating={props.artist.user_rating ?? 0}
                  size="md"
                  onRatingChange={props.onRatingChange}
                />
              </div>
            </div>
          </div>

          {/* stats cards */}
          <div class="px-4 md:px-6">
            <StatsGrid columns={5} gap="sm">
              <StatsCard label="songs" value={formatNumber(props.artist.song_count)} icon="music" />
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
              <Show when={artistGenres().length > 0}>
                <StatsCard
                  label="genres"
                  value={formatNumber(artistGenres().length)}
                  icon="music"
                />
              </Show>
              <Show when={artistTags().length > 0}>
                <StatsCard label="tags" value={formatNumber(artistTags().length)} icon="music" />
              </Show>
            </StatsGrid>
          </div>
        </div>

        {/* albums list with songs */}
        <div class="flex-1 px-4 md:px-6 py-3 md:py-4">
          <Show
            when={albumGroups().length > 0}
            fallback={<p class="text-[var(--color-text-tertiary)] text-sm">no albums found</p>}
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
                    images={album.images}
                    artworkUrl={album.artworkUrl}
                    blobId={album.blobId}
                    isFavorite={album.isFavorite}
                    rating={album.rating}
                    genre={album.genre}
                    subGenres={album.subGenres}
                    tags={album.tags}
                    onRatingChange={(rating) => props.onAlbumRatingChange?.(album.albumId, rating)}
                    onFavoriteToggle={(isFavorite) =>
                      props.onAlbumFavoriteToggle?.(album.albumId, isFavorite)
                    }
                    playingSongId={props.playingSongId}
                    onAlbumClick={props.onAlbumClick}
                    onPlayAlbum={() => props.onPlayAlbum?.(album.albumId)}
                    onAddToQueue={() => props.onAddAlbumToQueue?.(album.albumId)}
                    onSongDoubleClick={(song) => props.onSongDoubleClick?.(song.id, album.albumId)}
                    onSongRatingChange={(songId, rating) =>
                      props.onSongRatingChange?.(songId, rating)
                    }
                    onSongFavoriteToggle={(songId, isFavorite) =>
                      props.onSongFavoriteToggle?.(songId, isFavorite)
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
                        }
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
