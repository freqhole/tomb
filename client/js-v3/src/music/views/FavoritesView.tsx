// favorites view - controller component that wraps FavoritesLayout with business logic
import { FavoritesLayout, type FavoriteItem } from "../../components/layout/FavoritesLayout";
import type { Song, AlbumSummary, ArtistSummary, PlaylistSummary } from "../data/types";

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
  onSongClick?: (song: Song) => void;
  /** callback when play button is clicked on collection */
  onCollectionPlay?: (id: string, type: "album" | "artist" | "playlist") => void;
  /** callback when song is double-clicked */
  onSongDoubleClick?: (song: Song) => void;
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
  onSongContextMenu?: (e: MouseEvent, song: Song) => void;
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
      onAlbumClick={(album: AlbumSummary) => props.onCollectionClick?.(album.album_id, "album")}
      onAlbumPlay={(album: AlbumSummary) => props.onCollectionPlay?.(album.album_id, "album")}
      onAlbumFavoriteToggle={(albumId, isFavorite) => props.onCollectionFavoriteToggle?.(albumId, "album", isFavorite)}
      onAlbumContextMenu={(e, album) => props.onCollectionContextMenu?.(e, album.album_id, "album")}
      onArtistClick={(artist: ArtistSummary) => props.onCollectionClick?.(artist.artist_id, "artist")}
      onArtistPlay={(artist: ArtistSummary) => props.onCollectionPlay?.(artist.artist_id, "artist")}
      onArtistFavoriteToggle={(artistId, isFavorite) => props.onCollectionFavoriteToggle?.(artistId, "artist", isFavorite)}
      onArtistContextMenu={(e, artist) => props.onCollectionContextMenu?.(e, artist.artist_id, "artist")}
      onPlaylistClick={(playlist: PlaylistSummary) => props.onCollectionClick?.(playlist.playlist_id, "playlist")}
      onPlaylistPlay={(playlist: PlaylistSummary) => props.onCollectionPlay?.(playlist.playlist_id, "playlist")}
      onPlaylistFavoriteToggle={(playlistId, isFavorite) => props.onCollectionFavoriteToggle?.(playlistId, "playlist", isFavorite)}
      onPlaylistContextMenu={(e, playlist) => props.onCollectionContextMenu?.(e, playlist.playlist_id, "playlist")}
      onArtistNavigate={props.onArtistClick}
      onAlbumNavigate={props.onAlbumClick}
      onGenreClick={props.onGenreClick}
    />
  );
}
