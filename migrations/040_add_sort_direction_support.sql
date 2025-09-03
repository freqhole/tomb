-- Add sort direction support to search_songs function
-- This migration updates the function to properly handle ASC/DESC sorting

-- Drop the existing function
DROP FUNCTION IF EXISTS search_songs(
    TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT, TEXT[], INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, INTEGER, INTEGER, TEXT
);

-- Enhanced search_songs function with sort direction support
CREATE OR REPLACE FUNCTION search_songs(
    -- === TEXT SEARCH ===
    p_search_query TEXT DEFAULT NULL,
    p_search_type TEXT DEFAULT 'websearch',
    p_structured_search TEXT DEFAULT NULL,

    -- === BASIC FILTERS ===
    p_artist TEXT DEFAULT NULL,
    p_artist_exact BOOLEAN DEFAULT FALSE,
    p_album TEXT DEFAULT NULL,
    p_album_exact BOOLEAN DEFAULT FALSE,
    p_album_artist TEXT DEFAULT NULL,
    p_genre TEXT DEFAULT NULL,
    p_title_search TEXT DEFAULT NULL,

    -- === NUMERIC RANGE FILTERS ===
    p_year INTEGER DEFAULT NULL,
    p_year_min INTEGER DEFAULT NULL,
    p_year_max INTEGER DEFAULT NULL,
    p_rating INTEGER DEFAULT NULL,
    p_rating_min INTEGER DEFAULT NULL,
    p_rating_max INTEGER DEFAULT NULL,
    p_bpm INTEGER DEFAULT NULL,
    p_bpm_min INTEGER DEFAULT NULL,
    p_bpm_max INTEGER DEFAULT NULL,
    p_duration_seconds BIGINT DEFAULT NULL,
    p_duration_min INTEGER DEFAULT NULL,
    p_duration_max INTEGER DEFAULT NULL,
    p_track_number INTEGER DEFAULT NULL,
    p_disc_number INTEGER DEFAULT NULL,

    -- === BOOLEAN FILTERS ===
    p_is_favorite BOOLEAN DEFAULT NULL,
    p_favorites_only BOOLEAN DEFAULT NULL,
    p_has_thumbnail BOOLEAN DEFAULT NULL,
    p_has_lyrics BOOLEAN DEFAULT NULL,
    p_has_waveform BOOLEAN DEFAULT NULL,
    p_is_compilation BOOLEAN DEFAULT NULL,

    -- === ARRAY/MULTI-VALUE FILTERS ===
    p_tags TEXT[] DEFAULT NULL,
    p_tags_any TEXT[] DEFAULT NULL,
    p_tags_exclude TEXT[] DEFAULT NULL,
    p_genres TEXT[] DEFAULT NULL,
    p_artists TEXT[] DEFAULT NULL,
    p_albums TEXT[] DEFAULT NULL,

    -- === FILE/TECHNICAL FILTERS ===
    p_file_format TEXT DEFAULT NULL,
    p_file_formats TEXT[] DEFAULT NULL,
    p_bitrate_min INTEGER DEFAULT NULL,
    p_bitrate_max INTEGER DEFAULT NULL,

    -- === DATE FILTERS ===
    p_created_after TIMESTAMPTZ DEFAULT NULL,
    p_created_before TIMESTAMPTZ DEFAULT NULL,
    p_updated_after TIMESTAMPTZ DEFAULT NULL,
    p_updated_before TIMESTAMPTZ DEFAULT NULL,
    p_added_after TIMESTAMPTZ DEFAULT NULL,
    p_added_before TIMESTAMPTZ DEFAULT NULL,

    -- === ADVANCED FILTERS ===
    p_key_signature TEXT DEFAULT NULL,
    p_key_signatures TEXT[] DEFAULT NULL,
    p_mood TEXT DEFAULT NULL,

    -- === LIBRARY MANAGEMENT ===
    p_playlist_id TEXT DEFAULT NULL,
    p_not_in_playlist TEXT DEFAULT NULL,

    -- === RESPONSE OPTIONS ===
    p_include_deleted BOOLEAN DEFAULT FALSE,

    -- === LEGACY FIELDS ===
    p_media_blob_id TEXT DEFAULT NULL,
    p_metadata_filter JSONB DEFAULT NULL,

    -- === PAGINATION AND ORDERING ===
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_order_by TEXT DEFAULT 'created_at',
    p_sort_direction TEXT DEFAULT 'desc'  -- NEW: sort direction parameter
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
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    search_rank REAL,
    total_count BIGINT
) AS $$
DECLARE
    sort_direction_modifier INTEGER;
BEGIN
    -- Determine sort direction multiplier (1 for ASC, -1 for DESC)
    sort_direction_modifier := CASE WHEN LOWER(p_sort_direction) = 'asc' THEN 1 ELSE -1 END;

    RETURN QUERY
    WITH base_query AS (
        SELECT
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
            s.year,
            s.bpm,
            s.key_signature,
            s.rating,
            s.is_favorite,
            s.tags,
            s.metadata,
            s.created_at,
            s.updated_at,
            s.version,
            CASE
                WHEN p_search_query IS NOT NULL AND trim(p_search_query) != '' THEN
                    CASE p_search_type
                        WHEN 'websearch' THEN
                            ts_rank(to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, '')),
                                    websearch_to_tsquery('english', p_search_query))
                        WHEN 'phrase' THEN
                            ts_rank(to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, '')),
                                    phraseto_tsquery('english', p_search_query))
                        ELSE -- 'plainto'
                            ts_rank(to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, '')),
                                    plainto_tsquery('english', p_search_query))
                    END
                ELSE 0.0
            END AS search_rank,
            COUNT(*) OVER() AS total_count
        FROM songs s
        LEFT JOIN playlist_songs ps ON (p_playlist_id IS NOT NULL AND s.id = ps.song_id AND ps.playlist_id = p_playlist_id::UUID)
        WHERE
            -- Soft deletion
            (p_include_deleted OR s.deleted_at IS NULL) AND

            -- === TEXT SEARCH ===
            (p_search_query IS NULL OR trim(p_search_query) = '' OR
                CASE p_search_type
                    WHEN 'websearch' THEN
                        to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, ''))
                        @@ websearch_to_tsquery('english', p_search_query)
                    WHEN 'phrase' THEN
                        to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, ''))
                        @@ phraseto_tsquery('english', p_search_query)
                    ELSE -- 'plainto'
                        to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, ''))
                        @@ plainto_tsquery('english', p_search_query)
                END) AND

            -- === BASIC FILTERS ===
            (p_artist IS NULL OR
                CASE WHEN COALESCE(p_artist_exact, FALSE)
                    THEN s.artist = p_artist
                    ELSE s.artist ILIKE '%' || p_artist || '%'
                END) AND
            (p_album IS NULL OR
                CASE WHEN COALESCE(p_album_exact, FALSE)
                    THEN s.album = p_album
                    ELSE s.album ILIKE '%' || p_album || '%'
                END) AND
            (p_album_artist IS NULL OR s.album_artist ILIKE '%' || p_album_artist || '%') AND
            (p_genre IS NULL OR s.genre = p_genre) AND
            (p_title_search IS NULL OR s.title ILIKE '%' || p_title_search || '%') AND

            -- === NUMERIC FILTERS ===
            (p_year IS NULL OR s.year = p_year) AND
            (p_year_min IS NULL OR s.year >= p_year_min) AND
            (p_year_max IS NULL OR s.year <= p_year_max) AND
            (p_rating IS NULL OR s.rating = p_rating) AND
            (p_rating_min IS NULL OR s.rating >= p_rating_min) AND
            (p_rating_max IS NULL OR s.rating <= p_rating_max) AND
            (p_bpm IS NULL OR s.bpm = p_bpm) AND
            (p_bpm_min IS NULL OR s.bpm >= p_bpm_min) AND
            (p_bpm_max IS NULL OR s.bpm <= p_bpm_max) AND
            (p_duration_seconds IS NULL OR EXTRACT(EPOCH FROM s.duration) = p_duration_seconds) AND
            (p_duration_min IS NULL OR EXTRACT(EPOCH FROM s.duration) >= p_duration_min) AND
            (p_duration_max IS NULL OR EXTRACT(EPOCH FROM s.duration) <= p_duration_max) AND
            (p_track_number IS NULL OR s.track_number = p_track_number) AND
            (p_disc_number IS NULL OR s.disc_number = p_disc_number) AND

            -- === BOOLEAN FILTERS ===
            (p_is_favorite IS NULL OR s.is_favorite = p_is_favorite) AND
            (p_favorites_only IS NULL OR NOT p_favorites_only OR s.is_favorite = TRUE) AND
            (p_has_thumbnail IS NULL OR
                (p_has_thumbnail AND s.thumbnail_blob_id IS NOT NULL) OR
                (NOT p_has_thumbnail AND s.thumbnail_blob_id IS NULL)) AND
            (p_has_lyrics IS NULL OR
                (p_has_lyrics AND s.metadata->>'lyrics' IS NOT NULL AND s.metadata->>'lyrics' != '') OR
                (NOT p_has_lyrics AND (s.metadata->>'lyrics' IS NULL OR s.metadata->>'lyrics' = ''))) AND
            (p_has_waveform IS NULL OR
                (p_has_waveform AND s.waveform_blob_id IS NOT NULL) OR
                (NOT p_has_waveform AND s.waveform_blob_id IS NULL)) AND
            (p_is_compilation IS NULL OR
                (p_is_compilation AND (s.metadata->>'is_compilation')::BOOLEAN = TRUE) OR
                (NOT p_is_compilation AND COALESCE((s.metadata->>'is_compilation')::BOOLEAN, FALSE) = FALSE)) AND

            -- === ARRAY FILTERS ===
            (p_tags IS NULL OR array_length(p_tags, 1) = 0 OR s.tags @> p_tags) AND
            (p_tags_any IS NULL OR array_length(p_tags_any, 1) = 0 OR s.tags && p_tags_any) AND
            (p_tags_exclude IS NULL OR array_length(p_tags_exclude, 1) = 0 OR NOT (s.tags && p_tags_exclude)) AND
            (p_genres IS NULL OR array_length(p_genres, 1) = 0 OR s.genre = ANY(p_genres)) AND
            (p_artists IS NULL OR array_length(p_artists, 1) = 0 OR s.artist = ANY(p_artists)) AND
            (p_albums IS NULL OR array_length(p_albums, 1) = 0 OR s.album = ANY(p_albums)) AND

            -- === FILE/TECHNICAL FILTERS ===
            (p_file_format IS NULL OR s.metadata->>'file_format' = p_file_format OR s.metadata->>'codec' = p_file_format) AND
            (p_file_formats IS NULL OR array_length(p_file_formats, 1) = 0 OR s.metadata->>'file_format' = ANY(p_file_formats) OR s.metadata->>'codec' = ANY(p_file_formats)) AND
            (p_bitrate_min IS NULL OR (s.metadata->>'bitrate')::INTEGER >= p_bitrate_min) AND
            (p_bitrate_max IS NULL OR (s.metadata->>'bitrate')::INTEGER <= p_bitrate_max) AND

            -- === DATE FILTERS ===
            (p_created_after IS NULL OR s.created_at >= p_created_after) AND
            (p_created_before IS NULL OR s.created_at <= p_created_before) AND
            (p_updated_after IS NULL OR s.updated_at >= p_updated_after) AND
            (p_updated_before IS NULL OR s.updated_at <= p_updated_before) AND
            (p_added_after IS NULL OR s.created_at >= p_added_after) AND
            (p_added_before IS NULL OR s.created_at <= p_added_before) AND

            -- === ADVANCED FILTERS ===
            (p_key_signature IS NULL OR s.key_signature = p_key_signature) AND
            (p_key_signatures IS NULL OR array_length(p_key_signatures, 1) = 0 OR s.key_signature = ANY(p_key_signatures)) AND
            (p_mood IS NULL OR s.metadata->>'mood' = p_mood) AND

            -- === LIBRARY MANAGEMENT ===
            (p_playlist_id IS NULL OR ps.song_id IS NOT NULL) AND
            (p_not_in_playlist IS NULL OR NOT EXISTS (
                SELECT 1 FROM playlist_songs ps2
                WHERE ps2.song_id = s.id AND ps2.playlist_id = p_not_in_playlist::UUID
            )) AND

            -- === LEGACY FILTERS ===
            (p_media_blob_id IS NULL OR s.media_blob_id = p_media_blob_id) AND
            (p_metadata_filter IS NULL OR s.metadata @> p_metadata_filter)
    )
    SELECT
        bq.id,
        bq.media_blob_id,
        bq.thumbnail_blob_id,
        bq.waveform_blob_id,
        bq.thumbnail_blob_ids,
        bq.title,
        bq.artist,
        bq.album,
        bq.album_artist,
        bq.track_number,
        bq.disc_number,
        bq.duration,
        bq.genre,
        bq.year,
        bq.bpm,
        bq.key_signature,
        bq.rating,
        bq.is_favorite,
        bq.tags,
        bq.metadata,
        bq.created_at,
        bq.updated_at,
        bq.version,
        bq.search_rank,
        bq.total_count
    FROM base_query bq
    ORDER BY
        CASE p_order_by
            WHEN 'relevance' THEN
                CASE WHEN p_search_query IS NOT NULL AND trim(p_search_query) != ''
                    THEN bq.search_rank * sort_direction_modifier * -1  -- relevance is typically DESC by nature
                    ELSE EXTRACT(EPOCH FROM bq.created_at) * sort_direction_modifier * -1
                END
            WHEN 'year' THEN COALESCE(bq.year, 0) * sort_direction_modifier * -1
            WHEN 'rating' THEN COALESCE(bq.rating, 0) * sort_direction_modifier * -1
            WHEN 'duration' THEN EXTRACT(EPOCH FROM bq.duration) * sort_direction_modifier * -1
            WHEN 'duration_seconds' THEN EXTRACT(EPOCH FROM bq.duration) * sort_direction_modifier * -1
            WHEN 'created_at' THEN EXTRACT(EPOCH FROM bq.created_at) * sort_direction_modifier * -1
            WHEN 'updated_at' THEN EXTRACT(EPOCH FROM bq.updated_at) * sort_direction_modifier * -1
            ELSE EXTRACT(EPOCH FROM bq.created_at) * sort_direction_modifier * -1
        END,
        -- Handle text fields with proper direction
        CASE WHEN p_order_by IN ('title', 'artist', 'album') AND LOWER(p_sort_direction) = 'desc' THEN
            CASE p_order_by
                WHEN 'title' THEN bq.title
                WHEN 'artist' THEN bq.artist
                WHEN 'album' THEN bq.album
                ELSE NULL
            END
        ELSE NULL END DESC NULLS LAST,
        CASE WHEN p_order_by IN ('title', 'artist', 'album') AND LOWER(p_sort_direction) = 'asc' THEN
            CASE p_order_by
                WHEN 'title' THEN bq.title
                WHEN 'artist' THEN bq.artist
                WHEN 'album' THEN bq.album
                ELSE NULL
            END
        ELSE NULL END ASC NULLS LAST,
        -- Secondary sorting for artist and album
        CASE WHEN p_order_by = 'artist' THEN bq.album ELSE NULL END ASC NULLS LAST,
        CASE WHEN p_order_by IN ('artist', 'album') THEN bq.track_number ELSE NULL END ASC NULLS LAST,
        bq.created_at DESC
    LIMIT COALESCE(p_limit, 100)
    OFFSET COALESCE(p_offset, 0);
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION search_songs IS 'Enhanced song search with total count and proper sort direction support (ASC/DESC)';
