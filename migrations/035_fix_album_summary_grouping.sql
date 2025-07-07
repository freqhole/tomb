-- Fix album_summary view to properly group albums without duplicating various artists albums
-- This migration drops and recreates the album_summary view to fix the grouping issue

-- Drop the existing view
DROP VIEW IF EXISTS album_summary;

-- Create the corrected album_summary view
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
    AVG(rating) FILTER (WHERE rating IS NOT NULL) as avg_rating,
    COUNT(*) FILTER (WHERE is_favorite = true) as favorite_count,
    MIN(created_at) as first_added,
    MAX(updated_at) as last_modified,
    -- Get thumbnail from first track that has one
    (SELECT thumbnail_blob_id FROM songs s2
     WHERE s2.album = s.album
     AND (s2.album_artist = s.album_artist OR (s2.album_artist IS NULL AND s.album_artist IS NULL))
     AND s2.thumbnail_blob_id IS NOT NULL
     AND s2.deleted_at IS NULL
     ORDER BY disc_number NULLS LAST, track_number NULLS LAST
     LIMIT 1) as album_thumbnail_id
FROM songs s
WHERE deleted_at IS NULL
GROUP BY album, album_artist
HAVING album IS NOT NULL;
