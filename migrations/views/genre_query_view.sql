-- genre_query_view
-- fixed: removed user_favoritez join that caused duplicates

DROP VIEW IF EXISTS genre_query_view;
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
    
    -- user favorites - now NULL (populated via cache layer)
    NULL as favorite_id,
    NULL as favorite_user_id,
    NULL as favorited_at

FROM genrez g
WHERE g.deleted_at IS NULL
AND EXISTS (
    SELECT 1 FROM album_genrez ag
    INNER JOIN album_songz als ON ag.album_id = als.album_id
    INNER JOIN songz s ON als.song_id = s.id
    WHERE ag.genre_id = g.id AND s.deleted_at IS NULL
);
