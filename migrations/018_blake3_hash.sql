-- add blake3 hash column for iroh-blobs integration
-- blake3 is computed on-demand or during backfill for existing files
-- used for verified streaming over P2P transport

ALTER TABLE media_blobz ADD COLUMN blake3 TEXT;

-- index for lookup by blake3 hash (iroh-blobs requests by hash)
CREATE INDEX idx_media_blobz_blake3 ON media_blobz(blake3) WHERE blake3 IS NOT NULL;
