-- playlist_song_query_view - references artist_query_view
-- fixed: removed user_favoritez/user_ratingz joins that caused duplicates

DROP VIEW IF EXISTS playlist_song_query_view;
CREATE VIEW playlist_song_query_view AS
SELECT
    -- playlist relationship fields
    ps.position as position,
    ps.added_at as added_at,
    pl.id as playlist_id,

    -- song fields
    s.id as song_id,
    s.media_blob_id as song_media_blob_id,
    COALESCE(
        (SELECT media_blob_id FROM song_imagez WHERE song_id = s.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM album_imagez WHERE album_id = al.id AND is_primary = 1 LIMIT 1),
        (SELECT media_blob_id FROM artist_imagez WHERE artist_id = ar.id AND is_primary = 1 LIMIT 1)
    ) as song_thumbnail_blob_id,

    -- media blob fields (for P2P verified streaming via iroh-blobs)
    mb.sha256 as media_blob_sha256,
    mb.blake3 as media_blob_blake3,
    mb.mime as media_blob_mime,
    mb.size as media_blob_size,

    s.title as song_title,
    s.track_number as song_track_number,
    s.disc_number as song_disc_number,
    s.duration as song_duration,
    s.bpm as song_bpm,
    s.track_artist as song_track_artist,
    s.metadata as song_metadata,
    s.lyrics as song_lyrics,
    s.created_at as song_created_at,
    s.updated_at as song_updated_at,
    s.deleted_at as song_deleted_at,
    s.deleted_by as song_deleted_by,
    s.created_by as song_created_by,
    s.updated_by as song_updated_by,
    ucb_song.username as song_created_by_username,
    uub_song.username as song_updated_by_username,

    -- song images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
         FROM song_imagez si
         JOIN media_blobz mb ON si.media_blob_id = mb.id
         WHERE si.song_id = s.id),
        '[]'
    ) as song_images,

    -- entity URLs as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
         FROM entity_urlz eu
         WHERE eu.entity_type = 'song' AND eu.entity_id = s.id),
        '[]'
    ) as song_urls,

    -- artist fields
    ar.id as artist_id,
    ar.name as artist_name,
    ar.bio as artist_bio,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,
    ar.deleted_at as artist_deleted_at,
    ar.deleted_by as artist_deleted_by,
    ar.created_by as artist_created_by,
    ar.updated_by as artist_updated_by,

    -- artist images as JSON array (waveforms excluded — they're
    -- audio peak data, not visual art)
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id AND mb.blob_type != 'waveform'),
        '[]'
    ) as artist_images,

    -- artist aggregated stats
    arv.song_count as artist_total_song_count,
    arv.album_count as artist_total_album_count,
    arv.total_duration as artist_total_duration,

    -- album fields
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    -- legacy `album_release_date` column sourced from album_taxonz (kind='release_date')
    (SELECT t.label
       FROM album_taxonz at
       JOIN taxonz t ON t.id = at.taxon_id
       JOIN taxon_kindz k ON k.id = t.kind_id
      WHERE at.album_id = al.id
        AND k.slug = 'release_date'
        AND t.deleted_at IS NULL
      ORDER BY at.created_at ASC
      LIMIT 1) as album_release_date,
    -- legacy `album_label` column sourced from album_taxonz (kind='label')
    (SELECT t.label
       FROM album_taxonz at
       JOIN taxonz t ON t.id = at.taxon_id
       JOIN taxon_kindz k ON k.id = t.kind_id
      WHERE at.album_id = al.id
        AND k.slug = 'label'
        AND t.deleted_at IS NULL
      ORDER BY at.created_at ASC
      LIMIT 1) as album_label,
    al.song_count as album_song_count,
    al.total_duration as album_total_duration,
    al.created_at as album_created_at,
    al.updated_at as album_updated_at,
    al.deleted_at as album_deleted_at,
    al.deleted_by as album_deleted_by,
    al.created_by as album_created_by,
    al.updated_by as album_updated_by,

    -- album genres (legacy contract; sourced from album_taxonz kind='genre')
    COALESCE(
        (SELECT json_group_array(json_object('id', t.id, 'name', t.label))
         FROM album_taxonz at
         INNER JOIN taxonz t ON t.id = at.taxon_id
         INNER JOIN taxon_kindz k ON k.id = t.kind_id
         WHERE at.album_id = al.id
           AND k.slug = 'genre'
           AND t.deleted_at IS NULL),
        '[]'
    ) as album_genres,

    -- new: every taxon linked to the album, across all kinds
    COALESCE(
        (SELECT json_group_array(json_object(
            'id', t.id,
            'kind_slug', k.slug,
            'label', t.label,
            'origin', at.origin,
            'confidence', at.confidence
         ))
         FROM album_taxonz at
         INNER JOIN taxonz t ON t.id = at.taxon_id
         INNER JOIN taxon_kindz k ON k.id = t.kind_id
         WHERE at.album_id = al.id
           AND t.deleted_at IS NULL),
        '[]'
    ) as album_taxons,

    -- album tags as JSON array
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- album images as JSON array (waveforms excluded — audio
    -- peak data should never surface as cover art)
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id AND mb.blob_type != 'waveform'),
        '[]'
    ) as album_images,

    -- user favorites and ratings for song - now NULL (populated via cache layer)
    NULL as favorite_id,
    NULL as favorite_user_id,
    NULL as favorited_at,
    NULL as rating_user_id,
    NULL as user_rating,
    NULL as rating_created_at,

    -- album favorite status - now NULL (populated via cache layer)
    NULL as album_favorite_id,
    NULL as album_favorite_user_id,
    NULL as album_favorited_at,

    -- album rating status - now NULL (populated via cache layer)
    NULL as album_rating_user_id,
    NULL as album_user_rating,
    NULL as album_rating_created_at,

    -- aggregated play count from music_play_eventz (uses idx_music_play_eventz_song)
    (SELECT COUNT(*) FROM music_play_eventz WHERE song_id = s.id) as song_play_count

FROM playlist_songz ps
LEFT JOIN songz s ON ps.song_id = s.id
LEFT JOIN media_blobz mb ON s.media_blob_id = mb.id
LEFT JOIN artist_songz ars ON s.id = ars.song_id
LEFT JOIN artistz ar ON ars.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN album_songz als ON s.id = als.song_id
LEFT JOIN albumz al ON als.album_id = al.id AND al.deleted_at IS NULL
LEFT JOIN playlistz pl ON ps.playlist_id = pl.id
LEFT JOIN artist_query_view arv ON ar.id = arv.artist_id
LEFT JOIN user_accountz ucb_song ON s.created_by = ucb_song.id
LEFT JOIN user_accountz uub_song ON s.updated_by = uub_song.id
WHERE s.deleted_at IS NULL AND pl.deleted_at IS NULL
ORDER BY ps.position;
