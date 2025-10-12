-- Migration: 062_extend_domain_types.sql
-- Add support for album, artist, and genre domain types to analytics

-- Update the domain_type constraint to include new collection types
ALTER TABLE media_events DROP CONSTRAINT IF EXISTS chk_domain_type;

ALTER TABLE media_events ADD CONSTRAINT chk_domain_type
    CHECK (domain_type IS NULL OR domain_type IN (
        'song', 'album', 'artist', 'genre', 'playlist',
        'photo', 'video', 'book', 'document'
    ));

-- Update the comment to reflect new domain types
COMMENT ON COLUMN media_events.domain_type IS 'Domain context: song, album, artist, genre, playlist, photo, video, book, document';

-- Add index for collection analytics queries
CREATE INDEX IF NOT EXISTS idx_media_events_collection_analytics
ON media_events(domain_type, domain_id, event_type, created_at)
WHERE domain_type IN ('album', 'artist', 'genre', 'playlist');

-- Create function to get collection play analytics
CREATE OR REPLACE FUNCTION get_collection_play_analytics(
    p_domain_type VARCHAR(20),
    p_time_period INTERVAL DEFAULT '30 days'
)
RETURNS TABLE (
    domain_id UUID,
    total_plays BIGINT,
    unique_users BIGINT,
    last_played_at TIMESTAMPTZ,
    avg_songs_per_play DECIMAL(8,2),
    shuffle_play_percentage DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        me.domain_id,
        COUNT(*)::BIGINT as total_plays,
        COUNT(DISTINCT me.user_id)::BIGINT as unique_users,
        MAX(me.created_at) as last_played_at,
        AVG((me.event_data->>'total_songs')::INTEGER)::DECIMAL(8,2) as avg_songs_per_play,
        (COUNT(CASE WHEN me.event_data->>'shuffle_enabled' = 'true' THEN 1 END)::DECIMAL / COUNT(*)::DECIMAL * 100)::DECIMAL(5,2) as shuffle_play_percentage
    FROM media_events me
    WHERE me.domain_type = p_domain_type
      AND me.event_type = 'play'
      AND me.created_at >= NOW() - p_time_period
      AND me.domain_id IS NOT NULL
    GROUP BY me.domain_id
    HAVING COUNT(*) > 0
    ORDER BY total_plays DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to get trending collections
CREATE OR REPLACE FUNCTION get_trending_collections(
    p_domain_type VARCHAR(20),
    p_time_period_hours INTEGER DEFAULT 168, -- 1 week
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    domain_id UUID,
    recent_plays BIGINT,
    previous_plays BIGINT,
    growth_rate DECIMAL(8,2),
    velocity_score DECIMAL(10,4)
) AS $$
BEGIN
    RETURN QUERY
    WITH recent_period AS (
        SELECT
            me.domain_id,
            COUNT(*) as plays
        FROM media_events me
        WHERE me.domain_type = p_domain_type
          AND me.event_type = 'play'
          AND me.created_at >= NOW() - INTERVAL '1 hour' * p_time_period_hours
          AND me.domain_id IS NOT NULL
        GROUP BY me.domain_id
    ),
    previous_period AS (
        SELECT
            me.domain_id,
            COUNT(*) as plays
        FROM media_events me
        WHERE me.domain_type = p_domain_type
          AND me.event_type = 'play'
          AND me.created_at >= NOW() - INTERVAL '1 hour' * (p_time_period_hours * 2)
          AND me.created_at < NOW() - INTERVAL '1 hour' * p_time_period_hours
          AND me.domain_id IS NOT NULL
        GROUP BY me.domain_id
    )
    SELECT
        COALESCE(r.domain_id, p.domain_id),
        COALESCE(r.plays, 0)::BIGINT,
        COALESCE(p.plays, 0)::BIGINT,
        CASE
            WHEN COALESCE(p.plays, 0) = 0 THEN
                CASE WHEN COALESCE(r.plays, 0) > 0 THEN 1000.0 ELSE 0.0 END
            ELSE ((COALESCE(r.plays, 0) - COALESCE(p.plays, 0))::DECIMAL / p.plays * 100)::DECIMAL(8,2)
        END as growth_rate,
        (COALESCE(r.plays, 0)::DECIMAL *
         CASE
             WHEN COALESCE(p.plays, 0) = 0 THEN 2.0
             ELSE (1.0 + (COALESCE(r.plays, 0) - COALESCE(p.plays, 0))::DECIMAL / GREATEST(p.plays, 1))
         END)::DECIMAL(10,4) as velocity_score
    FROM recent_period r
    FULL OUTER JOIN previous_period p ON r.domain_id = p.domain_id
    WHERE COALESCE(r.plays, 0) > 0
    ORDER BY velocity_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Add helpful comments for new functions
COMMENT ON FUNCTION get_collection_play_analytics IS 'Get play analytics for collections (albums, artists, genres, playlists)';
COMMENT ON FUNCTION get_trending_collections IS 'Get trending collections based on velocity and growth metrics';
