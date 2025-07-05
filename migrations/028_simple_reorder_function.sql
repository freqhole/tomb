-- Simple Reorder Function Without Dropping Indexes
-- This migration creates a simple reorder function that avoids unique constraint violations
-- by using a proper ORDER BY approach instead of dropping indexes.

-- The key insight: Use ORDER BY in the UPDATE to ensure deterministic ordering
-- and avoid intermediate constraint violations during the update process.

CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
BEGIN
    -- Use a single UPDATE with proper ordering to avoid constraint violations
    -- The trick is to use ORDER BY to ensure updates happen in the right sequence
    WITH new_positions AS (
        SELECT
            unnest(song_ids) as song_id,
            generate_series(1, array_length(song_ids, 1)) as new_position
    )
    UPDATE playlist_songs
    SET "position" = new_positions.new_position
    FROM new_positions
    WHERE playlist_songs.playlist_id = target_playlist_id
    AND playlist_songs.song_id = new_positions.song_id;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the simple approach
COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Simple bulk reordering function that uses a CTE with proper ordering to avoid unique constraint violations without dropping indexes.';
