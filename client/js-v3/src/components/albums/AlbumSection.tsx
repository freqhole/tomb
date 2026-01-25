// reusable album section component for displaying an album with its songs
import { For, type JSX } from "solid-js";
import { ContextMenu, type MenuAction } from "../overlays/ContextMenu";
import { FavoriteToggle } from "../ratings/FavoriteToggle";
import { Rating } from "../ratings/Rating";
import { SongRow } from "../songs/SongRow";
import { MarqueeText } from "../text/MarqueeText";

export interface AlbumSectionSong {
  id: string;
  sha256?: string;
  title: string;
  trackNumber: number;
  discNumber: number;
  duration: number;
  isFavorite?: boolean;
  rating?: number;
  album_rating?: number;
}

export interface AlbumSectionProps {
  /** album id */
  albumId: string;
  /** album title */
  albumTitle: string;
  /** album year */
  year?: number | null;
  /** array of songs in this album */
  songs: AlbumSectionSong[];
  /** total duration in seconds */
  totalDuration?: number;
  /** album artwork url */
  artworkUrl?: string | null;
  /** currently playing song id */
  playingSongId?: string;
  /** album favorite status */
  isFavorite?: boolean;
  /** album user rating */
  rating?: number;
  /** album primary genre */
  genre?: string | null;
  /** album sub-genres */
  subGenres?: string[];
  /** album tags */
  tags?: string[];
  /** rating change handler */
  onRatingChange?: (rating: number) => void;
  /** click handler for album (navigates to album detail) */
  onAlbumClick?: (albumId: string) => void;
  /** play album handler */
  onPlayAlbum?: () => void;
  /** add album to queue handler */
  onAddToQueue?: () => void;
  /** song double click handler (plays song) */
  onSongDoubleClick?: (song: AlbumSectionSong) => void;
  /** song rating change handler */
  onSongRatingChange?: (songId: string, rating: number) => void;
  /** callback to get context menu actions for album header */
  getAlbumContextMenuActions?: () => MenuAction[];
  /** callback to get context menu actions for a song */
  getSongContextMenuActions?: (song: AlbumSectionSong) => MenuAction[];
  /** additional css classes */
  class?: string;
}

// format seconds to MM:SS
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// format album duration to human readable
function formatAlbumDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function AlbumSection(props: AlbumSectionProps): JSX.Element {
  const totalDuration = () =>
    props.totalDuration ??
    props.songs.reduce((sum, song) => sum + song.duration, 0);

  const handleAlbumClick = () => {
    props.onAlbumClick?.(props.albumId);
  };

  const albumHeader = (
    <div class="flex items-center gap-4 p-4 bg-[var(--color-bg-elevated)] rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors">
      {/* album artwork */}
      <button
        onClick={handleAlbumClick}
        class="w-16 h-16 bg-[var(--color-bg-primary)] rounded flex items-center justify-center flex-shrink-0 hover:opacity-80 transition-opacity overflow-hidden"
      >
        {props.artworkUrl ? (
          <img
            src={props.artworkUrl}
            alt={`${props.albumTitle} artwork`}
            class="w-full h-full object-cover"
          />
        ) : (
          <span class="text-[var(--color-text-tertiary)] text-xs">no art</span>
        )}
      </button>

      {/* album info */}
      <div class="flex-1 min-w-0">
        <button
          onClick={handleAlbumClick}
          class="text-xl font-semibold text-[var(--color-text-primary)] hover:underline text-left block"
        >
          <MarqueeText text={props.albumTitle} hoverOnly={true} />
        </button>
        <div class="text-sm text-[var(--color-text-secondary)]">
          {props.songs.length} tracks · {formatAlbumDuration(totalDuration())}
          {props.year && ` · ${props.year}`}
        </div>
        {/* genres and tags */}
        <div class="text-xs text-[var(--color-text-tertiary)] mt-1 flex flex-wrap gap-1">
          {props.genre && (
            <span class="px-2 py-0.5 bg-[var(--color-bg-primary)] rounded">
              {props.genre}
            </span>
          )}
          {props.subGenres?.map((sg) => (
            <span class="px-2 py-0.5 bg-[var(--color-bg-primary)] rounded opacity-75">
              {sg}
            </span>
          ))}
          {props.tags?.map((tag) => (
            <span class="px-2 py-0.5 bg-[var(--color-bg-hover)] rounded">
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* album actions */}
      <div class="flex gap-2 flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onPlayAlbum?.();
          }}
          class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
          title="play album"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onAddToQueue?.();
          }}
          class="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded-full transition-colors"
          title="add to queue"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
        <FavoriteToggle
          targetType="album"
          targetId={props.albumId}
          isFavorite={props.isFavorite ?? false}
          size="md"
        />
        <Rating
          rating={props.rating ?? 0}
          size="md"
          onRatingChange={props.onRatingChange}
        />
      </div>
    </div>
  );

  return (
    <div class={`space-y-2 ${props.class || ""}`}>
      {/* album header */}
      {props.getAlbumContextMenuActions ? (
        <ContextMenu actions={props.getAlbumContextMenuActions()}>
          {albumHeader}
        </ContextMenu>
      ) : (
        albumHeader
      )}

      {/* album songs */}
      <div class="space-y-1 pl-4">
        <For each={props.songs}>
          {(song) => {
            const trackDisplay =
              song.discNumber > 1
                ? `${song.discNumber}-${song.trackNumber}`
                : song.trackNumber;

            return (
              <SongRow
                title={song.title}
                trackNumber={trackDisplay}
                duration={formatDuration(song.duration)}
                isPlaying={props.playingSongId === song.id}
                onDoubleClick={() => props.onSongDoubleClick?.(song)}
                showPlayOnHover={true}
                contextMenuActions={
                  props.getSongContextMenuActions
                    ? props.getSongContextMenuActions(song)
                    : undefined
                }
                isFavorite={song.isFavorite}
                rating={song.rating ?? 0}
                onRatingChange={(rating) => props.onSongRatingChange?.(song.id, rating)}
                songId={song.id}
                sha256={song.sha256}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
