-- denormalize videoz's media blob blake3 hash onto the row itself,
-- mirroring how songz already does this for its own media blob fields
-- (see 049_songz_denormalize_media_blob.sql). a video's media_blob_id is
-- content-addressed and immutable once created, so it's safe to copy
-- blake3 onto videoz directly instead of joining media_blobz on every
-- read - lets client code resolve a video's content hash (for p2p
-- verified streaming, sync, send-to-remote) without a separate
-- blob-metadata round-trip.
--
-- nullable for now: rows created before this migration are backfilled
-- below; new rows populate this column at insert time going forward.

ALTER TABLE videoz ADD COLUMN media_blob_blake3 TEXT;

-- partial index: every real lookup path filters `deleted_at IS NULL`
-- alongside the blake3 match (mirrors songz's own repository query shape),
-- so excluding soft-deleted rows keeps this index smaller/faster than a
-- plain column index would be.
CREATE INDEX idx_videoz_media_blob_blake3 ON videoz(media_blob_blake3) WHERE deleted_at IS NULL;

UPDATE videoz
SET media_blob_blake3 = (SELECT blake3 FROM media_blobz WHERE media_blobz.id = videoz.media_blob_id)
WHERE media_blob_blake3 IS NULL;
