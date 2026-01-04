-- Add support for multiple thumbnail images per song
-- This migration adds an array column for storing additional thumbnail blob IDs
-- while keeping the existing thumbnail_blob_id for backward compatibility

-- Add thumbnail_blob_ids array column to songs table
ALTER TABLE songs ADD COLUMN thumbnail_blob_ids TEXT[] DEFAULT '{}';

-- Add comment for the new column
COMMENT ON COLUMN songs.thumbnail_blob_ids IS 'Array of additional thumbnail/album art image blob IDs (directory art, alternative covers, etc.)';

-- Create GIN index for efficient array operations on thumbnail_blob_ids
CREATE INDEX idx_songs_thumbnail_blob_ids ON songs USING GIN(thumbnail_blob_ids) WHERE deleted_at IS NULL;

-- Create index for songs that have multiple thumbnails
CREATE INDEX idx_songs_has_multiple_thumbnails ON songs(id) WHERE array_length(thumbnail_blob_ids, 1) > 0 AND deleted_at IS NULL;

-- Create index for songs with any thumbnails (primary or additional)
CREATE INDEX idx_songs_has_any_thumbnail ON songs(id) WHERE (thumbnail_blob_id IS NOT NULL OR array_length(thumbnail_blob_ids, 1) > 0) AND deleted_at IS NULL;
