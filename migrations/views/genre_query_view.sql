-- genre_query_view
-- sources from taxonz/album_taxonz with kind=genre. preserved for back-compat
-- with the legacy `genres` entity wire shape until callers migrate to the
-- taxonomy entity directly.

DROP VIEW IF EXISTS genre_query_view;
CREATE VIEW genre_query_view AS
SELECT
    g.id as genre_id,
    g.label as genre_name,
    g.created_at as genre_created_at,

    -- count albums with this genre-taxon
    (SELECT COUNT(DISTINCT ag.album_id)
     FROM album_taxonz ag
     INNER JOIN albumz a ON ag.album_id = a.id
     WHERE ag.taxon_id = g.id AND a.deleted_at IS NULL AND a.song_count > 0) as album_count,

    -- count songs in albums with this genre-taxon
    (SELECT COUNT(DISTINCT als.song_id)
     FROM album_taxonz ag
     INNER JOIN album_songz als ON ag.album_id = als.album_id
     INNER JOIN songz s ON als.song_id = s.id
     WHERE ag.taxon_id = g.id AND s.deleted_at IS NULL) as song_count,

    -- total duration
    (SELECT COALESCE(SUM(s.duration), 0)
     FROM album_taxonz ag
     INNER JOIN album_songz als ON ag.album_id = als.album_id
     INNER JOIN songz s ON als.song_id = s.id
     WHERE ag.taxon_id = g.id AND s.deleted_at IS NULL) as total_duration,

    -- user favorites - now NULL (populated via cache layer)
    NULL as favorite_id,
    NULL as favorite_user_id,
    NULL as favorited_at

FROM taxonz g
JOIN taxon_kindz k ON k.id = g.kind_id AND k.slug = 'genre'
WHERE g.deleted_at IS NULL
AND EXISTS (
    SELECT 1 FROM album_taxonz ag
    INNER JOIN album_songz als ON ag.album_id = als.album_id
    INNER JOIN songz s ON als.song_id = s.id
    WHERE ag.taxon_id = g.id AND s.deleted_at IS NULL
);
