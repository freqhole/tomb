-- replaceable projections, recreated by the views loader after schema migrations.
DROP VIEW IF EXISTS library_offline_blob_view;
DROP VIEW IF EXISTS library_sync_source_view;
DROP VIEW IF EXISTS library_source_blob_path_view;

CREATE VIEW library_source_blob_path_view AS
SELECT DISTINCT b.id AS blob_id, p.source_id
FROM media_blobz b
JOIN library_source_pathz p
  ON substr(b.local_path, 1, length(p.path)) = p.path
 AND (substr(p.path, -1) = '/'
      OR substr(b.local_path, length(p.path) + 1, 1) = '/'
      OR (substr(p.path, 1, 1) != '/'
          AND (substr(p.path, -1) = '\'
               OR substr(b.local_path, length(p.path) + 1, 1) = '\')))
JOIN library_sourcez s ON s.id = p.source_id;

CREATE VIEW library_sync_source_view AS
WITH source_mount AS (
    SELECT id, volume_uuid,
           CASE WHEN relative_path = '' THEN last_known_path
                ELSE substr(last_known_path, 1, length(last_known_path) - length(relative_path) - 1)
           END AS mount_path
    FROM library_sourcez
)
SELECT s.id AS source_id FROM source_mount s
WHERE EXISTS (
    SELECT 1 FROM storage_sync_targetz t
    WHERE t.volume_uuid = s.volume_uuid COLLATE NOCASE
       OR t.path = s.mount_path
       OR (substr(t.path, 1, length(s.mount_path)) = s.mount_path
           AND (substr(s.mount_path, -1) = '/'
                OR substr(t.path, length(s.mount_path) + 1, 1) = '/'
                OR (substr(s.mount_path, 1, 1) != '/'
                    AND (substr(s.mount_path, -1) = '\'
                         OR substr(t.path, length(s.mount_path) + 1, 1) = '\'))))
       OR (substr(s.mount_path, 1, length(t.path)) = t.path
           AND (substr(t.path, -1) = '/'
                OR substr(s.mount_path, length(t.path) + 1, 1) = '/'
                OR (substr(t.path, 1, 1) != '/'
                    AND (substr(t.path, -1) = '\'
                         OR substr(s.mount_path, length(t.path) + 1, 1) = '\'))))
);

-- unknown/untracked and sync-owned media are not confirmed offline.
CREATE VIEW library_offline_blob_view AS
SELECT b.id AS blob_id FROM media_blobz b
WHERE EXISTS (
    SELECT 1 FROM library_source_mediaz m
    JOIN library_source_statez a ON a.source_id = m.source_id
    WHERE m.blob_id = b.id AND a.status = 'offline'
      AND NOT EXISTS (SELECT 1 FROM library_sync_source_view r WHERE r.source_id = m.source_id)
)
AND NOT EXISTS (
    SELECT 1 FROM library_source_mediaz m
    LEFT JOIN library_source_statez a ON a.source_id = m.source_id
    WHERE m.blob_id = b.id AND COALESCE(a.status, 'unknown') != 'offline'
      AND NOT EXISTS (SELECT 1 FROM library_sync_source_view r WHERE r.source_id = m.source_id)
);
