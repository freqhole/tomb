-- 044_drop_album_review_status.sql
--
-- phase 11.x bulk-review cleanup: the dedicated `review_status` /
-- `reviewed_at` lifecycle on `albumz` (added in migration 042) is
-- being collapsed into the existing `mb_lookup_status` enum. the
-- bulk-enrichment review wizard now writes `mb_lookup_status =
-- 'enriched'` on save and `mb_lookup_status = 'skipped'` on skip,
-- and the library filter chip reads off the same column. there's no
-- meaningful state on `albumz` that wasn't either redundant with
-- `mb_lookup_status` (`pending` ~= not-yet-enriched/skipped) or
-- duplicative of `updated_at` (`reviewed_at`).
--
-- drop:
--   * idx_albumz_review_status (the partial index on the column)
--   * albumz.review_status (TEXT NOT NULL DEFAULT 'pending')
--   * albumz.reviewed_at (INTEGER NULL)
--   * album_query_view (recreated by `grimoire::database::ensure_views`
--     on the next connect, sourced from
--     migrations/views/album_query_view.sql which has been updated to
--     stop projecting the two columns)

DROP INDEX IF EXISTS idx_albumz_review_status;

-- ALL views that reference `albumz` must be dropped before the column
-- drop, because sqlite re-validates view DDL against the post-alter
-- schema. that means a stale `feed_query_view` (or any other view that
-- still references columns long since dropped from `albumz` — in
-- practice `release_date` from migration 039 — would fail validation
-- during this ALTER even though we're not touching those columns).
-- the bootstrap path (`grimoire::database::ensure_views`) recreates
-- every view from the up-to-date `migrations/views/*.sql` on the next
-- connect, so dropping them here is safe and self-healing.
DROP VIEW IF EXISTS feed_query_view;
DROP VIEW IF EXISTS playlist_song_query_view;
DROP VIEW IF EXISTS playlist_query_view;
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS artist_query_view;

ALTER TABLE albumz DROP COLUMN review_status;
ALTER TABLE albumz DROP COLUMN reviewed_at;
