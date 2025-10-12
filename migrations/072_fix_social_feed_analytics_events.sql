-- Fix social feed to be powered by analytics events instead of querying non-existent tables
-- This migration updates the get_social_feed_items function to use media_events for true social activity

-- Drop and recreate get_social_feed_items function to use analytics events
DROP FUNCTION IF EXISTS public.get_social_feed_items(bigint, bigint, interval);

CREATE FUNCTION public.get_social_feed_items(p_limit bigint, p_offset bigint, p_days_back interval)
 RETURNS TABLE(item_type text, domain_type text, domain_ids text[], title text, subtitle text, image_url text, metadata jsonb, play_count bigint, last_played_at timestamp with time zone, score double precision, created_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Return social feed items based on actual user activity from media_events
    RETURN QUERY
    WITH recent_activity AS (
        SELECT
            me.domain_type,
            me.domain_ids,
            me.event_type,
            me.event_data,
            me.user_id,
            me.created_at,
            -- Extract collection name from event_data if available
            COALESCE(
                me.event_data->>'collection_name',
                CASE
                    WHEN me.domain_type = 'album' THEN 'Unknown Album'
                    WHEN me.domain_type = 'playlist' THEN 'Unknown Playlist'
                    WHEN me.domain_type = 'artist' THEN 'Unknown Artist'
                    WHEN me.domain_type = 'genre' THEN 'Unknown Genre'
                    ELSE 'Unknown Collection'
                END
            ) as collection_name,
            -- Count recent plays for this collection
            COUNT(*) OVER (PARTITION BY me.domain_type, me.domain_ids) as play_count,
            -- Get latest activity time
            MAX(me.created_at) OVER (PARTITION BY me.domain_type, me.domain_ids) as latest_activity
        FROM media_events me
        WHERE me.created_at >= NOW() - p_days_back
        AND me.domain_type IN ('album', 'playlist', 'artist', 'genre')
        AND me.event_type = 'play'  -- Focus on play events for feed
        AND array_length(me.domain_ids, 1) > 0  -- Ensure domain_ids is not empty
    ),
    grouped_activity AS (
        SELECT DISTINCT ON (domain_type, domain_ids)
            domain_type,
            domain_ids,
            collection_name,
            play_count,
            latest_activity as last_played_at,
            latest_activity as created_at,
            -- Score based on recency and play count (more recent and popular = higher score)
            (EXTRACT(EPOCH FROM latest_activity) / 1000000) + (play_count * 100) as score
        FROM recent_activity
        ORDER BY domain_type, domain_ids, latest_activity DESC
    )
    SELECT
        CASE
            WHEN ga.domain_type = 'album' THEN 'recent_album'
            WHEN ga.domain_type = 'playlist' THEN 'recent_playlist'
            WHEN ga.domain_type = 'artist' THEN 'trending_artist'
            WHEN ga.domain_type = 'genre' THEN 'trending_genre'
            ELSE 'user_activity'
        END::text as item_type,
        ga.domain_type::text,
        ga.domain_ids,
        ga.collection_name as title,
        CASE
            WHEN ga.domain_type = 'album' THEN ga.play_count || ' recent plays'
            WHEN ga.domain_type = 'playlist' THEN ga.play_count || ' recent plays'
            WHEN ga.domain_type = 'artist' THEN ga.play_count || ' recent plays'
            WHEN ga.domain_type = 'genre' THEN ga.play_count || ' recent plays'
            ELSE 'recent activity'
        END as subtitle,
        NULL::text as image_url,  -- TODO: add thumbnail support later
        jsonb_build_object(
            'total_songs', NULL,
            'artist_name', CASE WHEN ga.domain_type = 'artist' THEN ga.collection_name ELSE NULL END,
            'album_name', CASE WHEN ga.domain_type = 'album' THEN ga.collection_name ELSE NULL END,
            'playlist_name', CASE WHEN ga.domain_type = 'playlist' THEN ga.collection_name ELSE NULL END,
            'genre_name', CASE WHEN ga.domain_type = 'genre' THEN ga.collection_name ELSE NULL END,
            'user_activity', jsonb_build_object(
                'play_count', ga.play_count,
                'last_activity', ga.last_played_at
            )
        ) as metadata,
        ga.play_count,
        ga.last_played_at,
        ga.score,
        ga.created_at
    FROM grouped_activity ga
    ORDER BY ga.score DESC, ga.last_played_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- Fix get_social_feed_count function to use analytics events
DROP FUNCTION IF EXISTS public.get_social_feed_count(interval);

CREATE FUNCTION public.get_social_feed_count(p_days_back interval)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Count distinct collections that have recent activity
    RETURN (
        SELECT COUNT(DISTINCT (domain_type, domain_ids))
        FROM media_events
        WHERE created_at >= NOW() - p_days_back
        AND domain_type IN ('album', 'playlist', 'artist', 'genre')
        AND event_type = 'play'
        AND array_length(domain_ids, 1) > 0
    );
END;
$function$;

-- Update function comments
COMMENT ON FUNCTION get_social_feed_items IS 'Returns social feed items based on user activity from media_events table';
COMMENT ON FUNCTION get_social_feed_count IS 'Returns count of collections with recent activity from media_events table';
