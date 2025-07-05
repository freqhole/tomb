-- Fix Reorder Function Unique Constraint Violations (v2)
-- This migration fixes the reorder_playlist_positions function to avoid unique constraint violations
-- when updating playlist song positions by using large positive numbers as temporary values.

-- The problem: When reordering songs, the function tries to update positions one by one,
-- which can create temporary duplicates that violate the unique constraint on (playlist_id, position).

-- The solution: Use a two-step approach with large temporary positive positions to avoid conflicts.

CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
    current_song_id UUID;
    new_position INTEGER;
    temp_offset INTEGER := 100000; -- Large offset to avoid conflicts
BEGIN
    -- Step 1: Set all positions to large temporary values to avoid conflicts
    -- This ensures no duplicates exist during the transition
    FOR i IN 1..array_length(song_ids, 1) LOOP
        current_song_id := song_ids[i];

        UPDATE playlist_songs
        SET "position" = temp_offset + i  -- Use large temporary positions
        WHERE playlist_id = target_playlist_id
        AND song_id = current_song_id;
    END LOOP;

    -- Step 2: Update to final positions
    -- Now we can safely set the final positions without conflicts
    FOR i IN 1..array_length(song_ids, 1) LOOP
        current_song_id := song_ids[i];
        new_position := i;

        UPDATE playlist_songs
        SET "position" = new_position
        WHERE playlist_id = target_playlist_id
        AND song_id = current_song_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the fix
COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Bulk reordering function that uses large temporary positive positions to avoid unique constraint violations during the update process.';
