-- 092: extend videoz.content_type CHECK to allow 'karaoke'
--
-- adds a fourth standalone content type alongside series/movie/clip for
-- karaoke videos - no schema changes needed beyond this (content_type has
-- always been a plain TEXT column with no fixed Rust enum; query/filter
-- code already treats it as an arbitrary string - see
-- video/crud/query.rs's content_types filter).
--
-- sqlite can't alter a CHECK constraint in place, and a full table rebuild
-- isn't safe here either: videoz is referenced by foreign keys from
-- video_seasonz, entity_imagez, entity_tagz, entity_taxonz, play_eventz,
-- playback_sessionz, feed_eventz, radio_bumperz, and more, plus its own
-- self-referential parent_video_id - see migration 060's writeup of the
-- same restriction (PRAGMA foreign_keys is ignored mid-transaction, and
-- sqlx always runs a migration file inside one).
--
-- same fix as 060: edit videoz's stored schema text directly via
-- PRAGMA writable_schema, replacing only the content_type CHECK clause's
-- substring in place. no row is touched, no table is dropped.

PRAGMA writable_schema = ON;

UPDATE sqlite_master
SET sql = REPLACE(
  sql,
  'CHECK (content_type IN (''series'', ''movie'', ''clip''))',
  'CHECK (content_type IN (''series'', ''movie'', ''clip'', ''karaoke''))'
)
WHERE type = 'table' AND name = 'videoz';

-- fail loudly if the exact substring above wasn't found, rather than
-- silently no-op (see 060's identical guard for why a CHECK is used here
-- instead of RAISE()).
CREATE TEMP TABLE __migration_092_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO __migration_092_guard (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type = 'table' AND name = 'videoz' AND sql LIKE '%karaoke%'
) = 0 THEN 0 ELSE 1 END;
DROP TABLE __migration_092_guard;

PRAGMA writable_schema = OFF;

PRAGMA integrity_check;
