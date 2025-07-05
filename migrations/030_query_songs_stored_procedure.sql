-- Create a comprehensive stored procedure for querying songs
-- This replaces the dynamic SQL building in the Rust code with a more efficient database-side solution

CREATE OR REPLACE FUNCTION query_songs(
    -- Basic filters
    p_artist TEXT DEFAULT NULL,
    p_album TEXT DEFAULT NULL,
    p_album_artist TEXT DEFAULT NULL,
    p_genre TEXT DEFAULT NULL,
    p_title_search TEXT DEFAULT NULL,

    -- Numeric filters
    p_year INTEGER DEFAULT NULL,
    p_rating_min INTEGER DEFAULT NULL,
    p_rating_max INTEGER DEFAULT NULL,
    p_bpm_min INTEGER DEFAULT NULL,
    p_bpm_max INTEGER DEFAULT NULL,

    -- Duration filters (in seconds)
    p_duration_min INTEGER DEFAULT NULL,
    p_duration_max INTEGER DEFAULT NULL,

    -- Boolean filters
    p_favorites_only BOOLEAN DEFAULT NULL,
    p_has_thumbnail BOOLEAN DEFAULT NULL,
    p_has_waveform BOOLEAN DEFAULT NULL,

    -- Array filters
    p_tags TEXT[] DEFAULT NULL, -- Match any of these tags

    -- Date filters
    p_created_after TIMESTAMPTZ DEFAULT NULL,
    p_updated_after TIMESTAMPTZ DEFAULT NULL,

    -- JSONB filters (could be JSON string to parse)
    p_metadata_filter JSONB DEFAULT NULL,

    -- Musical filters
    p_key_signature TEXT DEFAULT NULL,

    -- Media blob filter
    p_media_blob_id TEXT DEFAULT NULL,

    -- Pagination
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,

    -- Ordering
    p_order_by TEXT DEFAULT 'created_at',
    p_order_direction TEXT DEFAULT 'DESC'
) RETURNS TABLE(
    id UUID,
    media_blob_id VARCHAR(16),
    thumbnail_blob_id VARCHAR(16),
    waveform_blob_id VARCHAR(16),
    thumbnail_blob_ids TEXT[],
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
    rating INTEGER,
    is_favorite BOOLEAN,
    tags TEXT[],
    metadata JSONB,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT
) AS $$
DECLARE
    valid_order_columns TEXT[] := ARRAY['created_at', 'updated_at', 'title', 'artist', 'album', 'year', 'rating', 'bpm', 'duration'];
    valid_directions TEXT[] := ARRAY['ASC', 'DESC'];
    final_order_by TEXT;
    final_direction TEXT;
BEGIN
    -- Validate order_by parameter
    IF p_order_by = ANY(valid_order_columns) THEN
        final_order_by := p_order_by;
    ELSE
        final_order_by := 'created_at';
    END IF;

    -- Validate order_direction parameter
    IF UPPER(p_order_direction) = ANY(valid_directions) THEN
        final_direction := UPPER(p_order_direction);
    ELSE
        final_direction := 'DESC';
    END IF;

    RETURN QUERY EXECUTE format('
        SELECT
            s.id, s.media_blob_id, s.thumbnail_blob_id, s.waveform_blob_id, s.thumbnail_blob_ids,
            s.title, s.artist, s.album, s.album_artist, s.track_number, s.disc_number,
            s.duration, s.genre, s.year, s.bpm, s.key_signature, s.rating, s.is_favorite,
            s.tags, s.metadata, s.deleted_at, s.deleted_by, s.created_at, s.updated_at, s.version
        FROM songs s
        WHERE s.deleted_at IS NULL
        AND ($1 IS NULL OR s.artist ILIKE ''%%'' || $1 || ''%%'')
        AND ($2 IS NULL OR s.album ILIKE ''%%'' || $2 || ''%%'')
        AND ($3 IS NULL OR s.album_artist ILIKE ''%%'' || $3 || ''%%'')
        AND ($4 IS NULL OR s.genre ILIKE ''%%'' || $4 || ''%%'')
        AND ($5 IS NULL OR s.title ILIKE ''%%'' || $5 || ''%%'')
        AND ($6 IS NULL OR s.year = $6)
        AND ($7 IS NULL OR s.rating >= $7)
        AND ($8 IS NULL OR s.rating <= $8)
        AND ($9 IS NULL OR s.bpm >= $9)
        AND ($10 IS NULL OR s.bpm <= $10)
        AND ($11 IS NULL OR EXTRACT(EPOCH FROM s.duration) >= $11)
        AND ($12 IS NULL OR EXTRACT(EPOCH FROM s.duration) <= $12)
        AND ($13 IS NULL OR s.is_favorite = $13)
        AND ($14 IS NULL OR (s.thumbnail_blob_id IS NOT NULL) = $14)
        AND ($15 IS NULL OR (s.waveform_blob_id IS NOT NULL) = $15)
        AND ($16 IS NULL OR s.tags && $16)  -- Array overlap
        AND ($17 IS NULL OR s.created_at > $17)
        AND ($18 IS NULL OR s.updated_at > $18)
        AND ($19 IS NULL OR s.metadata @> $19)  -- JSONB containment
        AND ($20 IS NULL OR s.key_signature = $20)
        AND ($21 IS NULL OR s.media_blob_id = $21)
        ORDER BY %I %s
        LIMIT $22 OFFSET $23',
        final_order_by, final_direction
    ) USING
        p_artist, p_album, p_album_artist, p_genre, p_title_search,
        p_year, p_rating_min, p_rating_max, p_bpm_min, p_bpm_max,
        p_duration_min, p_duration_max, p_favorites_only,
        p_has_thumbnail, p_has_waveform, p_tags,
        p_created_after, p_updated_after, p_metadata_filter, p_key_signature,
        p_media_blob_id,
        p_limit, p_offset;
END;
$$ LANGUAGE plpgsql;

-- Add comment explaining the stored procedure
COMMENT ON FUNCTION query_songs IS 'Comprehensive song query function with filtering, pagination, and ordering capabilities - with explicit return type definition';

-- Create a helper function to validate query parameters
CREATE OR REPLACE FUNCTION validate_song_query_params(
    p_order_by TEXT DEFAULT 'created_at',
    p_order_direction TEXT DEFAULT 'DESC'
) RETURNS TABLE(valid_order_by TEXT, valid_direction TEXT) AS $$
DECLARE
    valid_order_columns TEXT[] := ARRAY['created_at', 'updated_at', 'title', 'artist', 'album', 'year', 'rating', 'bpm', 'duration'];
    valid_directions TEXT[] := ARRAY['ASC', 'DESC'];
BEGIN
    -- Validate and return sanitized parameters
    valid_order_by := CASE
        WHEN p_order_by = ANY(valid_order_columns) THEN p_order_by
        ELSE 'created_at'
    END;

    valid_direction := CASE
        WHEN UPPER(p_order_direction) = ANY(valid_directions) THEN UPPER(p_order_direction)
        ELSE 'DESC'
    END;

    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Add comment for the validation helper
COMMENT ON FUNCTION validate_song_query_params IS 'Helper function to validate and sanitize query parameters for song queries';
