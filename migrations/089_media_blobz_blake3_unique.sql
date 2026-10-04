-- 089: add a UNIQUE constraint (and shape CHECK) to media_blobz.blake3
--
-- part of docs/sha256-removal-plan.md phase 1 - blake3 becomes the real
-- dedup key. the plan originally called for `blake3 NOT NULL` once
-- phase 0's automatic backfill reaches 0 remaining in practice, but a
-- real pre-flight check against the local dev db (636 blobs) found a
-- genuinely stuck row even after running the manual backfill command:
-- a `waveform` blob with no `local_path` and no matching `blob_data`
-- row, so there's no byte source left to hash at all (its original
-- bytes are gone, not just unhashed - likely stale leftover metadata
-- from a prior dev-only experiment, not something the current import
-- code path produces). that proves a hard `NOT NULL` migration isn't
-- safe to ship: it would hard-fail this exact migration for any real
-- user who happens to have even one such orphaned row, with no
-- graceful way to detect/skip it ahead of time.
--
-- staying nullable and adding `UNIQUE` instead gets the same practical
-- dedup protection (sqlite's UNIQUE index already treats multiple NULLs
-- as distinct, never colliding with each other - this exact behavior
-- was already verified for sha256 in migration 088) without requiring
-- 100% backfill coverage before it's safe to ship. this exactly mirrors
-- the nullable-UNIQUE pattern migration 088 used for sha256, just
-- applied to blake3 instead, and for the same underlying reason (a
-- rare-but-real class of row that can't always get a value).
--
-- IMPORTANT - why this does NOT reuse migration 060/088's
-- `PRAGMA writable_schema` text-edit for the UNIQUE part (unlike the
-- CHECK constraint below, which still uses it safely): a first version
-- of this migration tried rewriting the stored `CREATE TABLE` text to
-- add `blake3 TEXT UNIQUE` the same way 088 added `sha256 TEXT UNIQUE`
-- - but 088 was only ever *loosening* an existing constraint
-- (NOT NULL -> nullable), never introducing a brand new one. a `UNIQUE`
-- column constraint is backed by a real index B-tree that SQLite builds
-- at `CREATE TABLE`/`CREATE INDEX` time; rewriting `sqlite_master.sql`
-- to retroactively claim a column is `UNIQUE` does not retroactively
-- build that index, so the declared schema and the actual on-disk
-- structure go out of sync. tested directly against a real, populated
-- dev db (`data/grimoire.db`, 636 media_blobz rows): the text-edit
-- version passed its own guard check but left `PRAGMA integrity_check`
-- reporting "database disk image is malformed" afterward (reproduced
-- both via `sqlx::migrate!` and a plain `sqlite3` CLI replay) - a fresh,
-- empty database never showed the problem, which is why it wasn't
-- caught by the normal cargo test / `#[ignore]` integration tests (none
-- of them run migrations against a pre-populated table). recovered by
-- restoring the pre-migration file (the corruption was confined to the
-- not-yet-checkpointed WAL, so the base file itself was untouched - no
-- data was lost, but this is why the migration is written differently
-- below instead of "just" fixing the text-edit).
--
-- the fix: `media_blobz` already has a plain (non-unique) index on
-- blake3 for lookup performance (`idx_media_blobz_blake3`, added in
-- migration 080) - dropping and recreating it as UNIQUE is a normal,
-- fully-supported DDL operation that needs no writable_schema trick at
-- all. same multiple-NULLs-allowed behavior as a UNIQUE column
-- constraint - no WHERE clause needed (compare `idx_media_blobz_sha256`,
-- already a plain, non-partial UNIQUE index over a nullable column).
--
-- the CHECK constraint (hash shape validation) has no such problem -
-- CHECK constraints are evaluated procedurally at write time, not
-- backed by any index, so editing the stored schema text for it is
-- exactly as safe as migration 060/088's identical use of the same
-- technique. same FK fan-out as migrations 060/088 (songz,
-- artist_imagez, album_imagez, song_imagez, playlist_imagez,
-- video_seriez, video_seasonz, videoz all reference media_blobz), so
-- this still avoids a table rebuild for the CHECK edit - no row
-- touched, no table dropped, no FK or trigger fires.

DROP INDEX idx_media_blobz_blake3;
CREATE UNIQUE INDEX idx_media_blobz_blake3 ON media_blobz(blake3);

PRAGMA writable_schema = ON;

UPDATE sqlite_master
SET sql = REPLACE(
  sql,
  'CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB ''*[^a-f0-9]*'')),',
  'CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB ''*[^a-f0-9]*'')),
  CHECK (blake3 IS NULL OR (length(blake3) = 64 AND blake3 NOT GLOB ''*[^a-f0-9]*'')),'
)
WHERE type = 'table' AND name = 'media_blobz';

-- fail loudly if the expected substring wasn't found, or the index
-- didn't come back as UNIQUE, rather than silently no-op (see migration
-- 060/088's identical guard pattern).
CREATE TEMP TABLE __migration_089_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO __migration_089_guard (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type = 'table' AND name = 'media_blobz'
    AND sql LIKE '%CHECK (blake3 IS NULL OR%'
) = 1
AND (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type = 'index' AND name = 'idx_media_blobz_blake3'
    AND sql LIKE 'CREATE UNIQUE INDEX%'
) = 1 THEN 1 ELSE 0 END;
DROP TABLE __migration_089_guard;

PRAGMA writable_schema = OFF;

PRAGMA integrity_check;
