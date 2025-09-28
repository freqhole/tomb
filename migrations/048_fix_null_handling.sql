-- Fix NULL handling in processing functions
-- Migration: 049_fix_null_handling.sql

-- Drop and recreate the function without "Unknown" defaults
DROP FUNCTION IF EXISTS get_albums_for_processing(VARCHAR(20), VARCHAR(255), INTEGER, INTEGER);

-- Create function that properly handles NULLs
CREATE OR REPLACE FUNCTION get_albums_for_processing(
    filter_status VARCHAR(20) DEFAULT NULL,
    artist_filter VARCHAR(255) DEFAULT NULL,
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
    album_name TEXT,
    artist_name TEXT,
    song_count BIGINT,
    processed_count INTEGER,
    status TEXT,
    notes TEXT,
    updated_at TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        s.album as album_name,
        s.artist as artist_name,
        COUNT(*) as song_count,
        COALESCE(aps.processed_count, 0) as processed_count,
        COALESCE(aps.status, 'unprocessed') as status,
        aps.notes,
        COALESCE(aps.updated_at, s.created_at) as updated_at
    FROM songs s
    LEFT JOIN album_processing_status aps
        ON aps.album_name = s.album
        AND aps.artist_name = s.artist
    WHERE
        (filter_status IS NULL OR COALESCE(aps.status, 'unprocessed') = filter_status)
        AND (artist_filter IS NULL OR s.artist ILIKE '%' || artist_filter || '%')
    GROUP BY
        s.album,
        s.artist,
        aps.processed_count,
        aps.status,
        aps.notes,
        aps.updated_at,
        s.created_at
    ORDER BY updated_at DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Update album processing status trigger to handle NULLs properly
CREATE OR REPLACE FUNCTION update_album_processing_counts()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if song has both album and artist (avoid NULL groupings)
    IF NEW.album IS NOT NULL AND NEW.artist IS NOT NULL THEN
        INSERT INTO album_processing_status (album_name, artist_name, song_count, processed_count)
        SELECT
            NEW.album,
            NEW.artist,
            COUNT(*) as total_songs,
            COUNT(*) FILTER (WHERE processing_status IN ('processed', 'skip')) as processed_songs
        FROM songs
        WHERE album = NEW.album
          AND artist = NEW.artist
        GROUP BY album, artist
        ON CONFLICT (album_name, artist_name)
        DO UPDATE SET
            song_count = EXCLUDED.song_count,
            processed_count = EXCLUDED.processed_count,
            updated_at = NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add function to get songs with NULL albums/artists (good candidates for musicbrainz)
CREATE OR REPLACE FUNCTION get_songs_needing_metadata(
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    artist TEXT,
    album TEXT,
    file_path TEXT,
    processing_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        s.artist,
        s.album,
        mb.file_path,
        COALESCE(s.processing_status, 'unprocessed') as processing_status
    FROM songs s
    JOIN media_blobs mb ON s.media_blob_id = mb.blob_id
    WHERE (s.artist IS NULL OR s.album IS NULL OR s.genre IS NULL)
      AND COALESCE(s.processing_status, 'unprocessed') = 'unprocessed'
    ORDER BY s.created_at DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Add function to find potential duplicate groups
CREATE OR REPLACE FUNCTION find_potential_duplicates(
    similarity_threshold FLOAT DEFAULT 0.8,
    limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
    group_id INTEGER,
    song_id UUID,
    title TEXT,
    artist TEXT,
    album TEXT,
    file_size BIGINT,
    similarity_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    WITH duplicate_candidates AS (
        SELECT
            s1.id as song1_id,
            s2.id as song2_id,
            s1.title as title1,
            s2.title as title2,
            s1.artist as artist1,
            s2.artist as artist2,
            -- Simple similarity based on title and artist matching
            CASE
                WHEN LOWER(s1.title) = LOWER(s2.title) AND LOWER(COALESCE(s1.artist, '')) = LOWER(COALESCE(s2.artist, '')) THEN 1.0
                WHEN LOWER(s1.title) = LOWER(s2.title) THEN 0.8
                ELSE 0.0
            END as similarity
        FROM songs s1
        JOIN songs s2 ON s1.id < s2.id -- avoid duplicating pairs
        WHERE s1.title IS NOT NULL
          AND s2.title IS NOT NULL
    )
    SELECT
        ROW_NUMBER() OVER (ORDER BY similarity DESC)::INTEGER as group_id,
        dc.song1_id as song_id,
        dc.title1 as title,
        dc.artist1 as artist,
        s.album,
        mb.file_size,
        dc.similarity as similarity_score
    FROM duplicate_candidates dc
    JOIN songs s ON s.id = dc.song1_id
    JOIN media_blobs mb ON s.media_blob_id = mb.blob_id
    WHERE dc.similarity >= similarity_threshold
    ORDER BY dc.similarity DESC, dc.title1
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;
