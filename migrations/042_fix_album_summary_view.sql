-- Fix album_summary view by removing user-specific rating and favorite fields
-- These fields are now user-specific and should not be in a global view

-- Drop the existing view
DROP VIEW IF EXISTS album_summary;

-- Create the corrected album_summary view without user-specific fields
CREATE VIEW album_summary AS
SELECT
    album,
    album_artist,
    -- For various artists albums, show a representative artist or artist list
    CASE
        WHEN COUNT(DISTINCT artist) = 1 THEN MIN(artist)
        WHEN album_artist = 'Various Artists' THEN album_artist
        WHEN COUNT(DISTINCT artist) <= 3 THEN STRING_AGG(DISTINCT artist, ', ' ORDER BY artist)
        ELSE STRING_AGG(DISTINCT artist, ', ' ORDER BY artist) || ' and others'
    END as artist,
    COUNT(*) as track_count,
    COUNT(DISTINCT disc_number) as disc_count,
    SUM(duration) as total_duration,
    MIN(year) as year,
    STRING_AGG(DISTINCT genre, ', ') as genres,
    -- Remove avg_rating since ratings are now user-specific
    NULL::FLOAT8 as avg_rating,
    -- Remove favorite_count since favorites are now user-specific
    0::BIGINT as favorite_count,
    MIN(created_at) as first_added,
    MAX(updated_at) as last_modified,
    -- Get thumbnail from first track that has one
    (SELECT thumbnail_blob_id FROM songs s2
     WHERE s2.album = s.album
     AND s2.thumbnail_blob_id IS NOT NULL
     AND s2.deleted_at IS NULL
     ORDER BY disc_number NULLS LAST, track_number NULLS LAST
     LIMIT 1) as album_thumbnail_id
FROM songs s
WHERE s.deleted_at IS NULL
  AND s.album IS NOT NULL
GROUP BY album, album_artist
ORDER BY year DESC NULLS LAST, album;

COMMENT ON VIEW album_summary IS 'album summary without user-specific data (rating/favorites removed due to per-user preferences)';
