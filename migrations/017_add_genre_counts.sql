-- add song and album counts to genre query view

-- drop the existing view
DROP VIEW IF EXISTS genre_query_view;

-- recreate genre query view with aggregated counts
CREATE VIEW genre_query_view AS
SELECT
    g.id as genre_id,
    g.name as genre_name,
    g.created_at as genre_created_at,

    -- aggregated stats
    COUNT(DISTINCT s.id) as song_count,
    COUNT(DISTINCT al.id) as album_count,

    -- user favorites (no ratings for genres)
    uf.id as favorite_id,
    uf.user_id as favorite_user_id,
    uf.created_at as favorited_at

FROM genrez g
LEFT JOIN albumz al ON g.id = al.genre_id AND al.deleted_at IS NULL
LEFT JOIN album_songz als ON al.id = als.album_id
LEFT JOIN songz s ON als.song_id = s.id AND s.deleted_at IS NULL
LEFT JOIN user_favoritez uf ON uf.target_type = 'genre' AND uf.target_id = g.id
WHERE g.deleted_at IS NULL
GROUP BY g.id, g.name, g.created_at, uf.id, uf.user_id, uf.created_at;
