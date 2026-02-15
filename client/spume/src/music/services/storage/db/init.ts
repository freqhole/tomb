// database initialization and schema management
import { openDB, type IDBPDatabase } from "idb";
import type { Song } from "../types";
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
  STORE_SONGS,
  STORE_TAGS,
} from "../types";
import { debug } from "../../../../utils/logger";

let dbInstance: IDBPDatabase | null = null;

export async function initMusicDB(): Promise<IDBPDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB(MUSIC_DB_NAME, MUSIC_DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      debug(`upgrading music db from v${oldVersion} to v${newVersion}`);

      // version 8: recreate songs store with UUID string primary key
      if (oldVersion < 8 && db.objectStoreNames.contains(STORE_SONGS)) {
        debug('deleting old songs store to recreate with UUID primary key');
        db.deleteObjectStore(STORE_SONGS);
      }

      // version 7: recreate songs store with auto-increment id
      if (oldVersion < 7 && db.objectStoreNames.contains(STORE_SONGS)) {
        debug('deleting old songs store to recreate with auto-increment id');
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
        debug("compound indexes added, will backfill album fields");
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

  debug("music database initialized");

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

  debug(
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
  debug("backfill complete");
}
