-- Add music search function for searching both songs and playlists together
-- This migration adds a function to search across both songs and playlists in a single query
-- with support for both full-text and structured search queries

-- Music search function that combines songs and playlists with structured search support
CREATE OR REPLACE FUNCTION music_search(
    p_search_query TEXT DEFAULT NULL,
    p_search_type TEXT DEFAULT 'websearch', -- 'websearch', 'plainto', 'phrase'
    p_structured_search TEXT DEFAULT NULL, -- 'key:value' format for structured searches
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
    structured_key TEXT;
    structured_value TEXT;
    structured_condition TEXT := '';
    song_query TEXT;
    playlist_query TEXT;
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

            -- Handle different field types for songs
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

    -- Build song query
    song_query := format('
        SELECT
            ''song''::TEXT as result_type,
            s.id,
            s.title,
            COALESCE(s.artist, ''Unknown Artist'') || '' - '' || COALESCE(s.album, ''Unknown Album'') as subtitle,
            s.genre as description,
            s.media_blob_id,
            s.thumbnail_blob_id,
            CASE WHEN $1 IS NOT NULL THEN ts_rank(s.search_vector, $1) ELSE 0 END as search_rank,
            s.metadata,
            s.created_at,
            s.updated_at
        FROM songs s
        WHERE s.deleted_at IS NULL
          AND ($1 IS NULL OR s.search_vector @@ $1)
          %s',
        structured_condition
    );

    -- Build playlist query (playlists don't have genre/artist fields, so structured search is limited)
    playlist_query := '
        SELECT
            ''playlist''::TEXT as result_type,
            p.id,
            p.title,
            COALESCE(p.description, ''No description'') as subtitle,
            ''Playlist'' as description,
            p.media_blob_id,
            p.thumbnail_blob_id,
            CASE WHEN $1 IS NOT NULL THEN ts_rank(p.search_vector, $1) ELSE 0 END as search_rank,
            p.metadata,
            p.created_at,
            p.updated_at
        FROM playlists p
        WHERE p.deleted_at IS NULL
          AND ($1 IS NULL OR p.search_vector @@ $1)
          -- For playlists, we only support title and metadata structured searches
          AND (
              $2 IS NULL OR
              ($2 LIKE ''title:%'' AND p.title ILIKE (''%'' || split_part($2, '':'', 2) || ''%'')) OR
              ($2 NOT LIKE ''title:%'' AND $2 NOT LIKE ''artist:%'' AND $2 NOT LIKE ''album:%'' AND $2 NOT LIKE ''genre:%'' AND $2 NOT LIKE ''album_artist:%'')
          )
    ';

    -- Execute the combined query
    RETURN QUERY EXECUTE format('
        (%s)
        UNION ALL
        (%s)
        ORDER BY search_rank DESC, created_at DESC
        LIMIT $3 OFFSET $4',
        song_query,
        playlist_query
    ) USING search_tsquery, p_structured_search, p_limit, p_offset;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON FUNCTION music_search IS 'Search across both songs and playlists with unified results, supporting both full-text and structured search queries';
