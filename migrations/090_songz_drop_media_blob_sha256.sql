-- 090: drop songz.media_blob_sha256 (denormalized sha256 copy, unused)
--
-- the denormalized sha256 copy (migration 049) is no longer read anywhere:
-- blake3 is the real content identity now (migration 089), and
-- `get_all_song_sha256s` (the one remaining sha256 reader, backing
-- `/api/sync/sha256s`) now joins `media_blobz` directly for sha256 instead
-- of relying on this copy.
--
-- a plain `ALTER TABLE ... DROP COLUMN` is safe here: no CHECK constraint
-- or FK references this column. SQLite drops the dependent index
-- automatically along with the column, but it's dropped explicitly first
-- for clarity.
--
-- two views select from songz and must be dropped first: SQLite validates
-- every view referencing a table before allowing DROP COLUMN, and the
-- currently-installed view definitions still reference the column being
-- dropped (the app's own `run_migrations_internal` already drops every
-- view before running migrations for exactly this reason, but `sqlx
-- migrate run` via the Makefile/sqlx-cli does not - this migration must
-- be self-sufficient under both). both are recreated automatically right
-- after migrations finish (the Makefile's "creating views" step, or the
-- app's own `views::ALL` recreation loop), already updated to not select
-- this column.

DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;

DROP INDEX IF EXISTS idx_songz_media_blob_sha256;
ALTER TABLE songz DROP COLUMN media_blob_sha256;
