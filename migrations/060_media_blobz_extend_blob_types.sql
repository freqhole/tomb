-- 060: extend media_blobz.blob_type CHECK to allow 'rendition' and 'subtitle'
--
-- video transcoded renditions and subtitle tracks are stored as derived
-- media_blobz rows (parent_blob_id -> original, blob_type = rendition/subtitle,
-- metadata json) - the same mechanism thumbnails/waveforms already use. see
-- docs/video-domain-phase1-data-model.md. BlobType::Rendition/BlobType::Subtitle
-- already exist in grimoire/src/media_blobz/models.rs; this migration just
-- catches up the CHECK constraint sqlite enforces on insert.
--
-- sqlite can't alter a CHECK constraint in place, and the usual fix (rebuild
-- the table: create new, copy rows, drop old, rename) isn't safe here.
-- media_blobz is referenced by foreign keys from songz, artist_imagez,
-- album_imagez, song_imagez, playlist_imagez, video_seriez, video_seasonz,
-- and videoz. dropping a table with sqlite foreign_keys enabled performs an
-- implicit bulk delete that's checked (or, for the ON DELETE CASCADE ones,
-- performed for real) against every one of those - and songz alone is in
-- turn referenced by a dozen more tables (playlist_songz, music_play_eventz,
-- radio_bumperz, ...), so a rebuild would cascade through most of the
-- schema. toggling `PRAGMA foreign_keys = OFF` first doesn't help either:
-- sqlite ignores that pragma while a transaction is open, and sqlx always
-- runs a migration file inside one (see migration 050's writeup of the same
-- restriction).
--
-- instead of a rebuild, this migration edits media_blobz's stored schema
-- text directly via `PRAGMA writable_schema`, replacing only the blob_type
-- CHECK clause's substring in place. no row is touched, no table is
-- dropped, no foreign key or trigger fires - the risk this migration
-- carries is a bad string edit to the schema, not data loss. sqlite
-- documents writable_schema as intended for repair tools, so it's used
-- narrowly: one substring swap against the exact, verified existing text,
-- followed by an integrity check.

PRAGMA writable_schema = ON;

UPDATE sqlite_master
SET sql = REPLACE(
  sql,
  'CHECK (blob_type IN (''original'', ''thumbnail'', ''waveform'', ''preview''))',
  'CHECK (blob_type IN (''original'', ''thumbnail'', ''waveform'', ''preview'', ''rendition'', ''subtitle''))'
)
WHERE type = 'table' AND name = 'media_blobz';

-- fail loudly if the exact substring above wasn't found (e.g. schema text
-- drifted from what this migration expects) rather than silently no-op.
-- RAISE() only works inside a trigger, so the abort is done instead via a
-- CHECK constraint: insert a 0 when the expected text is missing, which
-- fails the CHECK and rolls back this whole migration transaction.
CREATE TEMP TABLE __migration_060_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO __migration_060_guard (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type = 'table' AND name = 'media_blobz'
    AND sql LIKE '%rendition%' AND sql LIKE '%subtitle%'
) = 0 THEN 0 ELSE 1 END;
DROP TABLE __migration_060_guard;

PRAGMA writable_schema = OFF;

PRAGMA integrity_check;

