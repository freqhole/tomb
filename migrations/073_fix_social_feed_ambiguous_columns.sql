-- Fix ambiguous column reference in get_social_feed_items function
-- This migration adds proper table aliases to resolve SQL ambiguity

-- Drop and recreate get_social_feed_items function with proper table aliases
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
        SELECT DISTINCT ON (ra.domain_type, ra.domain_ids)
            ra.domain_type,
            ra.domain_ids,
            ra.collection_name,
            ra.play_count,
            ra.latest_activity as last_played_at,
            ra.latest_activity as created_at,
            -- Score based on recency and play count (more recent and popular = higher score)
            (EXTRACT(EPOCH FROM ra.latest_activity) / 1000000) + (ra.play_count * 100) as score
        FROM recent_activity ra
        ORDER BY ra.domain_type, ra.domain_ids, ra.latest_activity DESC
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

-- Update function comment
COMMENT ON FUNCTION get_social_feed_items IS 'Returns social feed items based on user activity from media_events table (fixed ambiguous columns)';
