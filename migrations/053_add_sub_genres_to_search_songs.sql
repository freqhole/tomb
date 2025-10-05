-- Add sub_genres to search_songs function
-- This migration updates the search_songs function to include sub_genres in its return table

-- Drop the existing search_songs function
DROP FUNCTION IF EXISTS search_songs CASCADE;

-- Recreate search_songs function with sub_genres field
CREATE OR REPLACE FUNCTION search_songs(params JSONB DEFAULT '{}'::JSONB)
RETURNS TABLE(
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
    sub_genres TEXT[],
    year INTEGER,
    bpm INTEGER,
    key_signature TEXT,
    rating INTEGER,
    is_favorite BOOLEAN,
    tags TEXT[],
    metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    search_rank REAL,
    total_count BIGINT
) AS $$
DECLARE
    -- search parameters
    p_user_id UUID := (params->>'user_id')::UUID;
    p_search_query TEXT := params->>'q';
    p_search_type TEXT := COALESCE(params->>'search_type', 'websearch');
    p_structured_search TEXT := params->>'structured_search';

    -- basic filters
    p_artist TEXT := params->>'artist';
    p_album TEXT := params->>'album';
    p_album_artist TEXT := params->>'album_artist';
    p_genre TEXT := params->>'genre';
    p_title_search TEXT := params->>'title_search';

    -- numeric filters
    p_year INTEGER := (params->>'year')::INTEGER;
    p_rating_min INTEGER := (params->>'rating_min')::INTEGER;
    p_rating_max INTEGER := (params->>'rating_max')::INTEGER;
    p_bpm_min INTEGER := (params->>'bpm_min')::INTEGER;
    p_bpm_max INTEGER := (params->>'bpm_max')::INTEGER;

    -- boolean filters
    p_is_favorite BOOLEAN := (params->>'is_favorite')::BOOLEAN;
    p_favorites_only BOOLEAN := (params->>'favorites_only')::BOOLEAN;

    -- array filters
    p_tags TEXT[] := CASE
        WHEN params ? 'tags' THEN
            ARRAY(SELECT jsonb_array_elements_text(params->'tags'))
        ELSE NULL
    END;

    -- null filters
    p_null_artist BOOLEAN := (params->>'null_artist')::BOOLEAN;
    p_null_album BOOLEAN := (params->>'null_album')::BOOLEAN;
    p_null_genre BOOLEAN := (params->>'null_genre')::BOOLEAN;
    p_null_year BOOLEAN := (params->>'null_year')::BOOLEAN;
    p_null_rating BOOLEAN := (params->>'null_rating')::BOOLEAN;

    -- pagination
    p_limit INTEGER := COALESCE((params->>'limit')::INTEGER, 50);
    p_offset INTEGER := COALESCE((params->>'offset')::INTEGER, 0);

    -- sorting
    p_order_by TEXT := COALESCE(params->>'order_by', 'created_at');
    p_order_direction TEXT := COALESCE(params->>'order_direction', 'desc');

    -- internal variables
    base_query TEXT;
    where_conditions TEXT[] := ARRAY[]::TEXT[];
    order_clause TEXT;
    final_query TEXT;
    total_count_val BIGINT;
BEGIN
    -- build base query with all fields including sub_genres
    base_query := '
        SELECT DISTINCT ON (s.id)
            s.id,
            s.media_blob_id,
            s.thumbnail_blob_id,
            s.waveform_blob_id,
            s.thumbnail_blob_ids,
            s.title,
            s.artist,
            s.album,
            s.album_artist,
            s.track_number,
            s.disc_number,
            s.duration,
            s.genre,
            s.sub_genres,
            s.year,
            s.bpm,
            s.key_signature,
            COALESCE(up.rating, s.rating) as rating,
            COALESCE(up.is_favorite, s.is_favorite) as is_favorite,
            s.tags,
            s.metadata,
            s.created_at,
            s.updated_at,
            s.version
        FROM songs s
        LEFT JOIN user_song_preferences up ON s.id = up.song_id AND up.user_id = $1
        WHERE s.deleted_at IS NULL
    ';

    -- add search conditions
    IF p_search_query IS NOT NULL AND p_search_query != '' THEN
        CASE p_search_type
            WHEN 'websearch' THEN
                where_conditions := array_append(where_conditions,
                    '(to_tsvector(''english'', COALESCE(s.title, '''') || '' '' || COALESCE(s.artist, '''') || '' '' || COALESCE(s.album, '''')) @@ websearch_to_tsquery(''english'', ''' || replace(p_search_query, '''', '''''') || '''))');
            WHEN 'plainto' THEN
                where_conditions := array_append(where_conditions,
                    '(to_tsvector(''english'', COALESCE(s.title, '''') || '' '' || COALESCE(s.artist, '''') || '' '' || COALESCE(s.album, '''')) @@ plainto_tsquery(''english'', ''' || replace(p_search_query, '''', '''''') || '''))');
            WHEN 'phrase' THEN
                where_conditions := array_append(where_conditions,
                    '(to_tsvector(''english'', COALESCE(s.title, '''') || '' '' || COALESCE(s.artist, '''') || '' '' || COALESCE(s.album, '''')) @@ phraseto_tsquery(''english'', ''' || replace(p_search_query, '''', '''''') || '''))');
        END CASE;
    END IF;

    -- add filters
    IF p_artist IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.artist ILIKE ''%' || replace(p_artist, '''', '''''') || '%''');
    END IF;

    IF p_album IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.album ILIKE ''%' || replace(p_album, '''', '''''') || '%''');
    END IF;

    IF p_album_artist IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.album_artist ILIKE ''%' || replace(p_album_artist, '''', '''''') || '%''');
    END IF;

    IF p_genre IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.genre ILIKE ''%' || replace(p_genre, '''', '''''') || '%''');
    END IF;

    IF p_title_search IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.title ILIKE ''%' || replace(p_title_search, '''', '''''') || '%''');
    END IF;

    IF p_year IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.year = ' || p_year);
    END IF;

    IF p_rating_min IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 'COALESCE(up.rating, s.rating) >= ' || p_rating_min);
    END IF;

    IF p_rating_max IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 'COALESCE(up.rating, s.rating) <= ' || p_rating_max);
    END IF;

    IF p_bpm_min IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.bpm >= ' || p_bpm_min);
    END IF;

    IF p_bpm_max IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.bpm <= ' || p_bmp_max);
    END IF;

    IF p_is_favorite IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 'COALESCE(up.is_favorite, s.is_favorite) = ' || p_is_favorite);
    END IF;

    IF p_favorites_only = true THEN
        where_conditions := array_append(where_conditions, 'COALESCE(up.is_favorite, s.is_favorite) = true');
    END IF;

    IF p_tags IS NOT NULL THEN
        where_conditions := array_append(where_conditions, 's.tags && ARRAY[' || array_to_string(ARRAY(SELECT '''' || replace(unnest(p_tags), '''', '''''') || ''''), ',') || ']');
    END IF;

    -- null filters
    IF p_null_artist = true THEN
        where_conditions := array_append(where_conditions, 's.artist IS NULL');
    ELSIF p_null_artist = false THEN
        where_conditions := array_append(where_conditions, 's.artist IS NOT NULL');
    END IF;

    IF p_null_album = true THEN
        where_conditions := array_append(where_conditions, 's.album IS NULL');
    ELSIF p_null_album = false THEN
        where_conditions := array_append(where_conditions, 's.album IS NOT NULL');
    END IF;

    IF p_null_genre = true THEN
        where_conditions := array_append(where_conditions, 's.genre IS NULL');
    ELSIF p_null_genre = false THEN
        where_conditions := array_append(where_conditions, 's.genre IS NOT NULL');
    END IF;

    IF p_null_year = true THEN
        where_conditions := array_append(where_conditions, 's.year IS NULL');
    ELSIF p_null_year = false THEN
        where_conditions := array_append(where_conditions, 's.year IS NOT NULL');
    END IF;

    IF p_null_rating = true THEN
        where_conditions := array_append(where_conditions, 'COALESCE(up.rating, s.rating) IS NULL');
    ELSIF p_null_rating = false THEN
        where_conditions := array_append(where_conditions, 'COALESCE(up.rating, s.rating) IS NOT NULL');
    END IF;

    -- build where clause
    IF array_length(where_conditions, 1) > 0 THEN
        base_query := base_query || ' AND ' || array_to_string(where_conditions, ' AND ');
    END IF;

    -- build order clause
    order_clause := CASE p_order_by
        WHEN 'title' THEN 'ORDER BY s.title ' || p_order_direction || ' NULLS LAST'
        WHEN 'artist' THEN 'ORDER BY s.artist ' || p_order_direction || ' NULLS LAST'
        WHEN 'album' THEN 'ORDER BY s.album ' || p_order_direction || ' NULLS LAST'
        WHEN 'year' THEN 'ORDER BY s.year ' || p_order_direction || ' NULLS LAST'
        WHEN 'rating' THEN 'ORDER BY COALESCE(up.rating, s.rating) ' || p_order_direction || ' NULLS LAST'
        WHEN 'created_at' THEN 'ORDER BY s.created_at ' || p_order_direction
        WHEN 'updated_at' THEN 'ORDER BY s.updated_at ' || p_order_direction
        WHEN 'duration_seconds' THEN 'ORDER BY EXTRACT(EPOCH FROM s.duration) ' || p_order_direction || ' NULLS LAST'
        ELSE 'ORDER BY s.created_at DESC'
    END;

    -- get total count
    EXECUTE 'SELECT COUNT(*) FROM (' || base_query || ') AS count_query'
    USING p_user_id INTO total_count_val;

    -- build final query with pagination
    final_query := base_query || ' ' || order_clause || ' LIMIT ' || p_limit || ' OFFSET ' || p_offset;

    -- return results with search_rank and total_count
    RETURN QUERY EXECUTE '
        SELECT
            q.*,
            1.0::REAL as search_rank,
            ' || total_count_val || '::BIGINT as total_count
        FROM (' || final_query || ') q
    ' USING p_user_id;

END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION search_songs IS 'Enhanced music search function with sub_genres support, smart album grouping, and comprehensive filtering';
