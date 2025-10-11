-- Add genre and playlist aggregation functions for search grouping
-- This migration adds functions to aggregate genres and playlists for the enhanced search API

-- Genre aggregation function
CREATE OR REPLACE FUNCTION get_genre_aggregations(
    p_search_query TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 10,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    genre TEXT,
    song_count BIGINT,
    artist_count BIGINT,
    representative_song_id UUID,
    representative_thumbnail VARCHAR(16),
    avg_rating NUMERIC,
    search_rank REAL
) AS $$
BEGIN
    RETURN QUERY
    WITH genre_stats AS (
        SELECT
            s.genre,
            COUNT(s.id) as song_count,
            COUNT(DISTINCT s.artist) as artist_count,
            AVG(COALESCE(up.rating, s.rating)::NUMERIC) as avg_rating,
            -- Get a representative song (highest rated, then most recent)
            (
                SELECT sub_s.id
                FROM songs sub_s
                LEFT JOIN user_song_preferences sub_up ON sub_s.id = sub_up.song_id AND sub_up.user_id = p_user_id
                WHERE sub_s.genre = s.genre
                  AND sub_s.deleted_at IS NULL
                ORDER BY COALESCE(sub_up.rating, sub_s.rating) DESC NULLS LAST,
                         sub_s.created_at DESC
                LIMIT 1
            ) as representative_song_id,
            -- Get thumbnail from representative song
            (
                SELECT sub_s.thumbnail_blob_id
                FROM songs sub_s
                LEFT JOIN user_song_preferences sub_up ON sub_s.id = sub_up.song_id AND sub_up.user_id = p_user_id
                WHERE sub_s.genre = s.genre
                  AND sub_s.deleted_at IS NULL
                ORDER BY COALESCE(sub_up.rating, sub_s.rating) DESC NULLS LAST,
                         sub_s.created_at DESC
                LIMIT 1
            ) as representative_thumbnail,
            -- Calculate search rank based on relevance if search query provided
            CASE
                WHEN p_search_query IS NOT NULL AND p_search_query != '' THEN
                    ts_rank(
                        to_tsvector('english', COALESCE(s.genre, '')),
                        websearch_to_tsquery('english', p_search_query)
                    )
                ELSE 1.0
            END as search_rank
        FROM songs s
        LEFT JOIN user_song_preferences up ON s.id = up.song_id AND up.user_id = p_user_id
        WHERE s.deleted_at IS NULL
          AND s.genre IS NOT NULL
          AND s.genre != ''
          -- Add search filter if provided
          AND (
              p_search_query IS NULL OR p_search_query = '' OR
              to_tsvector('english', COALESCE(s.genre, '')) @@ websearch_to_tsquery('english', p_search_query)
          )
        GROUP BY s.genre
        HAVING COUNT(s.id) > 0
    )
    SELECT
        gs.genre,
        gs.song_count,
        gs.artist_count,
        gs.representative_song_id,
        gs.representative_thumbnail,
        gs.avg_rating,
        gs.search_rank
    FROM genre_stats gs
    ORDER BY
        CASE WHEN p_search_query IS NOT NULL AND p_search_query != ''
             THEN gs.search_rank
             ELSE gs.song_count::REAL
        END DESC,
        gs.genre ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Playlist search function
CREATE OR REPLACE FUNCTION get_playlist_search_results(
    p_search_query TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_include_private BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT 10,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id UUID,
    title TEXT,
    description TEXT,
    song_count BIGINT,
    is_public BOOLEAN,
    thumbnail_blob_id VARCHAR(16),
    created_at TIMESTAMPTZ,
    search_rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        p.description,
        COALESCE(p.song_count, 0) as song_count,
        p.is_public,
        p.thumbnail_blob_id,
        p.created_at,
        -- Calculate search rank based on title and description relevance
        CASE
            WHEN p_search_query IS NOT NULL AND p_search_query != '' THEN
                ts_rank(
                    to_tsvector('english',
                        COALESCE(p.title, '') || ' ' || COALESCE(p.description, '')
                    ),
                    websearch_to_tsquery('english', p_search_query)
                )
            ELSE 1.0
        END as search_rank
    FROM playlists p
    WHERE p.deleted_at IS NULL
      -- Privacy filter
      AND (
          p.is_public = true OR
          (p_include_private = true AND p.created_by = p_user_id)
      )
      -- Search filter if provided
      AND (
          p_search_query IS NULL OR p_search_query = '' OR
          to_tsvector('english',
              COALESCE(p.title, '') || ' ' || COALESCE(p.description, '')
          ) @@ websearch_to_tsquery('english', p_search_query)
      )
    ORDER BY
        CASE WHEN p_search_query IS NOT NULL AND p_search_query != ''
             THEN search_rank
             ELSE p.created_at
        END DESC,
        p.title ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON FUNCTION get_genre_aggregations IS 'Aggregate genres with song counts, artist counts, and representative songs for search results';
COMMENT ON FUNCTION get_playlist_search_results IS 'Search playlists with FTS support and privacy filtering for search results';
