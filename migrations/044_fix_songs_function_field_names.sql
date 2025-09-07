-- Fix field naming consistency in get_songs_with_user_preferences function
-- This ensures consistent naming between database, server API, and client JS

-- Drop the existing function
DROP FUNCTION IF EXISTS get_songs_with_user_preferences(UUID, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN);

-- Create the updated function with consistent field names
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
    duration_seconds BIGINT,
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
    is_favorite BOOLEAN,
    rating INTEGER,
    preference_updated_at TIMESTAMPTZ
) AS $$
DECLARE
    query_sql TEXT;
    order_field TEXT;
BEGIN
    -- Map client field names to database field names for ordering
    CASE p_order_by
        WHEN 'rating' THEN order_field := 'up.rating';
        WHEN 'duration_seconds' THEN order_field := 'EXTRACT(EPOCH FROM s.duration)';
        WHEN 'is_favorite' THEN order_field := 'COALESCE(up.is_favorite, false)';
        ELSE order_field := 's.' || quote_ident(p_order_by);
    END CASE;

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
           EXTRACT(EPOCH FROM s.duration)::BIGINT as duration_seconds,
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
           COALESCE(up.is_favorite, false) as is_favorite,
           up.rating as rating,
           up.updated_at as preference_updated_at
    FROM songs s
    LEFT JOIN user_song_preferences up ON s.id = up.song_id AND up.user_id = $1
    WHERE s.deleted_at IS NULL';

    -- Add favorites filter if requested
    IF p_favorites_only THEN
        query_sql := query_sql || ' AND up.is_favorite = true';
    END IF;

    -- Add ordering with proper field mapping
    query_sql := query_sql || ' ORDER BY ' || order_field || ' ' ||
        CASE WHEN upper(p_order_direction) = 'ASC' THEN 'ASC' ELSE 'DESC' END;

    -- Add pagination
    query_sql := query_sql || ' LIMIT ' || p_limit || ' OFFSET ' || p_offset;

    RETURN QUERY EXECUTE query_sql USING p_user_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_songs_with_user_preferences IS 'get songs with user-specific preference data using consistent field names for client compatibility';
