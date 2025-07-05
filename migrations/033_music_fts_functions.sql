-- Enhanced song search functions with FTS and structured search capabilities
-- This migration adds the main search_songs function and helper functions

-- Enhanced song search function with FTS - replaces the old query_songs function
CREATE OR REPLACE FUNCTION search_songs(
    p_search_query TEXT DEFAULT NULL,
    p_search_type TEXT DEFAULT 'websearch', -- 'websearch', 'plainto', 'phrase'
    p_structured_search TEXT DEFAULT NULL, -- 'key:value' format for JSONB field searches

    -- All existing filters (maintains full compatibility)
    p_artist TEXT DEFAULT NULL,
    p_album TEXT DEFAULT NULL,
    p_album_artist TEXT DEFAULT NULL,
    p_genre TEXT DEFAULT NULL,
    p_title_search TEXT DEFAULT NULL,
    p_year INTEGER DEFAULT NULL,
    p_rating_min INTEGER DEFAULT NULL,
    p_rating_max INTEGER DEFAULT NULL,
    p_bpm_min INTEGER DEFAULT NULL,
    p_bpm_max INTEGER DEFAULT NULL,
    p_duration_min INTEGER DEFAULT NULL,
    p_duration_max INTEGER DEFAULT NULL,
    p_favorites_only BOOLEAN DEFAULT NULL,
    p_has_thumbnail BOOLEAN DEFAULT NULL,
    p_has_waveform BOOLEAN DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_created_after TIMESTAMPTZ DEFAULT NULL,
    p_updated_after TIMESTAMPTZ DEFAULT NULL,
    p_metadata_filter JSONB DEFAULT NULL,
    p_key_signature TEXT DEFAULT NULL,
    p_media_blob_id TEXT DEFAULT NULL,

    -- Pagination and ordering
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_order_by TEXT DEFAULT 'relevance' -- 'relevance', 'created_at', 'title', etc.
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
    version BIGINT,
    search_rank REAL -- FTS relevance score
) AS $$
DECLARE
    search_tsquery tsquery;
    order_clause TEXT;
    structured_key TEXT;
    structured_value TEXT;
    structured_condition TEXT := '';
BEGIN
    -- Build search query if provided
    IF p_search_query IS NOT NULL THEN
        search_tsquery := CASE p_search_type
            WHEN 'websearch' THEN websearch_to_tsquery('english', p_search_query)
            WHEN 'plainto' THEN plainto_tsquery('english', p_search_query)
            WHEN 'phrase' THEN phraseto_tsquery('english', p_search_query)
            ELSE websearch_to_tsquery('english', p_search_query)
        END;
    END IF;

    -- Parse structured search if provided (format: "key:value")
    IF p_structured_search IS NOT NULL THEN
        IF p_structured_search LIKE '%:%' THEN
            structured_key := split_part(p_structured_search, ':', 1);
            structured_value := split_part(p_structured_search, ':', 2);

            -- Handle different field types
            CASE structured_key
                WHEN 'has' THEN
                    -- Existence check: has:lyrics
                    structured_condition := format('AND s.metadata ? %L', structured_value);
                WHEN 'artist' THEN
                    -- Artist column search: artist:pink
                    structured_condition := format('AND s.artist ILIKE %L', '%' || structured_value || '%');
                WHEN 'title' THEN
                    -- Title column search: title:love
                    structured_condition := format('AND s.title ILIKE %L', '%' || structured_value || '%');
                WHEN 'album' THEN
                    -- Album column search: album:greatest
                    structured_condition := format('AND s.album ILIKE %L', '%' || structured_value || '%');
                WHEN 'genre' THEN
                    -- Genre column search: genre:rock
                    structured_condition := format('AND s.genre ILIKE %L', '%' || structured_value || '%');
                WHEN 'album_artist' THEN
                    -- Album artist column search: album_artist:various
                    structured_condition := format('AND s.album_artist ILIKE %L', '%' || structured_value || '%');
                ELSE
                    -- Default: JSONB metadata search
                    structured_condition := format('AND s.metadata @> %L',
                        jsonb_build_object(structured_key, structured_value));
            END CASE;
        END IF;
    END IF;

    -- Build order clause
    order_clause := CASE p_order_by
        WHEN 'relevance' THEN
            CASE WHEN p_search_query IS NOT NULL THEN 'search_rank DESC, created_at DESC'
                 ELSE 'created_at DESC'
            END
        WHEN 'created_at' THEN 'created_at DESC'
        WHEN 'title' THEN 'title ASC'
        WHEN 'artist' THEN 'artist ASC, album ASC, track_number ASC'
        WHEN 'album' THEN 'album ASC, track_number ASC'
        WHEN 'rating' THEN 'rating DESC NULLS LAST, created_at DESC'
        ELSE 'created_at DESC'
    END;

    RETURN QUERY EXECUTE format('
        SELECT
            s.id, s.media_blob_id, s.thumbnail_blob_id, s.waveform_blob_id, s.thumbnail_blob_ids,
            s.title, s.artist, s.album, s.album_artist, s.track_number, s.disc_number,
            s.duration, s.genre, s.year, s.bpm, s.key_signature, s.rating, s.is_favorite,
            s.tags, s.metadata, s.deleted_at, s.deleted_by, s.created_at, s.updated_at, s.version,
            CASE WHEN $1 IS NOT NULL THEN ts_rank(s.search_vector, $1) ELSE 0 END as search_rank
        FROM songs s
        WHERE s.deleted_at IS NULL
        AND ($1 IS NULL OR s.search_vector @@ $1)
        AND ($2 IS NULL OR s.artist ILIKE ''%%'' || $2 || ''%%'')
        AND ($3 IS NULL OR s.album ILIKE ''%%'' || $3 || ''%%'')
        AND ($4 IS NULL OR s.album_artist ILIKE ''%%'' || $4 || ''%%'')
        AND ($5 IS NULL OR s.genre ILIKE ''%%'' || $5 || ''%%'')
        AND ($6 IS NULL OR s.title ILIKE ''%%'' || $6 || ''%%'')
        AND ($7 IS NULL OR s.year = $7)
        AND ($8 IS NULL OR s.rating >= $8)
        AND ($9 IS NULL OR s.rating <= $9)
        AND ($10 IS NULL OR s.bpm >= $10)
        AND ($11 IS NULL OR s.bpm <= $11)
        AND ($12 IS NULL OR EXTRACT(EPOCH FROM s.duration) >= $12)
        AND ($13 IS NULL OR EXTRACT(EPOCH FROM s.duration) <= $13)
        AND ($14 IS NULL OR s.is_favorite = $14)
        AND ($15 IS NULL OR (s.thumbnail_blob_id IS NOT NULL) = $15)
        AND ($16 IS NULL OR (s.waveform_blob_id IS NOT NULL) = $16)
        AND ($17 IS NULL OR s.tags && $17)
        AND ($18 IS NULL OR s.created_at > $18)
        AND ($19 IS NULL OR s.updated_at > $19)
        AND ($20 IS NULL OR s.metadata @> $20)
        AND ($21 IS NULL OR s.key_signature = $21)
        AND ($22 IS NULL OR s.media_blob_id = $22)
        %s
        ORDER BY %s
        LIMIT $23 OFFSET $24',
        structured_condition,
        order_clause
    ) USING
        search_tsquery,
        p_artist, p_album, p_album_artist, p_genre, p_title_search,
        p_year, p_rating_min, p_rating_max, p_bpm_min, p_bpm_max,
        p_duration_min, p_duration_max, p_favorites_only,
        p_has_thumbnail, p_has_waveform, p_tags,
        p_created_after, p_updated_after, p_metadata_filter, p_key_signature,
        p_media_blob_id,
        p_limit, p_offset;
END;
$$ LANGUAGE plpgsql;

-- Enhanced search suggestions function with improved matching and word extraction
CREATE OR REPLACE FUNCTION get_search_suggestions(
    p_partial_query TEXT,
    p_limit INTEGER DEFAULT 10
) RETURNS TABLE(
    suggestion TEXT,
    category TEXT,
    frequency INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT sug.suggestion, sug.category, sug.frequency
    FROM (
        -- Artist suggestions (partial match anywhere)
        SELECT DISTINCT s.artist as suggestion, 'artist' as category,
               COUNT(*)::INTEGER as frequency
        FROM songs s
        WHERE s.deleted_at IS NULL
          AND s.artist ILIKE '%' || p_partial_query || '%'
          AND s.artist IS NOT NULL
          AND LENGTH(s.artist) > 0
        GROUP BY s.artist
        HAVING COUNT(*) > 0

        UNION ALL

        -- Album suggestions (partial match anywhere)
        SELECT DISTINCT s.album as suggestion, 'album' as category,
               COUNT(*)::INTEGER as frequency
        FROM songs s
        WHERE s.deleted_at IS NULL
          AND s.album ILIKE '%' || p_partial_query || '%'
          AND s.album IS NOT NULL
          AND LENGTH(s.album) > 0
        GROUP BY s.album
        HAVING COUNT(*) > 0

        UNION ALL

        -- Full title suggestions (partial match anywhere)
        SELECT DISTINCT s.title as suggestion, 'title' as category,
               COUNT(*)::INTEGER as frequency
        FROM songs s
        WHERE s.deleted_at IS NULL
          AND s.title ILIKE '%' || p_partial_query || '%'
          AND s.title IS NOT NULL
          AND LENGTH(s.title) > 0
        GROUP BY s.title
        HAVING COUNT(*) > 0

        UNION ALL

        -- Individual word suggestions from titles
        SELECT DISTINCT word as suggestion, 'word' as category,
               COUNT(*)::INTEGER as frequency
        FROM (
            SELECT unnest(string_to_array(lower(s.title), ' ')) as word
            FROM songs s
            WHERE s.deleted_at IS NULL
              AND s.title IS NOT NULL
              AND LENGTH(s.title) > 0
        ) words
        WHERE word ILIKE p_partial_query || '%'
          AND LENGTH(word) >= 3  -- Only suggest words 3+ characters
          AND word NOT IN ('the', 'and', 'or', 'but', 'for', 'nor', 'yet', 'so', 'a', 'an', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'be', 'is', 'it', 'he', 'she', 'we', 'you', 'they', 'was', 'were', 'been', 'have', 'has', 'had', 'do', 'did', 'does', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall')
        GROUP BY word
        HAVING COUNT(*) > 0

        UNION ALL

        -- Genre suggestions (partial match anywhere)
        SELECT DISTINCT s.genre as suggestion, 'genre' as category,
               COUNT(*)::INTEGER as frequency
        FROM songs s
        WHERE s.deleted_at IS NULL
          AND s.genre ILIKE '%' || p_partial_query || '%'
          AND s.genre IS NOT NULL
          AND LENGTH(s.genre) > 0
        GROUP BY s.genre
        HAVING COUNT(*) > 0

        UNION ALL

        -- Playlist title suggestions (partial match anywhere)
        SELECT DISTINCT p.title as suggestion, 'playlist' as category,
               COUNT(*)::INTEGER as frequency
        FROM playlists p
        WHERE p.deleted_at IS NULL
          AND p.title ILIKE '%' || p_partial_query || '%'
          AND p.title IS NOT NULL
          AND LENGTH(p.title) > 0
        GROUP BY p.title
        HAVING COUNT(*) > 0
    ) sug
    ORDER BY
        -- Prioritize exact matches at the beginning
        CASE WHEN lower(sug.suggestion) LIKE lower(p_partial_query) || '%' THEN 1 ELSE 2 END,
        -- Then by frequency (popularity)
        sug.frequency DESC,
        -- Then alphabetically
        sug.suggestion ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Simple playlist search function
CREATE OR REPLACE FUNCTION search_playlists(
    p_search_query TEXT DEFAULT NULL,
    p_search_type TEXT DEFAULT 'websearch',
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE(
    id UUID,
    media_blob_id VARCHAR(16),
    thumbnail_blob_id VARCHAR(16),
    title TEXT,
    description TEXT,
    client_id TEXT,
    is_public BOOLEAN,
    is_collaborative BOOLEAN,
    metadata JSONB,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    search_rank REAL
) AS $$
DECLARE
    search_tsquery tsquery;
BEGIN
    -- Build search query if provided
    IF p_search_query IS NOT NULL THEN
        search_tsquery := CASE p_search_type
            WHEN 'websearch' THEN websearch_to_tsquery('english', p_search_query)
            WHEN 'plainto' THEN plainto_tsquery('english', p_search_query)
            WHEN 'phrase' THEN phraseto_tsquery('english', p_search_query)
            ELSE websearch_to_tsquery('english', p_search_query)
        END;
    END IF;

    RETURN QUERY
    SELECT
        p.id, p.media_blob_id, p.thumbnail_blob_id, p.title, p.description,
        p.client_id, p.is_public, p.is_collaborative, p.metadata,
        p.deleted_at, p.deleted_by, p.created_at, p.updated_at, p.version,
        CASE WHEN search_tsquery IS NOT NULL THEN ts_rank(p.search_vector, search_tsquery) ELSE 0 END as search_rank
    FROM playlists p
    WHERE p.deleted_at IS NULL
      AND (search_tsquery IS NULL OR p.search_vector @@ search_tsquery)
    ORDER BY
        CASE WHEN search_tsquery IS NOT NULL THEN ts_rank(p.search_vector, search_tsquery) END DESC NULLS LAST,
        p.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON FUNCTION search_songs IS 'Enhanced song search with FTS, structured search, and compatibility with old query_songs parameters';
COMMENT ON FUNCTION get_search_suggestions IS 'Enhanced search suggestions with partial matching, word extraction, and better ranking for autocomplete functionality';
COMMENT ON FUNCTION search_playlists IS 'Full-text search for playlists with relevance ranking';
