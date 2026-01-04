-- Add thumbnail_blob_ids array to videos table
-- This migration adds support for storing multiple thumbnail blob IDs for videos
-- (10 evenly spaced screenshots from the video timeline)

-- Add thumbnail_blob_ids column to videos table
ALTER TABLE videos ADD COLUMN thumbnail_blob_ids TEXT[];

-- Add comment for the new column
COMMENT ON COLUMN videos.thumbnail_blob_ids IS 'Array of thumbnail blob IDs (10 evenly spaced screenshots from video timeline)';

-- Add index for thumbnail_blob_ids array
CREATE INDEX idx_videos_thumbnail_blob_ids ON videos USING GIN(thumbnail_blob_ids) WHERE deleted_at IS NULL;

-- Add constraint to ensure thumbnail_blob_ids array is not too large (max 20 thumbnails)
ALTER TABLE videos ADD CONSTRAINT videos_thumbnail_blob_ids_max_length CHECK (array_length(thumbnail_blob_ids, 1) <= 20);
