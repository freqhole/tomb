// shared mock data for storybook stories
import mockDataJson from "./mockData.json";
import type { Song as DomainSong } from "../src/music/data/types";

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

// mock favorites with long strings for testing marquee and truncation
export const mockFavorites = [
  // song with very long title and artist
  {
    type: "song" as const,
    id: "song-long-1",
    title: "This is an extremely long song title that should definitely trigger the marquee effect when it overflows the container",
    artist: "An Artist With A Really Really Long Name That Goes On Forever",
    album: "The Most Incredibly Long Album Title You've Ever Seen In Your Entire Life",
    duration: "5:23",
    thumbnailUrl: mockSongs[0]?.thumbnailUrl,
    isFavorite: true,
    sha256: "sha256-long-1",
    createdAt: Date.now() - 1 * 86400000,
  },
  // album with long title
  {
    type: "album" as const,
    id: "album-long-1",
    title: "A Monumentally Long Album Title That Tests The Boundaries Of Text Truncation",
    subtitle: "Another Extremely Long Artist Name For Testing Purposes",
    imageUrl: mockAlbums[0]?.thumbnailUrl,
    isFavorite: true,
    trackCount: 24,
    year: 1973,
    genres: ["progressive rock", "art rock", "experimental", "psychedelic rock", "symphonic rock", "krautrock", "space rock", "jazz fusion"],
    tags: ["classic", "iconic", "groundbreaking", "innovative", "experimental", "virtuoso", "complex", "atmospheric", "conceptual"],
    createdAt: Date.now() - 2 * 86400000,
  },
  // artist with long name
  {
    type: "artist" as const,
    id: "artist-long-1",
    title: "The Incredibly Long Band Name That Just Keeps Going And Going And Going",
    imageUrl: undefined,
    isFavorite: true,
    albumCount: 42,
    genres: ["progressive metal", "symphonic metal", "technical death metal", "avant-garde metal", "djent", "mathcore", "post-metal"],
    tags: ["virtuoso", "epic", "technical", "atmospheric", "heavy", "melodic", "complex", "innovative", "experimental"],
    createdAt: Date.now() - 3 * 86400000,
  },
  // playlist with long description
  {
    type: "playlist" as const,
    id: "playlist-long-1",
    title: "My Super Long Playlist Name That Contains Way Too Many Words",
    imageUrl: undefined,
    isFavorite: true,
    trackCount: 156,
    description: "This is an extremely long description for a playlist that goes into great detail about the curation process and the emotional journey that listeners will experience when they play this carefully crafted collection of songs",
    updatedAt: Date.now() - 8 * 3600000,
    duration: 12847,
    createdAt: Date.now() - 4 * 86400000,
  },
  // regular length song
  {
    type: "song" as const,
    id: mockSongs[0].id,
    title: mockSongs[0].title,
    artist: mockSongs[0].artist,
    album: mockSongs[0].album,
    duration: `${Math.floor(mockSongs[0].durationSeconds / 60)}:${String(mockSongs[0].durationSeconds % 60).padStart(2, "0")}`,
    thumbnailUrl: mockSongs[0].thumbnailUrl,
    isFavorite: true,
    sha256: `sha256-${mockSongs[0].id}`,
    createdAt: Date.now() - 5 * 86400000,
  },
  // regular album
  {
    type: "album" as const,
    id: mockAlbums[0].id,
    title: mockAlbums[0].title,
    subtitle: mockAlbums[0].artist,
    imageUrl: mockAlbums[0].thumbnailUrl,
    isFavorite: true,
    trackCount: mockAlbums[0].trackCount,
    year: mockAlbums[0].year,
    genres: ["rock", "progressive rock", "classic rock", "album rock", "hard rock"],
    tags: ["classic", "iconic", "70s", "legendary", "influential", "timeless"],
    createdAt: Date.now() - 6 * 86400000,
  },
  // another long song
  {
    type: "song" as const,
    id: "song-long-2",
    title: "Another Song With An Absurdly Long Title That Will Definitely Need Scrolling",
    artist: "Yet Another Band With Way Too Many Words In Their Name",
    album: "Short Album",
    duration: "7:42",
    thumbnailUrl: mockSongs[1]?.thumbnailUrl,
    isFavorite: true,
    sha256: "sha256-long-2",
    createdAt: Date.now() - 7 * 86400000,
  },
  // regular artist
  {
    type: "artist" as const,
    id: mockArtists[0].id,
    title: mockArtists[0].name,
    imageUrl: undefined,
    isFavorite: true,
    albumCount: mockArtists[0].albumCount,
    genres: ["rock", "alternative", "alternative rock", "indie rock", "post-grunge", "britpop"],
    tags: ["90s", "iconic", "influential", "melodic", "anthemic", "legendary"],
    createdAt: Date.now() - 8 * 86400000,
  },
  // more regular items
  {
    type: "song" as const,
    id: mockSongs[1].id,
    title: mockSongs[1].title,
    artist: mockSongs[1].artist,
    album: mockSongs[1].album,
    duration: `${Math.floor(mockSongs[1].durationSeconds / 60)}:${String(mockSongs[1].durationSeconds % 60).padStart(2, "0")}`,
    thumbnailUrl: mockSongs[1].thumbnailUrl,
    isFavorite: true,
    sha256: `sha256-${mockSongs[1].id}`,
    createdAt: Date.now() - 9 * 86400000,
  },
  {
    type: "album" as const,
    id: mockAlbums[1].id,
    title: mockAlbums[1].title,
    subtitle: mockAlbums[1].artist,
    imageUrl: mockAlbums[1].thumbnailUrl,
    isFavorite: true,
    trackCount: mockAlbums[1].trackCount,
    year: mockAlbums[1].year,
    genres: ["rock", "progressive rock"],
    tags: ["classic", "iconic"],
    createdAt: Date.now() - 10 * 86400000,
  },
  {
    type: "playlist" as const,
    id: mockPlaylists[0].id,
    title: mockPlaylists[0].name,
    imageUrl: undefined,
    isFavorite: true,
    trackCount: mockPlaylists[0].songCount,
    description: `a curated collection of ${mockPlaylists[0].songCount} amazing tracks`,
    updatedAt: Date.now() - 16 * 3600000,
    duration: mockPlaylists[0].duration,
    createdAt: Date.now() - 11 * 86400000,
  },
  {
    type: "song" as const,
    id: mockSongs[2].id,
    title: mockSongs[2].title,
    artist: mockSongs[2].artist,
    album: mockSongs[2].album,
    duration: `${Math.floor(mockSongs[2].durationSeconds / 60)}:${String(mockSongs[2].durationSeconds % 60).padStart(2, "0")}`,
    thumbnailUrl: mockSongs[2].thumbnailUrl,
    isFavorite: true,
    sha256: `sha256-${mockSongs[2].id}`,
    createdAt: Date.now() - 12 * 86400000,
  },
  {
    type: "artist" as const,
    id: mockArtists[1].id,
    title: mockArtists[1].name,
    imageUrl: undefined,
    isFavorite: true,
    albumCount: mockArtists[1].albumCount,
    genres: ["rock", "alternative"],
    tags: ["90s", "grunge"],
    createdAt: Date.now() - 13 * 86400000,
  },
  {
    type: "album" as const,
    id: mockAlbums[2].id,
    title: mockAlbums[2].title,
    subtitle: mockAlbums[2].artist,
    imageUrl: mockAlbums[2].thumbnailUrl,
    isFavorite: true,
    trackCount: mockAlbums[2].trackCount,
    year: mockAlbums[2].year,
    genres: ["rock", "classic rock"],
    tags: ["70s", "legendary"],
    createdAt: Date.now() - 14 * 86400000,
  },
  // song without image
  {
    type: "song" as const,
    id: "song-no-image-1",
    title: "Track Without Cover Art",
    artist: "Unknown Artist",
    album: "Unknown Album",
    duration: "3:42",
    thumbnailUrl: undefined,
    isFavorite: true,
    sha256: "sha256-no-image-1",
    createdAt: Date.now() - 15 * 86400000,
  },
  // album without image
  {
    type: "album" as const,
    id: "album-no-image-1",
    title: "Rare Bootleg Recording",
    subtitle: "Underground Band",
    imageUrl: undefined,
    isFavorite: true,
    trackCount: 12,
    year: 1998,
    genres: ["punk", "hardcore"],
    tags: ["rare", "bootleg"],
    createdAt: Date.now() - 16 * 86400000,
  },
  // artist with image
  {
    type: "artist" as const,
    id: "artist-with-image-1",
    title: "Famous Band With Photo",
    imageUrl: mockAlbums[0]?.thumbnailUrl,
    isFavorite: true,
    albumCount: 15,
    genres: ["rock", "alternative"],
    tags: ["iconic", "legendary"],
    createdAt: Date.now() - 17 * 86400000,
  },
  // artist without image (already have this)
  {
    type: "artist" as const,
    id: "artist-no-image-1",
    title: "Mysterious Artist",
    imageUrl: undefined,
    isFavorite: true,
    albumCount: 8,
    genres: ["electronic", "ambient"],
    tags: ["mysterious", "atmospheric"],
    createdAt: Date.now() - 18 * 86400000,
  },
  // playlist without image
  {
    type: "playlist" as const,
    id: "playlist-no-image-1",
    title: "My Chill Mix",
    imageUrl: undefined,
    isFavorite: true,
    trackCount: 87,
    description: "relaxing tunes for late night coding sessions",
    updatedAt: Date.now() - 24 * 3600000,
    duration: 5420,
    createdAt: Date.now() - 19 * 86400000,
  },
];

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
export function generateBulkSongs(count: number): DomainSong[] {
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

    const now = Date.now();

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
      // additional required Song fields
      bpm: null,
      key_signature: null,
      lyrics: null,
      metadata: null,
      created_at: now,
      updated_at: now,
      album_added_at: now,
      source_type: "remote" as const,
      opfs_path: null,
      file_name: null,
      file_size: null,
      last_modified: null,
      mime_type: null,
      source_url: null,
      downloaded_at: null,
      remote_server_id: null,
      remote_sha256: null,
      added_at: now,
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
