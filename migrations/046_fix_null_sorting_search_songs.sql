-- Fix NULL handling in search_songs function sorting
-- This ensures NULLs are always sorted last and improves favorites grouping

-- Drop the existing search_songs function
DROP FUNCTION IF EXISTS search_songs CASCADE;

-- Recreate search_songs function with proper NULL handling in sorting
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
    -- extract all parameters from JSONB with proper typing and defaults
    p_user_id UUID := (params->>'user_id')::UUID;
    p_search_query TEXT := params->>'search_query';
    p_search_type TEXT := COALESCE(params->>'search_type', 'websearch');
    p_structured_search TEXT := params->>'structured_search';
    p_artist TEXT := params->>'artist';
    p_artist_exact BOOLEAN := COALESCE((params->>'artist_exact')::BOOLEAN, false);
    p_album TEXT := params->>'album';
    p_album_exact BOOLEAN := COALESCE((params->>'album_exact')::BOOLEAN, false);
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
    p_duration_seconds BIGINT := (params->>'duration_seconds')::BIGINT;
    p_duration_min INTEGER := (params->>'duration_min')::INTEGER;
    p_duration_max INTEGER := (params->>'duration_max')::INTEGER;
    p_track_number INTEGER := (params->>'track_number')::INTEGER;
    p_disc_number INTEGER := (params->>'disc_number')::INTEGER;
    p_is_favorite BOOLEAN := (params->>'is_favorite')::BOOLEAN;
    p_favorites_only BOOLEAN := COALESCE((params->>'favorites_only')::BOOLEAN, false);
    p_has_thumbnail BOOLEAN := (params->>'has_thumbnail')::BOOLEAN;
    p_has_lyrics BOOLEAN := (params->>'has_lyrics')::BOOLEAN;
    p_has_waveform BOOLEAN := (params->>'has_waveform')::BOOLEAN;
    p_is_compilation BOOLEAN := (params->>'is_compilation')::BOOLEAN;
    p_tags TEXT[] := CASE
        WHEN params->>'tags' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'tags'))
    END;
    p_tags_any TEXT[] := CASE
        WHEN params->>'tags_any' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'tags_any'))
    END;
    p_tags_exclude TEXT[] := CASE
        WHEN params->>'tags_exclude' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'tags_exclude'))
    END;
    p_genres TEXT[] := CASE
        WHEN params->>'genres' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'genres'))
    END;
    p_artists TEXT[] := CASE
        WHEN params->>'artists' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'artists'))
    END;
    p_albums TEXT[] := CASE
        WHEN params->>'albums' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'albums'))
    END;
    p_file_format TEXT := params->>'file_format';
    p_file_formats TEXT[] := CASE
        WHEN params->>'file_formats' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'file_formats'))
    END;
    p_bitrate_min INTEGER := (params->>'bitrate_min')::INTEGER;
    p_bitrate_max INTEGER := (params->>'bitrate_max')::INTEGER;
    p_created_after TIMESTAMPTZ := (params->>'created_after')::TIMESTAMPTZ;
    p_created_before TIMESTAMPTZ := (params->>'created_before')::TIMESTAMPTZ;
    p_updated_after TIMESTAMPTZ := (params->>'updated_after')::TIMESTAMPTZ;
    p_updated_before TIMESTAMPTZ := (params->>'updated_before')::TIMESTAMPTZ;
    p_added_after TIMESTAMPTZ := (params->>'added_after')::TIMESTAMPTZ;
    p_added_before TIMESTAMPTZ := (params->>'added_before')::TIMESTAMPTZ;
    p_key_signature TEXT := params->>'key_signature';
    p_key_signatures TEXT[] := CASE
        WHEN params->>'key_signatures' IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(params->'key_signatures'))
    END;
    p_mood TEXT := params->>'mood';
    p_playlist_id TEXT := params->>'playlist_id';
    p_not_in_playlist TEXT := params->>'not_in_playlist';
    p_include_deleted BOOLEAN := COALESCE((params->>'include_deleted')::BOOLEAN, false);
    p_media_blob_id TEXT := params->>'media_blob_id';
    p_metadata_filter JSONB := params->'metadata_filter';
    p_limit INTEGER := COALESCE((params->>'limit')::INTEGER, 50);
    p_offset INTEGER := COALESCE((params->>'offset')::INTEGER, 0);
    p_order_by TEXT := COALESCE(params->>'order_by', 'created_at');
    p_sort_direction TEXT := COALESCE(params->>'sort_direction', 'desc');

    is_asc BOOLEAN;
BEGIN
    -- determine if ascending order
    is_asc := LOWER(p_sort_direction) = 'asc';

    RETURN QUERY
    WITH base_query AS (
        SELECT
            s.id,
            s.media_blob_id,
            s.thumbnail_blob_id,
            s.waveform_blob_id,
            CASE
                WHEN s.thumbnail_blob_id IS NOT NULL THEN ARRAY[s.thumbnail_blob_id]
                ELSE ARRAY[]::TEXT[]
            END as thumbnail_blob_ids,
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
            -- use user preferences when user_id provided, fallback to legacy columns
            CASE
                WHEN p_user_id IS NOT NULL THEN COALESCE(up.rating, NULL)
                ELSE s.rating
            END as rating,
            CASE
                WHEN p_user_id IS NOT NULL THEN COALESCE(up.is_favorite, false)
                ELSE COALESCE(s.is_favorite, false)
            END as is_favorite,
            s.tags,
            s.metadata,
            s.created_at,
            s.updated_at,
            s.version,
            -- search ranking logic
            CASE
                WHEN p_search_query IS NOT NULL THEN
                    ts_rank(
                        setweight(to_tsvector('english', COALESCE(s.title, '')), 'A') ||
                        setweight(to_tsvector('english', COALESCE(s.artist, '')), 'B') ||
                        setweight(to_tsvector('english', COALESCE(s.album, '')), 'C'),
                        websearch_to_tsquery('english', p_search_query)
                    )
                ELSE 1.0
            END as search_rank
        FROM songs s
        LEFT JOIN user_song_preferences up ON s.id = up.song_id AND up.user_id = p_user_id
        WHERE s.deleted_at IS NULL OR p_include_deleted = true
    ),
    filtered_query AS (
        SELECT *,
               COUNT(*) OVER() as total_count
        FROM base_query bq
        WHERE
            -- text search filters
            (p_search_query IS NULL OR
             (setweight(to_tsvector('english', COALESCE(bq.title, '')), 'A') ||
              setweight(to_tsvector('english', COALESCE(bq.artist, '')), 'B') ||
              setweight(to_tsvector('english', COALESCE(bq.album, '')), 'C')) @@
              websearch_to_tsquery('english', p_search_query))

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

            -- array filters
            AND (p_tags IS NULL OR bq.tags && p_tags)
            AND (p_tags_any IS NULL OR bq.tags && p_tags_any)
            AND (p_tags_exclude IS NULL OR NOT (bq.tags && p_tags_exclude))

            -- date filters
            AND (p_created_after IS NULL OR bq.created_at >= p_created_after)
            AND (p_created_before IS NULL OR bq.created_at <= p_created_before)
            AND (p_updated_after IS NULL OR bq.updated_at >= p_updated_after)
            AND (p_updated_before IS NULL OR bq.updated_at <= p_updated_before)
    )
    SELECT
        fq.id,
        fq.media_blob_id,
        fq.thumbnail_blob_id,
        fq.waveform_blob_id,
        fq.thumbnail_blob_ids,
        fq.title,
        fq.artist,
        fq.album,
        fq.album_artist,
        fq.track_number,
        fq.disc_number,
        fq.duration,
        fq.genre,
        fq.year,
        fq.bpm,
        fq.key_signature,
        fq.rating,
        fq.is_favorite,
        fq.tags,
        fq.metadata,
        fq.created_at,
        fq.updated_at,
        fq.version,
        fq.search_rank,
        fq.total_count
    FROM filtered_query fq
    ORDER BY
        -- Title sorting with NULLS LAST
        CASE WHEN p_order_by = 'title' AND is_asc THEN fq.title END ASC NULLS LAST,
        CASE WHEN p_order_by = 'title' AND NOT is_asc THEN fq.title END DESC NULLS LAST,

        -- Artist sorting with NULLS LAST
        CASE WHEN p_order_by = 'artist' AND is_asc THEN fq.artist END ASC NULLS LAST,
        CASE WHEN p_order_by = 'artist' AND NOT is_asc THEN fq.artist END DESC NULLS LAST,

        -- Album sorting with NULLS LAST
        CASE WHEN p_order_by = 'album' AND is_asc THEN fq.album END ASC NULLS LAST,
        CASE WHEN p_order_by = 'album' AND NOT is_asc THEN fq.album END DESC NULLS LAST,

        -- Year sorting with NULLS LAST
        CASE WHEN p_order_by = 'year' AND is_asc THEN fq.year END ASC NULLS LAST,
        CASE WHEN p_order_by = 'year' AND NOT is_asc THEN fq.year END DESC NULLS LAST,

        -- Rating sorting with NULLS LAST
        CASE WHEN p_order_by = 'rating' AND is_asc THEN fq.rating END ASC NULLS LAST,
        CASE WHEN p_order_by = 'rating' AND NOT is_asc THEN fq.rating END DESC NULLS LAST,
        CASE WHEN p_order_by = 'user_rating' AND is_asc THEN fq.rating END ASC NULLS LAST,
        CASE WHEN p_order_by = 'user_rating' AND NOT is_asc THEN fq.rating END DESC NULLS LAST,

        -- Favorites sorting - favorites first for DESC, non-favorites first for ASC, with proper secondary sort
        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') AND NOT is_asc THEN fq.is_favorite END DESC,
        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') AND is_asc THEN fq.is_favorite END ASC,

        -- Duration sorting with NULLS LAST
        CASE WHEN p_order_by = 'duration_seconds' AND is_asc THEN EXTRACT(EPOCH FROM fq.duration) END ASC NULLS LAST,
        CASE WHEN p_order_by = 'duration_seconds' AND NOT is_asc THEN EXTRACT(EPOCH FROM fq.duration) END DESC NULLS LAST,

        -- Search rank sorting with NULLS LAST
        CASE WHEN p_order_by = 'search_rank' AND is_asc THEN fq.search_rank END ASC NULLS LAST,
        CASE WHEN p_order_by = 'search_rank' AND NOT is_asc THEN fq.search_rank END DESC NULLS LAST,

        -- Date sorting with NULLS LAST
        CASE WHEN p_order_by = 'created_at' AND is_asc THEN fq.created_at END ASC NULLS LAST,
        CASE WHEN p_order_by = 'created_at' AND NOT is_asc THEN fq.created_at END DESC NULLS LAST,
        CASE WHEN p_order_by = 'updated_at' AND is_asc THEN fq.updated_at END ASC NULLS LAST,
        CASE WHEN p_order_by = 'updated_at' AND NOT is_asc THEN fq.updated_at END DESC NULLS LAST,

        -- Secondary sort for favorites: when sorting by favorites, also sort by title within each group
        CASE WHEN p_order_by IN ('user_is_favorite', 'is_favorite') THEN fq.title END ASC NULLS LAST,

        -- Default fallback
        fq.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- add comment for updated function
COMMENT ON FUNCTION search_songs IS 'search songs with proper NULL handling - all NULLs sorted last, favorites grouped properly with secondary sorting';
