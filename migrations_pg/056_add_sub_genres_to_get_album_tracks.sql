-- Add sub_genres to get_album_tracks function
-- This migration updates the get_album_tracks function to include sub_genres in its return table

-- Drop the existing function
DROP FUNCTION IF EXISTS get_album_tracks(TEXT, TEXT);

-- Recreate the function with sub_genres field
CREATE OR REPLACE FUNCTION get_album_tracks(
    album_name TEXT,
    artist_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    song_id UUID,
    title TEXT,
    artist TEXT,
    disc_number INTEGER,
    track_number INTEGER,
    duration INTERVAL,
    genre TEXT,
    sub_genres TEXT[],
    year INTEGER,
    rating INTEGER,
    is_favorite BOOLEAN,
    media_blob_id VARCHAR(16),
    thumbnail_id VARCHAR(16),
    waveform_id VARCHAR(16)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        s.artist,
        s.disc_number,
        s.track_number,
        s.duration,
        s.genre,
        s.sub_genres,
        s.year,
        s.rating,
        s.is_favorite,
        s.media_blob_id,
        s.thumbnail_blob_id,
        s.waveform_blob_id
    FROM songs s
    WHERE s.deleted_at IS NULL
    AND s.album = album_name
    AND (artist_name IS NULL OR s.album_artist = artist_name OR s.artist = artist_name)
    ORDER BY
        s.disc_number NULLS LAST,
        s.track_number NULLS LAST,
        s.title;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION get_album_tracks IS 'Get all tracks for an album with sub_genres support, ordered by disc and track number';
