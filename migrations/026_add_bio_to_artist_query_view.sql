-- add bio field to artist_query_view

DROP VIEW IF EXISTS artist_query_view;

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
LEFT JOIN user_favoritez uf ON uf.target_type = 'artist' AND uf.target_id = ar.id
LEFT JOIN user_ratingz ur ON ur.target_type = 'artist' AND ur.target_id = ar.id
WHERE ar.deleted_at IS NULL
GROUP BY ar.id, uf.id, ur.user_id;
