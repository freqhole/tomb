// database initialization and schema management for the video domain
// own indexeddb database — never touch music's MUSIC_DB_NAME/init.ts
import { openDB, type IDBPDatabase } from "idb";

export const VIDEO_DB_NAME = "freqhole-video";
export const VIDEO_DB_VERSION = 1;

export const STORE_VIDEOS = "videos";
export const STORE_VIDEO_SERIES = "video_series";
export const STORE_VIDEO_SEASONS = "video_seasons";

let dbInstance: IDBPDatabase | null = null;

export async function getVideoDB(): Promise<IDBPDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB(VIDEO_DB_NAME, VIDEO_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        const videosStore = db.createObjectStore(STORE_VIDEOS, {
          keyPath: "id",
        });
        videosStore.createIndex("by_title", "title");
        videosStore.createIndex("by_series_id", "series_id");
        videosStore.createIndex("by_season_id", "season_id");
        videosStore.createIndex("by_added_at", "added_at");
        videosStore.createIndex("by_source_type", "source_type");
      }

      if (!db.objectStoreNames.contains(STORE_VIDEO_SERIES)) {
        const seriesStore = db.createObjectStore(STORE_VIDEO_SERIES, {
          keyPath: "id",
        });
        seriesStore.createIndex("by_title", "title");
        seriesStore.createIndex("by_created_at", "created_at");
      }

      if (!db.objectStoreNames.contains(STORE_VIDEO_SEASONS)) {
        const seasonsStore = db.createObjectStore(STORE_VIDEO_SEASONS, {
          keyPath: "id",
        });
        seasonsStore.createIndex("by_series_id", "series_id");
        seasonsStore.createIndex("by_season_number", "season_number");
      }
    },
  });

  return dbInstance;
}
