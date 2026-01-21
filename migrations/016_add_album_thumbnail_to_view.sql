-- add JSON image arrays to all query views
-- this migration updates song_query_view, artist_query_view, and album_query_view
-- to include a JSON array of all images with primary status indicator

-- drop existing views (in reverse dependency order)
DROP VIEW IF EXISTS playlist_song_query_view;
DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS artist_query_view;
DROP VIEW IF EXISTS song_query_view;

-- recreate song_query_view with images JSON array
CREATE VIEW song_query_view AS
SELECT
    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    s.thumbnail_blob_id as song_thumbnail_blob_id,
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

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- user favorites and ratings (for filtering by user_id in queries)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM songz s
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
WHERE s.deleted_at IS NULL;

-- recreate artist_query_view with images JSON array
CREATE VIEW artist_query_view AS
SELECT
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- images as JSON array: [{"blob_id": "...", "is_primary": 1}, ...]
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary))
     FROM artist_imagez ai
     WHERE ai.artist_id = ar.id) as artist_images,

    -- aggregated stats
    COUNT(DISTINCT ars.song_id) as song_count,
    COUNT(DISTINCT aa.album_id) as album_count,
    COALESCE(SUM(s.duration), 0) as total_duration,

    -- user favorites and ratings (for filtering by user_id in queries)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM artistz ar
LEFT JOIN artist_songz ars ON ar.id = ars.artist_id
LEFT JOIN songz s ON ars.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN artist_albumz aa ON ar.id = aa.artist_id
LEFT JOIN albumz al ON aa.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'artist' AND uf.target_id = ar.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'artist' AND ur.target_id = ar.id
WHERE ar.deleted_at IS NULL
GROUP BY ar.id, ar.name, ar.created_at, ar.updated_at, ar.deleted_at, ar.deleted_by, ar.created_by, ar.updated_by, uf.id, uf.user_id, uf.created_at, ur.user_id, ur.rating, ur.created_at;

-- recreate album_query_view with images JSON array
CREATE VIEW album_query_view AS
SELECT
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

    -- images as JSON array: [{"blob_id": "...", "is_primary": 1}, ...]
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary))
     FROM album_imagez ai
     WHERE ai.album_id = al.id) as album_images,

    -- primary artist (first alphabetically for consistency)
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,

    -- user favorites and ratings (for filtering by user_id in queries)
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
-- get primary artist (first one alphabetically for deterministic results)
AND (ar.id IS NULL OR ar.id = (
    SELECT aa2.artist_id
    FROM artist_albumz aa2
    JOIN artistz ar2 ON aa2.artist_id = ar2.id AND ar2.deleted_at IS NULL
    WHERE aa2.album_id = al.id
    ORDER BY ar2.name ASC
    LIMIT 1
));

-- recreate playlist_song_query_view (depends on song_query_view)
CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist relationship fields
    ps.position as position,
    ps.added_at as added_at,
    pl.id as playlist_id,

    -- full song fields (same as song_query_view)
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    s.thumbnail_blob_id as song_thumbnail_blob_id,
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

    -- song images as JSON array
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

    -- user favorites and ratings
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at,
    ur.user_id as rating_user_id,
    ur.rating as user_rating,
    ur.created_at as rating_created_at

FROM playlist_songz ps
INNER JOIN playlistz pl ON ps.playlist_id = pl.id
INNER JOIN songz s ON ps.song_id = s.id
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'song' AND uf.target_id = s.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'song' AND ur.target_id = s.id
WHERE s.deleted_at IS NULL
  AND pl.deleted_at IS NULL;
