-- keep member checks correlated to indexed relations, not a nested UNION view.
DROP VIEW IF EXISTS library_offline_container_view;
DROP VIEW IF EXISTS library_container_media_view;
DROP VIEW IF EXISTS library_offline_album_view;
DROP VIEW IF EXISTS library_offline_artist_view;
DROP VIEW IF EXISTS library_offline_series_view;
DROP VIEW IF EXISTS library_offline_playlist_view;

-- typed callers avoid making SQLx analyze unrelated UNION branches.
CREATE VIEW library_offline_album_view AS
SELECT 'album' AS entity_type, c.id AS entity_id FROM albumz c
WHERE c.deleted_at IS NULL
AND (
    EXISTS (SELECT 1 FROM album_songz a JOIN songz s ON s.id = a.song_id
            WHERE a.album_id = c.id AND s.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM videoz v WHERE v.album_id = c.id AND v.deleted_at IS NULL)
)
AND NOT EXISTS (
    SELECT 1 FROM album_songz a JOIN songz s ON s.id = a.song_id
    WHERE a.album_id = c.id AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = s.media_blob_id)
)
AND NOT EXISTS (
    SELECT 1 FROM videoz v WHERE v.album_id = c.id AND v.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = v.media_blob_id)
);

CREATE VIEW library_offline_artist_view AS
SELECT 'artist' AS entity_type, c.id AS entity_id FROM artistz c
WHERE c.deleted_at IS NULL
AND (
    EXISTS (SELECT 1 FROM artist_songz a JOIN songz s ON s.id = a.song_id
            WHERE a.artist_id = c.id AND s.deleted_at IS NULL)
    OR EXISTS (
        SELECT 1 FROM artist_albumz a
        JOIN albumz al ON al.id = a.album_id AND al.deleted_at IS NULL
        JOIN album_songz als ON als.album_id = al.id
        JOIN songz s ON s.id = als.song_id AND s.deleted_at IS NULL
        WHERE a.artist_id = c.id
    )
    OR EXISTS (SELECT 1 FROM videoz v WHERE v.artist_id = c.id AND v.deleted_at IS NULL)
    OR EXISTS (
        SELECT 1 FROM artist_albumz a
        JOIN albumz al ON al.id = a.album_id AND al.deleted_at IS NULL
        JOIN videoz v ON v.album_id = al.id AND v.deleted_at IS NULL
        WHERE a.artist_id = c.id
    )
)
AND NOT EXISTS (
    SELECT 1 FROM artist_songz a JOIN songz s ON s.id = a.song_id
    WHERE a.artist_id = c.id AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = s.media_blob_id)
)
AND NOT EXISTS (
    SELECT 1 FROM artist_albumz a
    JOIN albumz al ON al.id = a.album_id AND al.deleted_at IS NULL
    JOIN album_songz als ON als.album_id = al.id
    JOIN songz s ON s.id = als.song_id AND s.deleted_at IS NULL
    WHERE a.artist_id = c.id
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = s.media_blob_id)
)
AND NOT EXISTS (
    SELECT 1 FROM videoz v WHERE v.artist_id = c.id AND v.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = v.media_blob_id)
)
AND NOT EXISTS (
    SELECT 1 FROM artist_albumz a
    JOIN albumz al ON al.id = a.album_id AND al.deleted_at IS NULL
    JOIN videoz v ON v.album_id = al.id AND v.deleted_at IS NULL
    WHERE a.artist_id = c.id
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = v.media_blob_id)
);

CREATE VIEW library_offline_series_view AS
SELECT 'video_series' AS entity_type, c.id AS entity_id FROM video_seriez c
WHERE c.deleted_at IS NULL
AND EXISTS (SELECT 1 FROM videoz v WHERE v.series_id = c.id AND v.deleted_at IS NULL)
AND NOT EXISTS (
    SELECT 1 FROM videoz v WHERE v.series_id = c.id AND v.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = v.media_blob_id)
);

CREATE VIEW library_offline_playlist_view AS
SELECT 'playlist' AS entity_type, c.id AS entity_id FROM playlistz c
WHERE c.deleted_at IS NULL
AND (
    EXISTS (
        SELECT 1 FROM playlist_itemz p JOIN songz s ON p.entity_type = 'song' AND s.id = p.entity_id
        WHERE p.playlist_id = c.id AND s.deleted_at IS NULL
    )
    OR EXISTS (
        SELECT 1 FROM playlist_itemz p JOIN videoz v ON p.entity_type = 'video' AND v.id = p.entity_id
        WHERE p.playlist_id = c.id AND v.deleted_at IS NULL
    )
)
AND NOT EXISTS (
    SELECT 1 FROM playlist_itemz p JOIN songz s ON p.entity_type = 'song' AND s.id = p.entity_id
    WHERE p.playlist_id = c.id AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = s.media_blob_id)
)
AND NOT EXISTS (
    SELECT 1 FROM playlist_itemz p JOIN videoz v ON p.entity_type = 'video' AND v.id = p.entity_id
    WHERE p.playlist_id = c.id AND v.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_offline_blob_view o WHERE o.blob_id = v.media_blob_id)
)
-- unsupported items are unknown, not evidence of an offline playlist.
AND NOT EXISTS (
    SELECT 1 FROM playlist_itemz p
    WHERE p.playlist_id = c.id AND p.entity_type NOT IN ('song', 'video')
);

CREATE VIEW library_offline_container_view AS
SELECT entity_type, entity_id FROM library_offline_album_view
UNION ALL
SELECT entity_type, entity_id FROM library_offline_artist_view
UNION ALL
SELECT entity_type, entity_id FROM library_offline_series_view
UNION ALL
SELECT entity_type, entity_id FROM library_offline_playlist_view;
