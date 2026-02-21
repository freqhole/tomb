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
    upgrade(db) {
      // artists
      const artistsStore = db.createObjectStore(STORE_ARTISTS, {
        keyPath: "artist_id",
      });
      artistsStore.createIndex("by_name", "name");
      artistsStore.createIndex("by_created_at", "created_at");

      // albums
      const albumsStore = db.createObjectStore(STORE_ALBUMS, {
        keyPath: "album_id",
      });
      albumsStore.createIndex("by_title", "title");
      albumsStore.createIndex("by_artist_id", "artist_id");
      albumsStore.createIndex("by_genre_id", "genre_id");
      albumsStore.createIndex("by_year", "year");
      albumsStore.createIndex("by_created_at", "created_at");
      albumsStore.createIndex("by_artist_title", ["artist_id", "title"]);

      // songs
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

      // genres
      const genresStore = db.createObjectStore(STORE_GENRES, {
        keyPath: "genre_id",
      });
      genresStore.createIndex("by_name", "name");
      genresStore.createIndex("by_parent_genre_id", "parent_genre_id");

      // playlists
      const playlistsStore = db.createObjectStore(STORE_PLAYLISTS, {
        keyPath: "playlist_id",
      });
      playlistsStore.createIndex("by_title", "title");
      playlistsStore.createIndex("by_created_at", "created_at");
      playlistsStore.createIndex("by_source_type", "source_type");
      playlistsStore.createIndex("by_source_remote_id", "source_remote_id");
      playlistsStore.createIndex("by_last_synced_at", "last_synced_at");

      // playlist_songs junction
      const playlistSongsStore = db.createObjectStore(STORE_PLAYLIST_SONGS, {
        keyPath: ["playlist_id", "song_id"],
      });
      playlistSongsStore.createIndex("by_playlist_id", "playlist_id");
      playlistSongsStore.createIndex("by_song_id", "song_id");
      playlistSongsStore.createIndex("by_position", [
        "playlist_id",
        "position",
      ]);

      // favorites
      const favoritesStore = db.createObjectStore(STORE_FAVORITES, {
        keyPath: ["target_type", "target_id"],
      });
      favoritesStore.createIndex("by_target_type", "target_type");
      favoritesStore.createIndex("by_favorited_at", "favorited_at");

      // ratings
      const ratingsStore = db.createObjectStore(STORE_RATINGS, {
        keyPath: ["target_type", "target_id"],
      });
      ratingsStore.createIndex("by_target_type", "target_type");
      ratingsStore.createIndex("by_rating", "rating");

      // tags
      const tagsStore = db.createObjectStore(STORE_TAGS, {
        keyPath: "tag_id",
      });
      tagsStore.createIndex("by_name", "name", { unique: true });
      tagsStore.createIndex("by_created_at", "created_at");

      // album_tags junction
      const albumTagsStore = db.createObjectStore(STORE_ALBUM_TAGS, {
        keyPath: ["album_id", "tag_id"],
      });
      albumTagsStore.createIndex("by_album_id", "album_id");
      albumTagsStore.createIndex("by_tag_id", "tag_id");
      albumTagsStore.createIndex("by_created_at", "created_at");
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
