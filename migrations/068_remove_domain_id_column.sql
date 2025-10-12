-- Migration 068: Complete media_events table recreation without domain_id
-- This migration recreates the media_events table to use only domain_ids arrays

-- Step 1: Drop all dependent objects completely
DROP MATERIALIZED VIEW IF EXISTS song_play_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS trending_analysis CASCADE;
DROP MATERIALIZED VIEW IF EXISTS analytics_dashboard CASCADE;
DROP MATERIALIZED VIEW IF EXISTS user_listening_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS books_statistics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS documents_statistics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS photo_statistics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS video_statistics CASCADE;

-- Drop all analytics functions
DROP FUNCTION IF EXISTS get_social_feed_items CASCADE;
DROP FUNCTION IF EXISTS get_social_feed_count CASCADE;
DROP FUNCTION IF EXISTS get_top_songs_from_materialized CASCADE;
DROP FUNCTION IF EXISTS get_trending_from_materialized CASCADE;
DROP FUNCTION IF EXISTS get_trending_songs CASCADE;
DROP FUNCTION IF EXISTS get_popular_songs_by_period CASCADE;
DROP FUNCTION IF EXISTS get_collection_play_analytics CASCADE;
DROP FUNCTION IF EXISTS get_trending_collections CASCADE;
DROP FUNCTION IF EXISTS get_top_media_by_engagement CASCADE;

-- Step 2: Backup any critical data we want to preserve (none for analytics)
-- Since we're doing a clean slate approach, we skip this

-- Step 3: Drop and recreate media_events table entirely
DROP TABLE IF EXISTS media_events CASCADE;

CREATE TABLE media_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id VARCHAR(16),
    user_id UUID,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}'::jsonb,
    session_id UUID,
    user_agent TEXT,
    ip_address INET,
    client_id TEXT,
    domain_type VARCHAR(20),
    domain_ids TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 4: Add constraints
ALTER TABLE media_events ADD CONSTRAINT chk_collection_domain_ids_only
    CHECK (
        (media_blob_id IS NOT NULL) OR
        (media_blob_id IS NULL AND domain_type IS NOT NULL AND
         domain_ids IS NOT NULL AND array_length(domain_ids, 1) > 0)
    );

ALTER TABLE media_events ADD CONSTRAINT chk_domain_type
    CHECK (domain_type IS NULL OR domain_type IN (
        'song', 'album', 'artist', 'genre', 'playlist',
        'photo', 'video', 'book', 'document'
    ));

ALTER TABLE media_events ADD CONSTRAINT chk_event_type
    CHECK (event_type IN (
        'play', 'pause', 'resume', 'seek', 'complete', 'stop', 'rate',
        'favorite', 'unfavorite', 'tag', 'untag', 'download', 'share',
        'view', 'thumbnail_click', 'playlist_add', 'playlist_remove',
        'skip', 'repeat', 'shuffle', 'volume_change', 'quality_change',
        'fullscreen', 'picture_in_picture', 'cast', 'upload',
        'create_playlist', 'add_to_playlist'
    ));

-- Step 5: Create optimized indexes
CREATE INDEX idx_media_events_blob_id ON media_events (media_blob_id) WHERE media_blob_id IS NOT NULL;
CREATE INDEX idx_media_events_blob_type_date ON media_events (media_blob_id, event_type, created_at) WHERE media_blob_id IS NOT NULL;
CREATE INDEX idx_media_events_client_id ON media_events (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_media_events_created_at ON media_events (created_at);
CREATE INDEX idx_media_events_data ON media_events USING GIN (event_data);
CREATE INDEX idx_media_events_domain_ids_gin ON media_events USING GIN (domain_ids) WHERE domain_ids IS NOT NULL;
CREATE INDEX idx_media_events_feed_domain_ids ON media_events (created_at DESC, domain_type, event_type) WHERE event_type = 'play' AND domain_ids IS NOT NULL;
CREATE INDEX idx_media_events_plays ON media_events (media_blob_id, created_at) WHERE event_type = 'play' AND media_blob_id IS NOT NULL;
CREATE INDEX idx_media_events_ratings ON media_events (media_blob_id, created_at) WHERE event_type = 'rate' AND (event_data ->> 'rating') IS NOT NULL AND media_blob_id IS NOT NULL;
CREATE INDEX idx_media_events_session_chronological ON media_events (session_id, created_at);
CREATE INDEX idx_media_events_session_id ON media_events (session_id);
CREATE INDEX idx_media_events_time_bucket ON media_events (created_at, event_type);
CREATE INDEX idx_media_events_type ON media_events (event_type);
CREATE INDEX idx_media_events_user_id ON media_events (user_id);
CREATE INDEX idx_media_events_user_type_date ON media_events (user_id, event_type, created_at);
CREATE INDEX idx_media_events_collection_analytics ON media_events (domain_type, event_type, created_at) WHERE domain_type IN ('album', 'artist', 'genre', 'playlist');
CREATE INDEX idx_media_events_collection_plays ON media_events (domain_type, created_at) WHERE event_type = 'play' AND media_blob_id IS NULL;
CREATE INDEX idx_media_events_collections ON media_events (domain_type, event_type, created_at) WHERE media_blob_id IS NULL;

-- Step 6: Recreate essential analytics functions using domain_ids
CREATE OR REPLACE FUNCTION get_social_feed_items(
    p_limit bigint,
    p_offset bigint,
    p_days_back interval
)
RETURNS TABLE (
    item_type text,
    domain_type text,
    domain_ids text[],
    title text,
    subtitle text,
    image_url text,
    metadata jsonb,
    play_count bigint,
    last_played_at timestamptz,
    score float,
    created_at timestamptz
) AS $$
BEGIN
    -- Return recent albums as feed items (simplified for now)
    RETURN QUERY
    SELECT
        'recent_album'::text as item_type,
        'album'::text as domain_type,
        ARRAY[a.id]::text[] as domain_ids,
        a.title as title,
        a.artist as subtitle,
        NULL::text as image_url,
        jsonb_build_object(
            'total_songs', (SELECT COUNT(*) FROM songs s WHERE s.album = a.title AND s.artist = a.artist),
            'artist_name', a.artist,
            'album_name', a.title
        ) as metadata,
        0::bigint as play_count,
        a.created_at as last_played_at,
        EXTRACT(EPOCH FROM (NOW() - a.created_at))::float as score,
        a.created_at
    FROM albums a
    WHERE a.created_at >= NOW() - p_days_back
    ORDER BY a.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_social_feed_count(p_days_back interval)
RETURNS bigint AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)
        FROM albums a
        WHERE a.created_at >= NOW() - p_days_back
    );
END;
$$ LANGUAGE plpgsql;

-- Step 7: Recreate simplified materialized views using domain_ids
CREATE MATERIALIZED VIEW song_play_summary AS
WITH daily_stats AS (
    SELECT
        me.media_blob_id,
        me.domain_ids,
        DATE_TRUNC('day', me.created_at)::date AS summary_date,
        COUNT(*) FILTER (WHERE me.event_type = 'play') AS daily_plays,
        COUNT(*) FILTER (WHERE me.event_type = 'complete') AS daily_completes,
        COUNT(DISTINCT me.user_id) AS daily_unique_users,
        COUNT(DISTINCT me.session_id) AS daily_unique_sessions,
        SUM(CASE
            WHEN me.event_data->>'duration' IS NOT NULL
            THEN (me.event_data->>'duration')::bigint
            ELSE 0
        END) AS daily_listening_seconds,
        AVG(CASE
            WHEN me.event_type = 'complete' THEN 1.0
            WHEN me.event_type = 'play' AND me.event_data->>'progress' IS NOT NULL
            THEN (me.event_data->>'progress')::float
            ELSE 0.0
        END) AS daily_avg_completion_rate
    FROM media_events me
    WHERE me.domain_type = 'song'
        AND me.created_at >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY me.media_blob_id, me.domain_ids, DATE_TRUNC('day', me.created_at)::date
)
SELECT
    media_blob_id,
    domain_ids,
    summary_date,
    'daily'::text AS period_type,
    daily_plays AS play_count,
    daily_completes AS complete_count,
    daily_unique_users AS unique_users,
    daily_unique_sessions AS unique_sessions,
    daily_listening_seconds AS listening_seconds,
    daily_avg_completion_rate AS avg_completion_rate,
    ROW_NUMBER() OVER (PARTITION BY summary_date ORDER BY daily_plays DESC) AS daily_rank
FROM daily_stats
WHERE daily_plays > 0;

CREATE MATERIALIZED VIEW trending_analysis AS
WITH time_periods AS (
    SELECT 'last_hour' as period_name, 1 as hours
    UNION ALL SELECT 'last_6_hours', 6
    UNION ALL SELECT 'last_24_hours', 24
    UNION ALL SELECT 'last_7_days', 168
    UNION ALL SELECT 'last_30_days', 720
)
SELECT
    tp.period_name,
    tp.hours,
    me.media_blob_id,
    me.domain_ids,
    COUNT(*) FILTER (WHERE me.event_type = 'play') as play_count,
    COUNT(DISTINCT me.user_id) as unique_users,
    AVG(CASE
        WHEN me.event_data->>'progress' IS NOT NULL
        THEN (me.event_data->>'progress')::float
        ELSE 0
    END) as avg_completion_rate,
    MAX(me.created_at) as latest_play_at
FROM time_periods tp
CROSS JOIN media_events me
WHERE me.created_at >= NOW() - (tp.hours || ' hours')::interval
    AND me.event_type = 'play'
    AND me.media_blob_id IS NOT NULL
GROUP BY tp.period_name, tp.hours, me.media_blob_id, me.domain_ids
HAVING COUNT(*) > 0;

-- Create simplified analytics dashboard view
CREATE MATERIALIZED VIEW analytics_dashboard AS
SELECT
    COUNT(*) FILTER (WHERE event_type = 'play') as total_plays,
    COUNT(*) FILTER (WHERE event_type = 'complete') as total_completes,
    COUNT(DISTINCT user_id) as total_users,
    COUNT(DISTINCT media_blob_id) as total_songs_played,
    AVG(CASE
        WHEN event_data->>'progress' IS NOT NULL
        THEN (event_data->>'progress')::float
        ELSE 0
    END) as avg_completion_rate,
    DATE_TRUNC('day', NOW()) as calculated_at
FROM media_events
WHERE created_at >= NOW() - INTERVAL '30 days';

-- Step 8: Create indexes for materialized views
CREATE INDEX idx_song_play_summary_lookup_v2 ON song_play_summary (media_blob_id, period_type, summary_date DESC);
CREATE INDEX idx_song_play_summary_plays_v2 ON song_play_summary (period_type, play_count DESC);
CREATE INDEX idx_song_play_summary_ranking_v2 ON song_play_summary (period_type, summary_date, daily_rank);

CREATE INDEX idx_trending_analysis_period_v2 ON trending_analysis (period_name, play_count DESC);
CREATE INDEX idx_trending_analysis_blob_v2 ON trending_analysis (media_blob_id, period_name);

-- Step 9: Add documentation
COMMENT ON COLUMN media_events.domain_ids IS 'Array of domain IDs for collection events. Use song SHA IDs for songs, UUIDs for playlists/users. Always store as arrays even for single items.';
COMMENT ON TABLE media_events IS 'Analytics events table - recreated to use only domain_ids arrays for consistent collection handling';
COMMENT ON MATERIALIZED VIEW song_play_summary IS 'Song play statistics aggregated by day - updated to use domain_ids arrays';
COMMENT ON MATERIALIZED VIEW trending_analysis IS 'Trending song analysis across time periods - updated to use domain_ids arrays';
COMMENT ON MATERIALIZED VIEW analytics_dashboard IS 'High-level analytics dashboard metrics - simplified view';
