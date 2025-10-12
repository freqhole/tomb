-- Fix social feed to be powered by analytics events instead of querying non-existent tables
-- This migration updates the get_social_feed_items function to use media_events for true social activity

-- Drop and recreate get_social_feed_items function to use analytics events
DROP FUNCTION IF EXISTS public.get_social_feed_items(bigint, bigint, interval);

CREATE FUNCTION public.get_social_feed_items(p_limit bigint, p_offset bigint, p_days_back interval)
 RETURNS TABLE(item_type text, domain_type text, domain_ids text[], title text, subtitle text, image_url text, metadata jsonb, play_count bigint, last_played_at timestamp with time zone, score double precision, created_at timestamp with time zone, user_id uuid, username text)
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Return social feed items with user attribution for true social timeline
    RETURN QUERY
    WITH recent_activity AS (
        SELECT
            me.domain_type,
            me.domain_ids,
            me.event_type,
            me.event_data,
            me.user_id,
            me.created_at,
            -- Get actual current collection name from domain_ids
            CASE
                WHEN me.domain_type = 'album' THEN
                    COALESCE(
                        (SELECT DISTINCT s.album || ' by ' || s.artist
                         FROM songs s
                         WHERE s.media_blob_id = ANY(me.domain_ids)
                         AND s.album IS NOT NULL AND s.artist IS NOT NULL
                         LIMIT 1),
                        me.event_data->>'collection_name',
                        'Unknown Album'
                    )
                WHEN me.domain_type = 'playlist' THEN
                    COALESCE(
                        (SELECT p.title FROM playlists p WHERE p.id::text = ANY(me.domain_ids) LIMIT 1),
                        me.event_data->>'collection_name',
                        'Unknown Playlist'
                    )
                WHEN me.domain_type = 'artist' THEN
                    COALESCE(
                        (SELECT DISTINCT s.artist
                         FROM songs s
                         WHERE s.media_blob_id = ANY(me.domain_ids)
                         AND s.artist IS NOT NULL
                         LIMIT 1),
                        me.event_data->>'collection_name',
                        'Unknown Artist'
                    )
                WHEN me.domain_type = 'genre' THEN
                    COALESCE(
                        (SELECT DISTINCT s.genre
                         FROM songs s
                         WHERE s.media_blob_id = ANY(me.domain_ids)
                         AND s.genre IS NOT NULL
                         LIMIT 1),
                        me.event_data->>'collection_name',
                        'Unknown Genre'
                    )
                ELSE 'Unknown Collection'
            END as collection_name,
            -- Count recent plays for this collection by this user
            COUNT(*) OVER (PARTITION BY me.domain_type, me.domain_ids, me.user_id) as user_play_count,
            -- Total plays across all users
            COUNT(*) OVER (PARTITION BY me.domain_type, me.domain_ids) as total_play_count,
            -- Get latest activity time for this user and collection
            MAX(me.created_at) OVER (PARTITION BY me.domain_type, me.domain_ids, me.user_id) as latest_user_activity,
            -- Get latest activity time overall for this collection
            MAX(me.created_at) OVER (PARTITION BY me.domain_type, me.domain_ids) as latest_activity
        FROM media_events me
        WHERE me.created_at >= NOW() - p_days_back
        AND me.domain_type IN ('album', 'playlist', 'artist', 'genre')
        AND me.event_type = 'play'  -- Focus on play events for feed
        AND array_length(me.domain_ids, 1) > 0  -- Ensure domain_ids is not empty
        AND me.user_id IS NOT NULL  -- Only include events with user attribution
    ),
    grouped_activity AS (
        SELECT DISTINCT ON (ra.domain_type, ra.domain_ids, ra.user_id)
            ra.domain_type,
            ra.domain_ids,
            ra.collection_name,
            ra.user_id,
            ra.user_play_count,
            ra.total_play_count,
            ra.latest_user_activity as last_played_at,
            ra.latest_user_activity as created_at,
            -- Score based on recency and user activity (more recent and active = higher score)
            ((EXTRACT(EPOCH FROM ra.latest_user_activity) / 1000000) + (ra.user_play_count * 100))::double precision as score
        FROM recent_activity ra
        ORDER BY ra.domain_type, ra.domain_ids, ra.user_id, ra.latest_user_activity DESC
    )
    SELECT
        CASE
            WHEN ga.domain_type = 'album' THEN 'user_played_album'
            WHEN ga.domain_type = 'playlist' THEN 'user_played_playlist'
            WHEN ga.domain_type = 'artist' THEN 'user_played_artist'
            WHEN ga.domain_type = 'genre' THEN 'user_played_genre'
            ELSE 'user_activity'
        END::text as item_type,
        ga.domain_type::text,
        ga.domain_ids,
        ga.collection_name as title,
        CASE
            WHEN ga.user_play_count = 1 THEN 'played once'
            WHEN ga.user_play_count < 5 THEN ga.user_play_count || ' times'
            WHEN ga.user_play_count < 20 THEN 'played ' || ga.user_play_count || ' times'
            ELSE 'played ' || ga.user_play_count || ' times recently'
        END as subtitle,
        NULL::text as image_url,  -- TODO: add thumbnail support later
        jsonb_build_object(
            'total_songs', NULL,
            'artist_name', CASE WHEN ga.domain_type = 'artist' THEN ga.collection_name ELSE NULL END,
            'album_name', CASE WHEN ga.domain_type = 'album' THEN ga.collection_name ELSE NULL END,
            'playlist_name', CASE WHEN ga.domain_type = 'playlist' THEN ga.collection_name ELSE NULL END,
            'genre_name', CASE WHEN ga.domain_type = 'genre' THEN ga.collection_name ELSE NULL END,
            'user_activity', jsonb_build_object(
                'user_play_count', ga.user_play_count,
                'total_play_count', ga.total_play_count,
                'last_activity', ga.last_played_at
            ),
            'social_context', jsonb_build_object(
                'action_type', 'play',
                'frequency', ga.user_play_count,
                'is_trending', ga.total_play_count > 10
            )
        ) as metadata,
        ga.user_play_count as play_count,
        ga.last_played_at,
        ga.score,
        ga.created_at,
        ga.user_id,
        COALESCE(u.username, 'unknown user')::text as username
    FROM grouped_activity ga
    LEFT JOIN users u ON u.id = ga.user_id
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
COMMENT ON FUNCTION get_social_feed_items IS 'Returns social feed items with user attribution for true social timeline';
COMMENT ON FUNCTION get_social_feed_count IS 'Returns count of collections with recent activity from media_events table';
