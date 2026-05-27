-- artist_query_view - MUST BE FIRST (referenced by song views)
-- fixed: removed user_favoritez/user_ratingz joins that caused duplicates

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

    -- aggregated stats (only non-deleted songs)
    COUNT(DISTINCT ars.song_id) as song_count,
    (SELECT COUNT(DISTINCT aa2.album_id)
     FROM artist_albumz aa2
     JOIN albumz al ON aa2.album_id = al.id
     WHERE aa2.artist_id = ar.id AND al.deleted_at IS NULL AND al.song_count > 0) as album_count,
    COALESCE(SUM(s.duration), 0) as total_duration,

    -- user favorites and ratings - now NULL (populated via cache layer)
    NULL as favorite_id,
    NULL as favorite_user_id,
    NULL as favorited_at,
    NULL as rating_user_id,
    NULL as user_rating,
    NULL as rating_created_at

FROM artistz ar
LEFT JOIN artist_songz ars ON ar.id = ars.artist_id
LEFT JOIN songz s ON ars.song_id = s.id AND s.deleted_at IS NULL
WHERE ar.deleted_at IS NULL
GROUP BY ar.id, ar.name, ar.bio, ar.created_at, ar.updated_at, ar.deleted_at,
         ar.deleted_by, ar.created_by, ar.updated_by,
         ar.metadata, ar.lastfm_lookup_status, ar.audiodb_lookup_status
HAVING COUNT(DISTINCT ars.song_id) > 0;
