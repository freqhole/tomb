-- migration 080: index for the blake3-backfill-needed lookup pattern.
--
-- media_blobz already has a blake3 index (018_blake3_hash.sql):
--   CREATE INDEX idx_media_blobz_blake3 ON media_blobz(blake3) WHERE blake3 IS NOT NULL;
-- that's a partial index built for the "find the row with THIS blake3"
-- direction (get_media_blob_by_blake3, find_present_blake3s) - those are
-- already fast and don't need anything new.
--
-- the backfill admin flow queries the OPPOSITE direction -
-- media_blobz::list_blobs_needing_blake3/count_blobs_needing_blake3 run:
--   WHERE blake3 IS NULL AND deleted_at IS NULL ORDER BY created_at ASC
-- a partial index scoped to `blake3 IS NOT NULL` can't serve a `blake3 IS
-- NULL` query at all (opposite condition), and idx_media_blobz_deleted_at
-- is likewise scoped to `deleted_at IS NOT NULL` - so this query had no
-- usable index on either of its two filters and fell back to a full
-- table scan of media_blobz every time it ran. on a large library this is
-- the slow-query-log culprit for "media_blobz by blake3" - it's the
-- `IS NULL` half of blake3 lookups, not the equality half.
--
-- shaped to match that exact query: same two conditions in the partial
-- WHERE, and its own indexed column (created_at) matches the ORDER BY, so
-- list_blobs_needing_blake3 becomes a pure index range scan with no
-- separate sort step, and count_blobs_needing_blake3 becomes an
-- index-only count.
CREATE INDEX idx_media_blobz_needs_blake3
    ON media_blobz (created_at)
    WHERE blake3 IS NULL AND deleted_at IS NULL;
