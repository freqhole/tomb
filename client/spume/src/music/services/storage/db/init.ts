// database initialization and schema management
import { openDB, type IDBPDatabase } from "idb";
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
    async upgrade(db, oldVersion, _newVersion, tx) {
      // artists
      if (!db.objectStoreNames.contains(STORE_ARTISTS)) {
        const artistsStore = db.createObjectStore(STORE_ARTISTS, {
          keyPath: "artist_id",
        });
        artistsStore.createIndex("by_name", "name");
        artistsStore.createIndex("by_created_at", "created_at");
      }

      // albums
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

      // songs
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        const songsStore = db.createObjectStore(STORE_SONGS, {
          keyPath: "id",
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
        songsStore.createIndex("by_album_disc_track", [
          "album_id",
          "disc_number",
          "track_number",
        ]);
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

      // genres
      if (!db.objectStoreNames.contains(STORE_GENRES)) {
        const genresStore = db.createObjectStore(STORE_GENRES, {
          keyPath: "genre_id",
        });
        genresStore.createIndex("by_name", "name");
        genresStore.createIndex("by_parent_genre_id", "parent_genre_id");
      }

      // playlists
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        const playlistsStore = db.createObjectStore(STORE_PLAYLISTS, {
          keyPath: "playlist_id",
        });
        playlistsStore.createIndex("by_title", "title");
        playlistsStore.createIndex("by_created_at", "created_at");
        playlistsStore.createIndex("by_source_type", "source_type");
        playlistsStore.createIndex("by_source_remote_id", "source_remote_id");
        playlistsStore.createIndex("by_last_synced_at", "last_synced_at");
      }

      // playlist_songs junction
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

      // favorites
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        const favoritesStore = db.createObjectStore(STORE_FAVORITES, {
          keyPath: ["target_type", "target_id"],
        });
        favoritesStore.createIndex("by_target_type", "target_type");
        favoritesStore.createIndex("by_favorited_at", "favorited_at");
      }

      // ratings
      if (!db.objectStoreNames.contains(STORE_RATINGS)) {
        const ratingsStore = db.createObjectStore(STORE_RATINGS, {
          keyPath: ["target_type", "target_id"],
        });
        ratingsStore.createIndex("by_target_type", "target_type");
        ratingsStore.createIndex("by_rating", "rating");
      }

      // tags
      if (!db.objectStoreNames.contains(STORE_TAGS)) {
        const tagsStore = db.createObjectStore(STORE_TAGS, {
          keyPath: "tag_id",
        });
        tagsStore.createIndex("by_name", "name", { unique: true });
        tagsStore.createIndex("by_created_at", "created_at");
      }

      // album_tags junction
      if (!db.objectStoreNames.contains(STORE_ALBUM_TAGS)) {
        const albumTagsStore = db.createObjectStore(STORE_ALBUM_TAGS, {
          keyPath: ["album_id", "tag_id"],
        });
        albumTagsStore.createIndex("by_album_id", "album_id");
        albumTagsStore.createIndex("by_tag_id", "tag_id");
        albumTagsStore.createIndex("by_created_at", "created_at");
      }

      // v11 -> v12: migrate cached songs from `album_genres` (GenreRef[]) to
      // `album_taxons` (TaxonRef[]). preserves any existing `album_taxons`,
      // backfilling only the genre kind from the legacy field. uses the
      // upgrade transaction to keep the migration atomic with the version bump.
      if (oldVersion < 12 && db.objectStoreNames.contains(STORE_SONGS)) {
        const songsStore = tx.objectStore(STORE_SONGS);
        let cursor = await songsStore.openCursor();
        while (cursor) {
          const song = cursor.value as Record<string, unknown>;
          const legacyGenres = song.album_genres as
            | Array<{ id: string; name: string }>
            | undefined;
          if (legacyGenres && legacyGenres.length > 0) {
            const existingTaxons = (song.album_taxons as
              | Array<{ id: string; kind_slug: string; label: string }>
              | undefined) ?? [];
            const haveGenre = new Set(
              existingTaxons
                .filter((t) => t.kind_slug === "genre")
                .map((t) => t.id),
            );
            const fromLegacy = legacyGenres
              .filter((g) => !haveGenre.has(g.id))
              .map((g) => ({ id: g.id, kind_slug: "genre", label: g.name }));
            song.album_taxons = [...existingTaxons, ...fromLegacy];
          }
          delete song.album_genres;
          await cursor.update(song);
          cursor = await cursor.continue();
        }
      }
    },
  });

  debug("music database initialized");
  return dbInstance;
}

// close database connection (required before deletion)
export function closeMusicDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    debug("music database connection closed");
  }
}
