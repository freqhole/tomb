-- 010: query views - denormalized views for efficient queries
-- IMPORTANT: order matters! artist_query_view must be created first since
-- song_query_view and playlist_song_query_view reference it

--------------------------------------------------------------------------------
-- artist_query_view - MUST BE FIRST (referenced by song views)
--------------------------------------------------------------------------------
CREATE VIEW artist_query_view AS
SELECT
    ar.id as artist_id,
    ar.name as artist_name,
    ar.bio as artist_bio,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- aggregated stats (only non-deleted songs)
    COUNT(DISTINCT ars.song_id) as song_count,
    (SELECT COUNT(DISTINCT aa2.album_id)
     FROM artist_albumz aa2
     JOIN albumz al ON aa2.album_id = al.id
     WHERE aa2.artist_id = ar.id AND al.deleted_at IS NULL AND al.song_count > 0) as album_count,
    COALESCE(SUM(s.duration), 0) as total_duration,

    -- user favorites and ratings
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM artistz ar
LEFT JOIN artist_songz ars ON ar.id = ars.artist_id
LEFT JOIN songz s ON ars.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'artist' AND uf.target_id = ar.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'artist' AND ur.target_id = ar.id
WHERE ar.deleted_at IS NULL
GROUP BY ar.id, ar.name, ar.bio, ar.created_at, ar.updated_at, ar.deleted_at,
         ar.deleted_by, ar.created_by, ar.updated_by, uf.id, uf.user_id, uf.created_at,
         ur.user_id, ur.rating, ur.created_at
HAVING COUNT(DISTINCT ars.song_id) > 0;

-- index to speed up lookups
CREATE INDEX idx_artist_query_view_name ON artistz(name, deleted_at) WHERE deleted_at IS NULL;

--------------------------------------------------------------------------------
-- album_query_view
--------------------------------------------------------------------------------
CREATE VIEW album_query_view AS
SELECT
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.label as album_label,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- genres as JSON array
    COALESCE(
        (SELECT json_group_array(g.name)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genres,

    -- genre IDs as JSON array
    COALESCE(
        (SELECT json_group_array(g.id)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genre_ids,

    -- images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id),
        '[]'
    ) as album_images,

    -- album tags as JSON array
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- primary artist
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,

    -- artist images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- user favorites and ratings
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM albumz al
LEFT JOIN artist_albumz aa ON al.id = aa.album_id
LEFT JOIN artistz ar ON aa.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'album' AND uf.target_id = al.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'album' AND ur.target_id = al.id
WHERE al.deleted_at IS NULL
AND al.song_count > 0
AND (ar.id IS NULL OR ar.id = (
    SELECT aa2.artist_id
    FROM artist_albumz aa2
    JOIN artistz ar2 ON aa2.artist_id = ar2.id AND ar2.deleted_at IS NULL
    WHERE aa2.album_id = al.id
    ORDER BY ar2.name ASC
    LIMIT 1
));

--------------------------------------------------------------------------------
-- genre_query_view
--------------------------------------------------------------------------------
CREATE VIEW genre_query_view AS
SELECT
    g.id as genre_id,
    g.name as genre_name,
    g.created_at as genre_created_at,
    
    -- count albums with this genre
    (SELECT COUNT(DISTINCT ag.album_id)
     FROM album_genrez ag
     INNER JOIN albumz a ON ag.album_id = a.id
     WHERE ag.genre_id = g.id AND a.deleted_at IS NULL AND a.song_count > 0) as album_count,
    
    -- count songs in albums with this genre
    (SELECT COUNT(DISTINCT als.song_id)
     FROM album_genrez ag
     INNER JOIN album_songz als ON ag.album_id = als.album_id
     INNER JOIN songz s ON als.song_id = s.id
     WHERE ag.genre_id = g.id AND s.deleted_at IS NULL) as song_count,
    
    -- total duration
    (SELECT COALESCE(SUM(s.duration), 0)
     FROM album_genrez ag
     INNER JOIN album_songz als ON ag.album_id = als.album_id
     INNER JOIN songz s ON als.song_id = s.id
     WHERE ag.genre_id = g.id AND s.deleted_at IS NULL) as total_duration,
    
    -- user favorites
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at

FROM genrez g
LEFT JOIN user_favoritez uf ON uf.target_type = 'genre' AND uf.target_id = g.id
WHERE g.deleted_at IS NULL
AND EXISTS (
    SELECT 1 FROM album_genrez ag
    INNER JOIN album_songz als ON ag.album_id = als.album_id
    INNER JOIN songz s ON als.song_id = s.id
    WHERE ag.genre_id = g.id AND s.deleted_at IS NULL
);

--------------------------------------------------------------------------------
-- song_query_view - references artist_query_view
--------------------------------------------------------------------------------
CREATE VIEW song_query_view AS
SELECT
    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    COALESCE(
        (SELECT media_blob_id FROM song_imagez WHERE song_id = s.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM album_imagez WHERE album_id = al.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM artist_imagez WHERE artist_id = ar.id AND is_primary = 1 LIMIT 1)
    ) as song_thumbnail_blob_id,
    s.title as song_title,
    s.track_number as song_track_number,
    s.disc_number as song_disc_number,
    s.duration as song_duration,
    s.bpm as song_bpm,
    s.key_signature as song_key_signature,
    s.metadata as song_metadata,
    s.lyrics as song_lyrics,
    s.processing_status as song_processing_status,
    s.processing_notes as song_processing_notes,
    s.created_at as song_created_at,
    s.updated_at as song_updated_at,
    s.deleted_at as song_deleted_at,
    s.deleted_by as song_deleted_by,
    s.created_by as song_created_by,
    s.updated_by as song_updated_by,

    -- song images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
         FROM song_imagez si
         JOIN media_blobz mb ON si.media_blob_id = mb.id
         WHERE si.song_id = s.id),
        '[]'
    ) as song_images,

    -- artist fields
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- artist images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.label as album_label,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- album genres as JSON array
    COALESCE(
        (SELECT json_group_array(g.name)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genres,

    -- album genre IDs as JSON array
    COALESCE(
        (SELECT json_group_array(g.id)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genre_ids,

    -- album tags as JSON array
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- album images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id),
        '[]'
    ) as album_images,

    -- artist aggregated stats (from artist_query_view)
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- user favorites and ratings for song
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at,

    -- album favorite status
    uf_album.id as album_favorite_id,
    uf_album.user_id as album_favorite_user_id,
    uf_album.created_at as album_favorited_at,

    -- album rating status
    ur_album.user_id as album_rating_user_id,
    ur_album.rating as album_user_rating,
    ur_album.created_at as album_rating_created_at

FROM songz s
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
LEFT JOIN user_favoritez uf_album ON uf_album.target_type = 'album' AND uf_album.target_id = al.id
LEFT JOIN user_ratingz ur_album ON ur_album.target_type = 'album' AND ur_album.target_id = al.id
WHERE s.deleted_at IS NULL;

--------------------------------------------------------------------------------
-- playlist_query_view
--------------------------------------------------------------------------------
CREATE VIEW playlist_query_view AS
SELECT
    pl.id as playlist_id,
    pl.title as playlist_title,
    pl.description as playlist_description,
    pl.is_public as playlist_is_public,
    pl.created_by_id as playlist_created_by_id,
    pl.created_at as playlist_created_at,
    pl.updated_at as playlist_updated_at,
    pl.deleted_at as playlist_deleted_at,
    pl.deleted_by as playlist_deleted_by,
    pl.created_by as playlist_created_by,
    pl.updated_by as playlist_updated_by,

    -- images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
         FROM playlist_imagez pi
         JOIN media_blobz mb ON pi.media_blob_id = mb.id
         WHERE pi.playlist_id = pl.id),
        '[]'
    ) as playlist_images,

    -- aggregated stats
    COUNT(ps.song_id) as playlist_song_count,
    COALESCE(SUM(s.duration), 0) as playlist_total_duration,

    -- user favorites
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at

FROM playlistz pl
LEFT JOIN playlist_songz ps ON pl.id = ps.playlist_id
LEFT JOIN songz s ON ps.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'playlist' AND uf.target_id = pl.id
WHERE pl.deleted_at IS NULL
GROUP BY pl.id, pl.title, pl.description, pl.is_public, pl.created_by_id,
         pl.created_at, pl.updated_at, pl.deleted_at, uf.id, uf.user_id, uf.created_at;

--------------------------------------------------------------------------------
-- playlist_song_query_view - references artist_query_view
--------------------------------------------------------------------------------
CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist relationship fields
    ps.position as position,
    ps.added_at as added_at,
    pl.id as playlist_id,

    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    COALESCE(
        (SELECT media_blob_id FROM song_imagez WHERE song_id = s.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM album_imagez WHERE album_id = al.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM artist_imagez WHERE artist_id = ar.id AND is_primary = 1 LIMIT 1)
    ) as song_thumbnail_blob_id,
    s.title as song_title,
    s.track_number as song_track_number,
    s.disc_number as song_disc_number,
    s.duration as song_duration,
    s.bpm as song_bpm,
    s.key_signature as song_key_signature,
    s.metadata as song_metadata,
    s.lyrics as song_lyrics,
    s.processing_status as song_processing_status,
    s.processing_notes as song_processing_notes,
    s.created_at as song_created_at,
    s.updated_at as song_updated_at,
    s.deleted_at as song_deleted_at,
    s.deleted_by as song_deleted_by,
    s.created_by as song_created_by,
    s.updated_by as song_updated_by,

    -- song images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
         FROM song_imagez si
         JOIN media_blobz mb ON si.media_blob_id = mb.id
         WHERE si.song_id = s.id),
        '[]'
    ) as song_images,

    -- artist fields
    ar.id as artist_id,
    ar.name as artist_name,
    ar.bio as artist_bio,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- artist images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.label as album_label,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- album genres as JSON array
    COALESCE(
        (SELECT json_group_array(g.name)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genres,

    -- album genre IDs as JSON array
    COALESCE(
        (SELECT json_group_array(g.id)
         FROM album_genrez ag
         INNER JOIN genrez g ON ag.genre_id = g.id
         WHERE ag.album_id = al.id
         ORDER BY g.name ASC),
        '[]'
    ) as album_genre_ids,

    -- album tags as JSON array
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- album images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id),
        '[]'
    ) as album_images,

    -- user favorites and ratings for song
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at,

    -- album favorite status
    uf_album.id as album_favorite_id,
    uf_album.user_id as album_favorite_user_id,
    uf_album.created_at as album_favorited_at,

    -- album rating status
    ur_album.user_id as album_rating_user_id,
    ur_album.rating as album_user_rating,
    ur_album.created_at as album_rating_created_at

FROM playlist_songz ps
LEFT JOIN songz s ON ps.song_id = s.id
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN playlistz pl ON ps.playlist_id = pl.id
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
LEFT JOIN user_favoritez uf_album ON uf_album.target_type = 'album' AND uf_album.target_id = al.id
LEFT JOIN user_ratingz ur_album ON ur_album.target_type = 'album' AND ur_album.target_id = al.id
WHERE s.deleted_at IS NULL AND pl.deleted_at IS NULL
ORDER BY ps.position;
