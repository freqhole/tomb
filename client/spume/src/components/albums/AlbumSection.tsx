// reusable album section component for displaying an album with its songs
import { For, type JSX } from "solid-js";
import { PlayIcon, AddStrokeIcon } from "../icons/registry";
import type { Song, GenreRef } from "../../music/data/types";
import type { ImageMetadata } from "../../music/services/storage/types";
import { formatDuration, formatHumanDuration } from "../../utils/formatDuration";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { Rating } from "../ratings/Rating";
import { SongRow } from "../songs/SongRow";
import { MarqueeText } from "../text/MarqueeText";
import MediaImage from "../media/MediaImage";

export interface AlbumSectionProps {
  /** album id */
  albumId: string;
  /** album title */
  albumTitle: string;
  /** album year */
  year?: number | null;
  /** array of songs in this album */
  songs: Song[];
  /** total duration in seconds */
  totalDuration?: number;
  /** structured image metadata array (preferred) */
  images?: ImageMetadata[];
  /** album artwork url (legacy, for backward compatibility) */
  artworkUrl?: string | null;
  blobId?: string | null;
  /** currently playing song id */
  playingSongId?: string;
  /** album favorite status */
  isFavorite?: boolean;
  /** album user rating */
  rating?: number;
  /** album primary genre */
  genre?: string | null;
  /** album genres */
  genres?: GenreRef[];
  /** album tags */
  tags?: string[];
  /** rating change handler */
  onRatingChange?: (rating: number) => void;
  /** favorite toggle handler */
  onFavoriteToggle?: (isFavorite: boolean) => void;
  /** click handler for album (navigates to album detail) */
  onAlbumClick?: (albumId: string) => void;
  /** play album handler */
  onPlayAlbum?: () => void;
  /** add album to queue handler */
  onAddToQueue?: () => void;
  /** song double click handler (plays song) */
  onSongDoubleClick?: (song: Song) => void;
  /** song rating change handler */
  onSongRatingChange?: (songId: string, rating: number) => void;
  /** song favorite toggle handler */
  onSongFavoriteToggle?: (songId: string, isFavorite: boolean) => void;
  /** callback to get context menu actions for album header */
  getAlbumContextMenuActions?: () => MenuAction[];
  /** callback to get context menu actions for a song */
  getSongContextMenuActions?: (song: Song) => MenuAction[];
  /** additional css classes */
  class?: string;
}

function AlbumHeader(props: {
  albumId: string;
  albumTitle: string;
  year?: number | null;
  songs: Song[];
  totalDuration: number;
  images?: ImageMetadata[];
  artworkUrl?: string | null;
  blobId?: string | null;
  isFavorite?: boolean;
  rating?: number;
  genre?: string | null;
  genres?: GenreRef[];
  tags?: string[];
  onAlbumClick?: () => void;
  onPlayAlbum?: () => void;
  onAddToQueue?: () => void;
  onRatingChange?: (rating: number) => void;
  onFavoriteToggle?: (isFavorite: boolean) => void;
}): JSX.Element {
  // collect all genre/tag badges for marquee
  const badgeText = () => {
    const parts: string[] = [];
    if (props.genre) parts.push(props.genre);
    if (props.genres) parts.push(...props.genres.map((g) => g.name));
    if (props.tags) parts.push(...props.tags.map((t) => `#${t}`));
    return parts.join(" · ");
  };

  return (
    <div class="bg-[var(--color-bg-elevated)] rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors">
      {/* narrow layout: title full width, then artwork with info/actions */}
      <div class="wide:hidden px-3 py-3">
        {/* row 1: title full width */}
        <button
          onClick={props.onAlbumClick}
          class="text-base font-semibold text-[var(--color-text-primary)] hover:underline text-left block w-full min-w-0 overflow-hidden"
        >
          <MarqueeText text={props.albumTitle} hoverOnly={true} />
        </button>
        {/* rows 2-3: artwork on left, info + actions on right */}
        <div class="flex gap-3 mt-2">
          {/* artwork */}
          <button
            onClick={props.onAlbumClick}
            class="w-12 h-12 bg-[var(--color-bg-primary)] rounded flex items-center justify-center flex-shrink-0 hover:opacity-80 transition-opacity overflow-hidden"
          >
            <MediaImage
              images={props.images}
              imageUrl={props.artworkUrl || null}
              blobId={props.blobId}
              alt={`${props.albumTitle} artwork`}
              class="w-full h-full object-cover"
              domainType="album"
              thumbnailSize={200}
            />
          </button>
          {/* info + actions stacked */}
          <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            {/* track info + actions */}
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs text-[var(--color-text-secondary)]">
                {props.songs.length} tracks · {formatHumanDuration(props.totalDuration)}
                {props.year && ` · ${props.year}`}
              </div>
              <div class="flex gap-0.5 flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onPlayAlbum?.();
                  }}
                  class="p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
                  title="play album"
                >
                  <PlayIcon size={16} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onAddToQueue?.();
                  }}
                  class="p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
                  title="add to queue"
                >
                  <AddStrokeIcon size={16} />
                </button>
                <FavoriteHeart
                  isFavorite={props.isFavorite ?? false}
                  onToggle={props.onFavoriteToggle}
                  size="sm"
                />
                <Rating
                  rating={props.rating ?? 0}
                  size="sm"
                  onRatingChange={props.onRatingChange}
                />
              </div>
            </div>
            {/* genres and tags */}
            {badgeText() && (
              <div class="text-xs text-[var(--color-text-tertiary)] overflow-hidden">
                <MarqueeText text={badgeText()} hoverOnly={true} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* wide layout: horizontal with image on left */}
      <div class="hidden wide:flex items-start gap-4 p-4">
        {/* album artwork */}
        <button
          onClick={props.onAlbumClick}
          class="w-16 h-16 bg-[var(--color-bg-primary)] rounded flex items-center justify-center flex-shrink-0 hover:opacity-80 transition-opacity overflow-hidden"
        >
          <MediaImage
            images={props.images}
            imageUrl={props.artworkUrl || null}
            blobId={props.blobId}
            alt={`${props.albumTitle} artwork`}
            class="w-full h-full object-cover"
            domainType="album"
            thumbnailSize={200}
          />
        </button>

        {/* album info - title gets full width, actions on second row */}
        <div class="flex-1 min-w-0 overflow-hidden">
          {/* row 1: title full width */}
          <button
            onClick={props.onAlbumClick}
            class="text-xl font-semibold text-[var(--color-text-primary)] hover:underline text-left block w-full min-w-0 overflow-hidden"
          >
            <MarqueeText text={props.albumTitle} hoverOnly={true} />
          </button>
          {/* row 2: track info + actions */}
          <div class="flex items-start justify-between gap-2 mt-0.5">
            <div class="text-sm text-[var(--color-text-secondary)] flex-shrink-0">
              {props.songs.length} tracks · {formatHumanDuration(props.totalDuration)}
              {props.year && ` · ${props.year}`}
            </div>
            {/* album actions - can wrap to multiple lines */}
            <div class="flex flex-wrap gap-1 justify-end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  props.onPlayAlbum?.();
                }}
                class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
                title="play album"
              >
                <PlayIcon size={20} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  props.onAddToQueue?.();
                }}
                class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
                title="add to queue"
              >
                <AddStrokeIcon size={20} />
              </button>
              <FavoriteHeart
                isFavorite={props.isFavorite ?? false}
                onToggle={props.onFavoriteToggle}
                size="md"
              />
              <Rating rating={props.rating ?? 0} size="md" onRatingChange={props.onRatingChange} />
            </div>
          </div>
          {/* row 3: genres and tags with marquee */}
          {badgeText() && (
            <div class="text-xs text-[var(--color-text-tertiary)] mt-1 overflow-hidden">
              <MarqueeText text={badgeText()} hoverOnly={true} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AlbumSection(props: AlbumSectionProps): JSX.Element {
  const totalDuration = () =>
    props.totalDuration ?? props.songs.reduce((sum, song) => sum + song.duration_seconds, 0);

  const handleAlbumClick = () => {
    props.onAlbumClick?.(props.albumId);
  };

  return (
    <div class={`space-y-2 ${props.class || ""}`}>
      {/* album header - sticky wrapper outside context menu */}
      <div class="sticky top-0 z-10">
        {props.getAlbumContextMenuActions ? (
          <ContextMenu actions={props.getAlbumContextMenuActions()}>
            <AlbumHeader
              albumId={props.albumId}
              albumTitle={props.albumTitle}
              year={props.year}
              songs={props.songs}
              totalDuration={totalDuration()}
              images={props.images}
              artworkUrl={props.artworkUrl}
              blobId={props.blobId}
              isFavorite={props.isFavorite}
              rating={props.rating}
              genre={props.genre}
              genres={props.genres}
              tags={props.tags}
              onAlbumClick={handleAlbumClick}
              onPlayAlbum={props.onPlayAlbum}
              onAddToQueue={props.onAddToQueue}
              onRatingChange={props.onRatingChange}
              onFavoriteToggle={props.onFavoriteToggle}
            />
          </ContextMenu>
        ) : (
          <AlbumHeader
            albumId={props.albumId}
            albumTitle={props.albumTitle}
            year={props.year}
            songs={props.songs}
            totalDuration={totalDuration()}
            images={props.images}
            artworkUrl={props.artworkUrl}
            blobId={props.blobId}
            isFavorite={props.isFavorite}
            rating={props.rating}
            genre={props.genre}
            genres={props.genres}
            tags={props.tags}
            onAlbumClick={handleAlbumClick}
            onPlayAlbum={props.onPlayAlbum}
            onAddToQueue={props.onAddToQueue}
            onRatingChange={props.onRatingChange}
            onFavoriteToggle={props.onFavoriteToggle}
          />
        )}
      </div>

      {/* album songs */}
      <div class="space-y-1 pl-4">
        <For each={props.songs}>
          {(song) => {
            const trackDisplay =
              song.disc_number > 1 ? `${song.disc_number}-${song.track_number}` : song.track_number;

            // show track_artist for compilation albums
            const trackArtist =
              song.album_type === "compilation" && song.track_artist?.trim()
                ? song.track_artist.trim()
                : undefined;

            return (
              <SongRow
                title={song.title}
                trackNumber={trackDisplay}
                duration={formatDuration(song.duration_seconds)}
                isPlaying={props.playingSongId === song.id}
                onDoubleClick={() => props.onSongDoubleClick?.(song)}
                showPlayOnHover={true}
                contextMenuActions={
                  props.getSongContextMenuActions
                    ? props.getSongContextMenuActions(song)
                    : undefined
                }
                isFavorite={song.is_favorite}
                rating={song.user_rating ?? 0}
                onRatingChange={(rating) => props.onSongRatingChange?.(song.id, rating)}
                onFavoriteToggle={(isFavorite) => props.onSongFavoriteToggle?.(song.id, isFavorite)}
                songId={song.id}
                sha256={song.sha256}
                artist={trackArtist}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
