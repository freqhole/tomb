-- video_query_view - denormalized read view for videoz. collapses the
-- per-row images/play_count subqueries every video repository query used
-- to hand-duplicate (get_video, list_videos_by_series, list_videos_by_season,
-- list_videos_unattached, list_recently_added_videos, list_unassigned_videos,
-- list_videos_by_taxon_value) into a single shared projection, and carries
-- media_blob_blake3 so every read gets a video's content hash for free.
--
-- no series/season/artist join needed here (unlike song_query_view) -
-- video's series/season rows are fetched separately by their own entities.

DROP VIEW IF EXISTS video_query_view;
CREATE VIEW video_query_view AS
SELECT
    v.id as id,
    v.series_id as series_id,
    v.season_id as season_id,
    v.episode_number as episode_number,
    v.content_type as content_type,
    v.title as title,
    v.description as description,
    v.media_blob_id as media_blob_id,
    v.media_blob_blake3 as media_blob_blake3,
    v.parent_video_id as parent_video_id,
    v.poster_blob_id as poster_blob_id,
    v.duration_seconds as duration_seconds,
    v.release_date as release_date,
    v.created_at as created_at,
    v.updated_at as updated_at,
    v.deleted_at as deleted_at,
    v.created_by as created_by,
    v.updated_by as updated_by,
    v.deleted_by as deleted_by,
    COALESCE(
        (SELECT json_group_array(json_object('blob_id', media_blob_id, 'is_primary', is_primary, 'blob_type', blob_type))
         FROM (SELECT media_blob_id, is_primary, blob_type FROM entity_imagez
               WHERE entity_type = 'video' AND entity_id = v.id
               ORDER BY is_primary DESC, created_at DESC)),
        '[]'
    ) as images,
    (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = v.id) as play_count
FROM videoz v;
