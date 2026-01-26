// favorites view - controller component that wraps FavoritesLayout with business logic
import { FavoritesLayout, type FavoriteItem } from "../../components/layout/FavoritesLayout";
import type { SongCardData } from "../../components/cards/SongCard";
import type { AlbumCardData } from "../../components/cards/AlbumCard";
import type { ArtistCardData } from "../../components/cards/ArtistCard";
import type { PlaylistCardData } from "../../components/cards/PlaylistCard";

// re-export types for external use
export type { FavoriteItem };

export interface FavoritesViewProps {
  /** all favorites to display - should be passed from an infinite scroll query */
  favorites: FavoriteItem[];
  /** whether data is loading */
  isLoading?: boolean;
  /** callback when a collection (album/artist/playlist) is clicked */
  onCollectionClick?: (id: string, type: "album" | "artist" | "playlist") => void;
  /** callback when a song is clicked */
  onSongClick?: (song: SongCardData) => void;
  /** callback when play button is clicked on collection */
  onCollectionPlay?: (id: string, type: "album" | "artist" | "playlist") => void;
  /** callback when song is double-clicked */
  onSongDoubleClick?: (song: SongCardData) => void;
  /** callback when favorite is toggled on collection - item will be removed from list when parent updates favorites array */
  onCollectionFavoriteToggle?: (
    id: string,
    type: "album" | "artist" | "playlist",
    isFavorite: boolean,
  ) => void;
  /** callback when favorite is toggled on song - item will be removed from list when parent updates favorites array */
  onSongFavoriteToggle?: (songId: string, isFavorite: boolean) => void;
  /** callback when context menu is triggered on collection */
  onCollectionContextMenu?: (e: MouseEvent, id: string, type: "album" | "artist" | "playlist") => void;
  /** callback when context menu is triggered on song */
  onSongContextMenu?: (e: MouseEvent, song: SongCardData) => void;
  /** callback when artist name is clicked */
  onArtistClick?: (artistId: string) => void;
  /** callback when album name is clicked */
  onAlbumClick?: (albumId: string) => void;
  /** callback when genre is clicked */
  onGenreClick?: (genre: string) => void;
}

export function FavoritesView(props: FavoritesViewProps) {
  return (
    <FavoritesLayout
      favorites={props.favorites}
      isLoading={props.isLoading}
      onSongClick={props.onSongClick}
      onSongPlay={props.onSongDoubleClick}
      onSongFavoriteToggle={props.onSongFavoriteToggle}
      onSongContextMenu={props.onSongContextMenu}
      onAlbumClick={(album: AlbumCardData) => props.onCollectionClick?.(album.id, "album")}
      onAlbumPlay={(album: AlbumCardData) => props.onCollectionPlay?.(album.id, "album")}
      onAlbumFavoriteToggle={(albumId, isFavorite) => props.onCollectionFavoriteToggle?.(albumId, "album", isFavorite)}
      onAlbumContextMenu={(e, album) => props.onCollectionContextMenu?.(e, album.id, "album")}
      onArtistClick={(artist: ArtistCardData) => props.onCollectionClick?.(artist.id, "artist")}
      onArtistPlay={(artist: ArtistCardData) => props.onCollectionPlay?.(artist.id, "artist")}
      onArtistFavoriteToggle={(artistId, isFavorite) => props.onCollectionFavoriteToggle?.(artistId, "artist", isFavorite)}
      onArtistContextMenu={(e, artist) => props.onCollectionContextMenu?.(e, artist.id, "artist")}
      onPlaylistClick={(playlist: PlaylistCardData) => props.onCollectionClick?.(playlist.id, "playlist")}
      onPlaylistPlay={(playlist: PlaylistCardData) => props.onCollectionPlay?.(playlist.id, "playlist")}
      onPlaylistFavoriteToggle={(playlistId, isFavorite) => props.onCollectionFavoriteToggle?.(playlistId, "playlist", isFavorite)}
      onPlaylistContextMenu={(e, playlist) => props.onCollectionContextMenu?.(e, playlist.id, "playlist")}
      onArtistNavigate={props.onArtistClick}
      onAlbumNavigate={props.onAlbumClick}
      onGenreClick={props.onGenreClick}
    />
  );
}
