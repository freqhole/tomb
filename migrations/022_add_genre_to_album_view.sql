-- add genre name and sub_genres to album_query_view
-- this allows us to show genre information when displaying albums without extra queries

DROP VIEW IF EXISTS album_query_view;

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

    -- genre fields
    g.name as album_genre_name,
    
    -- album sub_genres as JSON array: ["diycore", "queercore", ...]
    (SELECT json_group_array(sg.name)
     FROM album_sub_genrez asg
     INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
     WHERE asg.album_id = al.id
     ORDER BY sg.name ASC) as album_sub_genres,

    -- images as JSON array: [{"blob_id": "...", "is_primary": 1}, ...]
    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary))
     FROM album_imagez ai
     WHERE ai.album_id = al.id) as album_images,

    -- album tags as JSON array of tag names
    (SELECT json_group_array(t.name)
     FROM album_tagz at
     INNER JOIN tagz t ON at.tag_id = t.id
     WHERE at.album_id = al.id AND t.deleted_at IS NULL
     ORDER BY t.name ASC) as album_tags,

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
LEFT JOIN genrez g ON al.genre_id = g.id
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
