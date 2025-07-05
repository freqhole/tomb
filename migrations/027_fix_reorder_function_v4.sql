-- Fix Reorder Function Unique Constraint Violations (v4)
-- This migration fixes the reorder_playlist_positions function to avoid unique constraint violations
-- when updating playlist song positions by temporarily dropping the unique constraint.

-- The problem: When reordering songs, even atomic UPDATE statements can create temporary duplicates
-- that violate the unique constraint on (playlist_id, position) during the update process.

-- The solution: Temporarily drop the unique constraint, perform the update, then recreate it.

CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
BEGIN
    -- Temporarily drop the unique constraint to avoid conflicts during update
    DROP INDEX IF EXISTS idx_playlist_songs_unique_position;

    -- Update all positions at once using the array index as the new position
    UPDATE playlist_songs
    SET "position" = new_positions.pos
    FROM (
        SELECT
            unnest(song_ids) as song_id,
            generate_series(1, array_length(song_ids, 1)) as pos
    ) as new_positions
    WHERE playlist_songs.playlist_id = target_playlist_id
    AND playlist_songs.song_id = new_positions.song_id;

    -- Recreate the unique constraint
    CREATE UNIQUE INDEX idx_playlist_songs_unique_position
    ON playlist_songs(playlist_id, "position");

EXCEPTION
    WHEN OTHERS THEN
        -- Make sure to recreate the constraint even if there's an error
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_songs_unique_position
        ON playlist_songs(playlist_id, "position");
        RAISE;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the fix
COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Bulk reordering function that temporarily drops the unique position constraint to avoid conflicts during the update process, then recreates it.';
