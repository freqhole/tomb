-- 066: entity_imagez - generic entity <-> image links
--
-- entity_type is plain TEXT with no SQL CHECK constraint, validated by
-- matching against the TaggableEntity rust enum
-- (grimoire/src/entities/mod.rs) at the api/serde boundary - same pattern
-- entity_urlz/entity_taxonz already use. lets the video domain (video/
-- video_series) reuse the same multi-image + set-primary UX
-- album/artist/playlist/song already have via their own dedicated
-- *_imagez tables, without adding two more near-duplicate per-domain
-- tables for a brand new pair of entity types.

CREATE TABLE entity_imagez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL REFERENCES media_blobz(id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  blob_type TEXT NOT NULL DEFAULT 'thumbnail',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT
);

CREATE INDEX idx_entity_imagez_entity ON entity_imagez(entity_type, entity_id);
CREATE INDEX idx_entity_imagez_primary ON entity_imagez(entity_type, entity_id, is_primary);
CREATE INDEX idx_entity_imagez_blob ON entity_imagez(media_blob_id);
