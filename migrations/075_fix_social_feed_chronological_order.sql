-- Fix social feed chronological ordering by prioritizing time over artificial scoring
-- This ensures individual items show before sessions when they're more recent

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
            me.media_blob_id,
            EXTRACT(EPOCH FROM (NOW() - me.created_at)) / 60 as age_minutes,
            -- Session gap detection using window functions
            COALESCE(
                EXTRACT(EPOCH FROM (me.created_at - LAG(me.created_at) OVER (
                    PARTITION BY me.user_id ORDER BY me.created_at
                ))) / 60, 0
            ) as gap_minutes,
            CASE
                WHEN me.domain_type = 'song' THEN
                    COALESCE(
                        (SELECT s.title FROM songs s WHERE s.media_blob_id = me.media_blob_id LIMIT 1),
                        'unknown song'
                    )
                WHEN me.domain_type = 'album' THEN
                    COALESCE(
                        (SELECT DISTINCT s.album || ' by ' || s.artist
                         FROM songs s
                         WHERE s.media_blob_id = ANY(me.domain_ids)
                         AND s.album IS NOT NULL AND s.artist IS NOT NULL
                         LIMIT 1),
                        me.event_data->>'collection_name',
                        'unknown album'
                    )
                WHEN me.domain_type = 'playlist' THEN
                    COALESCE(
                        (SELECT p.title FROM playlists p WHERE p.id::text = ANY(me.domain_ids) LIMIT 1),
                        me.event_data->>'collection_name',
                        'unknown playlist'
                    )
                WHEN me.domain_type = 'artist' THEN
                    COALESCE(
                        (SELECT DISTINCT s.artist
                         FROM songs s
                         WHERE s.media_blob_id = ANY(me.domain_ids)
                         AND s.artist IS NOT NULL
                         LIMIT 1),
                        me.event_data->>'collection_name',
                        'unknown artist'
                    )
                WHEN me.domain_type = 'genre' THEN
                    COALESCE(
                        (SELECT DISTINCT s.genre
                         FROM songs s
                         WHERE s.media_blob_id = ANY(me.domain_ids)
                         AND s.genre IS NOT NULL
                         LIMIT 1),
                        me.event_data->>'collection_name',
                        'unknown genre'
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
    session_boundaries AS (
        SELECT
            re.*,
            -- Create session groups by detecting 15+ minute gaps
            SUM(CASE WHEN re.gap_minutes > 15 OR re.gap_minutes = 0 THEN 1 ELSE 0 END)
            OVER (PARTITION BY re.user_id ORDER BY re.created_at ROWS UNBOUNDED PRECEDING) as session_group
        FROM recent_events re
    ),
    progressive_groups AS (
        SELECT
            sb.user_id,
            sb.domain_type,
            sb.domain_ids,
            sb.collection_name,
            sb.event_type,
            sb.event_data,
            sb.created_at,
            sb.age_minutes,
            sb.session_group,
            sb.media_blob_id,
            -- Progressive temporal grouping key - more aggressive grouping (10 min threshold)
            CASE
                WHEN sb.age_minutes < 10 THEN
                    'individual_' || sb.user_id::text || '_' || sb.created_at::text
                -- Session grouping: 10 minutes - 2 hours (group by session)
                WHEN sb.age_minutes < 120 THEN
                    'session_' || sb.user_id::text || '_' || sb.session_group::text
                -- Daily grouping: 2 hours - 1 day (group by day)
                WHEN sb.age_minutes < 1440 THEN
                    'daily_' || sb.user_id::text || '_' || DATE(sb.created_at)::text
                -- Weekly grouping: 1 day - 1 week (group by week)
                WHEN sb.age_minutes < 10080 THEN
                    'weekly_' || sb.user_id::text || '_' || DATE_TRUNC('week', sb.created_at)::text
                -- Monthly grouping: 1 week - 1 month (group by month)
                WHEN sb.age_minutes < 43200 THEN
                    'monthly_' || sb.user_id::text || '_' || DATE_TRUNC('month', sb.created_at)::text
                -- Yearly grouping: 1+ months (group by year)
                ELSE
                    'yearly_' || sb.user_id::text || '_' || DATE_TRUNC('year', sb.created_at)::text
            END as grouping_key,
            -- Determine grouping level for display
            CASE
                WHEN sb.age_minutes < 10 THEN 'individual'
                WHEN sb.age_minutes < 120 THEN 'session'
                WHEN sb.age_minutes < 1440 THEN 'daily'
                WHEN sb.age_minutes < 10080 THEN 'weekly'
                WHEN sb.age_minutes < 43200 THEN 'monthly'
                ELSE 'yearly'
            END as grouping_level
        FROM session_boundaries sb
    ),
    aggregated_groups AS (
        SELECT
            pg.grouping_key,
            pg.grouping_level,
            pg.user_id,
            -- For individual items, keep specific collection; for groups, create descriptive titles
            CASE
                WHEN pg.grouping_level = 'individual' THEN (array_agg(pg.collection_name))[1]
                WHEN pg.grouping_level = 'session' THEN 'listening session'
                WHEN pg.grouping_level = 'daily' THEN 'daily music'
                WHEN pg.grouping_level = 'weekly' THEN 'weekly listening'
                WHEN pg.grouping_level = 'monthly' THEN 'monthly highlights'
                ELSE 'music archive'
            END as display_title,
            -- For individual items, keep specific domain info; for groups, generalize
            CASE
                WHEN pg.grouping_level = 'individual' THEN (array_agg(pg.domain_type))[1]
                ELSE 'collection'
            END as display_domain_type,
            CASE
                WHEN pg.grouping_level = 'individual' THEN MAX(pg.domain_ids)
                ELSE ARRAY[]::text[]
            END as display_domain_ids,
            -- Event type prioritization: rate > favorite > play
            CASE
                WHEN COUNT(*) FILTER (WHERE pg.event_type = 'rate') > 0 THEN 'rate'
                WHEN COUNT(*) FILTER (WHERE pg.event_type = 'favorite') > 0 THEN 'favorite'
                WHEN COUNT(*) FILTER (WHERE pg.event_type = 'unfavorite') > 0 THEN 'unfavorite'
                ELSE 'play'
            END as primary_event_type,
            MAX(pg.created_at) as latest_activity,
            MIN(pg.created_at) as earliest_activity,
            COUNT(*) FILTER (WHERE pg.event_type = 'play') as total_plays,
            COUNT(*) FILTER (WHERE pg.event_type = 'favorite') as total_favorites,
            COUNT(*) FILTER (WHERE pg.event_type = 'rate') as total_ratings,
            COUNT(DISTINCT pg.collection_name) as unique_collections,
            COUNT(*) as total_events,
            -- Get latest event data for ratings/metadata
            (array_agg(pg.event_data ORDER BY
                CASE pg.event_type
                    WHEN 'rate' THEN 1
                    WHEN 'favorite' THEN 2
                    WHEN 'unfavorite' THEN 3
                    ELSE 4
                END, pg.created_at DESC))[1] as latest_event_data,
            -- Collection grid with full song records and metadata
            CASE
                WHEN pg.grouping_level != 'individual' THEN
                    (SELECT jsonb_build_object(
                        'total_songs', COUNT(DISTINCT all_song_ids.song_id),
                        'grouping_level', pg.grouping_level,
                        'songs', jsonb_agg(jsonb_build_object(
                            'id', s.media_blob_id,
                            'song_id', s.id,
                            'title', s.title,
                            'artist', s.artist,
                            'album', s.album,
                            'year', s.year,
                            'genre', s.genre,
                            'sub_genres', s.sub_genres,
                            'tags', s.tags,
                            'disc_number', s.disc_number,
                            'track_number', s.track_number,
                            'duration', s.duration,
                            'thumbnail_blob_id', s.thumbnail_blob_id,
                            'domain_type', 'song',
                            'user_rating', (
                                SELECT ur.rating
                                FROM user_ratings ur
                                WHERE ur.domain_type = 'song'
                                AND s.media_blob_id = ANY(ur.domain_ids)
                                AND ur.user_id = pg.user_id
                                LIMIT 1
                            ),
                            'is_favorite', EXISTS(
                                SELECT 1
                                FROM user_favorites uf
                                WHERE uf.domain_type = 'song'
                                AND s.media_blob_id = ANY(uf.domain_ids)
                                AND uf.user_id = pg.user_id
                            )
                        ) ORDER BY
                            COALESCE(s.disc_number, 1),
                            COALESCE(s.track_number, 999),
                            s.created_at
                        )
                    )
                    FROM (
                        -- Get all song IDs from domain_ids arrays and individual media_blob_ids
                        SELECT unnest(pg2.domain_ids) as song_id
                        FROM progressive_groups pg2
                        WHERE pg2.grouping_key = pg.grouping_key
                        AND pg2.domain_ids IS NOT NULL
                        UNION
                        SELECT pg2.media_blob_id as song_id
                        FROM progressive_groups pg2
                        WHERE pg2.grouping_key = pg.grouping_key
                        AND pg2.media_blob_id IS NOT NULL
                    ) all_song_ids
                    INNER JOIN songs s ON s.media_blob_id = all_song_ids.song_id
                    WHERE s.deleted_at IS NULL
                    LIMIT 12)
                ELSE NULL
            END as collection_grid,
            MIN(pg.age_minutes) as min_age_minutes
        FROM progressive_groups pg
        GROUP BY pg.grouping_key, pg.grouping_level, pg.user_id
    )
    SELECT
        -- Generate appropriate item types based on grouping level and primary event
        CASE
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'play' AND ag.display_domain_type = 'song' THEN 'user_played_song'
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'play' AND ag.display_domain_type = 'album' THEN 'user_played_album'
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'play' AND ag.display_domain_type = 'playlist' THEN 'user_played_playlist'
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'play' AND ag.display_domain_type = 'artist' THEN 'user_played_artist'
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'play' AND ag.display_domain_type = 'genre' THEN 'user_played_genre'
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'favorite' THEN 'user_favorited_' || ag.display_domain_type
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'unfavorite' THEN 'user_unfavorited_' || ag.display_domain_type
            WHEN ag.grouping_level = 'individual' AND ag.primary_event_type = 'rate' THEN 'user_rated_' || ag.display_domain_type
            WHEN ag.grouping_level = 'session' THEN 'user_listening_session'
            WHEN ag.grouping_level = 'daily' THEN 'user_daily_activity'
            WHEN ag.grouping_level = 'weekly' THEN 'user_weekly_activity'
            WHEN ag.grouping_level = 'monthly' THEN 'user_monthly_activity'
            ELSE 'user_music_archive'
        END::text as item_type,
        ag.display_domain_type::text as domain_type,
        ag.display_domain_ids as domain_ids,
        ag.display_title as title,
        -- Generate contextual subtitles based on grouping level and activity
        CASE
            WHEN ag.grouping_level = 'individual' THEN
                CASE
                    WHEN ag.primary_event_type = 'favorite' THEN 'added to favorites'
                    WHEN ag.primary_event_type = 'unfavorite' THEN 'removed from favorites'
                    WHEN ag.primary_event_type = 'rate' THEN
                        CASE
                            WHEN (ag.latest_event_data->>'rating')::int = 5 THEN 'rated 5 stars'
                            WHEN (ag.latest_event_data->>'rating')::int = 4 THEN 'rated 4 stars'
                            WHEN (ag.latest_event_data->>'rating')::int = 3 THEN 'rated 3 stars'
                            WHEN (ag.latest_event_data->>'rating')::int = 2 THEN 'rated 2 stars'
                            WHEN (ag.latest_event_data->>'rating')::int = 1 THEN 'rated 1 star'
                            ELSE 'rated'
                        END
                    WHEN ag.total_plays = 1 THEN 'played once'
                    WHEN ag.total_plays < 5 THEN ag.total_plays || ' times'
                    WHEN ag.total_plays < 20 THEN 'played ' || ag.total_plays || ' times'
                    ELSE 'played ' || ag.total_plays || ' times recently'
                END
            ELSE
                -- Grouped activity subtitles with rich context
                CASE
                    WHEN ag.grouping_level = 'session' THEN
                        CASE
                            WHEN ag.unique_collections = 1 THEN ag.total_plays || ' plays'
                            ELSE ag.unique_collections || ' items, ' || ag.total_plays || ' plays'
                        END
                    WHEN ag.grouping_level = 'daily' THEN
                        ag.unique_collections || ' collections, ' || ag.total_plays || ' plays'
                    WHEN ag.grouping_level = 'weekly' THEN
                        ag.unique_collections || ' collections this week'
                    WHEN ag.grouping_level = 'monthly' THEN
                        ag.unique_collections || ' collections this month'
                    ELSE
                        ag.unique_collections || ' collections'
                END ||
                CASE
                    WHEN ag.total_favorites > 0 THEN ' • ' || ag.total_favorites || ' favorited'
                    ELSE ''
                END ||
                CASE
                    WHEN ag.total_ratings > 0 THEN ' • ' || ag.total_ratings || ' rated'
                    ELSE ''
                END
        END as subtitle,
        NULL::text as image_url,
        jsonb_build_object(
            'total_songs', NULL,
            'artist_name', CASE WHEN ag.display_domain_type = 'artist' THEN ag.display_title ELSE NULL END,
            'album_name', CASE WHEN ag.display_domain_type = 'album' THEN ag.display_title ELSE NULL END,
            'playlist_name', CASE WHEN ag.display_domain_type = 'playlist' THEN ag.display_title ELSE NULL END,
            'genre_name', CASE WHEN ag.display_domain_type = 'genre' THEN ag.display_title ELSE NULL END,
            'user_activity', jsonb_build_object(
                'user_play_count', ag.total_plays,
                'total_play_count', ag.total_plays,
                'last_activity', ag.latest_activity,
                'grouping_level', ag.grouping_level,
                'unique_collections', ag.unique_collections,
                'session_duration', EXTRACT(EPOCH FROM (ag.latest_activity - ag.earliest_activity)),
                'total_events', ag.total_events
            ),
            'social_context', jsonb_build_object(
                'action_type', ag.primary_event_type,
                'frequency', ag.total_plays,
                'is_trending', CASE
                    WHEN ag.grouping_level = 'individual' THEN ag.total_plays > 10
                    ELSE ag.total_plays > 20
                END,
                'grouping_level', ag.grouping_level,
                'age_category', CASE
                    WHEN ag.min_age_minutes < 10 THEN 'fresh'
                    WHEN ag.min_age_minutes < 120 THEN 'recent'
                    WHEN ag.min_age_minutes < 1440 THEN 'today'
                    WHEN ag.min_age_minutes < 10080 THEN 'this_week'
                    WHEN ag.min_age_minutes < 43200 THEN 'this_month'
                    ELSE 'archive'
                END,
                'rating', CASE
                    WHEN ag.primary_event_type = 'rate' THEN (ag.latest_event_data->>'rating')::int
                    ELSE NULL
                END
            ),
            'collection_grid', ag.collection_grid
        ) as metadata,
        ag.total_plays as play_count,
        ag.latest_activity as last_played_at,
        -- Time-based scoring: prioritize recent activity with minimal artificial boosting
        EXTRACT(EPOCH FROM ag.latest_activity)::double precision as score,
        ag.latest_activity as created_at,
        ag.user_id as user_id,
        COALESCE(u.username, 'unknown user')::text as username
    FROM aggregated_groups ag
    LEFT JOIN users u ON u.id = ag.user_id
    ORDER BY ag.latest_activity DESC  -- Pure chronological order
    LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- Update function comments
COMMENT ON FUNCTION get_social_feed_items IS 'returns social feed in strict chronological order with progressive temporal grouping (10min threshold)';
