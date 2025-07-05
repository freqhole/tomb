-- Remove old query_songs function to prepare for FTS replacement
-- This migration cleans up the old query implementation before adding the new FTS system

-- Drop the old query_songs function and its helper
DROP FUNCTION IF EXISTS query_songs(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS validate_song_query_params(TEXT, TEXT);

-- Add comment explaining the removal
COMMENT ON SCHEMA public IS 'Removed old query_songs function in preparation for FTS system - migration 031';
