-- add filename field to media_blobz for search indexing without exposing filesystem paths
-- note: existing rows will have NULL filename until backfilled manually

-- add filename column (just the filename, not full path)
ALTER TABLE media_blobz ADD COLUMN filename TEXT;

-- create index for search performance
CREATE INDEX idx_media_blobz_filename ON media_blobz(filename) WHERE filename IS NOT NULL;
