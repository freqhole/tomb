-- album metadata blob + musicbrainz lookup tracking
--
-- adds a free-form json metadata column to albumz plus three typed tracking
-- columns for the musicbrainz enrichment workflow. the typed columns are
-- intentionally TEXT without CHECK constraints so the status enum can evolve
-- in code without requiring db migrations.
--
-- the canonical shape of the metadata blob and the set of valid status values
-- live in grimoire/src/music/entities/albums/metadata.rs (rust) and the
-- generated zod schemas (typescript). nothing else should encode them.

ALTER TABLE albumz ADD COLUMN metadata TEXT;
ALTER TABLE albumz ADD COLUMN mb_lookup_status TEXT;
ALTER TABLE albumz ADD COLUMN mb_lookup_at INTEGER;
ALTER TABLE albumz ADD COLUMN mb_lookup_by TEXT;

-- partial index: most table queries filter by status while excluding deleted rows
CREATE INDEX IF NOT EXISTS idx_albumz_mb_lookup_status
  ON albumz(mb_lookup_status)
  WHERE deleted_at IS NULL;
