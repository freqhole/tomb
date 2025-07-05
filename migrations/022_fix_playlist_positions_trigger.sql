-- Fix Playlist Positions Trigger
-- This migration removes the problematic maintain_playlist_positions trigger that causes
-- unique constraint violations when deleting songs from playlists.

-- The trigger conflicts with the Rust code's position management in remove_songs_from_playlist()
-- which already handles position reordering correctly using ROW_NUMBER().

-- Drop the problematic trigger
DROP TRIGGER IF EXISTS maintain_playlist_positions_trigger ON playlist_songs;

-- Drop the function as well since it's no longer needed
DROP FUNCTION IF EXISTS maintain_playlist_positions();

-- Add comment explaining the change
COMMENT ON TABLE playlist_songs IS 'Many-to-many relationship between playlists and songs. Position management is handled by application code to avoid race conditions.';

-- The reorder_playlist_positions function is kept as it's used by the bulk reordering feature
-- and properly handles trigger disabling/enabling during its execution.
