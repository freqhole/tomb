-- Fix ORDER BY logic to properly group album tracks when primary sort values are similar
-- The issue is that we need to group by album/artist first, then sort by the primary field within those groups
-- This ensures tracks from the same album stay together and are ordered by disc/track number

-- Drop the existing search_songs function
DROP FUNCTION IF EXISTS search_songs CASCADE;

-- Recreate search_songs function with corrected ORDER BY logic
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
    -- parameter extraction
    p_search_query TEXT := params->>'search_query';
    p_search_type TEXT := COALESCE(params->>'search_type', 'websearch');
    p_structured_search TEXT := params->>'structured_search';
    p_artist TEXT := params->>'artist';
    p_artist_exact BOOLEAN := COALESCE((params->>'artist_exact')::BOOLEAN, FALSE);
    p_album TEXT := params->>'album';
    p_album_exact BOOLEAN := COALESCE((params->>'album_exact')::BOOLEAN, FALSE);
    p_album_artist TEXT := params->>'album_artist';
    p_genre TEXT := params->>'genre';
    p_title_search TEXT := params->>'title_search';
    p_year INTEGER := (params->>'year')::INTEGER;
    p_year_min INTEGER := (params->>'year_min')::INTEGER;
    p_year_max INTEGER := (params->>'year_max')::INTEGER;
    p_rating INTEGER := (params->>'rating')::INTEGER;
    p_rating_min INTEGER := (params->>'rating_min')::INTEGER;
    p_rating_max INTEGER := (params->>'rating_max')::INTEGER;
    p_bpm INTEGER := (params->>'bpm')::INTEGER;
    p_bpm_min INTEGER := (params->>'bpm_min')::INTEGER;
    p_bpm_max INTEGER := (params->>'bpm_max')::INTEGER;
    p_track_number INTEGER := (params->>'track_number')::INTEGER;
    p_disc_number INTEGER := (params->>'disc_number')::INTEGER;
    p_is_favorite BOOLEAN := (params->>'is_favorite')::BOOLEAN;
    p_favorites_only BOOLEAN := COALESCE((params->>'favorites_only')::BOOLEAN, FALSE);
    p_has_thumbnail BOOLEAN := (params->>'has_thumbnail')::BOOLEAN;

    -- Fixed array parameter extraction with proper null handling
    p_tags TEXT[] := CASE
        WHEN params->'tags' IS NULL OR jsonb_typeof(params->'tags') = 'null' THEN '{}'::TEXT[]
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'tags'))
    END;
    p_tags_any TEXT[] := CASE
        WHEN params->'tags_any' IS NULL OR jsonb_typeof(params->'tags_any') = 'null' THEN '{}'::TEXT[]
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'tags_any'))
    END;
    p_tags_exclude TEXT[] := CASE
        WHEN params->'tags_exclude' IS NULL OR jsonb_typeof(params->'tags_exclude') = 'null' THEN '{}'::TEXT[]
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'tags_exclude'))
    END;
    p_genres TEXT[] := CASE
        WHEN params->'genres' IS NULL OR jsonb_typeof(params->'genres') = 'null' THEN '{}'::TEXT[]
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'genres'))
    END;
    p_artists TEXT[] := CASE
        WHEN params->'artists' IS NULL OR jsonb_typeof(params->'artists') = 'null' THEN '{}'::TEXT[]
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'artists'))
    END;
    p_albums TEXT[] := CASE
        WHEN params->'albums' IS NULL OR jsonb_typeof(params->'albums') = 'null' THEN '{}'::TEXT[]
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'albums'))
    END;

    p_order_by TEXT := COALESCE(params->>'order_by', 'created_at');
    p_order_direction TEXT := COALESCE(params->>'order_direction', 'desc');
    p_limit INTEGER := COALESCE((params->>'limit')::INTEGER, 50);
    p_offset INTEGER := COALESCE((params->>'offset')::INTEGER, 0);
    p_user_id UUID := (params->>'user_id')::UUID;

    -- computed variables
    is_asc BOOLEAN := LOWER(p_order_direction) = 'asc';
BEGIN
    RETURN QUERY
    WITH base_query AS (
        SELECT
            s.id, s.media_blob_id, s.thumbnail_blob_id, s.waveform_blob_id,
            s.thumbnail_blob_ids, s.title, s.artist, s.album, s.album_artist,
            s.track_number, s.disc_number, s.duration, s.genre, s.year, s.bpm,
            s.key_signature, s.rating, s.is_favorite, s.tags, s.metadata,
            s.created_at, s.updated_at, s.version, s.search_vector,

            -- FTS ranking
            CASE
                WHEN p_search_query IS NOT NULL THEN
                    CASE p_search_type
                        WHEN 'websearch' THEN ts_rank_cd(s.search_vector, websearch_to_tsquery('english', p_search_query))
                        WHEN 'plainto' THEN ts_rank_cd(s.search_vector, plainto_tsquery('english', p_search_query))
                        WHEN 'phrase' THEN ts_rank_cd(s.search_vector, phraseto_tsquery('english', p_search_query))
                        ELSE 0.0
                    END
                ELSE 0.0
            END AS search_rank

        FROM songs s
        WHERE s.deleted_at IS NULL
    ),

    filtered_query AS (
        SELECT bq.*, COUNT(*) OVER() as total_count
        FROM base_query bq
        WHERE
            -- FTS search conditions
            (p_search_query IS NULL OR
             (p_search_type = 'websearch' AND bq.search_vector @@ websearch_to_tsquery('english', p_search_query)) OR
             (p_search_type = 'plainto' AND bq.search_vector @@ plainto_tsquery('english', p_search_query)) OR
             (p_search_type = 'phrase' AND bq.search_vector @@ phraseto_tsquery('english', p_search_query)))

            -- structured search for JSONB fields
            AND (p_structured_search IS NULL OR
                 (p_structured_search LIKE 'artist:%' AND bq.artist ILIKE '%' || SUBSTRING(p_structured_search FROM 8) || '%') OR
                 (p_structured_search LIKE 'album:%' AND bq.album ILIKE '%' || SUBSTRING(p_structured_search FROM 7) || '%') OR
                 (p_structured_search LIKE 'title:%' AND bq.title ILIKE '%' || SUBSTRING(p_structured_search FROM 7) || '%') OR
                 (p_structured_search LIKE 'genre:%' AND bq.genre ILIKE '%' || SUBSTRING(p_structured_search FROM 7) || '%'))

            -- basic filters
            AND (p_artist IS NULL OR
                 (p_artist_exact = true AND bq.artist = p_artist) OR
                 (p_artist_exact = false AND bq.artist ILIKE '%' || p_artist || '%'))
            AND (p_album IS NULL OR
                 (p_album_exact = true AND bq.album = p_album) OR
                 (p_album_exact = false AND bq.album ILIKE '%' || p_album || '%'))
            AND (p_album_artist IS NULL OR bq.album_artist ILIKE '%' || p_album_artist || '%')
            AND (p_genre IS NULL OR bq.genre ILIKE '%' || p_genre || '%')
            AND (p_title_search IS NULL OR bq.title ILIKE '%' || p_title_search || '%')

            -- numeric range filters
            AND (p_year IS NULL OR bq.year = p_year)
            AND (p_year_min IS NULL OR bq.year >= p_year_min)
            AND (p_year_max IS NULL OR bq.year <= p_year_max)
            AND (p_rating IS NULL OR bq.rating = p_rating)
            AND (p_rating_min IS NULL OR bq.rating >= p_rating_min)
            AND (p_rating_max IS NULL OR bq.rating <= p_rating_max)
            AND (p_bpm IS NULL OR bq.bpm = p_bpm)
            AND (p_bpm_min IS NULL OR bq.bpm >= p_bpm_min)
            AND (p_bpm_max IS NULL OR bq.bpm <= p_bpm_max)
            AND (p_track_number IS NULL OR bq.track_number = p_track_number)
            AND (p_disc_number IS NULL OR bq.disc_number = p_disc_number)

            -- boolean filters
            AND (p_is_favorite IS NULL OR bq.is_favorite = p_is_favorite)
            AND (p_favorites_only IS NOT TRUE OR bq.is_favorite = true)
            AND (p_has_thumbnail IS NULL OR
                 (p_has_thumbnail = true AND bq.thumbnail_blob_id IS NOT NULL) OR
                 (p_has_thumbnail = false AND bq.thumbnail_blob_id IS NULL))

            -- array filters - now safely handle empty arrays
            AND (p_tags = '{}' OR bq.tags @> p_tags)
            AND (p_tags_any = '{}' OR bq.tags && p_tags_any)
            AND (p_tags_exclude = '{}' OR NOT (bq.tags && p_tags_exclude))
            AND (p_genres = '{}' OR bq.genre = ANY(p_genres))
            AND (p_artists = '{}' OR bq.artist = ANY(p_artists))
            AND (p_albums = '{}' OR bq.album = ANY(p_albums))
    )

    SELECT
        fq.id, fq.media_blob_id, fq.thumbnail_blob_id, fq.waveform_blob_id,
        fq.thumbnail_blob_ids, fq.title, fq.artist, fq.album, fq.album_artist,
        fq.track_number, fq.disc_number, fq.duration, fq.genre, fq.year, fq.bpm,
        fq.key_signature, fq.rating, fq.is_favorite, fq.tags, fq.metadata,
        fq.created_at, fq.updated_at, fq.version, fq.search_rank, fq.total_count
    FROM filtered_query fq
    ORDER BY
        -- For created_at and updated_at, group by album then sort tracks within album
        CASE WHEN p_order_by IN ('created_at', 'updated_at') THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by IN ('created_at', 'updated_at') THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by IN ('created_at', 'updated_at') THEN COALESCE(fq.track_number, 999) END ASC,
        CASE WHEN p_order_by = 'created_at' AND is_asc THEN fq.created_at END ASC NULLS LAST,
        CASE WHEN p_order_by = 'created_at' AND NOT is_asc THEN fq.created_at END DESC NULLS LAST,
        CASE WHEN p_order_by = 'updated_at' AND is_asc THEN fq.updated_at END ASC NULLS LAST,
        CASE WHEN p_order_by = 'updated_at' AND NOT is_asc THEN fq.updated_at END DESC NULLS LAST,

        -- For other sorts, apply primary sort first, then group albums within same values
        CASE WHEN p_order_by = 'title' AND is_asc THEN fq.title END ASC NULLS LAST,
        CASE WHEN p_order_by = 'title' AND NOT is_asc THEN fq.title END DESC NULLS LAST,
        CASE WHEN p_order_by = 'title' THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'title' THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by = 'title' THEN COALESCE(fq.track_number, 999) END ASC,

        CASE WHEN p_order_by = 'artist' AND is_asc THEN fq.artist END ASC NULLS LAST,
        CASE WHEN p_order_by = 'artist' AND NOT is_asc THEN fq.artist END DESC NULLS LAST,
        CASE WHEN p_order_by = 'artist' THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'artist' THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by = 'artist' THEN COALESCE(fq.track_number, 999) END ASC,

        CASE WHEN p_order_by = 'album' AND is_asc THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'album' AND NOT is_asc THEN fq.album END DESC NULLS LAST,
        CASE WHEN p_order_by = 'album' THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by = 'album' THEN COALESCE(fq.track_number, 999) END ASC,

        CASE WHEN p_order_by = 'album_artist' AND is_asc THEN fq.album_artist END ASC NULLS LAST,
        CASE WHEN p_order_by = 'album_artist' AND NOT is_asc THEN fq.album_artist END DESC NULLS LAST,
        CASE WHEN p_order_by = 'album_artist' THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'album_artist' THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by = 'album_artist' THEN COALESCE(fq.track_number, 999) END ASC,

        CASE WHEN p_order_by = 'year' AND is_asc THEN fq.year END ASC NULLS LAST,
        CASE WHEN p_order_by = 'year' AND NOT is_asc THEN fq.year END DESC NULLS LAST,
        CASE WHEN p_order_by = 'year' THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'year' THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by = 'year' THEN COALESCE(fq.track_number, 999) END ASC,

        CASE WHEN p_order_by = 'genre' AND is_asc THEN fq.genre END ASC NULLS LAST,
        CASE WHEN p_order_by = 'genre' AND NOT is_asc THEN fq.genre END DESC NULLS LAST,
        CASE WHEN p_order_by = 'genre' THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'genre' THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by = 'genre' THEN COALESCE(fq.track_number, 999) END ASC,

        CASE WHEN p_order_by = 'rating' AND is_asc THEN fq.rating END ASC NULLS LAST,
        CASE WHEN p_order_by = 'rating' AND NOT is_asc THEN fq.rating END DESC NULLS LAST,
        CASE WHEN p_order_by = 'user_rating' AND is_asc THEN fq.rating END ASC NULLS LAST,
        CASE WHEN p_order_by = 'user_rating' AND NOT is_asc THEN fq.rating END DESC NULLS LAST,
        CASE WHEN p_order_by IN ('rating', 'user_rating') THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by IN ('rating', 'user_rating') THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by IN ('rating', 'user_rating') THEN COALESCE(fq.track_number, 999) END ASC,

        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') AND NOT is_asc THEN fq.is_favorite END DESC,
        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') AND is_asc THEN fq.is_favorite END ASC,
        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') THEN COALESCE(fq.track_number, 999) END ASC,

        -- Duration sorting should NOT group by album - pure duration order
        CASE WHEN p_order_by = 'duration_seconds' AND is_asc THEN EXTRACT(EPOCH FROM fq.duration) END ASC NULLS LAST,
        CASE WHEN p_order_by = 'duration_seconds' AND NOT is_asc THEN EXTRACT(EPOCH FROM fq.duration) END DESC NULLS LAST,

        CASE WHEN p_order_by = 'search_rank' AND is_asc THEN fq.search_rank END ASC NULLS LAST,
        CASE WHEN p_order_by = 'search_rank' AND NOT is_asc THEN fq.search_rank END DESC NULLS LAST,
        CASE WHEN p_order_by = 'search_rank' THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'search_rank' THEN COALESCE(fq.disc_number, 1) END ASC,
        CASE WHEN p_order_by = 'search_rank' THEN COALESCE(fq.track_number, 999) END ASC,

        -- Final fallback - only apply when not duration sorting
        CASE WHEN p_order_by != 'duration_seconds' THEN fq.id END ASC

    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Add comment for updated function
COMMENT ON FUNCTION search_songs IS 'Enhanced music search function with corrected ORDER BY logic for proper album grouping within time-based sorts';

-- Force plan cache invalidation
ANALYZE songs;
