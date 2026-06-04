-- 042_album_review_status.sql
--
-- adds `review_status` + `reviewed_at` to `albumz` so the bulk
-- enrichment review wizard (phase 11) can filter its candidate set to
-- pending albums and flip them to `complete` when the user finishes
-- per-album review. `dismissed` is a third state for albums the user
-- explicitly skipped (manually re-includable from the album editor).
--
-- albums created before this migration default to `pending`; the wizard
-- will surface them all on first open. existing per-album taxon edits
-- (via `AlbumEditorModal` or direct taxonomy routes) do NOT auto-flip
-- `review_status`; the flag is owned by the bulk-review flow.

ALTER TABLE albumz ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'complete', 'dismissed'));

ALTER TABLE albumz ADD COLUMN reviewed_at INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_albumz_review_status
    ON albumz(review_status)
    WHERE deleted_at IS NULL;

-- album_query_view needs to be recreated to project the two new
-- columns. drop here; the bootstrap path
-- (`grimoire::database::ensure_views`) recreates it from
-- `migrations/views/album_query_view.sql` on next connect.
DROP VIEW IF EXISTS album_query_view;
