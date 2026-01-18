// normalized music database with separate artists, albums, songs tables
import { openDB, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";
import type {
  Album,
  AlbumQueryResult,
  Artist,
  ArtistQueryResult,
  Favorite,
  Genre,
  Playlist,
  PlaylistSong,
  Rating,
  Song,
  SongQueryResult,
} from "./types";
import {
  MUSIC_DB_NAME,
  MUSIC_DB_VERSION,
  STORE_ALBUMS,
  STORE_ARTISTS,
  STORE_FAVORITES,
  STORE_GENRES,
  STORE_PLAYLIST_SONGS,
  STORE_PLAYLISTS,
  STORE_RATINGS,
  STORE_SONGS,
} from "./types";

let dbInstance: IDBPDatabase | null = null;

// reactive signals (for backwards compatibility - will remove later)
const [songs, setSongs] = createSignal<Song[]>([]);
const [songsVersion, setSongsVersion] = createSignal(0);

// ===== DATABASE INITIALIZATION =====

async function initMusicDB(): Promise<IDBPDatabase> {
  if (dbInstance) {
    // load songs signal if not already loaded
    if (songs().length === 0) {
      const allSongs = await dbInstance.getAll(STORE_SONGS);
      setSongs(allSongs);
    }
    return dbInstance;
  }

  dbInstance = await openDB(MUSIC_DB_NAME, MUSIC_DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`upgrading music db from v${oldVersion} to v${newVersion}`);

      // create artists table
      if (!db.objectStoreNames.contains(STORE_ARTISTS)) {
        const artistsStore = db.createObjectStore(STORE_ARTISTS, {
          keyPath: "artist_id",
        });
        artistsStore.createIndex("by_name", "name");
        artistsStore.createIndex("by_created_at", "created_at");
      }

      // create albums table
      if (!db.objectStoreNames.contains(STORE_ALBUMS)) {
        const albumsStore = db.createObjectStore(STORE_ALBUMS, {
          keyPath: "album_id",
        });
        albumsStore.createIndex("by_title", "title");
        albumsStore.createIndex("by_artist_id", "artist_id");
        albumsStore.createIndex("by_genre_id", "genre_id");
        albumsStore.createIndex("by_year", "year");
        albumsStore.createIndex("by_created_at", "created_at");
        albumsStore.createIndex("by_artist_title", ["artist_id", "title"]);
      }

      // create songs table
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        const songsStore = db.createObjectStore(STORE_SONGS, {
          keyPath: "song_id",
        });
        songsStore.createIndex("by_title", "title");
        songsStore.createIndex("by_artist_id", "artist_id");
        songsStore.createIndex("by_album_id", "album_id");
        songsStore.createIndex("by_duration", "duration");
        songsStore.createIndex("by_year", "year");
        songsStore.createIndex("by_added_at", "added_at");
        songsStore.createIndex("by_source_type", "source_type");
        songsStore.createIndex("by_file_identity", [
          "file_name",
          "file_size",
          "last_modified",
        ]);
      }

      // create genres table
      if (!db.objectStoreNames.contains(STORE_GENRES)) {
        const genresStore = db.createObjectStore(STORE_GENRES, {
          keyPath: "genre_id",
        });
        genresStore.createIndex("by_name", "name");
        genresStore.createIndex("by_parent_genre_id", "parent_genre_id");
      }

      // create playlists table
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        const playlistsStore = db.createObjectStore(STORE_PLAYLISTS, {
          keyPath: "playlist_id",
        });
        playlistsStore.createIndex("by_title", "title");
        playlistsStore.createIndex("by_created_at", "created_at");
      }

      // create playlist_songs junction table
      if (!db.objectStoreNames.contains(STORE_PLAYLIST_SONGS)) {
        const playlistSongsStore = db.createObjectStore(STORE_PLAYLIST_SONGS, {
          keyPath: ["playlist_id", "song_id"],
        });
        playlistSongsStore.createIndex("by_playlist_id", "playlist_id");
        playlistSongsStore.createIndex("by_song_id", "song_id");
        playlistSongsStore.createIndex("by_position", [
          "playlist_id",
          "position",
        ]);
      }

      // create favorites table
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        const favoritesStore = db.createObjectStore(STORE_FAVORITES, {
          keyPath: ["target_type", "target_id"],
        });
        favoritesStore.createIndex("by_target_type", "target_type");
        favoritesStore.createIndex("by_favorited_at", "favorited_at");
      }

      // create ratings table
      if (!db.objectStoreNames.contains(STORE_RATINGS)) {
        const ratingsStore = db.createObjectStore(STORE_RATINGS, {
          keyPath: ["target_type", "target_id"],
        });
        ratingsStore.createIndex("by_target_type", "target_type");
        ratingsStore.createIndex("by_rating", "rating");
      }
    },
  });

  console.log("music database initialized");

  // load songs signal for backwards compat
  const allSongs = await dbInstance.getAll(STORE_SONGS);
  setSongs(allSongs);
  setSongsVersion((v) => v + 1);

  return dbInstance;
}

// ===== ARTISTS =====

async function createArtist(artist: Artist): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_ARTISTS, artist);
}

async function getArtistById(artistId: string): Promise<Artist | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_ARTISTS, artistId);
}

async function findArtistByName(name: string): Promise<Artist | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_ARTISTS).store.index("by_name");
  return index.get(name);
}

async function getOrCreateArtist(name: string): Promise<Artist> {
  const existing = await findArtistByName(name);
  if (existing) return existing;

  const artist: Artist = {
    artist_id: crypto.randomUUID(),
    name,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  await createArtist(artist);
  return artist;
}

// ===== ALBUMS =====

async function createAlbum(album: Album): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_ALBUMS, album);
}

async function getAlbumById(albumId: string): Promise<Album | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_ALBUMS, albumId);
}

async function findAlbumByArtistAndTitle(
  artistId: string | null,
  title: string,
): Promise<Album | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_ALBUMS).store.index("by_artist_title");
  return index.get([artistId, title]);
}

async function getOrCreateAlbum(
  title: string,
  artistId: string | null,
  albumType: string = "album",
): Promise<Album> {
  const existing = await findAlbumByArtistAndTitle(artistId, title);
  if (existing) return existing;

  const album: Album = {
    album_id: crypto.randomUUID(),
    title,
    artist_id: artistId,
    album_type: albumType,
    release_date: null,
    release_date_precision: null,
    label: null,
    genre_id: null,
    year: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  await createAlbum(album);
  return album;
}

// ===== SONGS =====

async function createSong(song: Song): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_SONGS, song);

  // update reactive signal for backwards compatibility
  const allSongs = await db.getAll(STORE_SONGS);
  setSongs(allSongs);
  setSongsVersion((v) => v + 1);
}

async function getSongById(songId: string): Promise<Song | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_SONGS, songId);
}

async function findDuplicateSong(
  fileName: string,
  fileSize: number,
  lastModified: number,
): Promise<Song | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_file_identity");
  return index.get([fileName, fileSize, lastModified]);
}

async function updateSong(
  songId: string,
  updates: Partial<Song>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_SONGS, songId);
  if (!existing) {
    throw new Error(`song not found: ${songId}`);
  }

  const updated: Song = {
    ...existing,
    ...updates,
    song_id: songId,
    updated_at: Date.now(),
  };

  await db.put(STORE_SONGS, updated);
}

async function deleteSong(songId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_SONGS, songId);

  // update reactive signal
  const allSongs = await db.getAll(STORE_SONGS);
  setSongs(allSongs);
  setSongsVersion((v) => v + 1);
}

// ===== GENRES =====

async function createGenre(genre: Genre): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_GENRES, genre);
}

async function getGenreById(genreId: string): Promise<Genre | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_GENRES, genreId);
}

async function findGenreByName(name: string): Promise<Genre | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_GENRES).store.index("by_name");
  return index.get(name);
}

async function getOrCreateGenre(name: string): Promise<Genre> {
  const existing = await findGenreByName(name);
  if (existing) return existing;

  const genre: Genre = {
    genre_id: crypto.randomUUID(),
    name,
    parent_genre_id: null,
    created_at: Date.now(),
  };

  await createGenre(genre);
  return genre;
}

// ===== QUERY HELPERS (with joins) =====

async function querySongsWithDetails(options?: {
  limit?: number;
  offset?: number;
  artistId?: string;
  albumId?: string;
}): Promise<SongQueryResult[]> {
  const db = await initMusicDB();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  // get songs (filtered if needed)
  let songsToQuery: Song[];
  if (options?.artistId) {
    const index = db.transaction(STORE_SONGS).store.index("by_artist_id");
    songsToQuery = await index.getAll(options.artistId);
  } else if (options?.albumId) {
    const index = db.transaction(STORE_SONGS).store.index("by_album_id");
    songsToQuery = await index.getAll(options.albumId);
  } else {
    songsToQuery = await db.getAll(STORE_SONGS);
  }

  // sort by added_at descending (newest first)
  songsToQuery.sort((a, b) => b.added_at - a.added_at);

  // apply pagination
  const paginatedSongs = songsToQuery.slice(offset, offset + limit);

  // join with artists, albums, genres
  const results: SongQueryResult[] = [];
  for (const song of paginatedSongs) {
    const artist = await getArtistById(song.artist_id);
    const album = await getAlbumById(song.album_id);
    const genre = album?.genre_id ? await getGenreById(album.genre_id) : null;

    if (!artist || !album) {
      console.warn(`missing artist or album for song ${song.song_id}`);
      continue;
    }

    const isFavorite = await checkFavorite("song", song.song_id);
    const rating = await getRating("song", song.song_id);

    results.push({
      song,
      artist,
      album,
      genre,
      is_favorite: isFavorite,
      rating,
    });
  }

  return results;
}

// ===== FAVORITES =====

async function setFavorite(
  targetType: "song" | "album" | "artist",
  targetId: string,
  isFavorite: boolean,
): Promise<void> {
  const db = await initMusicDB();

  if (isFavorite) {
    const favorite: Favorite = {
      target_type: targetType,
      target_id: targetId,
      favorited_at: Date.now(),
    };
    await db.put(STORE_FAVORITES, favorite);
  } else {
    await db.delete(STORE_FAVORITES, [targetType, targetId]);
  }
}

async function checkFavorite(
  targetType: "song" | "album" | "artist",
  targetId: string,
): Promise<boolean> {
  const db = await initMusicDB();
  const favorite = await db.get(STORE_FAVORITES, [targetType, targetId]);
  return !!favorite;
}

// ===== RATINGS =====

async function setRating(
  targetType: "song" | "album" | "artist",
  targetId: string,
  rating: number,
): Promise<void> {
  const db = await initMusicDB();
  const ratingRecord: Rating = {
    target_type: targetType,
    target_id: targetId,
    rating,
    created_at: Date.now(),
  };
  await db.put(STORE_RATINGS, ratingRecord);
}

async function getRating(
  targetType: "song" | "album" | "artist",
  targetId: string,
): Promise<number | null> {
  const db = await initMusicDB();
  const rating = await db.get(STORE_RATINGS, [targetType, targetId]);
  return rating?.rating ?? null;
}

// ===== CLEAR DATA =====

async function clearAllMusicData(): Promise<void> {
  const db = await initMusicDB();
  await db.clear(STORE_ARTISTS);
  await db.clear(STORE_ALBUMS);
  await db.clear(STORE_SONGS);
  await db.clear(STORE_GENRES);
  await db.clear(STORE_PLAYLISTS);
  await db.clear(STORE_PLAYLIST_SONGS);
  await db.clear(STORE_FAVORITES);
  await db.clear(STORE_RATINGS);
  setSongs([]);
  console.log("cleared all music data");
}

// ===== EXPORTS =====

export {
  checkFavorite,
  // cleanup
  clearAllMusicData,
  // albums
  createAlbum,
  // artists
  createArtist,
  // genres
  createGenre,
  // songs
  createSong,
  deleteSong,
  findAlbumByArtistAndTitle,
  findArtistByName,
  findDuplicateSong,
  findGenreByName,
  getAlbumById,
  getArtistById,
  getGenreById,
  getOrCreateAlbum,
  getOrCreateArtist,
  getOrCreateGenre,
  getRating,
  getSongById,
  // init
  initMusicDB,
  // queries
  querySongsWithDetails,
  // favorites
  setFavorite,
  // ratings
  setRating,
  // backwards compat (will remove)
  songs,
  songsVersion,
  updateSong,
};
