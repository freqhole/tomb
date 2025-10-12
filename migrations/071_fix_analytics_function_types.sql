-- Fix analytics function type mismatches causing dashboard errors
-- This migration fixes return type mismatches between SQL functions and Rust structs

-- Drop and recreate get_popular_songs_by_period function with proper types
DROP FUNCTION IF EXISTS public.get_popular_songs_by_period(integer, integer, integer);

CREATE FUNCTION public.get_popular_songs_by_period(period_hours integer, limit_count integer, min_plays integer)
 RETURNS TABLE(media_blob_id text, domain_ids text[], play_count bigint, unique_users bigint, completion_rate double precision, momentum_score double precision, first_play_at timestamp with time zone, latest_play_at timestamp with time zone, song_id uuid, title text, artist text, album text, duration integer, year integer, genre text, sub_genres text[], file_size bigint, sample_rate integer, bit_rate integer, channels integer, codec text, created_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        sps.media_blob_id::text,
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
        EXTRACT(EPOCH FROM s.duration)::integer as duration,
        s.year,
        s.genre,
        s.sub_genres,
        mb.size as file_size,
        COALESCE((mb.metadata->>'sample_rate')::integer, 0) as sample_rate,
        COALESCE((mb.metadata->>'bit_rate')::integer, 0) as bit_rate,
        COALESCE((mb.metadata->>'channels')::integer, 0) as channels,
        COALESCE(mb.metadata->>'codec', '') as codec,
        s.created_at
    FROM song_play_summary sps
    LEFT JOIN songs s ON s.media_blob_id = sps.media_blob_id
    LEFT JOIN media_blobs mb ON mb.id = sps.media_blob_id
    WHERE sps.period_type = 'daily'
    AND sps.play_count >= min_plays
    AND sps.summary_date >= CURRENT_DATE - (period_hours || ' hours')::interval
    ORDER BY sps.play_count DESC
    LIMIT limit_count;
END;
$function$;

-- Drop and recreate get_song_play_analytics function with proper types
DROP FUNCTION IF EXISTS public.get_song_play_analytics(character varying);

CREATE FUNCTION public.get_song_play_analytics(p_media_blob_id character varying)
 RETURNS TABLE(media_blob_id text, total_plays bigint, complete_plays bigint, partial_plays bigint, unique_users bigint, unique_sessions bigint, avg_completion_rate numeric, total_play_time_seconds bigint, avg_play_time_seconds numeric, last_played_at timestamp with time zone, first_played_at timestamp with time zone, play_count_last_24h bigint, play_count_last_7d bigint, play_count_last_30d bigint)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        p_media_blob_id::text,
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
            ELSE 0.0
        END), 0)::DECIMAL(10,2) as avg_play_time_seconds,
        MAX(created_at) as last_played_at,
        MIN(created_at) as first_played_at,
        COUNT(*) FILTER (WHERE event_type = 'play' AND created_at >= NOW() - INTERVAL '24 hours')::BIGINT as play_count_last_24h,
        COUNT(*) FILTER (WHERE event_type = 'play' AND created_at >= NOW() - INTERVAL '7 days')::BIGINT as play_count_last_7d,
        COUNT(*) FILTER (WHERE event_type = 'play' AND created_at >= NOW() - INTERVAL '30 days')::BIGINT as play_count_last_30d
    FROM media_events
    WHERE media_blob_id = p_media_blob_id;
END;
$function$;

-- Refresh materialized views to ensure they work with fixed functions
REFRESH MATERIALIZED VIEW analytics_dashboard;

-- Analytics jobs updated - functions are now compatible with dashboard
