-- Smart Playlist Positions Trigger
-- This migration creates a smarter trigger design that only handles INSERT operations
-- and doesn't interfere with DELETE operations, avoiding race conditions.

-- Create a smarter trigger function that only handles INSERT (auto-positioning)
-- and doesn't interfere with DELETE operations
CREATE OR REPLACE FUNCTION auto_assign_playlist_position()
RETURNS TRIGGER AS $$
BEGIN
    -- Only handle INSERT operations
    IF TG_OP = 'INSERT' THEN
        -- If no position specified, add to end
        IF NEW."position" IS NULL THEN
            SELECT COALESCE(MAX("position"), 0) + 1
            INTO NEW."position"
            FROM playlist_songs
            WHERE playlist_id = NEW.playlist_id;
        END IF;
        RETURN NEW;
    END IF;

    -- For all other operations, just pass through
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create the new trigger only for INSERT operations
CREATE TRIGGER auto_assign_playlist_position_trigger
    BEFORE INSERT ON playlist_songs
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_playlist_position();

-- Update the reorder_playlist_positions function to not try to disable non-existent trigger
CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
    current_song_id UUID;
    new_position INTEGER;
BEGIN
    -- No need to disable triggers since we only have an INSERT trigger now

    -- Update positions for all songs in the provided order
    FOR i IN 1..array_length(song_ids, 1) LOOP
        current_song_id := song_ids[i];
        new_position := i;

        UPDATE playlist_songs
        SET "position" = new_position
        WHERE playlist_id = target_playlist_id
        AND playlist_songs.song_id = current_song_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Add comments explaining the new approach
COMMENT ON FUNCTION auto_assign_playlist_position() IS
'Smart trigger that only handles INSERT operations for auto-positioning. DELETE cleanup is handled by application code to avoid race conditions.';

COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Bulk reordering function that works safely with the INSERT-only trigger design.';

COMMENT ON TABLE playlist_songs IS
'Many-to-many relationship between playlists and songs. Position auto-assignment handled by INSERT trigger, position cleanup handled by application code.';
