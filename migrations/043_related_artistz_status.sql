-- 043_related_artistz_status.sql
--
-- adds `status` to `related_artistz` so the bulk enrichment review
-- wizard (phase 11 — slice 4c) can gate auto-written related-artist
-- relations behind explicit user accept.
--
-- prior to this migration every row written by the lastfm / audiodb /
-- mb processors was effectively "live" the moment it landed — we
-- showed those rows in `RelatedArtists` UI immediately. that's a lot
-- of noise (each source returns 20-100 candidates per artist), and
-- many are obvious mismatches.
--
-- with this column:
--   * existing rows are backfilled to `accepted` so nothing currently
--     visible disappears from the UI.
--   * new INSERTs default to `pending` — the review wizard now picks
--     up the new rows in `propose_related_artists` and the user
--     decides which ones to accept.
--   * the upsert ON CONFLICT path preserves the existing status so a
--     re-fetch from the source never downgrades an already-accepted
--     row back to pending.

ALTER TABLE related_artistz ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted'));

-- backfill: every row that existed before this migration is treated
-- as accepted (they were already visible to the user, and we don't
-- want to flood the review queue with historical rows).
UPDATE related_artistz SET status = 'accepted';

CREATE INDEX IF NOT EXISTS idx_related_artistz_status_pending
    ON related_artistz(source_artist_id, status)
    WHERE status = 'pending' AND deleted_at IS NULL;
