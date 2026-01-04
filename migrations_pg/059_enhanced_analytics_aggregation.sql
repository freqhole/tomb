-- Enhanced Analytics Aggregation Functions
-- This migration extends the existing analytics system with advanced aggregation functions
-- for trending analysis, user engagement patterns, and listening time calculations

-- Enhanced get_song_play_analytics function with play time calculations
CREATE OR REPLACE FUNCTION get_song_play_analytics(
    p_media_blob_id VARCHAR(16)
)
RETURNS TABLE (
    media_blob_id VARCHAR(16),
    total_plays BIGINT,
    complete_plays BIGINT,
    partial_plays BIGINT,
    unique_users BIGINT,
    unique_sessions BIGINT,
    avg_completion_rate DECIMAL(5,4),
    total_play_time_seconds BIGINT,
    avg_play_time_seconds DECIMAL(8,2),
    last_played_at TIMESTAMPTZ,
    first_played_at TIMESTAMPTZ,
    play_count_last_24h BIGINT,
    play_count_last_7d BIGINT,
    play_count_last_30d BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p_media_blob_id,
        COUNT(*) FILTER (WHERE event_type = 'play')::BIGINT as total_plays,
        COUNT(*) FILTER (WHERE event_type = 'complete' OR
            (event_type = 'play' AND (event_data->>'progress')::FLOAT >= 0.9))::BIGINT as complete_plays,
        COUNT(*) FILTER (WHERE event_type IN ('pause', 'stop') OR
            (event_type = 'play' AND (event_data->>'progress')::FLOAT < 0.9))::BIGINT as partial_plays,
        COUNT(DISTINCT user_id)::BIGINT as unique_users,
        COUNT(DISTINCT session_id)::BIGINT as unique_sessions,
        COALESCE(AVG(CASE
            WHEN event_type = 'complete' THEN 1.0
            WHEN event_type = 'play' AND event_data->>'progress' IS NOT NULL
            THEN (event_data->>'progress')::FLOAT
            ELSE 0.0
        END), 0)::DECIMAL(5,4) as avg_completion_rate,
        COALESCE(SUM(CASE
            WHEN event_data->>'duration' IS NOT NULL
            THEN (event_data->>'duration')::BIGINT
            ELSE 0
        END), 0)::BIGINT as total_play_time_seconds,
        COALESCE(AVG(CASE
            WHEN event_data->>'duration' IS NOT NULL
            THEN (event_data->>'duration')::FLOAT
            ELSE 0
        END), 0)::DECIMAL(8,2) as avg_play_time_seconds,
        MAX(me.created_at) FILTER (WHERE event_type = 'play') as last_played_at,
        MIN(me.created_at) FILTER (WHERE event_type = 'play') as first_played_at,
        COUNT(*) FILTER (WHERE event_type = 'play' AND me.created_at >= NOW() - INTERVAL '24 hours')::BIGINT as play_count_last_24h,
        COUNT(*) FILTER (WHERE event_type = 'play' AND me.created_at >= NOW() - INTERVAL '7 days')::BIGINT as play_count_last_7d,
        COUNT(*) FILTER (WHERE event_type = 'play' AND me.created_at >= NOW() - INTERVAL '30 days')::BIGINT as play_count_last_30d
    FROM media_events me
    WHERE me.media_blob_id = p_media_blob_id;
END;
$$ LANGUAGE plpgsql;

-- Get trending songs based on play velocity and momentum
CREATE OR REPLACE FUNCTION get_trending_songs(
    time_period_hours INTEGER DEFAULT 24,
    limit_count INTEGER DEFAULT 50,
    domain_filter TEXT DEFAULT 'song'
)
RETURNS TABLE (
    media_blob_id VARCHAR(16),
    domain_id UUID,
    current_period_plays BIGINT,
    previous_period_plays BIGINT,
    trend_score DECIMAL(10,4),
    velocity_score DECIMAL(10,4),
    unique_users BIGINT,
    completion_rate DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    WITH current_period AS (
        SELECT
            me.media_blob_id,
            me.domain_id,
            COUNT(*) FILTER (WHERE event_type = 'play') as plays,
            COUNT(DISTINCT user_id) as users,
            COUNT(*) FILTER (WHERE event_type = 'complete') as completes
        FROM media_events me
        WHERE me.created_at >= NOW() - INTERVAL '1 hour' * time_period_hours
        AND (domain_filter IS NULL OR me.domain_type = domain_filter)
        GROUP BY me.media_blob_id, me.domain_id
    ),
    previous_period AS (
        SELECT
            me.media_blob_id,
            COUNT(*) FILTER (WHERE event_type = 'play') as plays
        FROM media_events me
        WHERE me.created_at >= NOW() - INTERVAL '1 hour' * (time_period_hours * 2)
        AND me.created_at < NOW() - INTERVAL '1 hour' * time_period_hours
        AND (domain_filter IS NULL OR me.domain_type = domain_filter)
        GROUP BY me.media_blob_id
    )
    SELECT
        cp.media_blob_id,
        cp.domain_id,
        cp.plays as current_period_plays,
        COALESCE(pp.plays, 0) as previous_period_plays,
        -- trend score: current plays / (previous plays + 1) to avoid division by zero
        (cp.plays::DECIMAL / (COALESCE(pp.plays, 0) + 1))::DECIMAL(10,4) as trend_score,
        -- velocity score: plays per hour in current period
        (cp.plays::DECIMAL / time_period_hours)::DECIMAL(10,4) as velocity_score,
        cp.users as unique_users,
        CASE WHEN cp.plays > 0 THEN (cp.completes * 100.0 / cp.plays)::DECIMAL(5,2) ELSE 0 END as completion_rate
    FROM current_period cp
    LEFT JOIN previous_period pp ON cp.media_blob_id = pp.media_blob_id
    WHERE cp.plays >= 1 -- minimum threshold for trending
    ORDER BY trend_score DESC, velocity_score DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Get user listening streaks and engagement patterns
CREATE OR REPLACE FUNCTION get_user_listening_streaks(
    p_user_id UUID
)
RETURNS TABLE (
    user_id UUID,
    current_streak_days INTEGER,
    longest_streak_days INTEGER,
    total_listening_days INTEGER,
    avg_daily_plays DECIMAL(8,2),
    favorite_listening_hour INTEGER,
    most_played_day_of_week INTEGER,
    total_unique_songs BIGINT,
    completion_rate DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    WITH daily_activity AS (
        SELECT
            date_trunc('day', created_at)::DATE as activity_date,
            COUNT(*) FILTER (WHERE event_type = 'play') as daily_plays,
            COUNT(*) FILTER (WHERE event_type = 'complete') as daily_completes,
            COUNT(DISTINCT media_blob_id) as unique_songs_per_day
        FROM media_events
        WHERE user_id = p_user_id
        GROUP BY date_trunc('day', created_at)::DATE
        HAVING COUNT(*) FILTER (WHERE event_type = 'play') > 0
    ),
    streak_calculation AS (
        SELECT
            activity_date,
            daily_plays,
            ROW_NUMBER() OVER (ORDER BY activity_date) -
            ROW_NUMBER() OVER (PARTITION BY activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date) || ' days')::INTERVAL ORDER BY activity_date) as streak_group
        FROM daily_activity
    ),
    user_stats AS (
        SELECT
            COUNT(DISTINCT da.activity_date)::INTEGER as total_days,
            AVG(da.daily_plays)::DECIMAL(8,2) as avg_plays,
            EXTRACT(hour FROM me.created_at)::INTEGER as hour_of_day,
            COUNT(*) as hour_plays
        FROM daily_activity da
        CROSS JOIN media_events me
        WHERE me.user_id = p_user_id AND event_type = 'play'
        GROUP BY EXTRACT(hour FROM me.created_at)
    )
    SELECT
        p_user_id,
        CASE
            WHEN MAX(da.activity_date) = CURRENT_DATE THEN
                (SELECT COUNT(*) FROM daily_activity WHERE activity_date >= CURRENT_DATE -
                 (ROW_NUMBER() OVER (ORDER BY activity_date DESC) - 1))::INTEGER
            ELSE 0
        END as current_streak_days,
        (SELECT MAX(streak_length) FROM (
            SELECT COUNT(*) as streak_length
            FROM streak_calculation
            GROUP BY streak_group
        ) streaks)::INTEGER as longest_streak_days,
        COUNT(DISTINCT da.activity_date)::INTEGER as total_listening_days,
        AVG(da.daily_plays)::DECIMAL(8,2) as avg_daily_plays,
        (SELECT hour_of_day FROM user_stats ORDER BY hour_plays DESC LIMIT 1) as favorite_listening_hour,
        (SELECT EXTRACT(dow FROM activity_date)::INTEGER as dow
         FROM daily_activity
         GROUP BY EXTRACT(dow FROM activity_date)
         ORDER BY COUNT(*) DESC
         LIMIT 1) as most_played_day_of_week,
        (SELECT COUNT(DISTINCT media_blob_id) FROM media_events WHERE user_id = p_user_id) as total_unique_songs,
        (SELECT
            CASE WHEN COUNT(*) FILTER (WHERE event_type = 'play') > 0
            THEN (COUNT(*) FILTER (WHERE event_type = 'complete') * 100.0 /
                  COUNT(*) FILTER (WHERE event_type = 'play'))::DECIMAL(5,2)
            ELSE 0 END
         FROM media_events WHERE user_id = p_user_id) as completion_rate
    FROM daily_activity da
    GROUP BY p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Get genre listening patterns for music taste analysis
CREATE OR REPLACE FUNCTION get_genre_listening_patterns(
    days_back INTEGER DEFAULT 30,
    min_plays INTEGER DEFAULT 5
)
RETURNS TABLE (
    genre VARCHAR(100),
    total_plays BIGINT,
    unique_users BIGINT,
    unique_songs BIGINT,
    avg_completion_rate DECIMAL(5,2),
    trend_direction TEXT,
    popularity_rank INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH genre_stats AS (
        SELECT
            COALESCE((me.event_data->>'genre')::VARCHAR(100), 'unknown') as genre_name,
            COUNT(*) FILTER (WHERE event_type = 'play') as plays,
            COUNT(DISTINCT me.user_id) as users,
            COUNT(DISTINCT me.media_blob_id) as songs,
            COUNT(*) FILTER (WHERE event_type = 'complete') as completes,
            COUNT(*) FILTER (WHERE event_type = 'play' AND me.created_at >= NOW() - INTERVAL '7 days') as recent_plays,
            COUNT(*) FILTER (WHERE event_type = 'play' AND me.created_at < NOW() - INTERVAL '7 days') as older_plays
        FROM media_events me
        WHERE me.created_at >= NOW() - INTERVAL '1 day' * days_back
        AND me.domain_type = 'song'
        AND event_type IN ('play', 'complete')
        GROUP BY COALESCE((me.event_data->>'genre')::VARCHAR(100), 'unknown')
        HAVING COUNT(*) FILTER (WHERE event_type = 'play') >= min_plays
    )
    SELECT
        gs.genre_name,
        gs.plays,
        gs.users,
        gs.songs,
        CASE WHEN gs.plays > 0 THEN (gs.completes * 100.0 / gs.plays)::DECIMAL(5,2) ELSE 0 END as avg_completion_rate,
        CASE
            WHEN gs.recent_plays > gs.older_plays * 1.2 THEN 'rising'
            WHEN gs.recent_plays < gs.older_plays * 0.8 THEN 'declining'
            ELSE 'stable'
        END as trend_direction,
        ROW_NUMBER() OVER (ORDER BY gs.plays DESC)::INTEGER as popularity_rank
    FROM genre_stats gs
    ORDER BY gs.plays DESC;
END;
$$ LANGUAGE plpgsql;

-- Calculate listening time by time period for user analytics
CREATE OR REPLACE FUNCTION calculate_listening_time_by_period(
    p_user_id UUID,
    period_type TEXT DEFAULT 'day'
)
RETURNS TABLE (
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    total_listening_seconds BIGINT,
    unique_songs_played BIGINT,
    total_play_events BIGINT,
    avg_session_length_minutes DECIMAL(8,2)
) AS $$
DECLARE
    trunc_format TEXT;
BEGIN
    -- validate period type
    IF period_type NOT IN ('hour', 'day', 'week', 'month') THEN
        RAISE EXCEPTION 'invalid period_type: %. must be hour, day, week, or month', period_type;
    END IF;

    trunc_format := period_type;

    RETURN QUERY
    EXECUTE format('
    WITH period_data AS (
        SELECT
            date_trunc(%L, created_at) as period_start,
            session_id,
            COUNT(*) FILTER (WHERE event_type = ''play'') as session_plays,
            COUNT(DISTINCT media_blob_id) as session_unique_songs,
            SUM(CASE
                WHEN event_data->>''duration'' IS NOT NULL
                THEN (event_data->>''duration'')::BIGINT
                ELSE 0
            END) as session_listening_seconds
        FROM media_events
        WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL ''90 days''
        GROUP BY date_trunc(%L, created_at), session_id
    ),
    aggregated_periods AS (
        SELECT
            period_start,
            SUM(session_listening_seconds) as total_seconds,
            SUM(session_unique_songs) as unique_songs,
            SUM(session_plays) as total_plays,
            COUNT(DISTINCT session_id) as unique_sessions,
            AVG(session_listening_seconds / 60.0) as avg_session_minutes
        FROM period_data
        GROUP BY period_start
    )
    SELECT
        ap.period_start,
        CASE
            WHEN %L = ''hour'' THEN ap.period_start + INTERVAL ''1 hour''
            WHEN %L = ''day'' THEN ap.period_start + INTERVAL ''1 day''
            WHEN %L = ''week'' THEN ap.period_start + INTERVAL ''1 week''
            WHEN %L = ''month'' THEN ap.period_start + INTERVAL ''1 month''
        END as period_end,
        ap.total_seconds,
        ap.unique_songs,
        ap.total_plays,
        COALESCE(ap.avg_session_minutes, 0)::DECIMAL(8,2)
    FROM aggregated_periods ap
    WHERE ap.total_plays > 0
    ORDER BY ap.period_start DESC
    ', trunc_format, trunc_format, period_type, period_type, period_type)
    USING p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Get popular songs by time period with momentum calculation
CREATE OR REPLACE FUNCTION get_popular_songs_by_period(
    period_hours INTEGER DEFAULT 24,
    limit_count INTEGER DEFAULT 20,
    min_plays INTEGER DEFAULT 3
)
RETURNS TABLE (
    media_blob_id VARCHAR(16),
    domain_id UUID,
    play_count BIGINT,
    unique_users BIGINT,
    completion_rate DECIMAL(5,2),
    momentum_score DECIMAL(8,4),
    first_play_at TIMESTAMPTZ,
    latest_play_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    WITH song_metrics AS (
        SELECT
            me.media_blob_id,
            me.domain_id,
            COUNT(*) FILTER (WHERE event_type = 'play') as plays,
            COUNT(DISTINCT user_id) as users,
            COUNT(*) FILTER (WHERE event_type = 'complete') as completes,
            MIN(created_at) FILTER (WHERE event_type = 'play') as first_play,
            MAX(created_at) FILTER (WHERE event_type = 'play') as latest_play,
            -- calculate momentum based on play distribution over time
            CASE
                WHEN COUNT(*) FILTER (WHERE event_type = 'play') > 0 THEN
                    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) /
                    (COUNT(*) FILTER (WHERE event_type = 'play') * 3600.0)
                ELSE 0
            END as time_spread_factor
        FROM media_events me
        WHERE me.created_at >= NOW() - INTERVAL '1 hour' * period_hours
        AND me.domain_type = 'song'
        GROUP BY me.media_blob_id, me.domain_id
        HAVING COUNT(*) FILTER (WHERE event_type = 'play') >= min_plays
    )
    SELECT
        sm.media_blob_id,
        sm.domain_id,
        sm.plays,
        sm.users,
        CASE WHEN sm.plays > 0 THEN (sm.completes * 100.0 / sm.plays)::DECIMAL(5,2) ELSE 0 END as completion_rate,
        -- momentum score: plays per user, adjusted by time distribution
        (sm.plays::DECIMAL / GREATEST(sm.users, 1) *
         (1.0 / GREATEST(sm.time_spread_factor, 0.1)))::DECIMAL(8,4) as momentum_score,
        sm.first_play,
        sm.latest_play
    FROM song_metrics sm
    ORDER BY sm.plays DESC, momentum_score DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Add comments for new functions
COMMENT ON FUNCTION get_song_play_analytics(VARCHAR) IS 'enhanced song analytics with play time calculations and recent activity metrics';
COMMENT ON FUNCTION get_trending_songs(INTEGER, INTEGER, TEXT) IS 'identifies trending songs based on velocity and momentum over specified time period';
COMMENT ON FUNCTION get_user_listening_streaks(UUID) IS 'calculates user engagement patterns including listening streaks and habits';
COMMENT ON FUNCTION get_genre_listening_patterns(INTEGER, INTEGER) IS 'analyzes music taste patterns and genre popularity trends';
COMMENT ON FUNCTION calculate_listening_time_by_period(UUID, TEXT) IS 'aggregates user listening time by hour/day/week/month periods';
COMMENT ON FUNCTION get_popular_songs_by_period(INTEGER, INTEGER, INTEGER) IS 'gets popular songs for a time period with momentum scoring';
