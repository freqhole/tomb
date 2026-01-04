-- Migration 069: Restore missing SQL functions as stubs for compatibility
-- This migration adds stub versions of the functions that were dropped in 068

-- Restore get_trending_songs function with domain_ids support
CREATE OR REPLACE FUNCTION get_trending_songs(
    time_period_hours integer,
    limit_count integer,
    domain_filter text DEFAULT NULL
)
RETURNS TABLE (
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
    file_size bigint,
    sample_rate integer,
    bit_rate integer,
    channels integer,
    codec text,
    created_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ta.media_blob_id,
        ta.domain_ids,
        ta.play_count as current_period_plays,
        0::bigint as previous_period_plays,
        0.0::double precision as trend_score,
        0.0::double precision as velocity_score,
        ta.unique_users,
        ta.avg_completion_rate as completion_rate,
        s.id as song_id,
        s.title,
        s.artist,
        s.album,
        s.duration,
        s.year,
        s.genre,
        s.file_size,
        s.sample_rate,
        s.bit_rate,
        s.channels,
        s.codec,
        s.created_at
    FROM trending_analysis ta
    LEFT JOIN songs s ON s.media_blob_id = ta.media_blob_id
    WHERE ta.period_name = CASE
        WHEN time_period_hours = 1 THEN 'last_hour'
        WHEN time_period_hours = 6 THEN 'last_6_hours'
        WHEN time_period_hours = 24 THEN 'last_24_hours'
        WHEN time_period_hours = 168 THEN 'last_7_days'
        WHEN time_period_hours = 720 THEN 'last_30_days'
        ELSE 'last_24_hours'
    END
    AND (domain_filter IS NULL OR s.genre = domain_filter)
    ORDER BY ta.play_count DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Restore get_popular_songs_by_period function with domain_ids support
CREATE OR REPLACE FUNCTION get_popular_songs_by_period(
    period_hours integer,
    limit_count integer,
    min_plays integer
)
RETURNS TABLE (
    media_blob_id text,
    domain_ids text[],
    play_count bigint,
    unique_users bigint,
    completion_rate double precision,
    momentum_score double precision,
    first_play_at timestamptz,
    latest_play_at timestamptz,
    song_id uuid,
    title text,
    artist text,
    album text,
    duration integer,
    year integer,
    genre text,
    file_size bigint,
    sample_rate integer,
    bit_rate integer,
    channels integer,
    codec text,
    created_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sps.media_blob_id,
        sps.domain_ids,
        sps.play_count,
        sps.unique_users,
        sps.avg_completion_rate as completion_rate,
        0.0::double precision as momentum_score,
        s.created_at as first_play_at,
        s.created_at as latest_play_at,
        s.id as song_id,
        s.title,
        s.artist,
        s.album,
        s.duration,
        s.year,
        s.genre,
        s.file_size,
        s.sample_rate,
        s.bit_rate,
        s.channels,
        s.codec,
        s.created_at
    FROM song_play_summary sps
    LEFT JOIN songs s ON s.media_blob_id = sps.media_blob_id
    WHERE sps.period_type = 'daily'
    AND sps.play_count >= min_plays
    AND sps.summary_date >= CURRENT_DATE - (period_hours || ' hours')::interval
    ORDER BY sps.play_count DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Add documentation
COMMENT ON FUNCTION get_trending_songs IS 'Trending songs analysis with domain_ids support - simplified stub version';
COMMENT ON FUNCTION get_popular_songs_by_period IS 'Popular songs by time period with domain_ids support - simplified stub version';
