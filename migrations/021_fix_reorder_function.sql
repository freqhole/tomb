-- Fix ambiguous column reference in reorder_playlist_positions function

DROP FUNCTION IF EXISTS reorder_playlist_positions(UUID, UUID[]);

-- Create a corrected function for handling position reordering safely
CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
    current_song_id UUID;
    new_position INTEGER;
BEGIN
    -- Temporarily disable the trigger
    ALTER TABLE playlist_songs DISABLE TRIGGER maintain_playlist_positions_trigger;

    -- Update positions for all songs in the provided order
    FOR i IN 1..array_length(song_ids, 1) LOOP
        current_song_id := song_ids[i];
        new_position := i;

        UPDATE playlist_songs
        SET "position" = new_position
        WHERE playlist_id = target_playlist_id
        AND playlist_songs.song_id = current_song_id;
    END LOOP;

    -- Re-enable the trigger
    ALTER TABLE playlist_songs ENABLE TRIGGER maintain_playlist_positions_trigger;

EXCEPTION
    WHEN OTHERS THEN
        -- Re-enable trigger even if there's an error
        ALTER TABLE playlist_songs ENABLE TRIGGER maintain_playlist_positions_trigger;
        RAISE;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the function
COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Safe function for bulk reordering that temporarily disables trigger to avoid conflicts';
