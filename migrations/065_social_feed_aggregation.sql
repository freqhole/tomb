-- Social Feed Aggregation Functions
-- Creates server-side aggregation for social feed combining recent content creation
-- with aggregated user activity across all users

-- Function to get social feed items with intelligent aggregation
CREATE OR REPLACE FUNCTION get_social_feed_items(
    p_limit bigint,
    p_offset bigint,
    p_days_back interval DEFAULT '7 days'
)
RETURNS TABLE (
    item_type text,
    domain_type VARCHAR(20),
    domain_id text,
    title text,
    subtitle text,
    image_url text,
    metadata jsonb,
    play_count bigint,
    last_played_at timestamptz,
    score float,
    created_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    WITH recent_albums AS (
        -- recent albums by created_at (new albums or updated albums with new songs)
        SELECT DISTINCT
            CASE
                WHEN MIN(s.created_at) >= NOW() - INTERVAL '7 days' THEN 'new_album'
                WHEN MAX(s.created_at) >= NOW() - INTERVAL '7 days' THEN 'updated_album'
                ELSE 'recent_album'
            END::text as item_type,
            'album'::VARCHAR(20) as domain_type,
            s.album as domain_id,
            s.album as title,
            (s.album_artist || ' • ' || COUNT(s.id)::text || ' songs') as subtitle,
            CASE
                WHEN s.thumbnail_blob_ids IS NOT NULL AND array_length(s.thumbnail_blob_ids, 1) > 0
                THEN '/api/blobs/' || s.thumbnail_blob_ids[1]
                ELSE NULL
            END as image_url,
            jsonb_build_object(
                'total_songs', COUNT(s.id),
                'artist_name', s.album_artist,
                'album_name', s.album
            ) as metadata,
            NULL::bigint as play_count,
            MAX(s.created_at) as last_played_at,
            100.0::double precision as score,
            MAX(s.created_at) as created_at
        FROM songs s
        WHERE s.created_at >= NOW() - p_days_back
          AND s.album IS NOT NULL
          AND s.album_artist IS NOT NULL
        GROUP BY s.album, s.album_artist, s.thumbnail_blob_ids
    ),
    recent_playlists AS (
        -- recent playlists by created_at or updated_at
        SELECT
            CASE
                WHEN p.created_at >= NOW() - INTERVAL '7 days' THEN 'new_playlist'
                ELSE 'updated_playlist'
            END::text as item_type,
            'playlist'::VARCHAR(20) as domain_type,
            p.id::text as domain_id,
            p.title as title,
            ('playlist • ' || COALESCE(song_count.count, 0)::text || ' songs') as subtitle,
            CASE
                WHEN p.thumbnail_blob_id IS NOT NULL
                THEN '/api/blobs/' || p.thumbnail_blob_id
                ELSE NULL
            END as image_url,
            jsonb_build_object(
                'total_songs', COALESCE(song_count.count, 0),
                'playlist_name', p.title
            ) as metadata,
            NULL::bigint as play_count,
            GREATEST(p.created_at, p.updated_at) as last_played_at,
            CASE
                WHEN p.updated_at >= NOW() - INTERVAL '7 days' THEN 110.0
                WHEN p.created_at >= NOW() - INTERVAL '7 days' THEN 105.0
                ELSE 95.0
            END::double precision as score,
            GREATEST(p.created_at, p.updated_at) as created_at
        FROM playlists p
        LEFT JOIN (
            SELECT playlist_id, COUNT(*) as count
            FROM playlist_songs
            GROUP BY playlist_id
        ) song_count ON p.id = song_count.playlist_id
        WHERE (p.created_at >= NOW() - p_days_back OR p.updated_at >= NOW() - p_days_back)
          AND p.deleted_at IS NULL
    ),
    user_activity_groups AS (
        -- aggregated user activity with visual tiles
        SELECT
            'user_activity_group'::text as item_type,
            NULL::VARCHAR(20) as domain_type,
            NULL::text as domain_id,
            'recent listening activity' as title,
            'what everyone is playing' as subtitle,
            NULL::text as image_url,
            jsonb_build_object(
                'user_activity', jsonb_build_object(
                    'recent_albums', recent_album_tiles.tiles,
                    'recent_playlists', recent_playlist_tiles.tiles,
                    'recent_songs', recent_song_tiles.tiles,
                    'period_description', 'last week'
                )
            ) as metadata,
            NULL::bigint as play_count,
            activity_summary.latest_activity as last_played_at,
            75.0::double precision as score,
            activity_summary.latest_activity as created_at
        FROM (
            SELECT MAX(me.created_at) as latest_activity
            FROM media_events me
            WHERE me.created_at >= NOW() - p_days_back
        ) activity_summary
        CROSS JOIN (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', album_stats.album,
                    'title', album_stats.album,
                    'subtitle', album_stats.artist,
                    'image_url', album_stats.image_url,
                    'domain_type', 'album'
                )
            ) as tiles
            FROM (
                SELECT DISTINCT
                    s.album,
                    s.album_artist as artist,
                    COUNT(*) as plays,
                    CASE
                        WHEN s.thumbnail_blob_ids IS NOT NULL AND array_length(s.thumbnail_blob_ids, 1) > 0
                        THEN '/api/blobs/' || s.thumbnail_blob_ids[1]
                        ELSE NULL
                    END as image_url
                FROM media_events me
                JOIN songs s ON s.media_blob_id = me.media_blob_id
                WHERE me.event_type = 'play'
                  AND me.created_at >= NOW() - INTERVAL '7 days'
                  AND s.album IS NOT NULL
                GROUP BY s.album, s.album_artist, s.thumbnail_blob_ids
                ORDER BY plays DESC
                LIMIT 4
            ) album_stats
        ) recent_album_tiles
        CROSS JOIN (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'id', playlist_stats.playlist_id,
                    'title', playlist_stats.title,
                    'subtitle', 'playlist',
                    'image_url', playlist_stats.image_url,
                    'domain_type', 'playlist'
                )
            ), '[]'::jsonb) as tiles
            FROM (
                SELECT
                    p.id::text as playlist_id,
                    p.title,
                    CASE
                        WHEN p.thumbnail_blob_id IS NOT NULL
                        THEN '/api/blobs/' || p.thumbnail_blob_id
                        ELSE NULL
                    END as image_url,
                    p.updated_at
                FROM playlists p
                WHERE p.updated_at >= NOW() - INTERVAL '7 days'
                  AND p.deleted_at IS NULL
                ORDER BY p.updated_at DESC
                LIMIT 2
            ) playlist_stats
        ) recent_playlist_tiles
        CROSS JOIN (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', song_stats.song_id,
                    'title', song_stats.title,
                    'subtitle', song_stats.artist,
                    'image_url', song_stats.image_url,
                    'domain_type', 'song'
                )
            ) as tiles
            FROM (
                SELECT DISTINCT
                    me.media_blob_id as song_id,
                    s.title,
                    s.artist,
                    COUNT(*) as plays,
                    CASE
                        WHEN s.thumbnail_blob_ids IS NOT NULL AND array_length(s.thumbnail_blob_ids, 1) > 0
                        THEN '/api/blobs/' || s.thumbnail_blob_ids[1]
                        ELSE NULL
                    END as image_url
                FROM media_events me
                JOIN songs s ON s.media_blob_id = me.media_blob_id
                WHERE me.event_type = 'play'
                  AND me.created_at >= NOW() - INTERVAL '7 days'
                  AND me.media_blob_id IS NOT NULL
                GROUP BY me.media_blob_id, s.title, s.artist, s.thumbnail_blob_ids
                ORDER BY plays DESC
                LIMIT 3
            ) song_stats
        ) recent_song_tiles
        WHERE activity_summary.latest_activity IS NOT NULL
    )
    SELECT
        ra.item_type, ra.domain_type, ra.domain_id, ra.title, ra.subtitle,
        ra.image_url, ra.metadata, ra.play_count, ra.last_played_at, ra.score, ra.created_at
    FROM recent_albums ra
    UNION ALL
    SELECT
        rp.item_type, rp.domain_type, rp.domain_id, rp.title, rp.subtitle,
        rp.image_url, rp.metadata, rp.play_count, rp.last_played_at, rp.score, rp.created_at
    FROM recent_playlists rp
    UNION ALL
    SELECT
        uag.item_type, uag.domain_type, uag.domain_id, uag.title, uag.subtitle,
        uag.image_url, uag.metadata, uag.play_count, uag.last_played_at, uag.score, uag.created_at
    FROM user_activity_groups uag
    ORDER BY score DESC, created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Performance indexes for feed queries
CREATE INDEX IF NOT EXISTS idx_songs_created_at_album ON songs (created_at DESC, album, album_artist)
WHERE album IS NOT NULL AND album_artist IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_events_feed_lookup ON media_events
(created_at DESC, domain_type, event_type, domain_id)
WHERE event_type = 'play' AND domain_type IN ('album', 'playlist', 'song');

-- Function to get total count for pagination
CREATE OR REPLACE FUNCTION get_social_feed_count(
    p_days_back interval DEFAULT '7 days'
)
RETURNS bigint AS $$
DECLARE
    album_count bigint;
    playlist_count bigint;
    activity_count bigint;
BEGIN
    -- Count recent albums
    SELECT COUNT(DISTINCT s.album) INTO album_count
    FROM songs s
    WHERE s.created_at >= NOW() - p_days_back
      AND s.album IS NOT NULL
      AND s.album_artist IS NOT NULL;

    -- Count recent/updated playlists
    SELECT COUNT(*) INTO playlist_count
    FROM playlists p
    WHERE (p.created_at >= NOW() - p_days_back OR p.updated_at >= NOW() - p_days_back)
      AND p.deleted_at IS NULL;

    -- User activity groups (always 1 if there's any activity)
    SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END INTO activity_count
    FROM media_events me
    WHERE me.created_at >= NOW() - p_days_back;

    RETURN album_count + playlist_count + activity_count;
END;
$$ LANGUAGE plpgsql;
