-- playlist_query_view
-- fixed: removed user_favoritez join that caused duplicates

DROP VIEW IF EXISTS playlist_query_view;
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

    -- entity URLs as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
         FROM entity_urlz eu
         WHERE eu.entity_type = 'playlist' AND eu.entity_id = pl.id),
        '[]'
    ) as playlist_urls,

    -- aggregated stats
    COUNT(ps.song_id) as playlist_song_count,
    COALESCE(SUM(s.duration), 0) as playlist_total_duration,

    -- user favorites - now NULL (populated via cache layer)
    NULL as favorite_id,
    NULL as favorite_user_id,
    NULL as favorited_at

FROM playlistz pl
LEFT JOIN playlist_songz ps ON pl.id = ps.playlist_id
LEFT JOIN songz s ON ps.song_id = s.id AND s.deleted_at IS NULL
WHERE pl.deleted_at IS NULL
GROUP BY pl.id, pl.title, pl.description, pl.is_public, pl.created_by_id,
         pl.created_at, pl.updated_at, pl.deleted_at;
