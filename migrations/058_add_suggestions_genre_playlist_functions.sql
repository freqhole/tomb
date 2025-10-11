-- Add genre and playlist suggestion functions to extend existing suggestions system
-- This migration adds functions to include genres and playlists in the suggestions API

-- genre suggestions function - returns suggestions matching genre names
CREATE OR REPLACE FUNCTION get_genre_suggestions(
    p_query TEXT,
    p_limit INTEGER DEFAULT 3
)
RETURNS TABLE(
    value TEXT,
    display TEXT,
    highlight TEXT,
    count INTEGER,
    suggestion_type TEXT,
    confidence REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.genre as value,
        s.genre as display,
        s.genre as highlight,
        COUNT(*)::INTEGER as count,
        'genre'::TEXT as suggestion_type,
        ts_rank(
            to_tsvector('english', s.genre),
            websearch_to_tsquery('english', p_query)
        ) as confidence
    FROM songs s
    WHERE s.deleted_at IS NULL
      AND s.genre IS NOT NULL
      AND s.genre != ''
      AND s.genre ILIKE '%' || p_query || '%'
    GROUP BY s.genre
    ORDER BY confidence DESC, count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- playlist suggestions function - returns suggestions matching playlist titles/descriptions
CREATE OR REPLACE FUNCTION get_playlist_suggestions(
    p_query TEXT,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 3
)
RETURNS TABLE(
    value TEXT,
    display TEXT,
    highlight TEXT,
    count INTEGER,
    suggestion_type TEXT,
    confidence REAL,
    playlist_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.title as value,
        p.title as display,
        p.title as highlight,
        COALESCE(song_counts.song_count, 0)::INTEGER as count,
        'playlist'::TEXT as suggestion_type,
        ts_rank(
            to_tsvector('english',
                COALESCE(p.title, '') || ' ' || COALESCE(p.description, '')
            ),
            websearch_to_tsquery('english', p_query)
        ) as confidence,
        p.id as playlist_id
    FROM playlists p
    LEFT JOIN (
        SELECT ps.playlist_id, COUNT(*) as song_count
        FROM playlist_songs ps
        GROUP BY ps.playlist_id
    ) song_counts ON p.id = song_counts.playlist_id
    WHERE p.deleted_at IS NULL
      AND (p.title ILIKE '%' || p_query || '%' OR p.description ILIKE '%' || p_query || '%')
    ORDER BY confidence DESC, count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- add comments for documentation
COMMENT ON FUNCTION get_genre_suggestions IS 'Get genre suggestions for search autocomplete based on genre names';
COMMENT ON FUNCTION get_playlist_suggestions IS 'Get playlist suggestions for search autocomplete based on titles and descriptions';
