-- Add 'add' event type to social feed to show music addition events
-- This allows newly added albums/songs to appear in the social feed
-- Fixed grouping logic to prevent overlaps and create single daily/weekly groups per user

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
            -- Use client_timestamp when available, fall back to created_at
            COALESCE(me.client_timestamp, me.created_at) as event_timestamp,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(me.client_timestamp, me.created_at))) / 60 as age_minutes,
            -- Session gap detection using client timestamps
            COALESCE(
                EXTRACT(EPOCH FROM (COALESCE(me.client_timestamp, me.created_at) - LAG(COALESCE(me.client_timestamp, me.created_at)) OVER (
                    PARTITION BY me.user_id ORDER BY COALESCE(me.client_timestamp, me.created_at)
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
        WHERE COALESCE(me.client_timestamp, me.created_at) >= NOW() - p_days_back
        AND me.domain_type IN ('album', 'playlist', 'artist', 'genre', 'song')
        AND me.event_type IN ('play', 'favorite', 'unfavorite', 'rate', 'add')
        AND (array_length(me.domain_ids, 1) > 0 OR me.media_blob_id IS NOT NULL)
        AND me.user_id IS NOT NULL
    ),
    session_boundaries AS (
        SELECT
            re.*,
            -- Create session groups by detecting 15+ minute gaps in actual listening time
            SUM(CASE WHEN re.gap_minutes > 15 OR re.gap_minutes = 0 THEN 1 ELSE 0 END)
            OVER (PARTITION BY re.user_id ORDER BY re.event_timestamp ROWS UNBOUNDED PRECEDING) as session_group
        FROM recent_events re
    ),
    -- Deduplicate rapid rating changes for the same song by the same user
    rating_deduplicated AS (
        SELECT
            sb.*,
            -- For rating events, only keep the most recent rating within a 2-minute window
            CASE
                WHEN sb.event_type = 'rate' THEN
                    ROW_NUMBER() OVER (
                        PARTITION BY sb.user_id, sb.media_blob_id, sb.domain_ids,
                        -- Group ratings within 2-minute windows
                        FLOOR(EXTRACT(EPOCH FROM sb.event_timestamp) / 120)
                        ORDER BY sb.event_timestamp DESC
                    )
                ELSE 1
            END as rating_rank
        FROM session_boundaries sb
    ),
    progressive_groups AS (
        SELECT
            rd.user_id,
            rd.domain_type,
            rd.domain_ids,
            rd.collection_name,
            rd.event_type,
            rd.event_data,
            rd.created_at,
            rd.event_timestamp,
            rd.age_minutes,
            rd.session_group,
            rd.media_blob_id,
            -- Create improved grouping keys with no overlaps
            CASE
                -- Tier 1: Individual items (very recent activity only)
                WHEN rd.age_minutes <= 90 AND rd.event_type IN ('add', 'favorite', 'rate') THEN
                    CONCAT(rd.user_id, ':', rd.domain_type, ':', COALESCE(array_to_string(rd.domain_ids, ','), rd.media_blob_id), ':individual')
                WHEN rd.age_minutes <= 3 AND rd.event_type = 'play' THEN
                    CONCAT(rd.user_id, ':', rd.domain_type, ':', COALESCE(array_to_string(rd.domain_ids, ','), rd.media_blob_id), ':individual')
                -- Tier 2: Session grouping (recent but not individual)
                WHEN rd.age_minutes > 90 AND rd.age_minutes <= 480 AND rd.event_type = 'play' THEN -- 8 hours
                    CONCAT(rd.user_id, ':', rd.session_group, ':listening_session')
                WHEN rd.age_minutes > 90 AND rd.age_minutes <= 480 AND rd.event_type IN ('add', 'favorite', 'rate') THEN -- 8 hours
                    CONCAT(rd.user_id, ':', rd.session_group, ':activity_session')
                -- Tier 3: Single daily group per user (spans up to 3 days, excludes recent sessions)
                WHEN rd.age_minutes > 480 AND rd.age_minutes <= 4320 THEN -- 8 hours to 3 days
                    CONCAT(rd.user_id, ':daily')
                -- Tier 4: Single weekly group per user (spans up to 4 weeks, excludes daily content)
                WHEN rd.age_minutes > 4320 AND rd.age_minutes <= 40320 THEN -- 3 days to 4 weeks
                    CONCAT(rd.user_id, ':weekly')
                -- Tier 5: Single monthly group per user (older than 4 weeks)
                ELSE
                    CONCAT(rd.user_id, ':monthly')
            END as grouping_key,
            CASE
                WHEN rd.age_minutes <= 90 AND rd.event_type IN ('add', 'favorite', 'rate') THEN 'individual'
                WHEN rd.age_minutes <= 3 AND rd.event_type = 'play' THEN 'individual'
                WHEN rd.age_minutes > 90 AND rd.age_minutes <= 480 AND rd.event_type = 'play' THEN 'listening_session'
                WHEN rd.age_minutes > 90 AND rd.age_minutes <= 480 AND rd.event_type IN ('add', 'favorite', 'rate') THEN 'activity_session'
                WHEN rd.age_minutes > 480 AND rd.age_minutes <= 4320 THEN 'daily'
                WHEN rd.age_minutes > 4320 AND rd.age_minutes <= 40320 THEN 'weekly'
                ELSE 'monthly'
            END as grouping_level,
            -- Add scoring for content sampling
            CASE
                WHEN rd.domain_type IN ('album', 'playlist') THEN 3 -- High priority for collections
                WHEN rd.event_type IN ('favorite', 'rate') AND rd.domain_type = 'song' THEN 2 -- Medium priority for song ratings
                WHEN rd.domain_type = 'song' THEN 1 -- Low priority for regular songs
                ELSE 1
            END as content_priority
        FROM rating_deduplicated rd
        WHERE rd.rating_rank = 1  -- Only include the most recent rating in each window
    ),
    -- Content sampling for larger groups (daily, weekly, monthly)
    sampled_content AS (
        SELECT
            pg.*,
            -- For large groups, sample content based on priority and limits
            CASE
                WHEN pg.grouping_level IN ('daily', 'weekly', 'monthly') THEN
                    ROW_NUMBER() OVER (
                        PARTITION BY pg.grouping_key, pg.grouping_level,
                        CASE
                            WHEN pg.domain_type IN ('album', 'playlist') THEN 'collections'
                            WHEN pg.event_type IN ('favorite', 'rate') AND pg.domain_type = 'song' THEN 'ratings'
                            ELSE 'songs'
                        END
                        ORDER BY pg.content_priority DESC,
                                CASE pg.event_type
                                    WHEN 'add' THEN 1
                                    WHEN 'rate' THEN 2
                                    WHEN 'favorite' THEN 3
                                    ELSE 4
                                END,
                                pg.event_timestamp DESC
                    )
                ELSE 1
            END as content_rank
        FROM progressive_groups pg
    ),
    content_limited AS (
        SELECT sc.*
        FROM sampled_content sc
        WHERE
            -- For individual items and sessions, include all
            sc.grouping_level IN ('individual', 'listening_session', 'activity_session')
            OR
            -- For large groups, apply content limits (100 total items with distribution)
            (sc.grouping_level IN ('daily', 'weekly', 'monthly') AND (
                (sc.domain_type IN ('album', 'playlist') AND sc.content_rank <= 60) OR -- 60% collections
                (sc.event_type IN ('favorite', 'rate') AND sc.domain_type = 'song' AND sc.content_rank <= 20) OR -- 20% ratings
                (sc.domain_type = 'song' AND sc.event_type NOT IN ('favorite', 'rate') AND sc.content_rank <= 20) -- 20% songs
            ))
    ),
    aggregated_groups AS (
        SELECT
            cl.grouping_key,
            cl.grouping_level,
            cl.user_id,
            MIN(cl.age_minutes) as age_minutes,
            -- For individual items, keep specific collection; for groups, create descriptive titles
            CASE
                WHEN cl.grouping_level = 'individual' THEN (array_agg(cl.collection_name))[1]
                WHEN cl.grouping_level = 'listening_session' THEN 'listening session'
                WHEN cl.grouping_level = 'activity_session' THEN 'music activity'
                WHEN cl.grouping_level = 'daily' THEN 'daily music'
                WHEN cl.grouping_level = 'weekly' THEN 'weekly listening'
                WHEN cl.grouping_level = 'monthly' THEN 'monthly highlights'
                ELSE 'music archive'
            END as display_title,
            -- For individual items, keep specific domain info; for groups, generalize
            CASE
                WHEN cl.grouping_level = 'individual' THEN (array_agg(cl.domain_type))[1]
                ELSE 'collection'
            END as display_domain_type,
            CASE
                WHEN cl.grouping_level = 'individual' THEN MAX(cl.domain_ids)
                ELSE ARRAY[]::text[]
            END as display_domain_ids,
            -- Event type prioritization: add > rate > favorite > play
            CASE
                WHEN COUNT(*) FILTER (WHERE cl.event_type = 'add') > 0 THEN 'add'
                WHEN COUNT(*) FILTER (WHERE cl.event_type = 'rate') > 0 THEN 'rate'
                WHEN COUNT(*) FILTER (WHERE cl.event_type = 'favorite') > 0 THEN 'favorite'
                WHEN COUNT(*) FILTER (WHERE cl.event_type = 'unfavorite') > 0 THEN 'unfavorite'
                ELSE 'play'
            END as primary_event_type,
            MAX(cl.event_timestamp) as latest_activity,
            MIN(cl.event_timestamp) as earliest_activity,
            COUNT(*) FILTER (WHERE cl.event_type = 'play') as total_plays,
            COUNT(*) FILTER (WHERE cl.event_type = 'favorite') as total_favorites,
            COUNT(*) FILTER (WHERE cl.event_type = 'rate') as total_ratings,
            COUNT(*) FILTER (WHERE cl.event_type = 'add') as total_additions,
            COUNT(DISTINCT cl.collection_name) as unique_collections,
            COUNT(*) as total_events,
            -- Content distribution stats for large groups
            COUNT(*) FILTER (WHERE cl.domain_type IN ('album', 'playlist')) as collection_count,
            COUNT(*) FILTER (WHERE cl.event_type IN ('favorite', 'rate') AND cl.domain_type = 'song') as rating_count,
            COUNT(*) FILTER (WHERE cl.domain_type = 'song' AND cl.event_type NOT IN ('favorite', 'rate')) as song_count,
            -- Get latest event data for ratings/metadata
            (array_agg(cl.event_data ORDER BY
                CASE cl.event_type
                    WHEN 'add' THEN 1
                    WHEN 'rate' THEN 2
                    WHEN 'favorite' THEN 3
                    WHEN 'unfavorite' THEN 4
                    ELSE 5
                END, cl.event_timestamp DESC))[1] as latest_event_data,
           -- Collection grid with distinct songs only
          (SELECT jsonb_build_object(
              'total_songs', COUNT(DISTINCT s.media_blob_id),
              'grouping_level', cl.grouping_level,
              'content_distribution', jsonb_build_object(
                  'collections', (SELECT COUNT(*) FROM content_limited cl_dist WHERE cl_dist.grouping_key = cl.grouping_key AND cl_dist.domain_type IN ('album', 'playlist')),
                  'ratings', (SELECT COUNT(*) FROM content_limited cl_dist WHERE cl_dist.grouping_key = cl.grouping_key AND cl_dist.event_type IN ('favorite', 'rate') AND cl_dist.domain_type = 'song'),
                  'songs', (SELECT COUNT(*) FROM content_limited cl_dist WHERE cl_dist.grouping_key = cl.grouping_key AND cl_dist.domain_type = 'song' AND cl_dist.event_type NOT IN ('favorite', 'rate'))
              ),
               'songs', jsonb_agg(jsonb_build_object(
                   'id', s.media_blob_id,
                   'song_id', s.id,
                   'title', s.title,
                   'artist', s.artist,
                   'album', s.album,
                   'album_artist', s.album_artist,
                   'year', s.year,
                   'genre', s.genre,
                   'sub_genres', s.sub_genres,
                   'tags', s.tags,
                   'disc_number', s.disc_number,
                   'track_number', s.track_number,
                   'duration', CASE
                       WHEN s.duration IS NOT NULL THEN
                           LPAD((EXTRACT(EPOCH FROM s.duration)::int / 60)::text, 2, '0') || ':' ||
                           LPAD((EXTRACT(EPOCH FROM s.duration)::int % 60)::text, 2, '0')
                       ELSE NULL
                   END,
                   'thumbnail_blob_id', s.thumbnail_blob_id,
                   'domain_type', 'song',
                   'user_rating', (
                       SELECT (latest_rating.event_data->>'rating')::int
                       FROM (
                           SELECT event_data,
                                  ROW_NUMBER() OVER (ORDER BY COALESCE(me_rating.client_timestamp, me_rating.created_at) DESC) as rn
                           FROM media_events me_rating
                           WHERE me_rating.user_id = cl.user_id
                             AND me_rating.event_type = 'rate'
                             AND me_rating.media_blob_id = s.media_blob_id
                       ) latest_rating
                       WHERE latest_rating.rn = 1
                   ),
                   'is_favorite', (
                       SELECT
                           CASE
                               WHEN COALESCE(SUM(CASE WHEN me_fav.event_type = 'favorite' THEN 1 ELSE -1 END), 0) > 0
                               THEN true
                               ELSE false
                           END
                       FROM media_events me_fav
                       WHERE me_fav.user_id = cl.user_id
                         AND me_fav.event_type IN ('favorite', 'unfavorite')
                         AND me_fav.media_blob_id = s.media_blob_id
                   )
               ) ORDER BY s.track_number NULLS LAST, s.title)
           ) FROM (
               SELECT DISTINCT song_id
               FROM (
                   -- Songs from array domain_ids (for collection events like add/play album)
                   SELECT unnest(cl_inner.domain_ids) as song_id
                   FROM content_limited cl_inner
                   WHERE cl_inner.grouping_key = cl.grouping_key
                     AND cl_inner.domain_ids IS NOT NULL
                   UNION ALL
                   -- Individual songs from media_blob_id (for single song events)
                   SELECT cl_inner.media_blob_id as song_id
                   FROM content_limited cl_inner
                   WHERE cl_inner.grouping_key = cl.grouping_key
                     AND cl_inner.media_blob_id IS NOT NULL
               ) as all_song_ids
               WHERE song_id IS NOT NULL
           ) as all_song_ids
           JOIN songs s ON (s.media_blob_id = all_song_ids.song_id OR s.id::text = all_song_ids.song_id)
           WHERE s.deleted_at IS NULL
           ) as collection_grid_data
        FROM content_limited cl
        GROUP BY cl.grouping_key, cl.grouping_level, cl.user_id
    ),
    final_results AS (
        SELECT
            ag.grouping_key,
            ag.grouping_level,
            -- Determine item type based on primary event and grouping level
            CASE
                WHEN ag.primary_event_type = 'add' AND ag.display_domain_type = 'album' THEN 'recent_album'
                WHEN ag.primary_event_type = 'add' AND ag.display_domain_type = 'playlist' THEN 'recent_playlist'
                WHEN ag.primary_event_type = 'add' AND ag.display_domain_type = 'song' THEN 'recent_song'
                WHEN ag.grouping_level = 'individual' AND ag.display_domain_type = 'album' THEN 'user_played_album'
                WHEN ag.grouping_level = 'individual' AND ag.display_domain_type = 'playlist' THEN 'user_played_playlist'
                WHEN ag.grouping_level = 'individual' AND ag.display_domain_type = 'artist' THEN 'user_played_artist'
                WHEN ag.grouping_level = 'individual' AND ag.display_domain_type = 'genre' THEN 'user_played_genre'
                WHEN ag.grouping_level = 'individual' AND ag.display_domain_type = 'song' THEN 'user_played_song'
                WHEN ag.primary_event_type = 'favorite' AND ag.display_domain_type = 'album' THEN 'user_favorited_album'
                WHEN ag.primary_event_type = 'favorite' AND ag.display_domain_type = 'playlist' THEN 'user_favorited_playlist'
                WHEN ag.primary_event_type = 'favorite' AND ag.display_domain_type = 'song' THEN 'user_favorited_song'
                WHEN ag.primary_event_type = 'unfavorite' AND ag.display_domain_type = 'song' THEN 'user_unfavorited_song'
                WHEN ag.primary_event_type = 'rate' AND ag.display_domain_type = 'song' THEN 'user_rated_song'
                WHEN ag.grouping_level = 'listening_session' THEN 'user_listening_session'
                WHEN ag.grouping_level = 'activity_session' THEN 'user_activity_session'
                WHEN ag.grouping_level = 'daily' THEN 'user_daily_activity'
                WHEN ag.grouping_level = 'weekly' THEN 'user_weekly_activity'
                WHEN ag.grouping_level = 'monthly' THEN 'user_monthly_activity'
                ELSE 'user_music_archive'
            END as computed_item_type,
            ag.display_domain_type,
            ag.display_domain_ids,
            ag.display_title,
            -- Create subtitles based on event type, counts, and content distribution
            CASE
                WHEN ag.primary_event_type = 'add' AND ag.grouping_level = 'individual' THEN 'added to collection'
                WHEN ag.grouping_level IN ('daily', 'weekly', 'monthly') THEN
                    CASE
                        WHEN ag.collection_count > 0 AND ag.rating_count > 0 AND ag.song_count > 0 THEN
                            ag.collection_count || ' albums/playlists, ' || ag.song_count || ' songs, ' || ag.rating_count || ' ratings'
                        WHEN ag.collection_count > 0 AND ag.song_count > 0 THEN
                            ag.collection_count || ' albums/playlists, ' || ag.song_count || ' songs'
                        WHEN ag.collection_count > 0 AND ag.rating_count > 0 THEN
                            ag.collection_count || ' albums/playlists, ' || ag.rating_count || ' ratings'
                        WHEN ag.collection_count > 0 THEN ag.collection_count || ' albums/playlists'
                        WHEN ag.rating_count > 0 AND ag.song_count > 0 THEN
                            ag.song_count || ' songs, ' || ag.rating_count || ' ratings'
                        WHEN ag.song_count > 0 THEN ag.song_count || ' songs'
                        WHEN ag.rating_count > 0 THEN ag.rating_count || ' ratings'
                        ELSE ag.total_events || ' activities'
                    END
                WHEN ag.grouping_level = 'activity_session' THEN
                    CASE
                        WHEN ag.total_additions > 0 AND ag.total_favorites > 0 THEN ag.total_additions || ' additions, ' || ag.total_favorites || ' favorites'
                        WHEN ag.total_additions > 0 AND ag.total_ratings > 0 THEN ag.total_additions || ' additions, ' || ag.total_ratings || ' ratings'
                        WHEN ag.total_additions > 0 THEN ag.total_additions || ' additions'
                        WHEN ag.total_favorites > 0 THEN ag.total_favorites || ' favorites'
                        WHEN ag.total_ratings > 0 THEN ag.total_ratings || ' ratings'
                        ELSE 'music activity'
                    END
                WHEN ag.grouping_level = 'listening_session' THEN
                    CASE
                        WHEN ag.total_plays = 1 THEN 'played once'
                        WHEN ag.total_plays > 1 THEN ag.total_plays || ' plays'
                        ELSE 'listened to music'
                    END
                WHEN ag.total_additions > 0 THEN ag.total_additions || ' additions'
                WHEN ag.total_favorites > 0 THEN ag.total_favorites || ' favorites'
                WHEN ag.total_ratings > 0 THEN ag.total_ratings || ' ratings'
                ELSE 'music activity'
            END as computed_subtitle,
            -- Extract thumbnail from collection grid or playlist/album thumbnail
            COALESCE(
                -- For playlists, get playlist thumbnail
                CASE WHEN ag.display_domain_type = 'playlist' THEN
                    (SELECT p.thumbnail_blob_id FROM playlists p WHERE p.id::text = ANY(ag.display_domain_ids) LIMIT 1)
                ELSE NULL END,
                -- For other collections, use first song's thumbnail
                (ag.collection_grid_data->'songs'->0->>'thumbnail_blob_id'),
                ''
            ) as computed_image_url,
            -- Build comprehensive metadata with content distribution info
            jsonb_build_object(
                'total_songs', COALESCE((ag.collection_grid_data->>'total_songs')::int, 1),
                'artist_name', ag.latest_event_data->>'artist_name',
                'album_name', ag.latest_event_data->>'collection_name',
                'playlist_name', CASE WHEN ag.display_domain_type = 'playlist' THEN ag.display_title ELSE NULL END,
                'genre_name', CASE WHEN ag.display_domain_type = 'genre' THEN ag.display_title ELSE NULL END,
                'user_activity', jsonb_build_object(
                    'recent_albums', NULL,
                    'recent_playlists', NULL,
                    'recent_songs', NULL,
                    'period_description', NULL,
                    'total_events', ag.total_events,
                    'last_activity', ag.latest_activity,
                    'grouping_level', ag.grouping_level,
                    'user_play_count', ag.total_plays,
                    'session_duration', EXTRACT(EPOCH FROM (ag.latest_activity - ag.earliest_activity)) / 60.0,
                    'total_play_count', ag.total_plays,
                    'unique_collections', ag.unique_collections,
                    'content_distribution', CASE
                        WHEN ag.grouping_level IN ('daily', 'weekly', 'monthly') THEN
                            jsonb_build_object(
                                'collections', ag.collection_count,
                                'songs', ag.song_count,
                                'ratings', ag.rating_count,
                                'sampled', true
                            )
                        ELSE NULL
                    END
                ),
                'social_context', jsonb_build_object(
                    'action_type', ag.primary_event_type,
                    'frequency', ag.total_events,
                    'is_trending', true,
                    'rating', NULL,
                    'age_category', CASE
                        WHEN ag.age_minutes <= 60 THEN 'fresh'
                        WHEN ag.age_minutes <= 1440 THEN 'recent'
                        WHEN ag.age_minutes <= 10080 THEN 'weekly'
                        ELSE 'archived'
                    END,
                    'grouping_level', ag.grouping_level
                ),
                'collection_grid', ag.collection_grid_data
            ) as computed_metadata,
            ag.total_plays,
            ag.latest_activity,
            -- Improved scoring: boost daily/weekly groups and maintain recency
            (
                -- Base recency score (0-100, exponential decay)
                100.0 * EXP(-ag.age_minutes / 2880.0) +
                -- Event type boost
                CASE ag.primary_event_type
                    WHEN 'add' THEN 50.0  -- Boost new additions
                    WHEN 'rate' THEN 30.0
                    WHEN 'favorite' THEN 25.0
                    ELSE 10.0
                END +
                -- Grouping level boost (prioritize aggregated content)
                CASE ag.grouping_level
                    WHEN 'daily' THEN 40.0    -- Boost daily summaries
                    WHEN 'weekly' THEN 35.0   -- Boost weekly summaries
                    WHEN 'monthly' THEN 30.0  -- Boost monthly summaries
                    WHEN 'activity_session' THEN 20.0
                    WHEN 'listening_session' THEN 15.0
                    ELSE 10.0
                END +
                -- Play count boost
                LEAST(ag.total_plays * 3.0, 30.0) +
                -- Content diversity bonus for large groups
                CASE
                    WHEN ag.grouping_level IN ('daily', 'weekly', 'monthly') AND ag.unique_collections > 5 THEN 20.0
                    WHEN ag.grouping_level IN ('daily', 'weekly', 'monthly') AND ag.unique_collections > 2 THEN 10.0
                    ELSE 0.0
                END
            ) as computed_score,
            ag.earliest_activity as computed_created_at,
            ag.user_id,
            (SELECT u.username FROM users u WHERE u.id = ag.user_id) as computed_username
        FROM aggregated_groups ag
        WHERE ag.total_events > 0
    )
    SELECT
        fr.computed_item_type::text as item_type,
        fr.display_domain_type::text as domain_type,
        fr.display_domain_ids as domain_ids,
        fr.display_title::text as title,
        fr.computed_subtitle::text as subtitle,
        fr.computed_image_url::text as image_url,
        fr.computed_metadata as metadata,
        fr.total_plays::bigint as play_count,
        fr.latest_activity as last_played_at,
        fr.computed_score::double precision as score,
        fr.computed_created_at as created_at,
        fr.user_id::uuid as user_id,
        fr.computed_username::text as username
    FROM final_results fr
    ORDER BY fr.latest_activity DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$function$;
