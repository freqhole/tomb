// normalized music database with separate artists, albums, songs tables
import { openDB, type IDBPDatabase } from "idb";
import type {
  Album,
  AlbumQueryResult,
  AlbumTag,
  AlbumWithStats,
  Artist,
  ArtistQueryResult,
  ArtistWithStats,
  Favorite,
  Genre,
  GenreWithStats,
  NewSong,
  Playlist,
  PlaylistSong,
  Rating,
  Song,
  SongQueryResult,
  Tag,
} from "./types";
import {
  MUSIC_DB_NAME,
  MUSIC_DB_VERSION,
  STORE_ALBUM_TAGS,
  STORE_ALBUMS,
  STORE_ARTISTS,
  STORE_FAVORITES,
  STORE_GENRES,
  STORE_PLAYLIST_SONGS,
  STORE_PLAYLISTS,
  STORE_RATINGS,
  STORE_REMOTES,
  STORE_SONGS,
  STORE_TAGS,
} from "./types";
import { generateUUID } from "../../../utils/uuid";

let dbInstance: IDBPDatabase | null = null;

// ===== DATABASE INITIALIZATION =====

export async function initMusicDB(): Promise<IDBPDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB(MUSIC_DB_NAME, MUSIC_DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log(`upgrading music db from v${oldVersion} to v${newVersion}`);

      // version 8: recreate songs store with UUID string primary key
      if (oldVersion < 8 && db.objectStoreNames.contains(STORE_SONGS)) {
        console.log('deleting old songs store to recreate with UUID primary key');
        db.deleteObjectStore(STORE_SONGS);
      }

      // version 7: recreate songs store with auto-increment id
      if (oldVersion < 7 && db.objectStoreNames.contains(STORE_SONGS)) {
        console.log('deleting old songs store to recreate with auto-increment id');
        db.deleteObjectStore(STORE_SONGS);
      }

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
          keyPath: "id", // UUID string, no autoIncrement
        });
        songsStore.createIndex("by_sha256", "sha256", { unique: true });
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
        // compound index for canonical album ordering: album -> disc -> track
        songsStore.createIndex("by_album_disc_track", [
          "album_id",
          "disc_number",
          "track_number",
        ]);
        // compound indexes for sortable views (all maintain album grouping)
        songsStore.createIndex("by_album_title_disc_track", [
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_artist_album_disc_track", [
          "artist_name",
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_year_album_disc_track", [
          "year",
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_album_added_at_album_disc_track", [
          "album_added_at",
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_album_genre_album_disc_track", [
          "album_primary_genre_id",
          "album_title",
          "disc_number",
          "track_number",
        ]);
      }

      // v2 -> v3: add compound indexes for album-grouped sorting
      if (oldVersion < 3 && newVersion >= 3) {
        const songsStore = transaction.objectStore(STORE_SONGS);

        // add new compound indexes if they don't exist
        if (!songsStore.indexNames.contains("by_album_title_disc_track")) {
          songsStore.createIndex("by_album_title_disc_track", [
            "album_title",
            "disc_number",
            "track_number",
          ]);
        }
        if (!songsStore.indexNames.contains("by_artist_album_disc_track")) {
          songsStore.createIndex("by_artist_album_disc_track", [
            "artist_name",
            "album_title",
            "disc_number",
            "track_number",
          ]);
        }
        if (!songsStore.indexNames.contains("by_year_album_disc_track")) {
          songsStore.createIndex("by_year_album_disc_track", [
            "year",
            "album_title",
            "disc_number",
            "track_number",
          ]);
        }
        if (
          !songsStore.indexNames.contains("by_album_added_at_album_disc_track")
        ) {
          songsStore.createIndex("by_album_added_at_album_disc_track", [
            "album_added_at",
            "album_title",
            "disc_number",
            "track_number",
          ]);
        }
        if (
          !songsStore.indexNames.contains("by_album_genre_album_disc_track")
        ) {
          songsStore.createIndex("by_album_genre_album_disc_track", [
            "album_primary_genre_id",
            "album_title",
            "disc_number",
            "track_number",
          ]);
        }

        // backfill denormalized album fields for existing songs
        // we'll do this after the upgrade transaction completes
        console.log("compound indexes added, will backfill album fields");
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

      // add playlist sync indexes (v5)
      if (db.objectStoreNames.contains(STORE_PLAYLISTS) && oldVersion < 5) {
        const playlistsStore = transaction.objectStore(STORE_PLAYLISTS);
        if (!playlistsStore.indexNames.contains("by_source_type")) {
          playlistsStore.createIndex("by_source_type", "source_type");
        }
        if (!playlistsStore.indexNames.contains("by_source_remote_id")) {
          playlistsStore.createIndex("by_source_remote_id", "source_remote_id");
        }
        if (!playlistsStore.indexNames.contains("by_last_synced_at")) {
          playlistsStore.createIndex("by_last_synced_at", "last_synced_at");
        }
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

      // create remotes table (v4)
      if (!db.objectStoreNames.contains(STORE_REMOTES)) {
        const remotesStore = db.createObjectStore(STORE_REMOTES, {
          keyPath: "remote_id",
        });
        remotesStore.createIndex("by_name", "name");
        remotesStore.createIndex("by_is_active", "is_active");
        remotesStore.createIndex("by_created_at", "created_at");
      }

      // create tags table (v9)
      if (!db.objectStoreNames.contains(STORE_TAGS)) {
        const tagsStore = db.createObjectStore(STORE_TAGS, {
          keyPath: "tag_id",
        });
        tagsStore.createIndex("by_name", "name", { unique: true });
        tagsStore.createIndex("by_created_at", "created_at");
      }

      // create album_tags junction table (v10)
      if (!db.objectStoreNames.contains(STORE_ALBUM_TAGS)) {
        const albumTagsStore = db.createObjectStore(STORE_ALBUM_TAGS, {
          keyPath: ["album_id", "tag_id"],
        });
        albumTagsStore.createIndex("by_album_id", "album_id");
        albumTagsStore.createIndex("by_tag_id", "tag_id");
        albumTagsStore.createIndex("by_created_at", "created_at");
      }
    },
  });

  console.log("music database initialized");

  // backfill denormalized album fields if needed (v3 upgrade)
  await backfillAlbumFields();

  return dbInstance;
}

// backfill album_added_at and album_primary_genre_id for existing songs
async function backfillAlbumFields(): Promise<void> {
  if (!dbInstance) return;

  // check if any songs are missing the new fields
  const allSongs = await dbInstance.getAll(STORE_SONGS);
  const needsBackfill = allSongs.some(
    (song) =>
      song.album_added_at === undefined ||
      song.album_primary_genre_id === undefined,
  );

  if (!needsBackfill) return;

  console.log(
    "backfilling album denormalized fields for",
    allSongs.length,
    "songs",
  );

  // group songs by album_id
  const songsByAlbum = new Map<string, Song[]>();
  for (const song of allSongs) {
    const existing = songsByAlbum.get(song.album_id) || [];
    existing.push(song);
    songsByAlbum.set(song.album_id, existing);
  }

  // compute album_added_at and album_primary_genre_id for each album
  const tx = dbInstance.transaction(STORE_SONGS, "readwrite");
  const store = tx.objectStore(STORE_SONGS);

  for (const [albumId, songs] of songsByAlbum) {
    // compute album_added_at: earliest added_at of any song in album
    const albumAddedAt = Math.min(...songs.map((s) => s.added_at));

    // compute album_primary_genre_id: most common genre (or null)
    const genreCounts = new Map<string | null, number>();
    for (const song of songs) {
      const genreId = (song as any).genre_id || null;
      genreCounts.set(genreId, (genreCounts.get(genreId) || 0) + 1);
    }
    let albumPrimaryGenreId: string | null = null;
    let maxCount = 0;
    for (const [genreId, count] of genreCounts) {
      if (count > maxCount) {
        maxCount = count;
        albumPrimaryGenreId = genreId;
      }
    }

    // update all songs in this album
    for (const song of songs) {
      const updated = {
        ...song,
        album_added_at: albumAddedAt,
        album_primary_genre_id: albumPrimaryGenreId,
      };
      await store.put(updated);
    }
  }

  await tx.done;
  console.log("backfill complete");
}

// sync album_added_at and album_primary_genre_id for all songs in an album
async function syncAlbumFields(albumId: string): Promise<void> {
  if (!dbInstance) return;

  const allSongsInAlbum = await getSongsByAlbumId(albumId);
  if (allSongsInAlbum.length === 0) return;

  // compute album_added_at: earliest added_at
  const albumAddedAt = Math.min(...allSongsInAlbum.map((s) => s.added_at));

  // compute album_primary_genre_id: most common genre (or null)
  const genreCounts = new Map<string | null, number>();
  for (const song of allSongsInAlbum) {
    const genreId = (song as any).genre_id || null;
    genreCounts.set(genreId, (genreCounts.get(genreId) || 0) + 1);
  }
  let albumPrimaryGenreId: string | null = null;
  let maxCount = 0;
  for (const [genreId, count] of genreCounts) {
    if (count > maxCount) {
      maxCount = count;
      albumPrimaryGenreId = genreId;
    }
  }

  // update all songs in album with synced values
  const tx = dbInstance.transaction(STORE_SONGS, "readwrite");
  const store = tx.objectStore(STORE_SONGS);

  for (const song of allSongsInAlbum) {
    const updated = {
      ...song,
      album_added_at: albumAddedAt,
      album_primary_genre_id: albumPrimaryGenreId,
    };
    await store.put(updated);
  }

  await tx.done;
}

// ===== ARTISTS =====

export async function createArtist(artist: Artist): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_ARTISTS, artist);
}

export async function getArtistById(artistId: string): Promise<Artist | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_ARTISTS, artistId);
}

export async function findArtistByName(name: string): Promise<Artist | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_ARTISTS).store.index("by_name");
  return index.get(name);
}

export async function getOrCreateArtist(name: string): Promise<Artist> {
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

export async function updateArtist(
  artistId: string,
  updates: Partial<Artist>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_ARTISTS, artistId);
  if (!existing) {
    throw new Error(`artist not found: ${artistId}`);
  }

  const updated = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  await db.put(STORE_ARTISTS, updated);
}

export async function deleteArtist(artistId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ARTISTS, artistId);
}

export async function countSongsByArtist(artistId: string): Promise<number> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_artist_id");
  const songs = await index.getAll(artistId);
  return songs.length;
}

// ===== ALBUMS =====

export async function createAlbum(album: Album): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_ALBUMS, album);
}

export async function getAlbumById(albumId: string): Promise<Album | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_ALBUMS, albumId);
}

export async function findAlbumByArtistAndTitle(
  artistId: string | null,
  title: string,
): Promise<Album | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_ALBUMS).store.index("by_artist_title");
  return index.get([artistId, title]);
}

export async function getOrCreateAlbum(
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

export async function updateAlbum(
  albumId: string,
  updates: Partial<Album>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_ALBUMS, albumId);
  if (!existing) {
    throw new Error(`album not found: ${albumId}`);
  }

  const updated = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  await db.put(STORE_ALBUMS, updated);
}

export async function deleteAlbum(albumId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ALBUMS, albumId);
}

export async function countSongsByAlbum(albumId: string): Promise<number> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_album_id");
  const songs = await index.getAll(albumId);
  return songs.length;
}

// ===== SONGS =====

export async function createSong(newSong: NewSong): Promise<Song> {
  const db = await initMusicDB();
  
  // generate UUID for song
  const songId = generateUUID();
  
  // create full song object with generated UUID
  const song: Song = {
    ...newSong,
    id: songId,
  };
  
  // add to IDB
  await db.add(STORE_SONGS, song);

  // sync album_added_at for all songs in this album
  await syncAlbumFields(song.album_id);
  
  return song;
}

export async function getSongById(songId: string): Promise<Song | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_SONGS, songId);
}

export async function getSongBySha256(sha256: string): Promise<Song | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_sha256");
  const song = await index.get(sha256);
  console.log(`getSongBySha256(${sha256.slice(0, 8)}...):`, song ? `found song id ${song.id}` : 'not found');
  return song;
}

export async function getSongsByAlbumId(albumId: string): Promise<Song[]> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_SONGS).store.index("by_album_id");
  return index.getAll(albumId);
}

export async function updateSong(
  songId: string,
  updates: Partial<Song>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_SONGS, songId);
  if (!existing) {
    throw new Error(`song not found: ${songId}`);
  }

  const updated = {
    ...existing,
    ...updates,
    updated_at: Date.now(),
  };

  await db.put(STORE_SONGS, updated);
}

export async function deleteSong(songId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_SONGS, songId);
}

// ===== GENRES =====

export async function createGenre(genre: Genre): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_GENRES, genre);
}

export async function getGenreById(genreId: string): Promise<Genre | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_GENRES, genreId);
}

export async function findGenreByName(name: string): Promise<Genre | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_GENRES).store.index("by_name");
  return index.get(name);
}

export async function getOrCreateGenre(name: string): Promise<Genre> {
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

// ===== TAGS =====

export async function createTag(name: string): Promise<Tag> {
  const db = await initMusicDB();
  
  // check if tag already exists
  const existing = await findTagByName(name);
  if (existing) {
    return existing;
  }

  const tag: Tag = {
    tag_id: crypto.randomUUID(),
    name,
    created_at: Date.now(),
  };

  await db.put(STORE_TAGS, tag);
  return tag;
}

export async function getTagById(tagId: string): Promise<Tag | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_TAGS, tagId);
}

export async function findTagByName(name: string): Promise<Tag | undefined> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_TAGS).store.index("by_name");
  return index.get(name);
}

export async function getAllTags(): Promise<Tag[]> {
  const db = await initMusicDB();
  return db.getAll(STORE_TAGS);
}

export async function deleteTag(tagId: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_TAGS, tagId);
}

// ===== ALBUM TAGS =====

export async function getAlbumTags(albumId: string): Promise<Tag[]> {
  const db = await initMusicDB();
  
  // get all album_tag entries for this album
  const albumTags = await db.getAllFromIndex(
    STORE_ALBUM_TAGS,
    "by_album_id",
    albumId
  );
  
  // fetch the actual tag objects
  const tags: Tag[] = [];
  for (const albumTag of albumTags) {
    const tag = await db.get(STORE_TAGS, albumTag.tag_id);
    if (tag) {
      tags.push(tag);
    }
  }
  
  return tags;
}

export async function addAlbumTag(
  albumId: string,
  tagId: string
): Promise<void> {
  const db = await initMusicDB();
  
  const albumTag: AlbumTag = {
    album_id: albumId,
    tag_id: tagId,
    created_at: Date.now(),
  };
  
  await db.put(STORE_ALBUM_TAGS, albumTag);
}

export async function removeAlbumTag(
  albumId: string,
  tagId: string
): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_ALBUM_TAGS, [albumId, tagId]);
}

export async function clearAlbumTags(albumId: string): Promise<void> {
  const db = await initMusicDB();
  
  const albumTags = await db.getAllFromIndex(
    STORE_ALBUM_TAGS,
    "by_album_id",
    albumId
  );
  
  for (const albumTag of albumTags) {
    await db.delete(STORE_ALBUM_TAGS, [albumTag.album_id, albumTag.tag_id]);
  }
}

// ===== QUERY HELPERS (with joins) =====

export async function queryAlbums(options?: {
  limit?: number;
  offset?: number;
  albumId?: string;
}): Promise<AlbumQueryResult[]> {
  const db = await initMusicDB();

  // get all albums (or specific album if albumId provided)
  const allAlbums = options?.albumId 
    ? [await db.get(STORE_ALBUMS, options.albumId)].filter(Boolean) as Album[]
    : await db.getAll(STORE_ALBUMS);

  // get all songs, artists, and genres once
  const allSongs = await db.getAll(STORE_SONGS);
  const allArtists = await db.getAll(STORE_ARTISTS);
  const allGenres = await db.getAll(STORE_GENRES);

  // create artist and genre lookup maps
  const artistsById = new Map<string, Artist>();
  for (const artist of allArtists) {
    artistsById.set(artist.artist_id, artist);
  }
  
  const genresById = new Map<string, Genre>();
  for (const genre of allGenres) {
    genresById.set(genre.genre_id, genre);
  }

  // group songs by album_id
  const songsByAlbum = new Map<string, Song[]>();
  for (const song of allSongs) {
    if (!songsByAlbum.has(song.album_id)) {
      songsByAlbum.set(song.album_id, []);
    }
    songsByAlbum.get(song.album_id)!.push(song);
  }

  // build album results with stats
  const results: AlbumQueryResult[] = [];
  for (const album of allAlbums) {
    const songs = songsByAlbum.get(album.album_id) || [];

    // skip albums with no songs
    if (songs.length === 0) continue;

    // get artist name from map
    const artist = album.artist_id ? artistsById.get(album.artist_id) : null;
    const artistName = artist?.name || "various artists";

    // get genre name from map and add to result
    let genreName: string | undefined;
    if (album.genre_id) {
      const genre = genresById.get(album.genre_id);
      if (genre) {
        genreName = genre.name;
      }
    }

    // gather unique sub-genres from songs in this album
    const subGenresSet = new Set<string>();
    for (const song of songs) {
      if (song.album_sub_genres) {
        song.album_sub_genres.forEach(sg => subGenresSet.add(sg));
      }
    }
    const subGenres = subGenresSet.size > 0 ? Array.from(subGenresSet) : undefined;

    // calculate total duration
    const totalDuration = songs.reduce(
      (sum, song) => sum + song.duration_seconds,
      0,
    );

    results.push({
      album,
      artist_name: artistName,
      song_count: songs.length,
      total_duration: totalDuration,
      genre_name: genreName,
      sub_genres: subGenres,
    });
  }

  // sort by album title (handle null/undefined titles)
  results.sort((a, b) => {
    const titleA = a.album.title || '';
    const titleB = b.album.title || '';
    return titleA.localeCompare(titleB);
  });

  // apply pagination if specified
  const limit = options?.limit ?? results.length;
  const offset = options?.offset ?? 0;

  return results.slice(offset, offset + limit);
}

export async function queryArtists(options?: {
  limit?: number;
  offset?: number;
  artistId?: string;
}): Promise<ArtistWithStats[]> {
  const db = await initMusicDB();

  // get all artists (or specific artist if artistId provided)
  const allArtists = options?.artistId 
    ? [await db.get(STORE_ARTISTS, options.artistId)].filter(Boolean) as Artist[]
    : await db.getAll(STORE_ARTISTS);

  // get all songs and albums to aggregate by artist
  const allSongs = await db.getAll(STORE_SONGS);
  const allAlbums = await db.getAll(STORE_ALBUMS);

  // group songs by artist_id
  const songsByArtist = new Map<string, Song[]>();
  for (const song of allSongs) {
    if (!songsByArtist.has(song.artist_id)) {
      songsByArtist.set(song.artist_id, []);
    }
    songsByArtist.get(song.artist_id)!.push(song);
  }

  // group albums by artist_id
  const albumsByArtist = new Map<string, Set<string>>();
  for (const album of allAlbums) {
    if (album.artist_id) {
      if (!albumsByArtist.has(album.artist_id)) {
        albumsByArtist.set(album.artist_id, new Set());
      }
      albumsByArtist.get(album.artist_id)!.add(album.album_id);
    }
  }

  // build artist results with stats
  const results: ArtistWithStats[] = [];
  for (const artist of allArtists) {
    const songs = songsByArtist.get(artist.artist_id) || [];

    // skip artists with no songs
    if (songs.length === 0) continue;

    // get unique album count
    const albums = albumsByArtist.get(artist.artist_id) || new Set();

    // calculate total duration
    const totalDuration = songs.reduce(
      (sum, song) => sum + song.duration_seconds,
      0,
    );

    results.push({
      artist,
      album_count: albums.size,
      song_count: songs.length,
      total_duration: totalDuration,
    });
  }

  // sort by artist name (handle undefined names)
  results.sort((a, b) => {
    const nameA = a.artist.name || "";
    const nameB = b.artist.name || "";
    return nameA.localeCompare(nameB);
  });

  // apply pagination if specified
  const limit = options?.limit ?? results.length;
  const offset = options?.offset ?? 0;

  return results.slice(offset, offset + limit);
}

export async function queryGenres(options?: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<GenreWithStats[]> {
  const db = await initMusicDB();

  // get all genres
  let allGenres = await db.getAll(STORE_GENRES);
  
  // filter by search if provided
  if (options?.search) {
    const searchLower = options.search.toLowerCase();
    allGenres = allGenres.filter(g => g.name.toLowerCase().includes(searchLower));
  }

  // get all albums and songs to count by genre
  const allAlbums = await db.getAll(STORE_ALBUMS);
  const allSongs = await db.getAll(STORE_SONGS);

  // create maps for album genre relationships
  const albumsByGenre = new Map<string, Set<string>>();
  for (const album of allAlbums) {
    if (album.genre_id) {
      if (!albumsByGenre.has(album.genre_id)) {
        albumsByGenre.set(album.genre_id, new Set());
      }
      albumsByGenre.get(album.genre_id)!.add(album.album_id);
    }
  }

  // count songs by album genre
  const songsByGenre = new Map<string, Set<string>>();
  for (const song of allSongs) {
    const album = allAlbums.find((a) => a.album_id === song.album_id);
    if (album?.genre_id) {
      if (!songsByGenre.has(album.genre_id)) {
        songsByGenre.set(album.genre_id, new Set());
      }
      songsByGenre.get(album.genre_id)!.add(song.sha256);
    }
  }

  // build genre results with stats
  const results: GenreWithStats[] = [];
  for (const genre of allGenres) {
    const albums = albumsByGenre.get(genre.genre_id) || new Set();
    const songs = songsByGenre.get(genre.genre_id) || new Set();

    // skip genres with no albums or songs
    if (albums.size === 0 && songs.size === 0) continue;

    results.push({
      genre,
      album_count: albums.size,
      song_count: songs.size,
    });
  }

  // sort by genre name (handle undefined names)
  results.sort((a, b) => {
    const nameA = a.genre.name || "";
    const nameB = b.genre.name || "";
    return nameA.localeCompare(nameB);
  });

  // apply pagination if specified
  const limit = options?.limit ?? results.length;
  const offset = options?.offset ?? 0;

  return results.slice(offset, offset + limit);
}

export async function querySongsWithDetails(options?: {
  limit?: number;
  offset?: number;
  artistId?: string;
  albumId?: string;
  genreId?: string;
  songIds?: string[];
  sortField?: "added_at" | "title" | "artist" | "album" | "genre" | "year";
  sortDirection?: "asc" | "desc";
}): Promise<Song[]> {
  const db = await initMusicDB();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const sortField = options?.sortField ?? "added_at";
  const sortDirection = options?.sortDirection ?? "desc";

  // map sort field to compound index (all maintain album grouping)
  const indexMap: Record<string, string> = {
    added_at: "by_album_added_at_album_disc_track",
    title: "by_album_title_disc_track",
    artist: "by_artist_album_disc_track",
    album: "by_album_title_disc_track",
    genre: "by_album_genre_album_disc_track",
    year: "by_year_album_disc_track",
  };

  let songsToQuery: Song[];

  // if filtering by artist or album, use those indexes first
  if (options?.artistId) {
    const index = db.transaction(STORE_SONGS).store.index("by_artist_id");
    songsToQuery = await index.getAll(options.artistId);
    // sort in memory since we're already filtered
    songsToQuery.sort((a, b) => {
      // always maintain album grouping: album_title -> disc -> track
      if (a.album_title !== b.album_title) {
        const titleA = a.album_title || "";
        const titleB = b.album_title || "";
        return titleA.localeCompare(titleB);
      }
      if (a.disc_number !== b.disc_number) {
        return a.disc_number - b.disc_number;
      }
      return a.track_number - b.track_number;
    });
  } else if (options?.albumId) {
    const index = db.transaction(STORE_SONGS).store.index("by_album_id");
    songsToQuery = await index.getAll(options.albumId);
    // sort by disc/track for single album
    songsToQuery.sort((a, b) => {
      if (a.disc_number !== b.disc_number) {
        return a.disc_number - b.disc_number;
      }
      return a.track_number - b.track_number;
    });
  } else if (options?.songIds) {
    // query by specific song IDs
    songsToQuery = [];
    for (const sha256 of options.songIds) {
      const song = await db.get(STORE_SONGS, sha256);
      if (song) songsToQuery.push(song);
    }
  } else if (options?.genreId) {
    // get all albums with this genre
    const allAlbums = await db.getAll(STORE_ALBUMS);
    const genreAlbums = allAlbums.filter((album) => album.genre_id === options.genreId);
    const albumIds = new Set(genreAlbums.map((a) => a.album_id));
    // get all songs and filter by album_id
    const allSongs = await db.getAll(STORE_SONGS);
    songsToQuery = allSongs.filter((song) => albumIds.has(song.album_id));
  } else {
    // use compound index for sorted, album-grouped results
    const indexName = indexMap[sortField];
    const index = db.transaction(STORE_SONGS).store.index(indexName);

    // for desc sort: load all, group by album, reverse albums, then paginate
    // this ensures newest albums are at top with correct disc/track order
    if (sortDirection === "desc") {
      // load all songs from index (in asc order to maintain disc/track)
      const allSongs = await index.getAll();

      // group by album_id preserving order
      const albumGroups: Song[][] = [];
      const seenAlbums = new Set<string>();

      for (const song of allSongs) {
        if (!seenAlbums.has(song.album_id)) {
          seenAlbums.add(song.album_id);
          albumGroups.push([]);
        }
        albumGroups[albumGroups.length - 1].push(song);
      }

      // reverse album groups to get newest first
      albumGroups.reverse();

      // flatten and paginate
      const flattened = albumGroups.flat();
      songsToQuery = flattened.slice(offset, offset + limit);
    } else {
      // asc: use cursor pagination normally
      const cursor = await index.openCursor(null, "next");
      songsToQuery = [];
      let skipped = 0;
      let collected = 0;

      if (cursor) {
        let currentCursor = cursor;
        while (currentCursor && collected < limit) {
          if (skipped < offset) {
            skipped++;
            currentCursor = await currentCursor.continue();
          } else {
            songsToQuery.push(currentCursor.value);
            collected++;
            currentCursor = await currentCursor.continue();
          }
        }
      }
    }
  }

  // apply pagination if we loaded all (artist/album filter cases)
  if (options?.artistId || options?.albumId) {
    songsToQuery = songsToQuery.slice(offset, offset + limit);
  }

  // join with artists, albums, genres and enrich songs with denormalized fields
  const results: Song[] = [];
  
  // load all albums, artists, genres, tags once for lookups
  const allAlbums = await db.getAll(STORE_ALBUMS);
  const allGenres = await db.getAll(STORE_GENRES);
  const allTags = await db.getAll(STORE_TAGS);
  const allAlbumTags = await db.getAll(STORE_ALBUM_TAGS);
  
  const albumsMap = new Map(allAlbums.map(a => [a.album_id, a]));
  const genresMap = new Map(allGenres.map(g => [g.genre_id, g]));
  const tagsMap = new Map(allTags.map(t => [t.tag_id, t]));
  
  // build map of album_id -> tag names
  const albumTagsMap = new Map<string, string[]>();
  for (const albumTag of allAlbumTags) {
    const tag = tagsMap.get(albumTag.tag_id);
    if (tag) {
      if (!albumTagsMap.has(albumTag.album_id)) {
        albumTagsMap.set(albumTag.album_id, []);
      }
      albumTagsMap.get(albumTag.album_id)!.push(tag.name);
    }
  }
  
  for (const song of songsToQuery) {
    const isFavorite = await checkFavorite("song", song.id);
    const rating = await getRating("song", song.id);

    // get album to populate denormalized fields
    const album = albumsMap.get(song.album_id);
    const albumIsFavorite = album ? await checkFavorite("album", album.album_id) : false;
    const albumRating = album ? await getRating("album", album.album_id) : null;
    
    // get genre name if album has genre_id
    const genreName = album?.genre_id ? genresMap.get(album.genre_id)?.name : undefined;
    
    // get album tags
    const albumTags = album ? albumTagsMap.get(album.album_id) : undefined;

    // enrich song object with is_favorite, user_rating, and denormalized album fields
    const enrichedSong: Song = {
      ...song,
      is_favorite: isFavorite,
      user_rating: rating ?? undefined,
      album_is_favorite: albumIsFavorite,
      album_rating: albumRating ?? undefined,
      album_primary_genre_id: album?.genre_id,
      album_primary_genre_name: genreName,
      album_tags: albumTags,
      album_images: album?.images, // include album images for artwork display
      // album_sub_genres is already on the song from import/edit
    };

    results.push(enrichedSong);
  }

  return results;
}

// ===== FAVORITES =====

export async function setFavorite(
  targetType: "song" | "album" | "artist" | "playlist",
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

export async function checkFavorite(
  targetType: "song" | "album" | "artist" | "playlist",
  targetId: string,
): Promise<boolean> {
  const db = await initMusicDB();
  const favorite = await db.get(STORE_FAVORITES, [targetType, targetId]);
  return !!favorite;
}

export async function migrateFavorite(
  targetType: "song" | "album" | "artist" | "playlist",
  oldId: string,
  newId: string,
): Promise<void> {
  const db = await initMusicDB();
  const oldFavorite = await db.get(STORE_FAVORITES, [targetType, oldId]);
  if (oldFavorite) {
    // copy to new entity
    await setFavorite(targetType, newId, true);
    // delete old favorite
    await db.delete(STORE_FAVORITES, [targetType, oldId]);
  }
}

// ===== RATINGS =====

export async function setRating(
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

export async function getRating(
  targetType: "song" | "album" | "artist",
  targetId: string,
): Promise<number | null> {
  const db = await initMusicDB();
  const rating = await db.get(STORE_RATINGS, [targetType, targetId]);
  return rating?.rating ?? null;
}

export async function migrateRating(
  targetType: "song" | "album" | "artist",
  oldId: string,
  newId: string,
): Promise<void> {
  const db = await initMusicDB();
  const oldRating = await db.get(STORE_RATINGS, [targetType, oldId]);
  if (oldRating) {
    // copy to new entity
    await setRating(targetType, newId, oldRating.rating);
    // delete old rating
    await db.delete(STORE_RATINGS, [targetType, oldId]);
  }
}

// ===== CLEAR DATA =====

export async function clearAllMusicData(): Promise<void> {
  const db = await initMusicDB();
  await db.clear(STORE_ARTISTS);
  await db.clear(STORE_ALBUMS);
  await db.clear(STORE_SONGS);
  await db.clear(STORE_GENRES);
  await db.clear(STORE_PLAYLISTS);
  await db.clear(STORE_PLAYLIST_SONGS);
  await db.clear(STORE_FAVORITES);
  await db.clear(STORE_RATINGS);
  await db.clear(STORE_TAGS);
  await db.clear(STORE_ALBUM_TAGS);
  console.log("cleared all music data");
}

export async function getPlaylistById(
  playlistId: string,
): Promise<Playlist | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_PLAYLISTS, playlistId);
}
