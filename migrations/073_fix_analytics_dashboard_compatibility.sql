-- Fix analytics dashboard compatibility by creating missing functions
-- and ensuring proper function signatures for existing ones

-- Drop and recreate get_top_songs function (was missing)
DROP FUNCTION IF EXISTS public.get_top_songs(integer, integer, integer);

CREATE FUNCTION public.get_top_songs(
    period_hours integer,
    limit_count integer,
    min_plays integer DEFAULT 1
) RETURNS TABLE(
    media_blob_id text,
    domain_ids text[],
    play_count bigint,
    unique_users bigint,
    completion_rate double precision,
    momentum_score double precision,
    first_play_at timestamp with time zone,
    latest_play_at timestamp with time zone,
    song_id uuid,
    title text,
    artist text,
    album text,
    duration integer,
    year integer,
    genre text,
    sub_genres text[],
    file_size bigint,
    sample_rate integer,
    bit_rate integer,
    channels integer,
    codec text,
    created_at timestamp with time zone
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        sps.media_blob_id::text,
        ARRAY[sps.media_blob_id]::text[] as domain_ids,
        sps.total_plays as play_count,
        sps.unique_users,
        sps.avg_completion_rate::double precision as completion_rate,
        0.0::double precision as momentum_score,
        sps.first_play_at,
        sps.latest_play_at,
        sps.song_id,
        sps.title,
        sps.artist,
        sps.album,
        EXTRACT(EPOCH FROM sps.duration_seconds)::integer as duration,
        sps.year,
        sps.genre,
        sps.sub_genres,
        0::bigint as file_size,
        0 as sample_rate,
        0 as bit_rate,
        0 as channels,
        ''::text as codec,
        sps.created_at
    FROM song_play_summary sps
    WHERE sps.total_plays >= min_plays
    ORDER BY sps.total_plays DESC
    LIMIT limit_count;
END;
$$;

-- Create song_play_summary materialized view for legacy compatibility
DROP MATERIALIZED VIEW IF EXISTS public.song_play_summary;

CREATE MATERIALIZED VIEW public.song_play_summary AS
SELECT
    s.id as song_id,
    s.media_blob_id,
    s.title,
    s.artist,
    s.album,
    s.duration as duration_seconds,
    s.year,
    s.genre,
    s.sub_genres,
    COUNT(me.id) as total_plays,
    COUNT(DISTINCT me.user_id) as unique_users,
    AVG(CASE
        WHEN me.event_data->>'completion_percentage' IS NOT NULL
        THEN (me.event_data->>'completion_percentage')::numeric / 100.0
        ELSE 0.9 -- Default completion rate for plays without percentage
    END) as avg_completion_rate,
    MIN(me.created_at) as first_play_at,
    MAX(me.created_at) as latest_play_at,
    s.created_at
FROM songs s
LEFT JOIN media_events me ON s.media_blob_id = ANY(me.domain_ids)
    OR s.media_blob_id = me.media_blob_id
WHERE s.deleted_at IS NULL
    AND (me.event_type = 'play' OR me.id IS NULL)
GROUP BY s.id, s.media_blob_id, s.title, s.artist, s.album,
         s.duration, s.year, s.genre, s.sub_genres, s.created_at;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_song_play_summary_plays
ON song_play_summary(total_plays DESC);

CREATE INDEX IF NOT EXISTS idx_song_play_summary_latest
ON song_play_summary(latest_play_at DESC);

-- Fix get_trending_songs function signature to match analytics API expectations
DROP FUNCTION IF EXISTS public.get_trending_songs(integer, integer, text);

CREATE FUNCTION public.get_trending_songs(
    time_period_hours integer,
    limit_count integer,
    domain_filter text DEFAULT NULL
) RETURNS TABLE(
    media_blob_id text,
    domain_ids text[],
    current_period_plays bigint,
    previous_period_plays bigint,
    trend_score double precision,
    velocity_score double precision,
    unique_users bigint,
    completion_rate double precision,
    song_id uuid,
    title text,
    artist text,
    album text,
    duration integer,
    year integer,
    genre text,
    sub_genres text[],
    file_size bigint,
    sample_rate integer,
    bit_rate integer,
    channels integer,
    codec text,
    created_at timestamp with time zone
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    WITH current_period AS (
        SELECT
            s.id as song_id,
            s.media_blob_id,
            s.title,
            s.artist,
            s.album,
            s.duration,
            s.year,
            s.genre,
            s.sub_genres,
            s.created_at,
            COUNT(me.id) as plays,
            COUNT(DISTINCT me.user_id) as users,
            AVG(CASE
                WHEN me.event_data->>'completion_percentage' IS NOT NULL
                THEN (me.event_data->>'completion_percentage')::numeric / 100.0
                ELSE 0.9
            END) as completion_rate
        FROM songs s
        LEFT JOIN media_events me ON (s.media_blob_id = ANY(me.domain_ids) OR s.media_blob_id = me.media_blob_id)
            AND me.event_type = 'play'
            AND me.created_at >= NOW() - (time_period_hours * INTERVAL '1 hour')
        WHERE s.deleted_at IS NULL
            AND (domain_filter IS NULL OR domain_filter = 'song')
        GROUP BY s.id, s.media_blob_id, s.title, s.artist, s.album, s.duration,
                 s.year, s.genre, s.sub_genres, s.created_at
    ),
    previous_period AS (
        SELECT
            s.media_blob_id,
            COUNT(me.id) as plays
        FROM songs s
        LEFT JOIN media_events me ON (s.media_blob_id = ANY(me.domain_ids) OR s.media_blob_id = me.media_blob_id)
            AND me.event_type = 'play'
            AND me.created_at >= NOW() - (time_period_hours * 2 * INTERVAL '1 hour')
            AND me.created_at < NOW() - (time_period_hours * INTERVAL '1 hour')
        WHERE s.deleted_at IS NULL
        GROUP BY s.media_blob_id
    )
    SELECT
        cp.media_blob_id::text,
        ARRAY[cp.media_blob_id]::text[] as domain_ids,
        cp.plays as current_period_plays,
        COALESCE(pp.plays, 0) as previous_period_plays,
        CASE
            WHEN COALESCE(pp.plays, 0) = 0 THEN cp.plays::double precision * 2.0
            ELSE cp.plays::double precision / NULLIF(pp.plays::double precision, 0)
        END as trend_score,
        (cp.plays::double precision / GREATEST(time_period_hours::double precision / 24.0, 1.0)) as velocity_score,
        cp.users as unique_users,
        cp.completion_rate::double precision as completion_rate,
        cp.song_id,
        cp.title,
        cp.artist,
        cp.album,
        EXTRACT(EPOCH FROM cp.duration)::integer as duration,
        cp.year,
        cp.genre,
        cp.sub_genres,
        0::bigint as file_size,
        0 as sample_rate,
        0 as bit_rate,
        0 as channels,
        ''::text as codec,
        cp.created_at
    FROM current_period cp
    LEFT JOIN previous_period pp ON cp.media_blob_id = pp.media_blob_id
    WHERE cp.plays > 0
    ORDER BY
        CASE
            WHEN COALESCE(pp.plays, 0) = 0 THEN cp.plays::double precision * 2.0
            ELSE cp.plays::double precision / NULLIF(pp.plays::double precision, 0)
        END DESC,
        cp.plays DESC
    LIMIT limit_count;
END;
$$;

-- Add helper function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW song_play_summary;

    -- Log the refresh
    INSERT INTO analytics_jobs (job_type, status, created_at, completed_at)
    VALUES ('refresh_materialized_views', 'completed', NOW(), NOW());

EXCEPTION WHEN OTHERS THEN
    -- Log the error
    INSERT INTO analytics_jobs (job_type, status, error_message, created_at, completed_at)
    VALUES ('refresh_materialized_views', 'failed', SQLERRM, NOW(), NOW());
    RAISE;
END;
$$;

-- Create a function to get analytics overview that doesn't rely on missing tables
CREATE OR REPLACE FUNCTION get_analytics_overview()
RETURNS TABLE(
    total_events bigint,
    total_plays bigint,
    unique_users bigint,
    active_sessions bigint
) LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM media_events) as total_events,
        (SELECT COUNT(*) FROM media_events WHERE event_type = 'play') as total_plays,
        (SELECT COUNT(DISTINCT user_id) FROM media_events WHERE user_id IS NOT NULL) as unique_users,
        (SELECT COUNT(DISTINCT user_id) FROM media_events
         WHERE created_at >= NOW() - INTERVAL '1 hour' AND user_id IS NOT NULL) as active_sessions;
END;
$$;

-- Update function comments
COMMENT ON FUNCTION get_top_songs IS 'Returns top songs by play count for analytics dashboard';
COMMENT ON FUNCTION get_trending_songs IS 'Returns trending songs with trend analysis for analytics dashboard';
COMMENT ON FUNCTION refresh_analytics_views IS 'Refreshes materialized views for analytics dashboard';
COMMENT ON FUNCTION get_analytics_overview IS 'Returns basic analytics overview metrics';
COMMENT ON MATERIALIZED VIEW song_play_summary IS 'Materialized view for song play statistics';
