-- 069: generalized polymorphic entity <-> tag links
--
-- additive/supplemental to the existing album-only `album_tagz`
-- (migrations/003_junction_tables.sql) - albums keep using `album_tagz`
-- for now, video (and any future domain) uses this generalized table
-- instead, mirroring `entity_taxonz` (migrations/057_entity_taxonz.sql).
-- reuses the existing shared `tagz` table so tag names stay unified/
-- deduped across domains. no `FOREIGN KEY`/`CASCADE` on
-- (entity_type, entity_id) - sqlite can't express a polymorphic fk, so
-- every entity's delete path must explicitly clean up its own rows.
-- `entity_type` is validated in rust, no `CHECK` constraint.

CREATE TABLE entity_tagz (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  tag_id      TEXT NOT NULL REFERENCES tagz(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by  TEXT,
  PRIMARY KEY (entity_type, entity_id, tag_id)
);

CREATE INDEX idx_entity_tagz_entity ON entity_tagz(entity_type, entity_id);
CREATE INDEX idx_entity_tagz_tag ON entity_tagz(tag_id);
