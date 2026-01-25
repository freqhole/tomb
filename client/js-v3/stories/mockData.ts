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

// helper to format duration from seconds to MM:SS or H:MM:SS
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// helper to generate bulk songs using shared artist/album/genre names
export function generateBulkSongs(count: number): Array<{
  id: string;
  sha256: string;
  title: string;
  artist_name: string;
  artist_id: string;
  album_title: string;
  album_id: string;
  album_primary_genre_name: string | null;
  album_primary_genre_id: string | null;
  duration_seconds: number;
  year: number | null;
  disc_number: number;
  track_number: number;
  thumbnail_blob_id: string | null;
  is_favorite: boolean;
  user_rating: number | null;
  album_rating: number | null;
  album_tags: string[];
  album_is_favorite: boolean;
  album_images: any[];
  album_sub_genres: string[];
}> {
  const artistNames = mockArtists.map((a) => a.name);
  const albumNames = mockAlbums.map((a) => a.title);
  const genreNames = mockGenres.map((g) => g.name);

  const songsPerAlbum = 12;
  const results = [];

  for (let i = 0; i < count; i++) {
    const albumIndex = Math.floor(i / songsPerAlbum);
    const trackInAlbum = i % songsPerAlbum;

    // some albums have 2 discs
    const hasMultipleDiscs = albumIndex % 3 === 0;
    const tracksPerDisc = hasMultipleDiscs ? 6 : songsPerAlbum;
    const discNumber = hasMultipleDiscs
      ? Math.floor(trackInAlbum / tracksPerDisc) + 1
      : 1;
    const trackNumber = hasMultipleDiscs
      ? (trackInAlbum % tracksPerDisc) + 1
      : trackInAlbum + 1;

    const durationSeconds =
      Math.floor(Math.random() * 5) * 60 + Math.floor(Math.random() * 60) + 120;

    results.push({
      id: `song-${i}`,
      sha256: `sha256-${i}`,
      title: `${albumNames[albumIndex % albumNames.length]} - Track ${trackNumber}`,
      artist_name: artistNames[albumIndex % artistNames.length],
      artist_id: `artist-${albumIndex % artistNames.length}`,
      album_title: albumNames[albumIndex % albumNames.length],
      album_id: `album-${albumIndex}`,
      album_primary_genre_name: genreNames[Math.floor(Math.random() * genreNames.length)],
      album_primary_genre_id: `genre-${Math.floor(Math.random() * genreNames.length)}`,
      duration_seconds: durationSeconds,
      year: 1970 + Math.floor(Math.random() * 50),
      disc_number: discNumber,
      track_number: trackNumber,
      thumbnail_blob_id: null,
      is_favorite: Math.random() > 0.7,
      user_rating: Math.random() > 0.5 ? Math.floor(Math.random() * 5) + 1 : null,
      album_rating: Math.random() > 0.6 ? Math.floor(Math.random() * 5) + 1 : null,
      album_tags:
        Math.random() > 0.3
          ? [
              genreNames[Math.floor(Math.random() * genreNames.length)],
              genreNames[Math.floor(Math.random() * genreNames.length)],
            ].filter((v, i, a) => a.indexOf(v) === i)
          : [],
      album_is_favorite: Math.random() > 0.8,
      album_images: [],
      album_sub_genres: [],
    });
  }

  return results;
}

// helper to generate bulk albums using shared artist/genre names
export function generateBulkAlbums(count: number): Array<{
  id: string;
  title: string;
  domainType: "album";
  imageUrl: string | null;
  artist: string;
  album: string;
  year: number;
  trackCount: number;
  totalDuration: string;
  genres: string;
  playCount: number;
}> {
  const artistNames = mockArtists.map((a) => a.name);
  const albumNames = mockAlbums.map((a) => a.title);
  const genresList = mockGenres.map((g) => g.name);

  return Array.from({ length: count }, (_, i) => {
    const totalSeconds =
      (Math.floor(Math.random() * 60) + 20) * 60 +
      Math.floor(Math.random() * 60);

    return {
      id: `album-${i}`,
      title: albumNames[i % albumNames.length],
      domainType: "album" as const,
      imageUrl:
        i % 3 === 0 ? null : `https://picsum.photos/seed/album${i}/300/300`,
      artist: artistNames[i % artistNames.length],
      album: albumNames[i % albumNames.length],
      year: 1970 + Math.floor(Math.random() * 50),
      trackCount: 8 + Math.floor(Math.random() * 15),
      totalDuration: formatDuration(totalSeconds),
      genres: [
        genresList[Math.floor(Math.random() * genresList.length)],
        genresList[Math.floor(Math.random() * genresList.length)],
      ]
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", "),
      playCount: Math.floor(Math.random() * 1000),
    };
  });
}

// helper to generate alphabet-sorted artists for AlphabetNav
export function generateAlphabetArtists(): Array<{
  name: string;
  songCount: number;
  albumCount: number;
}> {
  return mockArtists
    .map((artist) => ({
      name: artist.name,
      songCount: artist.songCount,
      albumCount: artist.albumCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
