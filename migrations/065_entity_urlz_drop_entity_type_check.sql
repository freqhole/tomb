-- 065: entity_urlz - drop entity_type CHECK entirely
--
-- mirrors 061/062's user_favoritez/user_ratingz CHECK-drop: entity_type is
-- validated by matching against the TaggableEntity rust enum
-- (grimoire/src/entities/mod.rs) at the api/serde boundary, the same
-- pattern entity_taxonz already uses (no SQL CHECK there either). this
-- lets the video domain (video/video_series/video_season) write entity
-- link rows without a migration re-widening a hardcoded sql allowlist
-- every time a new domain adds a variant.
--
-- sqlite can't drop a CHECK constraint in place, so the table is rebuilt
-- (same columns/indexes otherwise).
--
-- 5 views (album/artist/playlist/playlist_song/song_query_view) select
-- from entity_urlz, and sqlite's ALTER TABLE ... RENAME TO scans every
-- view/trigger in the schema for references to fix up - it does this
-- mid-rebuild, while entity_urlz is transiently gone, and errors with
-- "no such table: main.entity_urlz". drop them first; `make db-migrate`'s
-- "creating views..." step re-applies migrations/views/*.sql
-- unconditionally right after this runs (each file DROP VIEW IF EXISTS's
-- itself before recreating), so this is safe.

DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS artist_query_view;
DROP VIEW IF EXISTS playlist_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;
DROP VIEW IF EXISTS song_query_view;

PRAGMA foreign_keys = OFF;

CREATE TABLE entity_urlz_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  name TEXT,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT
);

INSERT INTO entity_urlz_new (id, entity_type, entity_id, name, url, created_at, created_by)
SELECT id, entity_type, entity_id, name, url, created_at, created_by
FROM entity_urlz;

DROP TABLE entity_urlz;
ALTER TABLE entity_urlz_new RENAME TO entity_urlz;

CREATE INDEX idx_entity_urlz_entity ON entity_urlz(entity_type, entity_id);
CREATE INDEX idx_entity_urlz_url ON entity_urlz(url);

PRAGMA foreign_keys = ON;
