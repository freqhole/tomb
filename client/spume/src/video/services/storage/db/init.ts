// database initialization and schema management for the video domain
// own indexeddb database — never touch music's MUSIC_DB_NAME/init.ts
import { openDB, type IDBPDatabase } from "idb";

export const VIDEO_DB_NAME = "freqhole-video";
export const VIDEO_DB_VERSION = 3;

export const STORE_VIDEOS = "videos";
export const STORE_VIDEO_SERIES = "video_series";
export const STORE_VIDEO_SEASONS = "video_seasons";
export const STORE_TAGS = "tags";
export const STORE_ENTITY_TAGS = "entity_tags";

let dbInstance: IDBPDatabase | null = null;

export async function getVideoDB(): Promise<IDBPDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB(VIDEO_DB_NAME, VIDEO_DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
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

      // global tag vocabulary — own copy, own store (mirrors
      // music/services/storage/db/init.ts's STORE_TAGS, kept separate
      // per the video domain's isolation rule).
      if (!db.objectStoreNames.contains(STORE_TAGS)) {
        const tagsStore = db.createObjectStore(STORE_TAGS, {
          keyPath: "tag_id",
        });
        tagsStore.createIndex("by_name", "name", { unique: true });
        tagsStore.createIndex("by_created_at", "created_at");
      }

      // entity_tags junction — generalized over entity_type (mirrors
      // the server's entity_tagz table), unlike music's album-only
      // STORE_ALBUM_TAGS, so the same store serves both "video" and
      // "video_series" entities.
      if (!db.objectStoreNames.contains(STORE_ENTITY_TAGS)) {
        const entityTagsStore = db.createObjectStore(STORE_ENTITY_TAGS, {
          keyPath: ["entity_type", "entity_id", "tag_id"],
        });
        entityTagsStore.createIndex("by_entity", ["entity_type", "entity_id"]);
        entityTagsStore.createIndex("by_tag_id", "tag_id");
      }

      // v2 -> v3: add a `by_blake3` index on videos (cenotaph tier-2 sync
      // queue to local, see docs/cenotaph-migration-plan.md) - mirrors
      // music's `by_blake3` index (songs, v17 -> v18). non-unique +
      // sparse: only remote-synced videos and freshly-uploaded local
      // videos get a `blake3`; older local videos imported before this
      // migration have no `blake3` and IDB indexes simply skip records
      // whose indexed path is null/undefined.
      if (oldVersion < 3 && db.objectStoreNames.contains(STORE_VIDEOS)) {
        const videosStore = tx.objectStore(STORE_VIDEOS);
        if (!videosStore.indexNames.contains("by_blake3")) {
          videosStore.createIndex("by_blake3", "blake3");
        }
      }
    },
  });

  return dbInstance;
}
