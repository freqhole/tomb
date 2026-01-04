-- Add sub_genres array field to songs table
-- This migration adds a flexible sub_genres field for user-defined genre tags

-- Add sub_genres array field to songs table
ALTER TABLE songs ADD COLUMN sub_genres TEXT[] DEFAULT '{}';

-- Add GIN index for sub_genres array searches
CREATE INDEX idx_songs_sub_genres ON songs USING GIN(sub_genres) WHERE deleted_at IS NULL;

-- Add comment
COMMENT ON COLUMN songs.sub_genres IS 'User-defined sub-genre tags (flexible array of strings)';
