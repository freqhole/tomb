-- album_query_view
-- fixed: removed user_favoritez/user_ratingz joins that caused duplicates

DROP VIEW IF EXISTS album_query_view;
CREATE VIEW album_query_view AS
SELECT
    al.id as album_id,
    al.title as album_title,
    al.album_type as album_album_type,
    -- album_release_date: first taxon under kind='release_date' linked
    -- to this album. preserves the legacy `album_release_date` column
    -- contract for callers that still expect a string. populated from
    -- `album_taxonz` so `albumz.release_date` can be dropped.
    (SELECT t.label
       FROM album_taxonz at
       JOIN taxonz t ON t.id = at.taxon_id
       JOIN taxon_kindz k ON k.id = t.kind_id
      WHERE at.album_id = al.id
        AND k.slug = 'release_date'
        AND t.deleted_at IS NULL
      ORDER BY at.created_at ASC
      LIMIT 1) as album_release_date,
    -- album_label: first taxon under kind='label' linked to this album.
    -- preserves the legacy `album_label` column contract for callers
    -- that still expect a string. populated from `album_taxonz` so
    -- `albumz.label` can be dropped without breaking consumers.
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
    ucb_album.username as album_created_by_username,
    uub_album.username as album_updated_by_username,
    al.metadata as album_metadata,
    al.mb_lookup_status as album_mb_lookup_status,
    al.mb_lookup_at as album_mb_lookup_at,
    al.mb_lookup_by as album_mb_lookup_by,
    al.review_status as album_review_status,
    al.reviewed_at as album_reviewed_at,

    -- genres as JSON array of objects with id and name (legacy contract)
    -- sourced from album_taxonz filtered to kind='genre'
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

    -- new: every taxon linked to this album, across all kinds. consumers
    -- preferring kind-aware iteration should read this instead of
    -- `album_genres`.
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

    -- images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM album_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.album_id = al.id),
        '[]'
    ) as album_images,

    -- album tags as JSON array
    COALESCE(
        (SELECT json_group_array(t.name)
         FROM album_tagz at
         INNER JOIN tagz t ON at.tag_id = t.id
         WHERE at.album_id = al.id AND t.deleted_at IS NULL
         ORDER BY t.name ASC),
        '[]'
    ) as album_tags,

    -- entity URLs as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
         FROM entity_urlz eu
         WHERE eu.entity_type = 'album' AND eu.entity_id = al.id),
        '[]'
    ) as album_urls,

    -- primary artist
    ar.id as artist_id,
    ar.name as artist_name,
    ar.created_at as artist_created_at,
    ar.updated_at as artist_updated_at,

    -- artist images as JSON array
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
         FROM artist_imagez ai
         JOIN media_blobz mb ON ai.media_blob_id = mb.id
         WHERE ai.artist_id = ar.id),
        '[]'
    ) as artist_images,

    -- user favorites and ratings - now NULL (populated via cache layer)
    NULL as favorite_id,
    NULL as favorite_user_id,
    NULL as favorited_at,
    NULL as rating_user_id,
    NULL as user_rating,
    NULL as rating_created_at

FROM albumz al
LEFT JOIN artist_albumz aa ON al.id = aa.album_id
LEFT JOIN artistz ar ON aa.artist_id = ar.id AND ar.deleted_at IS NULL
LEFT JOIN user_accountz ucb_album ON al.created_by = ucb_album.id
LEFT JOIN user_accountz uub_album ON al.updated_by = uub_album.id
WHERE al.deleted_at IS NULL
AND al.song_count > 0
AND (ar.id IS NULL OR ar.id = (
    SELECT aa2.artist_id
    FROM artist_albumz aa2
    JOIN artistz ar2 ON aa2.artist_id = ar2.id AND ar2.deleted_at IS NULL
    WHERE aa2.album_id = al.id
    ORDER BY ar2.name ASC
    LIMIT 1
));
