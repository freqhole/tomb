-- keep this projection flattenable: song queries join it for artist stats.
-- grouping here materializes every artist, including offline checks, for one album.
-- fixed: removed user_favoritez/user_ratingz joins that caused duplicates

DROP VIEW IF EXISTS artist_query_view;
CREATE VIEW artist_query_view AS
SELECT
    ar.id as artist_id,
    EXISTS (SELECT 1 FROM library_offline_container_view o
            WHERE o.entity_type = 'artist' AND o.entity_id = ar.id) as is_offline,
    ar.name as artist_name,
    ar.bio as artist_bio,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,
    ar.metadata as artist_metadata,
    ar.lastfm_lookup_status as artist_lastfm_lookup_status,
    ar.audiodb_lookup_status as artist_audiodb_lookup_status,

    -- images as JSON array (waveforms excluded — they're audio peak
    -- data and should never surface as artist art)
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id AND mb.blob_type != 'waveform'),
        '[]'
    ) as artist_images,

    -- entity URLs as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
         FROM entity_urlz eu
         WHERE eu.entity_type = 'artist' AND eu.entity_id = ar.id),
        '[]'
    ) as artist_urls,

    -- counts retain memberships; durations exclude deleted songs.
    (SELECT COUNT(*) FROM artist_songz ars WHERE ars.artist_id = ar.id) as song_count,
    (SELECT COUNT(DISTINCT aa2.album_id)
     FROM artist_albumz aa2
     JOIN albumz al ON aa2.album_id = al.id
     WHERE aa2.artist_id = ar.id AND al.deleted_at IS NULL
       AND (al.song_count > 0 OR EXISTS (
           SELECT 1 FROM videoz vz WHERE vz.album_id = al.id AND vz.deleted_at IS NULL
       ))) as album_count,
    (SELECT COALESCE(SUM(s.duration), 0)
     FROM artist_songz ars
     JOIN songz s ON s.id = ars.song_id AND s.deleted_at IS NULL
     WHERE ars.artist_id = ar.id) as total_duration,

    -- user favorites and ratings - now NULL (populated via cache layer)
    NULL as favorite_id,
    NULL as favorite_user_id,
    NULL as favorited_at,
    NULL as rating_user_id,
    NULL as user_rating,
    NULL as rating_created_at

FROM artistz ar
WHERE ar.deleted_at IS NULL
-- an artist with no songs still surfaces when it has live music/karaoke
-- videos attached (see migration 096).
AND (EXISTS (SELECT 1 FROM artist_songz ars WHERE ars.artist_id = ar.id)
     OR EXISTS (SELECT 1 FROM videoz vz WHERE vz.artist_id = ar.id AND vz.deleted_at IS NULL));
