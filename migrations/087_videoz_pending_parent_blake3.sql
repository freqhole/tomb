-- transient bookkeeping for cross-remote parent_video_id resolution (see
-- docs/backlog.md item 7f): when a movie's "extra" is synced/sent before
-- its parent movie has been synced/imported locally, the source's parent
-- video's own content blake3 is stashed here (instead of the source's raw,
-- meaningless-locally parent_video_id) so a later create_video call for
-- the actual parent - via ANY path: sync pull/push, local import, manual
-- upload - can retroactively backfill parent_video_id. cleared once
-- resolved; never exposed on the public `Video` model (internal-only,
-- mirrors how other bookkeeping-only columns on this table aren't part of
-- the domain struct).

ALTER TABLE videoz ADD COLUMN pending_parent_blake3 TEXT;

-- partial index: only rows still awaiting resolution are ever queried by
-- this column (the reconciliation lookup in create_video/update_video).
CREATE INDEX idx_videoz_pending_parent_blake3 ON videoz(pending_parent_blake3)
    WHERE pending_parent_blake3 IS NOT NULL AND deleted_at IS NULL;
