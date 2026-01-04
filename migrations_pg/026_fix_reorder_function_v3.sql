-- Fix Reorder Function Unique Constraint Violations (v3)
-- This migration fixes the reorder_playlist_positions function to avoid unique constraint violations
-- when updating playlist song positions by using a single atomic UPDATE with a CTE.

-- The problem: When reordering songs, the function tries to update positions one by one,
-- which can create temporary duplicates that violate the unique constraint on (playlist_id, position).

-- The solution: Use a single atomic UPDATE with a CTE to update all positions at once.

CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
BEGIN
    -- Use a single atomic UPDATE with a CTE to avoid any intermediate constraint violations
    -- This updates all positions at once using the array index as the new position
    UPDATE playlist_songs
    SET "position" = new_positions.pos
    FROM (
        SELECT
            unnest(song_ids) as song_id,
            generate_series(1, array_length(song_ids, 1)) as pos
    ) as new_positions
    WHERE playlist_songs.playlist_id = target_playlist_id
    AND playlist_songs.song_id = new_positions.song_id;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the fix
COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Bulk reordering function that uses a single atomic UPDATE with CTE to avoid unique constraint violations by updating all positions simultaneously.';
