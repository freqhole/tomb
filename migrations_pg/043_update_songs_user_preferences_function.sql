-- Update get_songs_with_user_preferences function to support pagination, ordering, and filtering
-- This fixes the parameter mismatch that was causing 500 errors in the songs API

-- Drop the existing function
DROP FUNCTION IF EXISTS get_songs_with_user_preferences(UUID);

-- Create the updated function with additional parameters
CREATE OR REPLACE FUNCTION get_songs_with_user_preferences(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0,
    p_order_by TEXT DEFAULT 'created_at',
    p_order_direction TEXT DEFAULT 'desc',
    p_favorites_only BOOLEAN DEFAULT false
)
RETURNS TABLE (
    id UUID,
    media_blob_id VARCHAR(16),
    thumbnail_blob_id VARCHAR(16),
    waveform_blob_id VARCHAR(16),
    title TEXT,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    track_number INTEGER,
    disc_number INTEGER,
    duration INTERVAL,
    genre TEXT,
    year INTEGER,
    bpm INTEGER,
    key_signature TEXT,
    tags TEXT[],
    metadata JSONB,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    user_is_favorite BOOLEAN,
    user_rating INTEGER,
    preference_updated_at TIMESTAMPTZ
) AS $$
DECLARE
    query_sql TEXT;
BEGIN
    query_sql := 'SELECT s.id,
           s.media_blob_id,
           s.thumbnail_blob_id,
           s.waveform_blob_id,
           s.title,
           s.artist,
           s.album,
           s.album_artist,
           s.track_number,
           s.disc_number,
           s.duration,
           s.genre,
           s.year,
           s.bpm,
           s.key_signature,
           s.tags,
           s.metadata,
           s.deleted_at,
           s.deleted_by,
           s.created_at,
           s.updated_at,
           s.version,
           COALESCE(up.is_favorite, false) as user_is_favorite,
           up.rating as user_rating,
           up.updated_at as preference_updated_at
    FROM songs s
    LEFT JOIN user_song_preferences up ON s.id = up.song_id AND up.user_id = $1
    WHERE s.deleted_at IS NULL';

    -- Add favorites filter if requested
    IF p_favorites_only THEN
        query_sql := query_sql || ' AND up.is_favorite = true';
    END IF;

    -- Add ordering
    query_sql := query_sql || ' ORDER BY ' || quote_ident(p_order_by) || ' ' ||
        CASE WHEN upper(p_order_direction) = 'ASC' THEN 'ASC' ELSE 'DESC' END;

    -- Add pagination
    query_sql := query_sql || ' LIMIT ' || p_limit || ' OFFSET ' || p_offset;

    RETURN QUERY EXECUTE query_sql USING p_user_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_songs_with_user_preferences IS 'get songs with user-specific preference data, supporting pagination, ordering, and filtering';
