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

// import favorites from json and add required fields with defaults
import type { FavoriteItem } from "../src/components/layout/FavoritesLayout";
const rawFavorites = mockDataJson.favorites as any[];

// normalize image entries from the json fixture: many were authored with a
// `blob_id` field holding an external picsum URL, but the real ImageMetadata
// shape uses `remote_url`/`local_blob_id`/`remote_blob_id`. fall back to a
// generated placeholder when the entity has no images so cards render art.
function normalizeFavoriteImages(item: any, fallbackSeed: string) {
  const raw = (item.images ?? []) as any[];
  const images = raw
    .map((img) => {
      if (!img) return null;
      // legacy: blob_id field smuggling a URL — promote to remote_url
      if (typeof img.blob_id === "string" && /^https?:\/\//.test(img.blob_id)) {
        return {
          remote_url: img.blob_id,
          is_primary: img.is_primary ?? true,
          blob_type: img.blob_type ?? "thumbnail",
        };
      }
      return img;
    })
    .filter(Boolean);
  if (images.length === 0) {
    images.push({
      remote_url: placeholderImage(fallbackSeed),
      is_primary: true,
      blob_type: "thumbnail",
    });
  }
  return images;
}

export const mockFavorites: FavoriteItem[] = rawFavorites.map((item) => {
  if (item.type === "song") {
    return {
      ...item,
      created_at: item.created_at ?? Date.now(),
      updated_at: item.updated_at ?? Date.now(),
      album_added_at: item.album_added_at ?? Date.now(),
      album_primary_genre_id: item.album_primary_genre_id ?? null,
      images: normalizeFavoriteImages(item, `fav-song-${item.id}`),
    };
  }
  if (item.type === "album") {
    return {
      ...item,
      created_at: item.created_at ?? Date.now(),
      updated_at: item.updated_at ?? Date.now(),
      images: normalizeFavoriteImages(item, `fav-album-${item.album_id}`),
    };
  }
  if (item.type === "artist") {
    return {
      ...item,
      created_at: item.created_at ?? Date.now(),
      updated_at: item.updated_at ?? Date.now(),
      images: normalizeFavoriteImages(item, `fav-artist-${item.artist_id}`),
    };
  }
  if (item.type === "playlist") {
    return {
      ...item,
      created_at: item.created_at ?? Date.now(),
      updated_at: item.updated_at ?? Date.now(),
      images: normalizeFavoriteImages(item, `fav-playlist-${item.playlist_id}`),
    };
  }
  return item;
}) as FavoriteItem[];

// generate a deterministic placeholder image URL.
// uses picsum.photos which MediaImage knows to skip the `/thumb/:size` suffix for.
export function placeholderImage(seed: string | number, _label?: string): string {
  const seedStr = encodeURIComponent(String(seed));
  return `https://picsum.photos/seed/${seedStr}/300/300`;
}

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

    // give ~70% of songs a placeholder image (svg data uri so it's resilient)
    const hasImage = i % 10 !== 7 && i % 10 !== 3 && i % 10 !== 9;
    const albumLabel = albumNames[albumIndex % albumNames.length];
    const images = hasImage
      ? [
          {
            remote_url: placeholderImage(`album-${albumIndex}`, albumLabel),
            is_primary: true,
            blob_type: "thumbnail" as const,
          },
        ]
      : [];

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
      images: images,
      is_favorite: Math.random() > 0.7,
      user_rating: Math.random() > 0.5 ? Math.floor(Math.random() * 5) + 1 : undefined,
      album_rating: Math.random() > 0.6 ? Math.floor(Math.random() * 5) + 1 : undefined,
      album_tags:
        Math.random() > 0.3
          ? [
              genreNames[Math.floor(Math.random() * genreNames.length)],
              genreNames[Math.floor(Math.random() * genreNames.length)],
            ].filter((v, i, a) => a.indexOf(v) === i)
          : [],
      album_is_favorite: Math.random() > 0.8,
      album_images: images,
      album_sub_genres: [],
      // additional required Song fields
      bpm: null,
      track_artist: null,
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
      remote_song_id: null,
      blake3: null,
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
        i % 3 === 0
          ? null
          : placeholderImage(`album-${i}`, albumNames[i % albumNames.length]),
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

// =====================================================================
// feed mock data
// =====================================================================

import type { FeedItem, FeedItemType } from "../src/music/data/types";
import type { QueueHistoryEntry } from "../src/app/services/storage/types";
import type { Song as DomainSongFull } from "../src/music/data/types";

// deterministic pseudo-random
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const feedUserNames = [
  "nancy",
  "sluggo",
  "fritzi",
  "rollo",
  "butch",
  "irma",
  "oona goosepimple",
  "phil fumble",
];

const feedTypes: FeedItemType[] = [
  "recent_listen",
  "recent_favorite",
  "recent_album",
  "recent_rating",
  "recent_playlist",
  "listen_session",
];

/**
 * generate a deterministic page of FeedItems for stories. mirrors the structure
 * used in VirtualFeedList.stories.tsx but pulls names/titles from the shared
 * mock pools so feed entries align with songs/albums/artists elsewhere.
 */
export function generateFeedItems(
  page: number,
  pageSize = 30,
  remote?: { id: string; name: string }
): FeedItem[] {
  const items: FeedItem[] = [];
  const baseTs = Date.now() - page * pageSize * 120000;

  const remoteSalt = remote
    ? remote.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 1000
    : 0;

  const songTitles = mockSongs.length > 0 ? mockSongs.map((s) => s.title) : ["untitled"];
  const albumNames = mockAlbums.map((a) => a.title);
  const artistNames = mockArtists.map((a) => a.name);
  const genres = mockGenres.map((g) => g.name);

  for (let i = 0; i < pageSize; i++) {
    const globalIdx = page * pageSize + i;
    const base = globalIdx + remoteSalt;
    const r1 = seededRand(base * 7);
    const r2 = seededRand(base * 13);
    const r3 = seededRand(base * 19);
    const r4 = seededRand(base * 23);
    const r5 = seededRand(base * 31);
    const r6 = seededRand(base * 37);

    const feedType = feedTypes[Math.floor(r1 * feedTypes.length)];
    const user = feedUserNames[Math.floor(r2 * feedUserNames.length)];
    const song = songTitles[Math.floor(r3 * songTitles.length)];
    const album = albumNames[Math.floor(r4 * albumNames.length)];
    const artist = artistNames[Math.floor(r5 * artistNames.length)];
    const genre = genres[Math.floor(r6 * genres.length)];
    const ts = baseTs - i * 120000;
    const isSession = feedType === "listen_session";
    const isAlbum = feedType === "recent_album";
    const isPlaylist = feedType === "recent_playlist";
    const hasRating = feedType === "recent_rating";

    const imageSeed = isPlaylist
      ? `playlist-${Math.floor(r3 * 20)}`
      : isAlbum
        ? `album-${Math.floor(r4 * 100)}`
        : `feed-${globalIdx}`;

    items.push({
      id: remote ? `${remote.id}-feed-${globalIdx}` : `feed-${globalIdx}`,
      feed_type: feedType,
      song_id: !isSession && !isAlbum && !isPlaylist ? `song-${Math.floor(r3 * 200)}` : null,
      album_id: !isPlaylist ? `album-${Math.floor(r4 * 100)}` : null,
      artist_id: `artist-${Math.floor(r5 * 50)}`,
      playlist_id: isPlaylist ? `playlist-${Math.floor(r3 * 20)}` : null,
      title: isSession
        ? `${artist} session`
        : isAlbum
          ? album
          : isPlaylist
            ? `${user}'s ${genre} mix`
            : song,
      subtitle: null,
      images: [
        {
          remote_url: placeholderImage(imageSeed),
          is_primary: true,
          blob_type: "thumbnail" as const,
        },
      ],
      created_at: ts,
      user_id: `user-${Math.floor(r2 * feedUserNames.length)}`,
      username: user,
      play_count: feedType === "recent_listen" ? Math.floor(r6 * 50) + 1 : null,
      rating: hasRating ? Math.floor(r6 * 5) + 1 : null,
      target_type: null,
      session_id: isSession ? `session-${globalIdx}` : null,
      session_type: isSession ? "album" : null,
      session_status: isSession ? (r6 > 0.5 ? "completed" : "active") : null,
      progress_percent: isSession ? Math.floor(r6 * 100) : null,
      songs_completed: isSession ? Math.floor(r6 * 12) : null,
      total_songs: isSession ? 12 : null,
      artist_name: artist,
      album_title: isPlaylist ? null : album,
      genre,
      genre_id: `genre-${genre}`,
      year: 1970 + Math.floor(r3 * 50),
      song_count: isAlbum ? Math.floor(r4 * 12) + 3 : null,
      songs_added: null,
      total_duration_ms: isSession || isAlbum ? Math.floor(r5 * 3600000) + 600000 : null,
      image_count: null,
      urls: null,
      description: isPlaylist ? "a curated selection of deep cuts" : null,
      tags: r6 > 0.7 ? [genre, "vinyl", "remastered"].slice(0, Math.floor(r4 * 3) + 1) : null,
      is_favorite: r3 > 0.7,
      is_initial_add: isAlbum ? r5 > 0.5 : true,
      collage_images: null,
      entity_created_at: null,
      remote_id: remote?.id ?? null,
      remote_name: remote?.name ?? null,
    });
  }

  return items;
}

// mock remotes used for the "all feed" (aggregate) view
export const mockRemotes = [
  { id: "remote-local", name: "local library" },
  { id: "remote-bandcamp-mirror", name: "bandcamp mirror" },
  { id: "remote-friends-house", name: "friends-house" },
  { id: "remote-vinyl-rips", name: "vinyl rips" },
  { id: "remote-carps-basement", name: "carp's basement" },
];

// curated music attributed to the "carp's basement" remote. these are
// distinctive (jazz / dub / library music) so they stand out against the
// local library when browsing the federated feed.
export interface MockRemoteSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: number;
  duration_seconds: number;
  genre: string;
  remote_id: string;
  remote_name: string;
  thumbnailUrl: string;
}
export const mockRemoteSongs: MockRemoteSong[] = [
  {
    id: "remote-song-1",
    title: "sketch for summer",
    artist: "the durutti column",
    album: "the return of the durutti column",
    year: 1980,
    duration_seconds: 224,
    genre: "post-punk",
    remote_id: "remote-carps-basement",
    remote_name: "carp's basement",
    thumbnailUrl: placeholderImage("remote-song-1"),
  },
  {
    id: "remote-song-2",
    title: "king tubby meets the rockers uptown",
    artist: "augustus pablo",
    album: "king tubbys meets rockers uptown",
    year: 1976,
    duration_seconds: 195,
    genre: "dub",
    remote_id: "remote-carps-basement",
    remote_name: "carp's basement",
    thumbnailUrl: placeholderImage("remote-song-2"),
  },
  {
    id: "remote-song-3",
    title: "laventille",
    artist: "david axelrod",
    album: "songs of innocence",
    year: 1968,
    duration_seconds: 265,
    genre: "jazz-funk",
    remote_id: "remote-carps-basement",
    remote_name: "carp's basement",
    thumbnailUrl: placeholderImage("remote-song-3"),
  },
  {
    id: "remote-song-4",
    title: "theme de yoyo",
    artist: "art ensemble of chicago",
    album: "les stances a sophie",
    year: 1970,
    duration_seconds: 312,
    genre: "free jazz",
    remote_id: "remote-carps-basement",
    remote_name: "carp's basement",
    thumbnailUrl: placeholderImage("remote-song-4"),
  },
  {
    id: "remote-song-5",
    title: "bibo no aozora",
    artist: "ryuichi sakamoto",
    album: "1996",
    year: 1996,
    duration_seconds: 348,
    genre: "ambient",
    remote_id: "remote-carps-basement",
    remote_name: "carp's basement",
    thumbnailUrl: placeholderImage("remote-song-5"),
  },
];

// =====================================================================
// radio mock data
// =====================================================================

export interface MockRadioStation {
  id: string;
  name: string;
  description: string;
  codec: string;
  play_mode: string;
  is_public: boolean;
  is_enabled: boolean;
  listenerCount: number;
  thumbnailUrl: string;
  currentSong?: {
    title: string;
    artist: string;
    album: string;
    startedAt: number;
  };
}

export const mockRadioStations: MockRadioStation[] = [
  {
    id: "radio-deep-cuts",
    name: "deep cuts",
    description: "obscure b-sides and rarities, hand-picked",
    codec: "opus",
    play_mode: "shuffle",
    is_public: true,
    is_enabled: true,
    listenerCount: 12,
    thumbnailUrl: placeholderImage("radio-deep-cuts"),
    currentSong: {
      title: "midnight blue",
      artist: "kenny burrell",
      album: "midnight blue",
      startedAt: Date.now() - 145_000,
    },
  },
  {
    id: "radio-late-night-jazz",
    name: "late night jazz",
    description: "smooth tunes for after-hours wandering",
    codec: "opus",
    play_mode: "weighted_shuffle",
    is_public: true,
    is_enabled: true,
    listenerCount: 47,
    thumbnailUrl: placeholderImage("radio-late-night-jazz"),
    currentSong: {
      title: "round midnight",
      artist: "thelonious monk",
      album: "genius of modern music",
      startedAt: Date.now() - 32_000,
    },
  },
  {
    id: "radio-warehouse",
    name: "warehouse",
    description: "industrial, ebm, and adjacent noise",
    codec: "opus",
    play_mode: "sequential",
    is_public: false,
    is_enabled: true,
    listenerCount: 3,
    thumbnailUrl: placeholderImage("radio-warehouse"),
    currentSong: {
      title: "headhunter",
      artist: "front 242",
      album: "front by front",
      startedAt: Date.now() - 78_000,
    },
  },
  {
    id: "radio-sunday-morning",
    name: "sunday morning",
    description: "soft folk and ambient washes",
    codec: "opus",
    play_mode: "shuffle",
    is_public: true,
    is_enabled: false,
    listenerCount: 0,
    thumbnailUrl: placeholderImage("radio-sunday-morning"),
  },
  {
    id: "radio-carps-basement",
    name: "carp's basement (remote)",
    description: "streaming live from carp's basement — dub, jazz, library oddities",
    codec: "opus",
    play_mode: "weighted_shuffle",
    is_public: true,
    is_enabled: true,
    listenerCount: 8,
    thumbnailUrl: placeholderImage("radio-carps-basement"),
    currentSong: {
      title: "king tubby meets the rockers uptown",
      artist: "augustus pablo",
      album: "king tubbys meets rockers uptown",
      startedAt: Date.now() - 64_000,
    },
  },
];

export interface MockRadioListen {
  id: string;
  stationId: string;
  stationName: string;
  songTitle: string;
  artistName: string;
  albumTitle: string;
  playedAt: number;
  durationSeconds: number;
}

export function generateRadioListenHistory(count = 20): MockRadioListen[] {
  const out: MockRadioListen[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const r1 = seededRand(i * 11 + 1);
    const r2 = seededRand(i * 17 + 3);
    const station = mockRadioStations[Math.floor(r1 * mockRadioStations.length)];
    const song = mockSongs[Math.floor(r2 * Math.max(mockSongs.length, 1))];
    out.push({
      id: `radio-listen-${i}`,
      stationId: station.id,
      stationName: station.name,
      songTitle: song?.title ?? "untitled",
      artistName: song?.artist ?? "unknown",
      albumTitle: song?.album ?? "unknown",
      playedAt: now - i * 3 * 60_000 - Math.floor(r2 * 60_000),
      durationSeconds: 120 + Math.floor(r1 * 240),
    });
  }
  return out;
}

// =====================================================================
// queue history mock data
// =====================================================================

/**
 * generate a deterministic list of queue history entries for stories.
 * covers the mix of source types (album/artist/playlist/genre/shuffle/radio)
 * with realistic listen-progress values.
 */
export function generateQueueHistory(
  count = 10,
  songSource?: DomainSongFull[]
): QueueHistoryEntry[] {
  const out: QueueHistoryEntry[] = [];
  const now = Date.now();
  const types: QueueHistoryEntry["type"][] = [
    "album",
    "artist",
    "playlist",
    "genre",
    "shuffle",
    "radio_station",
    "song",
  ];

  for (let i = 0; i < count; i++) {
    const r1 = seededRand(i * 13 + 5);
    const r2 = seededRand(i * 19 + 7);
    const r3 = seededRand(i * 23 + 11);
    const type = types[i % types.length];
    const songCount = type === "song" ? 1 : 4 + Math.floor(r1 * 12);
    const songs = (songSource ?? []).slice(0, songCount);
    const totalSeconds = songs.length > 0
      ? songs.reduce((s, song) => s + (song.duration_seconds ?? 180), 0)
      : songCount * 200;
    const progress = r2;
    const songsCompleted = Math.floor(progress * songCount);
    const currentIndex = Math.min(songCount - 1, songsCompleted);
    const listened = Math.floor(progress * totalSeconds);

    let label = "";
    let radioRef: QueueHistoryEntry["radio_station_ref"];
    switch (type) {
      case "album": {
        const album = mockAlbums[i % mockAlbums.length];
        label = `${album.artist} - ${album.title}`;
        break;
      }
      case "artist": {
        label = mockArtists[i % mockArtists.length].name;
        break;
      }
      case "playlist": {
        label = mockPlaylists[i % mockPlaylists.length].name;
        break;
      }
      case "genre": {
        label = mockGenres[i % mockGenres.length].name;
        break;
      }
      case "shuffle": {
        label = "shuffle all";
        break;
      }
      case "radio_station": {
        const station = mockRadioStations[i % mockRadioStations.length];
        label = station.name;
        radioRef = {
          peer_addr: "local",
          station_id: station.id,
          station_name: station.name,
          is_local: true,
        };
        break;
      }
      case "song": {
        const song = songs[0] ?? mockSongs[i % mockSongs.length];
        label = `${(song as any).artist ?? (song as any).artist_name ?? "unknown"} - ${song?.title ?? "untitled"}`;
        break;
      }
    }

    out.push({
      id: `qh-${i}`,
      type,
      label,
      entity_id: undefined,
      remote_name: r3 > 0.7 ? "bandcamp mirror" : undefined,
      song_count: songCount,
      songs,
      queued_at: now - i * 27 * 60_000,
      image: {
        remote_url: placeholderImage(`qh-${type}-${i}`),
        is_primary: true,
        blob_type: "thumbnail" as const,
      },
      listened_seconds: listened,
      total_seconds: totalSeconds,
      songs_completed: songsCompleted,
      current_song_index: currentIndex,
      current_song_position: Math.floor((listened % 200)),
      radio_station_ref: radioRef,
    });
  }

  return out;
}

// ===== demo library mode (scroll-coach demo) =================================
// signal-backed toggle for the scroll-coach demo's first beat: start "empty",
// flip to "populated" once the fake scan completes. consumers (SuperStory's
// derived song/album/etc. signals, eventually) read demoLibraryMode() and pick
// either the empty fixtures or the rich populated mocks.
//
// stub: SuperStory does NOT yet read this signal — wiring is the next step.

import { createSignal as _createSignal } from "solid-js";

export type DemoLibraryMode = "empty" | "populated";
export const [demoLibraryMode, setDemoLibraryMode] =
  _createSignal<DemoLibraryMode>("populated");

// 0..1 progress for the fake-scan animation. consumers can render a bar
// off this signal during the add-music step.
export const [fakeScanProgress, setFakeScanProgress] = _createSignal(0);
export const [fakeScanRunning, setFakeScanRunning] = _createSignal(false);

/** simple async fake-scan: progresses 0->1 over `durationMs`, then flips to populated. */
export function runFakeLibraryScan(opts: {
  durationMs?: number;
  onProgress?: (pct: number) => void;
  /** if false, leave libraryMode at "empty" after scan completes (caller flips later) */
  flipToPopulated?: boolean;
} = {}): Promise<void> {
  const duration = opts.durationMs ?? 2000;
  const flip = opts.flipToPopulated ?? true;
  setDemoLibraryMode("empty");
  setFakeScanProgress(0);
  setFakeScanRunning(true);
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = (now: number) => {
      const pct = Math.min(1, (now - start) / duration);
      setFakeScanProgress(pct);
      opts.onProgress?.(pct);
      if (pct >= 1) {
        if (flip) setDemoLibraryMode("populated");
        setFakeScanRunning(false);
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
