// shared mock data for storybook stories
import mockDataJson from "./mockData.json";

// type definitions
export interface Artist {
  id: string;
  name: string;
  songCount: number;
  albumCount: number;
  totalDuration: number;
  avgRating: number;
  genres: string[];
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  year: number;
  trackCount: number;
  duration: number;
  rating: number;
  thumbnailUrl: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  rating: number;
  isFavorite: boolean;
  thumbnailUrl?: string;
}

export interface Genre {
  id: string;
  name: string;
  songCount: number;
  artistCount: number;
  albumCount: number;
  totalDuration: number;
}

export interface Playlist {
  id: string;
  name: string;
  songCount: number;
  duration: number;
  isPublic: boolean;
  createdAt: string;
}

export interface Tag {
  value: string;
  label: string;
  count: number;
}

export interface LibraryStats {
  totalSongs: number;
  totalArtists: number;
  totalAlbums: number;
  totalGenres: number;
  totalDuration: number;
  totalPlaylists: number;
}

// export typed mock data
export const mockArtists: Artist[] = mockDataJson.artists;
export const mockAlbums: Album[] = mockDataJson.albums;
export const mockSongs: Song[] = mockDataJson.songs;
export const mockGenres: Genre[] = mockDataJson.genres;
export const mockPlaylists: Playlist[] = mockDataJson.playlists;
export const mockPlaylistSongs: Record<string, string[]> =
  mockDataJson.playlistSongs;
export const mockLibraryStats: LibraryStats = mockDataJson.library;
export const mockTags: Tag[] = mockDataJson.tags;

// helper to get songs for a playlist
export function getPlaylistSongs(playlistId: string): Song[] {
  const songIds = mockPlaylistSongs[playlistId] || [];
  return songIds
    .map((id) => mockSongs.find((song) => song.id === id))
    .filter((song): song is Song => song !== undefined);
}

// helper to get songs by artist
export function getSongsByArtist(artistName: string): Song[] {
  return mockSongs.filter(
    (song) => song.artist.toLowerCase() === artistName.toLowerCase(),
  );
}

// helper to get albums by artist
export function getAlbumsByArtist(artistName: string): Album[] {
  return mockAlbums.filter(
    (album) => album.artist.toLowerCase() === artistName.toLowerCase(),
  );
}

// helper to get songs by album
export function getSongsByAlbum(albumTitle: string): Song[] {
  return mockSongs.filter(
    (song) => song.album.toLowerCase() === albumTitle.toLowerCase(),
  );
}

// helper to get artist by name
export function getArtistByName(name: string): Artist | undefined {
  return mockArtists.find(
    (artist) => artist.name.toLowerCase() === name.toLowerCase(),
  );
}

// helper to get genre by name
export function getGenreByName(name: string): Genre | undefined {
  return mockGenres.find(
    (genre) => genre.name.toLowerCase() === name.toLowerCase(),
  );
}
