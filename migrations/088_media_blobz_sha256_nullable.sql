-- 088: relax media_blobz.sha256 from UNIQUE NOT NULL to UNIQUE (nullable)
--
-- part of docs/sha256-removal-plan.md phase 0 - computing a full-file
-- sha256 synchronously during import is the main thing making media
-- import slow today, and it's only done because this column/the request
-- struct backing it required a real value. sqlite allows multiple NULLs
-- through a UNIQUE index (NULLs are never considered equal to each
-- other), so dropping NOT NULL here is safe: existing rows keep their
-- real sha256, new rows can omit it entirely without colliding.
--
-- same constraint as migration 060: media_blobz is referenced by foreign
-- keys from songz, artist_imagez, album_imagez, song_imagez,
-- playlist_imagez, video_seriez, video_seasonz, and videoz, so a normal
-- "rebuild the table" migration (sqlite's usual way to change a column's
-- NOT NULL-ness) risks cascading through all of them under
-- `PRAGMA foreign_keys`. instead, edit the stored schema text in place
-- via `PRAGMA writable_schema`, same technique migration 060 used for the
-- blob_type CHECK constraint - no row touched, no table dropped, no FK
-- or trigger fires. the live schema text was read directly from a real
-- database (`sqlite3 data/test.db ".schema media_blobz"`) to confirm
-- these exact substrings before writing this migration, not
-- reconstructed from migration history.
--
-- two edits: the column definition itself, and the CHECK constraint that
-- validated the old NOT NULL value's shape (must now also accept NULL).

PRAGMA writable_schema = ON;

UPDATE sqlite_master
SET sql = REPLACE(
  sql,
  'sha256 TEXT UNIQUE NOT NULL,',
  'sha256 TEXT UNIQUE,'
)
WHERE type = 'table' AND name = 'media_blobz';

UPDATE sqlite_master
SET sql = REPLACE(
  sql,
  'CHECK (length(sha256) = 64 AND sha256 NOT GLOB ''*[^a-f0-9]*''),',
  'CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB ''*[^a-f0-9]*'')),'
)
WHERE type = 'table' AND name = 'media_blobz';

-- fail loudly if either expected substring wasn't found, rather than
-- silently no-op (see migration 060's identical guard pattern).
CREATE TEMP TABLE __migration_088_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO __migration_088_guard (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type = 'table' AND name = 'media_blobz'
    AND sql LIKE '%sha256 TEXT UNIQUE,%'
    AND sql LIKE '%CHECK (sha256 IS NULL OR%'
) = 1 THEN 1 ELSE 0 END;
DROP TABLE __migration_088_guard;

PRAGMA writable_schema = OFF;

PRAGMA integrity_check;
