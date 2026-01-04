-- Analytics Materialized Views for Performance Optimization
-- This migration creates materialized views to optimize analytics queries
-- for daily/weekly/monthly aggregations and trending analysis

-- Materialized view for song play summary by time period
CREATE MATERIALIZED VIEW song_play_summary AS
WITH daily_stats AS (
    SELECT
        me.media_blob_id,
        me.domain_id,
        date_trunc('day', me.created_at)::DATE as summary_date,
        COUNT(*) FILTER (WHERE event_type = 'play') as daily_plays,
        COUNT(*) FILTER (WHERE event_type = 'complete') as daily_completes,
        COUNT(DISTINCT user_id) as daily_unique_users,
        COUNT(DISTINCT session_id) as daily_unique_sessions,
        SUM(CASE
            WHEN event_data->>'duration' IS NOT NULL
            THEN (event_data->>'duration')::BIGINT
            ELSE 0
        END) as daily_listening_seconds,
        AVG(CASE
            WHEN event_type = 'complete' THEN 1.0
            WHEN event_type = 'play' AND event_data->>'progress' IS NOT NULL
            THEN (event_data->>'progress')::FLOAT
            ELSE 0.0
        END) as daily_avg_completion_rate
    FROM media_events me
    WHERE me.domain_type = 'song'
    AND me.created_at >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY me.media_blob_id, me.domain_id, date_trunc('day', me.created_at)::DATE
),
weekly_stats AS (
    SELECT
        media_blob_id,
        domain_id,
        date_trunc('week', summary_date)::DATE as week_start,
        SUM(daily_plays) as weekly_plays,
        SUM(daily_completes) as weekly_completes,
        AVG(daily_unique_users) as avg_daily_users,
        SUM(daily_listening_seconds) as weekly_listening_seconds,
        AVG(daily_avg_completion_rate) as weekly_avg_completion_rate
    FROM daily_stats
    GROUP BY media_blob_id, domain_id, date_trunc('week', summary_date)::DATE
),
monthly_stats AS (
    SELECT
        media_blob_id,
        domain_id,
        date_trunc('month', summary_date)::DATE as month_start,
        SUM(daily_plays) as monthly_plays,
        SUM(daily_completes) as monthly_completes,
        AVG(daily_unique_users) as avg_daily_users,
        SUM(daily_listening_seconds) as monthly_listening_seconds,
        AVG(daily_avg_completion_rate) as monthly_avg_completion_rate
    FROM daily_stats
    GROUP BY media_blob_id, domain_id, date_trunc('month', summary_date)::DATE
)
SELECT
    ds.media_blob_id,
    ds.domain_id,
    ds.summary_date,
    'daily' as period_type,
    ds.daily_plays as play_count,
    ds.daily_completes as complete_count,
    ds.daily_unique_users as unique_users,
    ds.daily_unique_sessions as unique_sessions,
    ds.daily_listening_seconds as listening_seconds,
    ds.daily_avg_completion_rate as avg_completion_rate,
    ROW_NUMBER() OVER (PARTITION BY ds.summary_date ORDER BY ds.daily_plays DESC) as daily_rank
FROM daily_stats ds
WHERE ds.daily_plays > 0

UNION ALL

SELECT
    ws.media_blob_id,
    ws.domain_id,
    ws.week_start as summary_date,
    'weekly' as period_type,
    ws.weekly_plays as play_count,
    ws.weekly_completes as complete_count,
    ws.avg_daily_users::BIGINT as unique_users,
    0 as unique_sessions, -- not meaningful for weekly aggregation
    ws.weekly_listening_seconds as listening_seconds,
    ws.weekly_avg_completion_rate as avg_completion_rate,
    ROW_NUMBER() OVER (PARTITION BY ws.week_start ORDER BY ws.weekly_plays DESC) as daily_rank
FROM weekly_stats ws
WHERE ws.weekly_plays > 0

UNION ALL

SELECT
    ms.media_blob_id,
    ms.domain_id,
    ms.month_start as summary_date,
    'monthly' as period_type,
    ms.monthly_plays as play_count,
    ms.monthly_completes as complete_count,
    ms.avg_daily_users::BIGINT as unique_users,
    0 as unique_sessions, -- not meaningful for monthly aggregation
    ms.monthly_listening_seconds as listening_seconds,
    ms.monthly_avg_completion_rate as avg_completion_rate,
    ROW_NUMBER() OVER (PARTITION BY ms.month_start ORDER BY ms.monthly_plays DESC) as daily_rank
FROM monthly_stats ms
WHERE ms.monthly_plays > 0;

-- Materialized view for user engagement metrics
CREATE MATERIALIZED VIEW user_listening_summary AS
WITH daily_user_stats AS (
    SELECT
        me.user_id,
        date_trunc('day', me.created_at)::DATE as activity_date,
        COUNT(*) FILTER (WHERE event_type = 'play') as daily_plays,
        COUNT(*) FILTER (WHERE event_type = 'complete') as daily_completes,
        COUNT(DISTINCT media_blob_id) as daily_unique_songs,
        COUNT(DISTINCT session_id) as daily_sessions,
        SUM(CASE
            WHEN event_data->>'duration' IS NOT NULL
            THEN (event_data->>'duration')::BIGINT
            ELSE 0
        END) as daily_listening_seconds,
        EXTRACT(hour FROM me.created_at) as hour_of_day,
        EXTRACT(dow FROM me.created_at) as day_of_week
    FROM media_events me
    WHERE me.user_id IS NOT NULL
    AND me.domain_type = 'song'
    AND me.created_at >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY me.user_id, date_trunc('day', me.created_at)::DATE,
             EXTRACT(hour FROM me.created_at), EXTRACT(dow FROM me.created_at)
),
user_summary AS (
    SELECT
        user_id,
        activity_date,
        'daily' as period_type,
        SUM(daily_plays) as total_plays,
        SUM(daily_completes) as total_completes,
        SUM(daily_unique_songs) as unique_songs,
        SUM(daily_sessions) as sessions,
        SUM(daily_listening_seconds) as listening_seconds,
        CASE WHEN SUM(daily_plays) > 0
             THEN (SUM(daily_completes) * 100.0 / SUM(daily_plays))::DECIMAL(5,2)
             ELSE 0 END as completion_rate,
        -- Most active hour and day of week for this day
        (SELECT hour_of_day FROM daily_user_stats dus2
         WHERE dus2.user_id = dus.user_id AND dus2.activity_date = dus.activity_date
         GROUP BY hour_of_day ORDER BY COUNT(*) DESC LIMIT 1) as most_active_hour,
        day_of_week as day_of_week
    FROM daily_user_stats dus
    GROUP BY user_id, activity_date, day_of_week
),
weekly_summary AS (
    SELECT
        user_id,
        date_trunc('week', activity_date)::DATE as summary_date,
        'weekly' as period_type,
        SUM(total_plays) as total_plays,
        SUM(total_completes) as total_completes,
        AVG(unique_songs) as unique_songs,
        SUM(sessions) as sessions,
        SUM(listening_seconds) as listening_seconds,
        AVG(completion_rate) as completion_rate,
        MODE() WITHIN GROUP (ORDER BY most_active_hour) as most_active_hour,
        MODE() WITHIN GROUP (ORDER BY day_of_week) as day_of_week
    FROM user_summary
    GROUP BY user_id, date_trunc('week', activity_date)::DATE
),
monthly_summary AS (
    SELECT
        user_id,
        date_trunc('month', activity_date)::DATE as summary_date,
        'monthly' as period_type,
        SUM(total_plays) as total_plays,
        SUM(total_completes) as total_completes,
        AVG(unique_songs) as unique_songs,
        SUM(sessions) as sessions,
        SUM(listening_seconds) as listening_seconds,
        AVG(completion_rate) as completion_rate,
        MODE() WITHIN GROUP (ORDER BY most_active_hour) as most_active_hour,
        MODE() WITHIN GROUP (ORDER BY day_of_week) as day_of_week
    FROM user_summary
    GROUP BY user_id, date_trunc('month', activity_date)::DATE
)
SELECT * FROM (
    SELECT
        user_id,
        activity_date as summary_date,
        period_type,
        total_plays,
        total_completes,
        unique_songs::BIGINT,
        sessions,
        listening_seconds,
        completion_rate,
        most_active_hour::INTEGER,
        day_of_week::INTEGER
    FROM user_summary

    UNION ALL

    SELECT
        user_id,
        summary_date,
        period_type,
        total_plays,
        total_completes,
        unique_songs::BIGINT,
        sessions,
        listening_seconds,
        completion_rate,
        most_active_hour::INTEGER,
        day_of_week::INTEGER
    FROM weekly_summary

    UNION ALL

    SELECT
        user_id,
        summary_date,
        period_type,
        total_plays,
        total_completes,
        unique_songs::BIGINT,
        sessions,
        listening_seconds,
        completion_rate,
        most_active_hour::INTEGER,
        day_of_week::INTEGER
    FROM monthly_summary
) combined_summary
WHERE total_plays > 0;

-- Materialized view for trending analysis
CREATE MATERIALIZED VIEW trending_analysis AS
WITH time_periods AS (
    SELECT
        24 as hours,
        'daily' as period_name
    UNION ALL
    SELECT
        24 * 7 as hours,
        'weekly' as period_name
),
trending_base AS (
    SELECT
        tp.period_name,
        tp.hours,
        me.media_blob_id,
        me.domain_id,
        -- Current period metrics
        COUNT(*) FILTER (WHERE event_type = 'play' AND
            me.created_at >= NOW() - INTERVAL '1 hour' * tp.hours) as current_plays,
        COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'play' AND
            me.created_at >= NOW() - INTERVAL '1 hour' * tp.hours) as current_users,
        COUNT(*) FILTER (WHERE event_type = 'complete' AND
            me.created_at >= NOW() - INTERVAL '1 hour' * tp.hours) as current_completes,

        -- Previous period metrics
        COUNT(*) FILTER (WHERE event_type = 'play' AND
            me.created_at >= NOW() - INTERVAL '1 hour' * (tp.hours * 2) AND
            me.created_at < NOW() - INTERVAL '1 hour' * tp.hours) as previous_plays,
        COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'play' AND
            me.created_at >= NOW() - INTERVAL '1 hour' * (tp.hours * 2) AND
            me.created_at < NOW() - INTERVAL '1 hour' * tp.hours) as previous_users,

        -- Momentum calculations
        MIN(me.created_at) FILTER (WHERE event_type = 'play' AND
            me.created_at >= NOW() - INTERVAL '1 hour' * tp.hours) as first_play_current,
        MAX(me.created_at) FILTER (WHERE event_type = 'play' AND
            me.created_at >= NOW() - INTERVAL '1 hour' * tp.hours) as last_play_current
    FROM media_events me
    CROSS JOIN time_periods tp
    WHERE me.domain_type = 'song'
    AND me.created_at >= NOW() - INTERVAL '1 hour' * (tp.hours * 2)
    GROUP BY tp.period_name, tp.hours, me.media_blob_id, me.domain_id
)
SELECT
    period_name,
    media_blob_id,
    domain_id,
    current_plays,
    previous_plays,
    current_users,
    previous_users,
    -- Trend score: current plays relative to previous period
    CASE WHEN previous_plays > 0
         THEN (current_plays::DECIMAL / previous_plays)
         ELSE CASE WHEN current_plays > 0 THEN 999.0 ELSE 0.0 END
    END as trend_score,
    -- Velocity score: plays per hour in current period
    (current_plays::DECIMAL / hours) as velocity_score,
    -- Completion rate
    CASE WHEN current_plays > 0
         THEN (current_completes * 100.0 / current_plays)::DECIMAL(5,2)
         ELSE 0 END as completion_rate,
    -- Momentum score: considering time distribution
    CASE WHEN current_plays > 1 AND first_play_current IS NOT NULL AND last_play_current IS NOT NULL
         THEN (current_plays::DECIMAL / GREATEST(
             EXTRACT(EPOCH FROM (last_play_current - first_play_current)) / 3600.0, 0.1))
         ELSE current_plays::DECIMAL END as momentum_score,
    first_play_current,
    last_play_current,
    NOW() as calculated_at
FROM trending_base
WHERE current_plays >= 1; -- minimum threshold for trending

-- Create indexes for optimal performance
CREATE INDEX idx_song_play_summary_lookup ON song_play_summary(media_blob_id, period_type, summary_date DESC);
CREATE INDEX idx_song_play_summary_ranking ON song_play_summary(period_type, summary_date, daily_rank);
CREATE INDEX idx_song_play_summary_plays ON song_play_summary(period_type, play_count DESC);

CREATE INDEX idx_user_listening_summary_user ON user_listening_summary(user_id, period_type, summary_date DESC);
CREATE INDEX idx_user_listening_summary_activity ON user_listening_summary(period_type, summary_date, total_plays DESC);

CREATE INDEX idx_trending_analysis_period ON trending_analysis(period_name, trend_score DESC);
CREATE INDEX idx_trending_analysis_velocity ON trending_analysis(period_name, velocity_score DESC);
CREATE INDEX idx_trending_analysis_momentum ON trending_analysis(period_name, momentum_score DESC);

-- Create functions to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_song_play_summary()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW song_play_summary;
    RAISE NOTICE 'song_play_summary materialized view refreshed at %', NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_user_listening_summary()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW user_listening_summary;
    RAISE NOTICE 'user_listening_summary materialized view refreshed at %', NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_trending_analysis()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW trending_analysis;
    RAISE NOTICE 'trending_analysis materialized view refreshed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a function to refresh all analytics materialized views
CREATE OR REPLACE FUNCTION refresh_all_analytics_views()
RETURNS TABLE (view_name TEXT, refresh_duration INTERVAL) AS $$
DECLARE
    start_time TIMESTAMPTZ;
    end_time TIMESTAMPTZ;
BEGIN
    -- Refresh song_play_summary
    start_time := NOW();
    PERFORM refresh_song_play_summary();
    end_time := NOW();
    RETURN QUERY SELECT 'song_play_summary'::TEXT, (end_time - start_time);

    -- Refresh user_listening_summary
    start_time := NOW();
    PERFORM refresh_user_listening_summary();
    end_time := NOW();
    RETURN QUERY SELECT 'user_listening_summary'::TEXT, (end_time - start_time);

    -- Refresh trending_analysis
    start_time := NOW();
    PERFORM refresh_trending_analysis();
    end_time := NOW();
    RETURN QUERY SELECT 'trending_analysis'::TEXT, (end_time - start_time);
END;
$$ LANGUAGE plpgsql;

-- Create optimized query functions that use materialized views
CREATE OR REPLACE FUNCTION get_top_songs_from_materialized(
    period_type_param TEXT DEFAULT 'daily',
    limit_count INTEGER DEFAULT 20,
    date_filter DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    media_blob_id VARCHAR(16),
    domain_id UUID,
    play_count BIGINT,
    complete_count BIGINT,
    unique_users BIGINT,
    completion_rate DECIMAL(5,2),
    daily_rank BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sps.media_blob_id,
        sps.domain_id,
        sps.play_count::BIGINT,
        sps.complete_count::BIGINT,
        sps.unique_users,
        sps.avg_completion_rate::DECIMAL(5,2),
        sps.daily_rank
    FROM song_play_summary sps
    WHERE sps.period_type = period_type_param
    AND (period_type_param != 'daily' OR sps.summary_date = date_filter)
    AND (period_type_param != 'weekly' OR sps.summary_date = date_trunc('week', date_filter::TIMESTAMPTZ)::DATE)
    AND (period_type_param != 'monthly' OR sps.summary_date = date_trunc('month', date_filter::TIMESTAMPTZ)::DATE)
    ORDER BY sps.play_count DESC, sps.complete_count DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_trending_from_materialized(
    period_name_param TEXT DEFAULT 'daily',
    limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
    media_blob_id VARCHAR(16),
    domain_id UUID,
    current_plays BIGINT,
    previous_plays BIGINT,
    trend_score DECIMAL(10,4),
    velocity_score DECIMAL(10,4),
    momentum_score DECIMAL(10,4),
    completion_rate DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ta.media_blob_id,
        ta.domain_id,
        ta.current_plays::BIGINT,
        ta.previous_plays::BIGINT,
        ta.trend_score::DECIMAL(10,4),
        ta.velocity_score::DECIMAL(10,4),
        ta.momentum_score::DECIMAL(10,4),
        ta.completion_rate
    FROM trending_analysis ta
    WHERE ta.period_name = period_name_param
    ORDER BY ta.trend_score DESC, ta.velocity_score DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON MATERIALIZED VIEW song_play_summary IS 'pre-aggregated song play statistics by day/week/month for fast analytics queries';
COMMENT ON MATERIALIZED VIEW user_listening_summary IS 'pre-aggregated user engagement metrics by time period';
COMMENT ON MATERIALIZED VIEW trending_analysis IS 'pre-calculated trending scores and momentum for songs';

COMMENT ON FUNCTION refresh_all_analytics_views() IS 'refreshes all analytics materialized views and returns timing information';
COMMENT ON FUNCTION get_top_songs_from_materialized(TEXT, INTEGER, DATE) IS 'fast top songs query using materialized view data';
COMMENT ON FUNCTION get_trending_from_materialized(TEXT, INTEGER) IS 'fast trending songs query using materialized view data';
