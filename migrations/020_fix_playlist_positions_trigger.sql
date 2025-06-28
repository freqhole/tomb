-- Fix playlist position trigger to avoid infinite loops during position swapping
-- This migration replaces the problematic maintain_playlist_positions function

-- Drop the existing trigger and function
DROP TRIGGER IF EXISTS maintain_playlist_positions_trigger ON playlist_songs;
DROP FUNCTION IF EXISTS maintain_playlist_positions();

-- Create a simple function that only handles INSERT and DELETE, not UPDATE
CREATE OR REPLACE FUNCTION maintain_playlist_positions()
RETURNS TRIGGER AS $$
BEGIN
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

    IF TG_OP = 'DELETE' THEN
        -- Close gaps in position sequence after deletion
        UPDATE playlist_songs
        SET "position" = "position" - 1
        WHERE playlist_id = OLD.playlist_id
        AND "position" > OLD."position";
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger only for INSERT and DELETE (not UPDATE)
CREATE TRIGGER maintain_playlist_positions_trigger
    BEFORE INSERT OR DELETE ON playlist_songs
    FOR EACH ROW
    EXECUTE FUNCTION maintain_playlist_positions();

-- Create a separate function for handling position reordering safely
CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
    song_id UUID;
    new_position INTEGER;
BEGIN
    -- Temporarily disable the trigger
    ALTER TABLE playlist_songs DISABLE TRIGGER maintain_playlist_positions_trigger;

    -- Update positions for all songs in the provided order
    FOR i IN 1..array_length(song_ids, 1) LOOP
        song_id := song_ids[i];
        new_position := i;

        UPDATE playlist_songs
        SET "position" = new_position
        WHERE playlist_id = target_playlist_id
        AND playlist_songs.song_id = song_id;
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

-- Add comments explaining the approach
COMMENT ON FUNCTION maintain_playlist_positions() IS
'Simplified trigger that only handles INSERT/DELETE to avoid recursive UPDATE issues';

COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Safe function for bulk reordering that temporarily disables trigger to avoid conflicts';
