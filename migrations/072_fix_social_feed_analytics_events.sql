-- Fix social feed analytics with simplified progressive grouping
-- This migration implements basic temporal grouping to debug type issues

-- Drop and recreate get_social_feed_items function with simplified approach
DROP FUNCTION IF EXISTS public.get_social_feed_items(bigint, bigint, interval);

CREATE FUNCTION public.get_social_feed_items(p_limit bigint, p_offset bigint, p_days_back interval)
 RETURNS TABLE(item_type text, domain_type text, domain_ids text[], title text, subtitle text, image_url text, metadata jsonb, play_count bigint, last_played_at timestamp with time zone, score double precision, created_at timestamp with time zone, user_id uuid, username text)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    WITH recent_events AS (
        SELECT
            me.domain_type,
            me.domain_ids,
            me.event_type,
            me.event_data,
            me.user_id,
            me.created_at,
            EXTRACT(EPOCH FROM (NOW() - me.created_at)) / 60 as age_minutes,
            CASE
                WHEN me.domain_type = 'song' THEN
                    COALESCE(
                        (SELECT s.title FROM songs s WHERE s.media_blob_id = me.media_blob_id LIMIT 1),
                        'unknown song'
                    )
                WHEN me.domain_type = 'album' THEN
                    COALESCE(
                        me.event_data->>'collection_name',
                        'unknown album'
                    )
                ELSE COALESCE(me.event_data->>'collection_name', 'unknown collection')
            END as collection_name
        FROM media_events me
        WHERE me.created_at >= NOW() - p_days_back
        AND me.domain_type IN ('album', 'playlist', 'artist', 'genre', 'song')
        AND me.event_type IN ('play', 'favorite', 'unfavorite', 'rate')
        AND (array_length(me.domain_ids, 1) > 0 OR me.media_blob_id IS NOT NULL)
        AND me.user_id IS NOT NULL
    ),
    grouped_events AS (
        SELECT
            re.user_id,
            re.domain_type,
            re.domain_ids,
            re.collection_name,
            re.event_type,
            MAX(re.created_at) as latest_activity,
            COUNT(*) FILTER (WHERE re.event_type = 'play') as play_count,
            COUNT(*) as total_events,
            (array_agg(re.event_data ORDER BY re.created_at DESC))[1] as latest_event_data,
            MIN(re.age_minutes) as min_age_minutes
        FROM recent_events re
        GROUP BY re.user_id, re.domain_type, re.domain_ids, re.collection_name, re.event_type,
                 CASE WHEN re.age_minutes < 30 THEN re.created_at ELSE DATE(re.created_at) END
    )
    SELECT
        CASE
            WHEN ge.event_type = 'play' AND ge.domain_type = 'song' THEN 'user_played_song'
            WHEN ge.event_type = 'play' AND ge.domain_type = 'album' THEN 'user_played_album'
            WHEN ge.event_type = 'favorite' THEN 'user_favorited_' || ge.domain_type
            WHEN ge.event_type = 'rate' THEN 'user_rated_' || ge.domain_type
            ELSE 'user_activity'
        END::text as item_type,
        ge.domain_type::text,
        ge.domain_ids,
        ge.collection_name as title,
        CASE
            WHEN ge.event_type = 'favorite' THEN 'added to favorites'
            WHEN ge.event_type = 'rate' THEN
                CASE
                    WHEN (ge.latest_event_data->>'rating')::int = 5 THEN 'rated 5 stars'
                    WHEN (ge.latest_event_data->>'rating')::int = 4 THEN 'rated 4 stars'
                    WHEN (ge.latest_event_data->>'rating')::int = 3 THEN 'rated 3 stars'
                    WHEN (ge.latest_event_data->>'rating')::int = 2 THEN 'rated 2 stars'
                    WHEN (ge.latest_event_data->>'rating')::int = 1 THEN 'rated 1 star'
                    ELSE 'rated'
                END
            WHEN ge.play_count = 1 THEN 'played once'
            WHEN ge.play_count < 5 THEN ge.play_count || ' times'
            WHEN ge.play_count < 20 THEN 'played ' || ge.play_count || ' times'
            ELSE 'played ' || ge.play_count || ' times recently'
        END as subtitle,
        NULL::text as image_url,
        jsonb_build_object(
            'total_songs', NULL,
            'artist_name', CASE WHEN ge.domain_type = 'artist' THEN ge.collection_name ELSE NULL END,
            'album_name', CASE WHEN ge.domain_type = 'album' THEN ge.collection_name ELSE NULL END,
            'playlist_name', CASE WHEN ge.domain_type = 'playlist' THEN ge.collection_name ELSE NULL END,
            'genre_name', CASE WHEN ge.domain_type = 'genre' THEN ge.collection_name ELSE NULL END,
            'user_activity', jsonb_build_object(
                'user_play_count', ge.play_count,
                'total_play_count', ge.play_count,
                'last_activity', ge.latest_activity
            ),
            'social_context', jsonb_build_object(
                'action_type', ge.event_type,
                'frequency', ge.play_count,
                'is_trending', ge.play_count > 10,
                'grouping_level', CASE WHEN ge.min_age_minutes < 30 THEN 'individual' ELSE 'grouped' END,
                'rating', CASE
                    WHEN ge.event_type = 'rate' THEN (ge.latest_event_data->>'rating')::int
                    ELSE NULL
                END
            )
        ) as metadata,
        ge.play_count,
        ge.latest_activity as last_played_at,
        ((EXTRACT(EPOCH FROM ge.latest_activity) / 1000000) + (ge.total_events * 100))::double precision as score,
        ge.latest_activity as created_at,
        ge.user_id as user_id,
        COALESCE(u.username, 'unknown user')::text as username
    FROM grouped_events ge
    LEFT JOIN users u ON u.id = ge.user_id
    ORDER BY score DESC, latest_activity DESC
    LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- Fix get_social_feed_count function
CREATE OR REPLACE FUNCTION public.get_social_feed_count(p_days_back interval)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN (
        SELECT COUNT(DISTINCT (domain_type, domain_ids, user_id,
            CASE
                WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 < 10 THEN created_at
                WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 < 120 THEN
                    date_trunc('hour', created_at) + INTERVAL '15 minutes' * FLOOR(EXTRACT(MINUTE FROM created_at) / 15)
                WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 < 1440 THEN
                    date_trunc('hour', created_at) + INTERVAL '4 hours' * FLOOR(EXTRACT(HOUR FROM created_at) / 4)
                ELSE date_trunc('day', created_at)
            END
        ))
        FROM media_events
        WHERE created_at >= NOW() - p_days_back
        AND domain_type IN ('album', 'playlist', 'artist', 'genre', 'song')
        AND event_type IN ('play', 'favorite', 'unfavorite', 'rate')
        AND (array_length(domain_ids, 1) > 0 OR media_blob_id IS NOT NULL)
    );
END;
$function$;

-- Update function comments
COMMENT ON FUNCTION get_social_feed_items IS 'returns social feed with progressive temporal grouping - more granular for recent events, more consolidated as events age';
COMMENT ON FUNCTION get_social_feed_count IS 'returns count of grouped social feed items using progressive temporal consolidation';
