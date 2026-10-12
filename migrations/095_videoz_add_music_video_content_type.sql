-- 095: extend videoz.content_type CHECK to allow 'music_video'
--
-- adds a fifth content type alongside series/movie/clip/karaoke. like
-- karaoke, a music video is standalone content that points at an artist +
-- album (see migration 096) rather than at a series.
--
-- same in-place schema-text edit as 060/092 (see 092's writeup for why a
-- table rebuild isn't safe here): only the content_type CHECK clause's
-- substring is replaced, no row is touched and no table is dropped.

PRAGMA writable_schema = ON;

UPDATE sqlite_master
SET sql = REPLACE(
  sql,
  'CHECK (content_type IN (''series'', ''movie'', ''clip'', ''karaoke''))',
  'CHECK (content_type IN (''series'', ''movie'', ''clip'', ''karaoke'', ''music_video''))'
)
WHERE type = 'table' AND name = 'videoz';

-- fail loudly if the exact substring above wasn't found (see 060/092's
-- identical guard).
CREATE TEMP TABLE __migration_095_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO __migration_095_guard (ok)
SELECT CASE WHEN (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type = 'table' AND name = 'videoz' AND sql LIKE '%music_video%'
) = 0 THEN 0 ELSE 1 END;
DROP TABLE __migration_095_guard;

-- RESET (rather than plain OFF) also reloads the connection's in-memory
-- schema: sqlx runs every migration on one connection, and without a
-- reload the next migration's ALTER TABLE videoz would rewrite the stored
-- schema text using stale character offsets and corrupt it.
PRAGMA writable_schema = RESET;

PRAGMA integrity_check;
