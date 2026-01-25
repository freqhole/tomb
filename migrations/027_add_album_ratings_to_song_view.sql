-- add album rating fields to song query views so songs can display their album's rating
-- this allows album sections in artist detail view to show album ratings

DROP VIEW IF EXISTS song_query_view;

CREATE VIEW song_query_view AS
SELECT
    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    COALESCE(
        s.thumbnail_blob_id,
        (SELECT media_blob_id FROM album_imagez WHERE album_id = al.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM artist_imagez WHERE artist_id = ar.id AND is_primary = 1 LIMIT 1)
    ) as song_thumbnail_blob_id,
    s.waveform_blob_id as song_waveform_blob_id,
    s.title as song_title,
    s.track_number as song_track_number,
    s.disc_number as song_disc_number,
    s.duration as song_duration,
    s.year as song_year,
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

    -- images as JSON array: [{"blob_id": "...", "is_primary": 1}, ...]
    (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary))
     FROM song_imagez si
     WHERE si.song_id = s.id) as song_images,

    -- artist fields (primary artist via artist_songz)
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.genre_id as album_genre_id,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- genre fields
    g.name as album_genre_name,
    
    -- album sub_genres as JSON array: ["diycore", "queercore", ...]
    (SELECT json_group_array(sg.name)
     FROM album_sub_genrez asg
     INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
     WHERE asg.album_id = al.id
     ORDER BY sg.name ASC) as album_sub_genres,

    -- album tags as JSON array of tag names: ["jazz", "experimental", ...]
    (SELECT json_group_array(t.name)
     FROM album_tagz at
     INNER JOIN tagz t ON at.tag_id = t.id
     WHERE at.album_id = al.id AND t.deleted_at IS NULL
     ORDER BY t.name ASC) as album_tags,

    -- album images as JSON array: [{"blob_id": "...", "is_primary": 1}, ...]
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary))
     FROM album_imagez ai
     WHERE ai.album_id = al.id) as album_images,

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- user favorites and ratings for songs (for filtering by user_id in queries)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at,

    -- album favorite status (for displaying album favorite in song lists)
    uf_album.id as album_favorite_id,
    uf_album.user_id as album_favorite_user_id,
    uf_album.created_at as album_favorited_at,

    -- album rating status (for displaying album rating in song lists)
    ur_album.user_id as album_rating_user_id,
    ur_album.rating as album_user_rating,
    ur_album.created_at as album_rating_created_at

FROM songz s
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN genrez g ON al.genre_id = g.id
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
LEFT JOIN user_favoritez uf_album ON uf_album.target_type = 'album' AND uf_album.target_id = al.id
LEFT JOIN user_ratingz ur_album ON ur_album.target_type = 'album' AND ur_album.target_id = al.id
WHERE s.deleted_at IS NULL;

-- also update playlist_song_query_view
DROP VIEW IF EXISTS playlist_song_query_view;

CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist relationship fields
    ps.position as position,
    ps.added_at as added_at,
    pl.id as playlist_id,

    -- full song fields (same as song_query_view)
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    COALESCE(
        s.thumbnail_blob_id,
        (SELECT media_blob_id FROM album_imagez WHERE album_id = al.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM artist_imagez WHERE artist_id = ar.id AND is_primary = 1 LIMIT 1)
    ) as song_thumbnail_blob_id,
    s.waveform_blob_id as song_waveform_blob_id,
    s.title as song_title,
    s.track_number as song_track_number,
    s.disc_number as song_disc_number,
    s.duration as song_duration,
    s.year as song_year,
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

    -- images as JSON array
    (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary))
     FROM song_imagez si
     WHERE si.song_id = s.id) as song_images,

    -- artist fields
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    al.release_date as album_release_date,
    al.release_date_precision as album_release_date_precision,
    al.label as album_label,
    al.genre_id as album_genre_id,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- genre fields
    g.name as album_genre_name,
    
    -- album sub_genres as JSON array
    (SELECT json_group_array(sg.name)
     FROM album_sub_genrez asg
     INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
     WHERE asg.album_id = al.id
     ORDER BY sg.name ASC) as album_sub_genres,

    -- album tags as JSON array
    (SELECT json_group_array(t.name)
     FROM album_tagz at
     INNER JOIN tagz t ON at.tag_id = t.id
     WHERE at.album_id = al.id AND t.deleted_at IS NULL
     ORDER BY t.name ASC) as album_tags,

    -- album images as JSON array: [{"blob_id": "...", "is_primary": 1}, ...]
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary))
     FROM album_imagez ai
     WHERE ai.album_id = al.id) as album_images,

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- user favorites and ratings
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
LEFT JOIN genrez g ON al.genre_id = g.id
LEFT JOIN playlistz pl ON ps.playlist_id = pl.id
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
LEFT JOIN user_favoritez uf_album ON uf_album.target_type = 'album' AND uf_album.target_id = al.id
LEFT JOIN user_ratingz ur_album ON ur_album.target_type = 'album' AND ur_album.target_id = al.id
WHERE s.deleted_at IS NULL AND pl.deleted_at IS NULL
ORDER BY ps.position;
