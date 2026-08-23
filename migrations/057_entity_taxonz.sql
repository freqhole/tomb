-- 057: generalized polymorphic entity <-> taxon links
--
-- additive/supplemental to the existing album-only `album_taxonz` 
-- (migrations/032_taxonomy_tables.sql) - albums keep using `album_taxonz` 
-- for now, video (and any future domain) uses this generalized table instead. 
-- no `FOREIGN KEY`/`CASCADE` on (entity_type, entity_id) - sqlite can't express 
-- a polymorphic fk, so every entity's delete path must explicitly clean up 
-- its own rows. `entity_type` is validated in rust, no `CHECK` constraint.

CREATE TABLE entity_taxonz (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  taxon_id    TEXT NOT NULL REFERENCES taxonz(id) ON DELETE CASCADE,
  origin      TEXT NOT NULL,
  confidence  REAL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by  TEXT,
  PRIMARY KEY (entity_type, entity_id, taxon_id, origin)
);

CREATE INDEX idx_entity_taxonz_entity ON entity_taxonz(entity_type, entity_id);
CREATE INDEX idx_entity_taxonz_taxon ON entity_taxonz(taxon_id);
