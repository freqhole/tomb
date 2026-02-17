-- 012: unified feed query view
-- combines all feed sources into a single view for efficient querying
-- replaces the 6-query tokio::join! approach in grimoire with a single query
-- supports filtering by feed_type and user_id

--------------------------------------------------------------------------------
-- feed_query_view
--------------------------------------------------------------------------------
CREATE VIEW feed_query_view AS

-- recent favorites (songs only)
SELECT
    uf.id as id,
    'recent_favorite' as feed_type,
    uf.target_id as song_id,
    (SELECT als.album_id FROM album_songz als WHERE als.song_id = uf.target_id LIMIT 1) as album_id,
    (SELECT asz.artist_id FROM artist_songz asz WHERE asz.song_id = uf.target_id LIMIT 1) as artist_id,
    NULL as playlist_id,
    s.title as title,
    (SELECT a.name FROM artist_songz asz2 JOIN artistz a ON a.id = asz2.artist_id WHERE asz2.song_id = uf.target_id LIMIT 1) as subtitle,
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
         FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id
         WHERE si.song_id = uf.target_id),
        '[]'
    ) as images,
    uf.created_at as created_at,
    uf.user_id as user_id,
    (SELECT u.username FROM user_accountz u WHERE u.id = uf.user_id) as username,
    NULL as play_count,
    NULL as rating,
    NULL as target_type,
    NULL as session_id,
    NULL as session_type,
    NULL as session_status,
    NULL as progress_percent,
    NULL as songs_completed,
    NULL as total_songs,
    (SELECT a.name FROM artist_songz asz3 JOIN artistz a ON a.id = asz3.artist_id WHERE asz3.song_id = uf.target_id LIMIT 1) as artist_name,
    (SELECT alb.title FROM album_songz als2 JOIN albumz alb ON alb.id = als2.album_id WHERE als2.song_id = uf.target_id LIMIT 1) as album_title,
    NULL as genre,
    NULL as year,
    NULL as song_count,
    NULL as total_duration_ms,
    NULL as description,
    NULL as tags
FROM user_favoritez uf
JOIN songz s ON s.id = uf.target_id
WHERE uf.target_type = 'song' AND s.deleted_at IS NULL

UNION ALL

-- recent albums
SELECT
    alb.id as id,
    'recent_album' as feed_type,
    NULL as song_id,
    alb.id as album_id,
    (SELECT aa.artist_id FROM artist_albumz aa WHERE aa.album_id = alb.id LIMIT 1) as artist_id,
    NULL as playlist_id,
    alb.title as title,
    (SELECT a.name FROM artist_albumz aa2 JOIN artistz a ON a.id = aa2.artist_id WHERE aa2.album_id = alb.id LIMIT 1) as subtitle,
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = alb.id),
        '[]'
    ) as images,
    alb.created_at as created_at,
    NULL as user_id,
    NULL as username,
    NULL as play_count,
    NULL as rating,
    NULL as target_type,
    NULL as session_id,
    NULL as session_type,
    NULL as session_status,
    NULL as progress_percent,
    NULL as songs_completed,
    NULL as total_songs,
    (SELECT a.name FROM artist_albumz aa3 JOIN artistz a ON a.id = aa3.artist_id WHERE aa3.album_id = alb.id LIMIT 1) as artist_name,
    alb.title as album_title,
    (SELECT g.name FROM album_genrez ag JOIN genrez g ON g.id = ag.genre_id WHERE ag.album_id = alb.id LIMIT 1) as genre,
    CAST(SUBSTR(alb.release_date, 1, 4) AS INTEGER) as year,
    alb.song_count as song_count,
    alb.total_duration as total_duration_ms,
    NULL as description,
    (SELECT json_group_array(t.name) FROM album_tagz at2 JOIN tagz t ON t.id = at2.tag_id WHERE at2.album_id = alb.id) as tags
FROM albumz alb
WHERE alb.deleted_at IS NULL

UNION ALL

-- recent ratings (polymorphic: song, album, artist)
SELECT
    ur.id as id,
    'recent_rating' as feed_type,
    CASE WHEN ur.target_type = 'song' THEN ur.target_id ELSE NULL END as song_id,
    CASE
        WHEN ur.target_type = 'album' THEN ur.target_id
        WHEN ur.target_type = 'song' THEN (SELECT als.album_id FROM album_songz als WHERE als.song_id = ur.target_id LIMIT 1)
        ELSE NULL
    END as album_id,
    CASE
        WHEN ur.target_type = 'artist' THEN ur.target_id
        WHEN ur.target_type = 'song' THEN (SELECT asz.artist_id FROM artist_songz asz WHERE asz.song_id = ur.target_id LIMIT 1)
        WHEN ur.target_type = 'album' THEN (SELECT aa.artist_id FROM artist_albumz aa WHERE aa.album_id = ur.target_id LIMIT 1)
        ELSE NULL
    END as artist_id,
    NULL as playlist_id,
    CASE
        WHEN ur.target_type = 'song' THEN (SELECT s.title FROM songz s WHERE s.id = ur.target_id)
        WHEN ur.target_type = 'album' THEN (SELECT alb.title FROM albumz alb WHERE alb.id = ur.target_id)
        WHEN ur.target_type = 'artist' THEN (SELECT a.name FROM artistz a WHERE a.id = ur.target_id)
        ELSE ur.target_id
    END as title,
    CASE
        WHEN ur.target_type = 'song' THEN (SELECT a.name FROM artist_songz asz JOIN artistz a ON a.id = asz.artist_id WHERE asz.song_id = ur.target_id LIMIT 1)
        WHEN ur.target_type = 'album' THEN (SELECT a.name FROM artist_albumz aa JOIN artistz a ON a.id = aa.artist_id WHERE aa.album_id = ur.target_id LIMIT 1)
        ELSE NULL
    END as subtitle,
    CASE
        WHEN ur.target_type = 'song' THEN COALESCE(
            (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
             FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id WHERE si.song_id = ur.target_id), '[]')
        WHEN ur.target_type = 'album' THEN COALESCE(
            (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id WHERE ai.album_id = ur.target_id), '[]')
        WHEN ur.target_type = 'artist' THEN COALESCE(
            (SELECT json_group_array(json_object('blob_id', ari.media_blob_id, 'is_primary', ari.is_primary, 'blob_type', mb.blob_type))
             FROM artist_imagez ari JOIN media_blobz mb ON ari.media_blob_id = mb.id WHERE ari.artist_id = ur.target_id), '[]')
        ELSE '[]'
    END as images,
    ur.updated_at as created_at,
    ur.user_id as user_id,
    (SELECT u.username FROM user_accountz u WHERE u.id = ur.user_id) as username,
    NULL as play_count,
    ur.rating as rating,
    ur.target_type as target_type,
    NULL as session_id,
    NULL as session_type,
    NULL as session_status,
    NULL as progress_percent,
    NULL as songs_completed,
    NULL as total_songs,
    CASE
        WHEN ur.target_type = 'song' THEN (SELECT a.name FROM artist_songz asz JOIN artistz a ON a.id = asz.artist_id WHERE asz.song_id = ur.target_id LIMIT 1)
        WHEN ur.target_type = 'album' THEN (SELECT a.name FROM artist_albumz aa JOIN artistz a ON a.id = aa.artist_id WHERE aa.album_id = ur.target_id LIMIT 1)
        WHEN ur.target_type = 'artist' THEN (SELECT a.name FROM artistz a WHERE a.id = ur.target_id)
        ELSE NULL
    END as artist_name,
    CASE
        WHEN ur.target_type = 'song' THEN (SELECT alb.title FROM album_songz als JOIN albumz alb ON alb.id = als.album_id WHERE als.song_id = ur.target_id LIMIT 1)
        WHEN ur.target_type = 'album' THEN (SELECT alb.title FROM albumz alb WHERE alb.id = ur.target_id)
        ELSE NULL
    END as album_title,
    NULL as genre,
    NULL as year,
    NULL as song_count,
    NULL as total_duration_ms,
    NULL as description,
    NULL as tags
FROM user_ratingz ur

UNION ALL

-- recent playlists
SELECT
    p.id as id,
    'recent_playlist' as feed_type,
    NULL as song_id,
    NULL as album_id,
    NULL as artist_id,
    p.id as playlist_id,
    p.title as title,
    p.description as subtitle,
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
         FROM playlist_imagez pi JOIN media_blobz mb ON pi.media_blob_id = mb.id
         WHERE pi.playlist_id = p.id),
        '[]'
    ) as images,
    p.updated_at as created_at,
    p.created_by_id as user_id,
    (SELECT u.username FROM user_accountz u WHERE u.id = p.created_by_id) as username,
    NULL as play_count,
    NULL as rating,
    NULL as target_type,
    NULL as session_id,
    NULL as session_type,
    NULL as session_status,
    NULL as progress_percent,
    NULL as songs_completed,
    NULL as total_songs,
    NULL as artist_name,
    NULL as album_title,
    NULL as genre,
    NULL as year,
    (SELECT COUNT(*) FROM playlist_songz ps WHERE ps.playlist_id = p.id) as song_count,
    (SELECT COALESCE(SUM(s.duration), 0) FROM playlist_songz ps2 JOIN songz s ON s.id = ps2.song_id WHERE ps2.playlist_id = p.id) as total_duration_ms,
    p.description as description,
    NULL as tags
FROM playlistz p
WHERE p.deleted_at IS NULL

UNION ALL

-- listen sessions (exclude single-song sessions)
SELECT
    ls.id as id,
    'listen_session' as feed_type,
    NULL as song_id,
    CASE WHEN ls.session_type = 'album' THEN ls.entity_id ELSE NULL END as album_id,
    CASE WHEN ls.session_type = 'artist' THEN ls.entity_id ELSE NULL END as artist_id,
    CASE WHEN ls.session_type = 'playlist' THEN ls.entity_id ELSE NULL END as playlist_id,
    ls.label as title,
    ls.session_type as subtitle,
    CASE
        WHEN ls.session_type = 'album' AND ls.entity_id IS NOT NULL THEN
            COALESCE(
                (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                 FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                 WHERE ai.album_id = ls.entity_id AND mb.blob_type NOT IN ('waveform')), '[]')
        WHEN ls.session_type = 'playlist' AND ls.entity_id IS NOT NULL THEN
            COALESCE(
                (SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
                 FROM playlist_imagez pi JOIN media_blobz mb ON pi.media_blob_id = mb.id
                 WHERE pi.playlist_id = ls.entity_id AND mb.blob_type NOT IN ('waveform')), '[]')
        WHEN ls.session_type = 'artist' AND ls.entity_id IS NOT NULL THEN
            COALESCE(
                (SELECT json_group_array(json_object('blob_id', ari.media_blob_id, 'is_primary', ari.is_primary, 'blob_type', mb.blob_type))
                 FROM artist_imagez ari JOIN media_blobz mb ON ari.media_blob_id = mb.id
                 WHERE ari.artist_id = ls.entity_id AND mb.blob_type NOT IN ('waveform')), '[]')
        WHEN ls.session_type = 'song' AND ls.entity_id IS NOT NULL THEN
            COALESCE(
                -- for song sessions, try song images first, then fall back to album images
                (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
                 FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id
                 WHERE si.song_id = ls.entity_id AND mb.blob_type NOT IN ('waveform')), '[]')
        ELSE '[]'
    END as images,
    ls.updated_at as created_at,
    ls.user_id as user_id,
    (SELECT u.username FROM user_accountz u WHERE u.id = ls.user_id) as username,
    NULL as play_count,
    NULL as rating,
    NULL as target_type,
    ls.id as session_id,
    ls.session_type as session_type,
    ls.status as session_status,
    CASE
        WHEN ls.total_duration_ms > 0 THEN MIN(ls.listened_duration_ms * 100.0 / ls.total_duration_ms, 100.0)
        WHEN ls.total_songs > 0 THEN MIN(ls.songs_completed * 100.0 / ls.total_songs, 100.0)
        ELSE 0.0
    END as progress_percent,
    ls.songs_completed as songs_completed,
    ls.total_songs as total_songs,
    -- resolve artist name for session entity
    CASE
        WHEN ls.session_type = 'artist' THEN (SELECT a.name FROM artistz a WHERE a.id = ls.entity_id)
        WHEN ls.session_type = 'album' THEN (SELECT a.name FROM artist_albumz aa JOIN artistz a ON a.id = aa.artist_id WHERE aa.album_id = ls.entity_id LIMIT 1)
        ELSE NULL
    END as artist_name,
    CASE
        WHEN ls.session_type = 'album' THEN (SELECT alb.title FROM albumz alb WHERE alb.id = ls.entity_id)
        ELSE NULL
    END as album_title,
    NULL as genre,
    NULL as year,
    NULL as song_count,
    ls.total_duration_ms as total_duration_ms,
    NULL as description,
    NULL as tags
FROM listen_sessionz ls
WHERE ls.total_songs > 1

UNION ALL

-- new images (user-uploaded only, grouped by entity)
-- this outer select groups by entity to show one feed entry per entity
SELECT
    'img-' || entity_type || '-' || entity_id as id,
    'new_image' as feed_type,
    CASE WHEN entity_type = 'song' THEN entity_id ELSE NULL END as song_id,
    album_id,
    artist_id,
    CASE WHEN entity_type = 'playlist' THEN entity_id ELSE NULL END as playlist_id,
    entity_title as title,
    CASE
        WHEN entity_type = 'song' THEN artist_name
        WHEN entity_type = 'album' THEN 'album' || COALESCE(' · ' || artist_name, '')
        WHEN entity_type = 'artist' THEN 'artist'
        WHEN entity_type = 'playlist' THEN 'playlist'
        ELSE entity_type
    END as subtitle,
    images,
    created_at,
    created_by as user_id,
    (SELECT u.username FROM user_accountz u WHERE u.id = created_by LIMIT 1) as username,
    NULL as play_count,
    NULL as rating,
    entity_type as target_type,
    NULL as session_id,
    NULL as session_type,
    NULL as session_status,
    NULL as progress_percent,
    NULL as songs_completed,
    NULL as total_songs,
    artist_name,
    NULL as album_title,
    NULL as genre,
    NULL as year,
    NULL as song_count,
    NULL as total_duration_ms,
    NULL as description,
    NULL as tags
FROM (
    SELECT
        entity_type,
        entity_id,
        entity_title,
        artist_id,
        artist_name,
        album_id,
        MAX(created_at) as created_at,
        images,
        created_by
    FROM (
        -- song images (exclude scanner imports + dedup against album images)
        SELECT
            'song' as entity_type,
            si.song_id as entity_id,
            s.title as entity_title,
            (SELECT a.id FROM artist_songz sa JOIN artistz a ON a.id = sa.artist_id WHERE sa.song_id = si.song_id LIMIT 1) as artist_id,
            (SELECT a.name FROM artist_songz sa JOIN artistz a ON a.id = sa.artist_id WHERE sa.song_id = si.song_id LIMIT 1) as artist_name,
            (SELECT aa.album_id FROM album_songz aa WHERE aa.song_id = si.song_id LIMIT 1) as album_id,
            mb.created_at as created_at,
            mb.created_by as created_by,
            (SELECT json_group_array(json_object('blob_id', si2.media_blob_id, 'is_primary', si2.is_primary, 'blob_type', mb2.blob_type))
             FROM song_imagez si2 JOIN media_blobz mb2 ON si2.media_blob_id = mb2.id
             WHERE si2.song_id = si.song_id AND mb2.blob_type NOT IN ('waveform')) as images
        FROM song_imagez si
        JOIN media_blobz mb ON si.media_blob_id = mb.id
        JOIN songz s ON si.song_id = s.id
        WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND s.deleted_at IS NULL
          AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
          AND NOT EXISTS (
            SELECT 1 FROM album_songz als
            JOIN album_imagez ai ON ai.album_id = als.album_id AND ai.media_blob_id = si.media_blob_id
            WHERE als.song_id = si.song_id
          )

        UNION ALL

        -- album images
        SELECT
            'album' as entity_type,
            ai.album_id as entity_id,
            alb.title as entity_title,
            (SELECT art.id FROM artist_albumz aa2 JOIN artistz art ON art.id = aa2.artist_id WHERE aa2.album_id = ai.album_id LIMIT 1) as artist_id,
            (SELECT art.name FROM artist_albumz aa2 JOIN artistz art ON art.id = aa2.artist_id WHERE aa2.album_id = ai.album_id LIMIT 1) as artist_name,
            ai.album_id as album_id,
            mb.created_at as created_at,
            mb.created_by as created_by,
            (SELECT json_group_array(json_object('blob_id', ai2.media_blob_id, 'is_primary', ai2.is_primary, 'blob_type', mb2.blob_type))
             FROM album_imagez ai2 JOIN media_blobz mb2 ON ai2.media_blob_id = mb2.id
             WHERE ai2.album_id = ai.album_id AND mb2.blob_type NOT IN ('waveform')) as images
        FROM album_imagez ai
        JOIN media_blobz mb ON ai.media_blob_id = mb.id
        JOIN albumz alb ON ai.album_id = alb.id
        WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND alb.deleted_at IS NULL
          AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')

        UNION ALL

        -- artist images
        SELECT
            'artist' as entity_type,
            ari.artist_id as entity_id,
            art.name as entity_title,
            ari.artist_id as artist_id,
            art.name as artist_name,
            NULL as album_id,
            mb.created_at as created_at,
            mb.created_by as created_by,
            (SELECT json_group_array(json_object('blob_id', ari2.media_blob_id, 'is_primary', ari2.is_primary, 'blob_type', mb2.blob_type))
             FROM artist_imagez ari2 JOIN media_blobz mb2 ON ari2.media_blob_id = mb2.id
             WHERE ari2.artist_id = ari.artist_id AND mb2.blob_type NOT IN ('waveform')) as images
        FROM artist_imagez ari
        JOIN media_blobz mb ON ari.media_blob_id = mb.id
        JOIN artistz art ON ari.artist_id = art.id
        WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL
          AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')

        UNION ALL

        -- playlist images
        SELECT
            'playlist' as entity_type,
            pi.playlist_id as entity_id,
            p.title as entity_title,
            NULL as artist_id,
            NULL as artist_name,
            NULL as album_id,
            mb.created_at as created_at,
            mb.created_by as created_by,
            (SELECT json_group_array(json_object('blob_id', pi2.media_blob_id, 'is_primary', pi2.is_primary, 'blob_type', mb2.blob_type))
             FROM playlist_imagez pi2 JOIN media_blobz mb2 ON pi2.media_blob_id = mb2.id
             WHERE pi2.playlist_id = pi.playlist_id AND mb2.blob_type NOT IN ('waveform')) as images
        FROM playlist_imagez pi
        JOIN media_blobz mb ON pi.media_blob_id = mb.id
        JOIN playlistz p ON pi.playlist_id = p.id
        WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND p.deleted_at IS NULL
          AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
    )
    GROUP BY entity_type, entity_id
);
