-- Media Events Analytics Table
-- This migration creates the media_events table for tracking user interactions with media

-- Create media_events table for analytics
CREATE TABLE media_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}',
    session_id UUID,
    user_agent TEXT,
    ip_address INET,
    client_id TEXT,
    domain_type VARCHAR(20),
    domain_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for media_events table
COMMENT ON TABLE media_events IS 'Analytics events for media interactions and usage tracking';
COMMENT ON COLUMN media_events.media_blob_id IS 'Reference to the media blob that was interacted with';
COMMENT ON COLUMN media_events.user_id IS 'User who performed the action (NULL for anonymous)';
COMMENT ON COLUMN media_events.event_type IS 'Type of event: play, pause, seek, complete, favorite, rate, download, share';
COMMENT ON COLUMN media_events.event_data IS 'Event-specific data: {"position": "00:02:30", "rating": 5, "progress": 0.75, "quality": "1080p"}';
COMMENT ON COLUMN media_events.session_id IS 'Session identifier to group related events';
COMMENT ON COLUMN media_events.user_agent IS 'Client user agent string';
COMMENT ON COLUMN media_events.ip_address IS 'Client IP address for analytics';
COMMENT ON COLUMN media_events.client_id IS 'Client application identifier';
COMMENT ON COLUMN media_events.domain_type IS 'Domain context: song, photo, video, book, document';
COMMENT ON COLUMN media_events.domain_id IS 'ID of the domain object (song_id, photo_id, etc.)';

-- Create indexes for analytics queries
CREATE INDEX idx_media_events_blob_id ON media_events(media_blob_id);
CREATE INDEX idx_media_events_user_id ON media_events(user_id);
CREATE INDEX idx_media_events_type ON media_events(event_type);
CREATE INDEX idx_media_events_created_at ON media_events(created_at);
CREATE INDEX idx_media_events_session_id ON media_events(session_id);
CREATE INDEX idx_media_events_domain ON media_events(domain_type, domain_id);

-- Composite indexes for common analytics queries
CREATE INDEX idx_media_events_user_type_date ON media_events(user_id, event_type, created_at);
CREATE INDEX idx_media_events_blob_type_date ON media_events(media_blob_id, event_type, created_at);
CREATE INDEX idx_media_events_session_chronological ON media_events(session_id, created_at);

-- Index for time-based analytics (daily, weekly, monthly aggregations)
-- Note: date_trunc index removed due to immutable function requirement
CREATE INDEX idx_media_events_time_bucket ON media_events(created_at, event_type);

-- GIN index for event_data JSONB queries
CREATE INDEX idx_media_events_data ON media_events USING GIN(event_data);

-- Partial indexes for specific event types (performance optimization)
CREATE INDEX idx_media_events_plays ON media_events(media_blob_id, created_at)
    WHERE event_type = 'play';

CREATE INDEX idx_media_events_ratings ON media_events(media_blob_id, created_at)
    WHERE event_type = 'rate' AND event_data->>'rating' IS NOT NULL;

-- Add constraint for valid event types
ALTER TABLE media_events ADD CONSTRAINT chk_event_type
    CHECK (event_type IN (
        'play', 'pause', 'resume', 'seek', 'complete', 'stop',
        'rate', 'favorite', 'unfavorite', 'tag', 'untag',
        'download', 'share', 'view', 'thumbnail_click',
        'playlist_add', 'playlist_remove', 'skip', 'repeat',
        'shuffle', 'volume_change', 'quality_change',
        'fullscreen', 'picture_in_picture', 'cast'
    ));

-- Add constraint for valid domain types
ALTER TABLE media_events ADD CONSTRAINT chk_domain_type
    CHECK (domain_type IS NULL OR domain_type IN ('song', 'photo', 'video', 'book', 'document', 'playlist'));

-- Create view for common analytics queries
CREATE VIEW media_analytics AS
SELECT
    media_blob_id,
    COUNT(*) FILTER (WHERE event_type = 'play') as play_count,
    COUNT(*) FILTER (WHERE event_type = 'complete') as completion_count,
    COUNT(*) FILTER (WHERE event_type = 'download') as download_count,
    COUNT(*) FILTER (WHERE event_type = 'share') as share_count,
    COUNT(*) FILTER (WHERE event_type = 'favorite') as favorite_count,
    MAX(created_at) FILTER (WHERE event_type = 'play') as last_played_at,
    AVG((event_data->>'rating')::INTEGER) FILTER (WHERE event_type = 'rate') as avg_rating,
    COUNT(*) FILTER (WHERE event_type = 'rate') as rating_count,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT session_id) as unique_sessions,
    MIN(created_at) as first_interaction,
    MAX(created_at) as last_interaction
FROM media_events
WHERE user_id IS NOT NULL -- Exclude anonymous events from main analytics
GROUP BY media_blob_id;

-- Create view for user engagement analytics
CREATE VIEW user_engagement_analytics AS
SELECT
    user_id,
    COUNT(*) as total_events,
    COUNT(DISTINCT media_blob_id) as unique_media_accessed,
    COUNT(DISTINCT session_id) as unique_sessions,
    COUNT(*) FILTER (WHERE event_type = 'play') as play_events,
    COUNT(*) FILTER (WHERE event_type = 'complete') as completion_events,
    COUNT(*) FILTER (WHERE event_type = 'favorite') as favorite_events,
    COUNT(*) FILTER (WHERE event_type = 'rate') as rating_events,
    COUNT(DISTINCT date_trunc('day', created_at)) as active_days,
    MIN(created_at) as first_activity,
    MAX(created_at) as last_activity,
    -- Calculate completion rate
    CASE
        WHEN COUNT(*) FILTER (WHERE event_type = 'play') > 0
        THEN (COUNT(*) FILTER (WHERE event_type = 'complete') * 100.0 /
              COUNT(*) FILTER (WHERE event_type = 'play'))::DECIMAL(5,2)
        ELSE 0
    END as completion_rate_percent
FROM media_events
WHERE user_id IS NOT NULL
GROUP BY user_id;

-- Create function to get daily analytics for a time range
CREATE OR REPLACE FUNCTION get_daily_analytics(
    start_date DATE,
    end_date DATE DEFAULT CURRENT_DATE,
    event_type_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    date DATE,
    event_type VARCHAR(50),
    event_count BIGINT,
    unique_users BIGINT,
    unique_media BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        date_trunc('day', me.created_at)::DATE,
        me.event_type,
        COUNT(*),
        COUNT(DISTINCT me.user_id),
        COUNT(DISTINCT me.media_blob_id)
    FROM media_events me
    WHERE date_trunc('day', me.created_at)::DATE BETWEEN start_date AND end_date
    AND (event_type_filter IS NULL OR me.event_type = event_type_filter)
    GROUP BY date_trunc('day', me.created_at)::DATE, me.event_type
    ORDER BY date_trunc('day', me.created_at)::DATE DESC, me.event_type;
END;
$$ LANGUAGE plpgsql;

-- Create function to get top media by engagement
CREATE OR REPLACE FUNCTION get_top_media_by_engagement(
    days_back INTEGER DEFAULT 30,
    limit_count INTEGER DEFAULT 20,
    domain_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    media_blob_id UUID,
    domain_type VARCHAR(20),
    domain_id UUID,
    play_count BIGINT,
    unique_users BIGINT,
    avg_rating DECIMAL(3,2),
    last_played TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        me.media_blob_id,
        me.domain_type,
        me.domain_id,
        COUNT(*) FILTER (WHERE me.event_type = 'play'),
        COUNT(DISTINCT me.user_id),
        AVG((me.event_data->>'rating')::INTEGER) FILTER (WHERE me.event_type = 'rate'),
        MAX(me.created_at) FILTER (WHERE me.event_type = 'play')
    FROM media_events me
    WHERE me.created_at >= NOW() - INTERVAL '1 day' * days_back
    AND (domain_filter IS NULL OR me.domain_type = domain_filter)
    GROUP BY me.media_blob_id, me.domain_type, me.domain_id
    HAVING COUNT(*) FILTER (WHERE me.event_type = 'play') > 0
    ORDER BY COUNT(*) FILTER (WHERE me.event_type = 'play') DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to clean up old analytics data
CREATE OR REPLACE FUNCTION cleanup_old_analytics(days_to_keep INTEGER DEFAULT 365)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete analytics events older than specified days
    DELETE FROM media_events
    WHERE created_at < NOW() - INTERVAL '1 day' * days_to_keep;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for performance dashboard (refresh periodically)
CREATE MATERIALIZED VIEW analytics_dashboard AS
SELECT
    'overview' as metric_type,
    json_build_object(
        'total_events', COUNT(*),
        'unique_users', COUNT(DISTINCT user_id),
        'unique_media', COUNT(DISTINCT media_blob_id),
        'unique_sessions', COUNT(DISTINCT session_id),
        'events_last_24h', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'),
        'events_last_7d', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'),
        'events_last_30d', COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')
    ) as metrics
FROM media_events
UNION ALL
SELECT
    'event_types' as metric_type,
    json_object_agg(event_type, event_count) as metrics
FROM (
    SELECT
        event_type,
        COUNT(*) as event_count
    FROM media_events
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY event_type
) event_type_counts;

-- Create index on materialized view
CREATE UNIQUE INDEX idx_analytics_dashboard_type ON analytics_dashboard(metric_type);
