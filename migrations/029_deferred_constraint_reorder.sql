-- Deferred Constraint Reorder Function
-- This migration creates a simple reorder function that uses deferred constraints
-- to properly handle unique constraint violations during playlist reordering.

-- The problem: Unique constraints are checked immediately during UPDATE operations
-- The solution: Use deferred constraints that are only checked at transaction commit

-- First, drop the existing unique index and replace it with a deferred constraint
DROP INDEX IF EXISTS idx_playlist_songs_unique_position;

-- Create a deferred unique constraint instead
ALTER TABLE playlist_songs
ADD CONSTRAINT playlist_songs_unique_position
UNIQUE (playlist_id, "position")
DEFERRABLE INITIALLY DEFERRED;

-- Now create a simple reorder function that works with deferred constraints
CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
BEGIN
    -- Simple UPDATE - the deferred constraint allows temporary duplicates
    -- during the transaction, only checking at commit time
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

-- Add comment explaining the deferred constraint approach
COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Simple bulk reordering function that works with deferred unique constraints to avoid intermediate constraint violations.';

COMMENT ON CONSTRAINT playlist_songs_unique_position ON playlist_songs IS
'Deferred unique constraint that allows temporary duplicates during transactions, only checking at commit time.';
