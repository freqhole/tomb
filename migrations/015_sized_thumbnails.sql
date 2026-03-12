-- 015: sized thumbnails support
-- adds width/height columns for thumbnail lookup and fixes blob_type usage

-- step 1: add width and height columns for sized thumbnails
ALTER TABLE media_blobz ADD COLUMN width INTEGER;
ALTER TABLE media_blobz ADD COLUMN height INTEGER;

-- step 2: fix existing "thumbnail" blobs - these are actually full-res album art
-- the thumbnail blob_type was incorrectly used for extracted album art
-- these should be "original" since they're standalone images (not resized versions)
-- the entity relationship is tracked via song_imagez, not parent_blob_id
UPDATE media_blobz 
SET blob_type = 'original', parent_blob_id = NULL 
WHERE blob_type = 'thumbnail';

-- step 3: add index for efficient sized thumbnail lookup
-- queries will be: WHERE parent_blob_id = ? AND width = ?
CREATE INDEX idx_media_blobz_parent_size ON media_blobz(parent_blob_id, width) 
  WHERE blob_type = 'thumbnail' AND width IS NOT NULL;
