-- Add music search function for searching both songs and playlists together
-- This migration adds a function to search across both songs and playlists in a single query

-- Music search function that combines songs and playlists
CREATE OR REPLACE FUNCTION music_search(
    p_search_query TEXT,
    p_search_type TEXT DEFAULT 'websearch', -- 'websearch', 'plainto', 'phrase'
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE(
    result_type TEXT,
    id UUID,
    title TEXT,
    subtitle TEXT,
    description TEXT,
    media_blob_id VARCHAR(16),
    thumbnail_blob_id VARCHAR(16),
    search_rank REAL,
    metadata JSONB,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    search_tsquery tsquery;
BEGIN
    -- Build search query
    search_tsquery := CASE p_search_type
        WHEN 'websearch' THEN websearch_to_tsquery('english', p_search_query)
        WHEN 'plainto' THEN plainto_tsquery('english', p_search_query)
        WHEN 'phrase' THEN phraseto_tsquery('english', p_search_query)
        ELSE websearch_to_tsquery('english', p_search_query)
    END;

    RETURN QUERY
    (
        -- Songs
        SELECT
            'song'::TEXT as result_type,
            s.id,
            s.title,
            COALESCE(s.artist, 'Unknown Artist') || ' - ' || COALESCE(s.album, 'Unknown Album') as subtitle,
            s.genre as description,
            s.media_blob_id,
            s.thumbnail_blob_id,
            ts_rank(s.search_vector, search_tsquery) as search_rank,
            s.metadata,
            s.created_at,
            s.updated_at
        FROM songs s
        WHERE s.deleted_at IS NULL
          AND s.search_vector @@ search_tsquery

        UNION ALL

        -- Playlists
        SELECT
            'playlist'::TEXT as result_type,
            p.id,
            p.title,
            COALESCE(p.description, 'No description') as subtitle,
            'Playlist' as description,
            p.media_blob_id,
            p.thumbnail_blob_id,
            ts_rank(p.search_vector, search_tsquery) as search_rank,
            p.metadata,
            p.created_at,
            p.updated_at
        FROM playlists p
        WHERE p.deleted_at IS NULL
          AND p.search_vector @@ search_tsquery
    )
    ORDER BY search_rank DESC, created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION music_search IS 'Search across both songs and playlists with unified results ranked by relevance';
