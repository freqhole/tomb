-- shared container availability is recreated with the other query views at startup.
DROP VIEW IF EXISTS library_offline_container_view;
DROP VIEW IF EXISTS library_container_media_view;

-- artwork never determines whether a container's media is offline.
CREATE VIEW library_container_media_view AS
SELECT 'album' AS entity_type, a.album_id AS entity_id, s.media_blob_id AS blob_id
FROM album_songz a JOIN songz s ON s.id = a.song_id WHERE s.deleted_at IS NULL
UNION ALL
SELECT 'album', v.album_id, v.media_blob_id
FROM videoz v WHERE v.album_id IS NOT NULL AND v.deleted_at IS NULL
UNION ALL
SELECT 'artist', a.artist_id, s.media_blob_id
FROM artist_songz a JOIN songz s ON s.id = a.song_id WHERE s.deleted_at IS NULL
UNION ALL
SELECT 'artist', a.artist_id, s.media_blob_id
FROM artist_albumz a
JOIN albumz al ON al.id = a.album_id AND al.deleted_at IS NULL
JOIN album_songz als ON als.album_id = al.id
JOIN songz s ON s.id = als.song_id AND s.deleted_at IS NULL
UNION ALL
SELECT 'artist', v.artist_id, v.media_blob_id
FROM videoz v WHERE v.artist_id IS NOT NULL AND v.deleted_at IS NULL
UNION ALL
SELECT 'artist', a.artist_id, v.media_blob_id
FROM artist_albumz a
JOIN albumz al ON al.id = a.album_id AND al.deleted_at IS NULL
JOIN videoz v ON v.album_id = al.id AND v.deleted_at IS NULL
UNION ALL
SELECT 'video_series', v.series_id, v.media_blob_id
FROM videoz v WHERE v.series_id IS NOT NULL AND v.deleted_at IS NULL
UNION ALL
SELECT 'playlist', p.playlist_id, s.media_blob_id
FROM playlist_itemz p JOIN songz s ON p.entity_type = 'song' AND s.id = p.entity_id
WHERE s.deleted_at IS NULL
UNION ALL
SELECT 'playlist', p.playlist_id, v.media_blob_id
FROM playlist_itemz p JOIN videoz v ON p.entity_type = 'video' AND v.id = p.entity_id
WHERE v.deleted_at IS NULL
UNION ALL
-- unsupported item kinds are unknown, not proof that a playlist is offline.
SELECT 'playlist', p.playlist_id, NULL
FROM playlist_itemz p WHERE p.entity_type NOT IN ('song', 'video');

CREATE VIEW library_offline_container_view AS
SELECT c.entity_type, c.entity_id FROM (
    SELECT 'album' AS entity_type, id AS entity_id FROM albumz WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'artist', id FROM artistz WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'video_series', id FROM video_seriez WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'playlist', id FROM playlistz WHERE deleted_at IS NULL
) c
WHERE EXISTS (
    SELECT 1 FROM library_container_media_view m
    WHERE m.entity_type = c.entity_type AND m.entity_id = c.entity_id
)
AND NOT EXISTS (
    SELECT 1 FROM library_container_media_view m
    WHERE m.entity_type = c.entity_type AND m.entity_id = c.entity_id
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = m.blob_id)
);
