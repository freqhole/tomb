-- the blobz table: reliquary's own content-addressed blob record store.
-- see tomb/docs/xl-refactor/PHASE_2_RELIQUARY_RUST.md ("schema" section) and
-- docs/storage-traits.md for the full design.

CREATE TABLE blobz (
    blake3          TEXT PRIMARY KEY NOT NULL,
    iroh_hash       TEXT,
    sha256          TEXT,
    old_grimoire_id TEXT,
    filename        TEXT,
    mime            TEXT,
    size            INTEGER NOT NULL,
    path            TEXT NOT NULL,
    external        INTEGER NOT NULL DEFAULT 0,
    blob_type       TEXT NOT NULL DEFAULT 'original',
    parent_blake3   TEXT,
    width           INTEGER,
    height          INTEGER,
    metadata        TEXT,
    created_at      INTEGER NOT NULL,
    soft_deleted_at INTEGER,
    soft_deleted_by TEXT
);

-- sqlite allows multiple NULLs through a unique index, so unmigrated rows
-- (iroh_hash not yet backfilled) don't collide with each other.
CREATE UNIQUE INDEX blobz_iroh_hash_idx ON blobz (iroh_hash);
CREATE INDEX blobz_sha256_idx ON blobz (sha256);
CREATE UNIQUE INDEX blobz_old_id_idx ON blobz (old_grimoire_id) WHERE old_grimoire_id IS NOT NULL;
CREATE INDEX blobz_parent_idx ON blobz (parent_blake3);
