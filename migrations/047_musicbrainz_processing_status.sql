-- Add MusicBrainz processing status tracking fields and tables
-- Migration: 047_musicbrainz_processing_status.sql

-- Add processing status fields to songs table
ALTER TABLE songs
ADD COLUMN IF NOT EXISTS processing_status VARCHAR(20) DEFAULT 'unprocessed',
ADD COLUMN IF NOT EXISTS processing_notes TEXT;

-- Create index for processing status filtering
CREATE INDEX IF NOT EXISTS idx_songs_processing_status ON songs (processing_status);

-- Create album-level processing status tracking table
CREATE TABLE IF NOT EXISTS album_processing_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_name VARCHAR(255) NOT NULL,
    artist_name VARCHAR(255),
    status VARCHAR(20) DEFAULT 'unprocessed',
    notes TEXT,
    song_count INTEGER DEFAULT 0,
    processed_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(album_name, artist_name)
);

-- Create indexes for album processing status
CREATE INDEX IF NOT EXISTS idx_album_processing_status ON album_processing_status (status);
CREATE INDEX IF NOT EXISTS idx_album_processing_artist ON album_processing_status (artist_name);
CREATE INDEX IF NOT EXISTS idx_album_processing_updated ON album_processing_status (updated_at DESC);

-- Add trigger to update album processing counts
CREATE OR REPLACE FUNCTION update_album_processing_counts()
RETURNS TRIGGER AS $$
BEGIN
    -- Update or insert album processing status when song processing status changes
    INSERT INTO album_processing_status (album_name, artist_name, song_count, processed_count)
    SELECT
        COALESCE(NEW.album, 'Unknown Album'),
        COALESCE(NEW.artist, 'Unknown Artist'),
        COUNT(*) as total_songs,
        COUNT(*) FILTER (WHERE processing_status IN ('processed', 'skip')) as processed_songs
    FROM songs
    WHERE album = COALESCE(NEW.album, 'Unknown Album')
      AND artist = COALESCE(NEW.artist, 'Unknown Artist')
    GROUP BY album, artist
    ON CONFLICT (album_name, artist_name)
    DO UPDATE SET
        song_count = EXCLUDED.song_count,
        processed_count = EXCLUDED.processed_count,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for song processing status updates
DROP TRIGGER IF EXISTS trigger_update_album_processing_counts ON songs;
CREATE TRIGGER trigger_update_album_processing_counts
    AFTER UPDATE OF processing_status ON songs
    FOR EACH ROW
    EXECUTE FUNCTION update_album_processing_counts();

-- Create function to get processing progress summary
CREATE OR REPLACE FUNCTION get_processing_progress()
RETURNS TABLE (
    total_songs BIGINT,
    unprocessed_songs BIGINT,
    processed_songs BIGINT,
    skipped_songs BIGINT,
    review_needed_songs BIGINT,
    duplicate_songs BIGINT,
    total_albums BIGINT,
    unprocessed_albums BIGINT,
    processed_albums BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM songs) as total_songs,
        (SELECT COUNT(*) FROM songs WHERE processing_status = 'unprocessed') as unprocessed_songs,
        (SELECT COUNT(*) FROM songs WHERE processing_status = 'processed') as processed_songs,
        (SELECT COUNT(*) FROM songs WHERE processing_status = 'skip') as skipped_songs,
        (SELECT COUNT(*) FROM songs WHERE processing_status = 'review_needed') as review_needed_songs,
        (SELECT COUNT(*) FROM songs WHERE processing_status = 'duplicate') as duplicate_songs,
        (SELECT COUNT(*) FROM album_processing_status) as total_albums,
        (SELECT COUNT(*) FROM album_processing_status WHERE status = 'unprocessed') as unprocessed_albums,
        (SELECT COUNT(*) FROM album_processing_status WHERE status IN ('processed', 'skip')) as processed_albums;
END;
$$ LANGUAGE plpgsql;

-- Create function to mark song processing status
CREATE OR REPLACE FUNCTION mark_song_status(
    song_uuid UUID,
    new_status VARCHAR(20),
    notes_text TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE songs
    SET
        processing_status = new_status,
        processing_notes = COALESCE(notes_text, processing_notes)
    WHERE id = song_uuid;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Create function to mark album processing status
CREATE OR REPLACE FUNCTION mark_album_status(
    album_name_param VARCHAR(255),
    artist_name_param VARCHAR(255),
    new_status VARCHAR(20),
    notes_text TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO album_processing_status (album_name, artist_name, status, notes)
    VALUES (album_name_param, artist_name_param, new_status, notes_text)
    ON CONFLICT (album_name, artist_name)
    DO UPDATE SET
        status = new_status,
        notes = COALESCE(notes_text, album_processing_status.notes),
        updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create function to get albums for processing
CREATE OR REPLACE FUNCTION get_albums_for_processing(
    filter_status VARCHAR(20) DEFAULT NULL,
    artist_filter VARCHAR(255) DEFAULT NULL,
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
    album_name VARCHAR(255),
    artist_name VARCHAR(255),
    song_count BIGINT,
    processed_count INTEGER,
    status VARCHAR(20),
    notes TEXT,
    updated_at TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        COALESCE(s.album, 'Unknown Album') as album_name,
        COALESCE(s.artist, 'Unknown Artist') as artist_name,
        COUNT(*) as song_count,
        COALESCE(aps.processed_count, 0) as processed_count,
        COALESCE(aps.status, 'unprocessed') as status,
        aps.notes,
        COALESCE(aps.updated_at, s.created_at) as updated_at
    FROM songs s
    LEFT JOIN album_processing_status aps
        ON aps.album_name = COALESCE(s.album, 'Unknown Album')
        AND aps.artist_name = COALESCE(s.artist, 'Unknown Artist')
    WHERE
        (filter_status IS NULL OR COALESCE(aps.status, 'unprocessed') = filter_status)
        AND (artist_filter IS NULL OR s.artist ILIKE '%' || artist_filter || '%')
    GROUP BY
        COALESCE(s.album, 'Unknown Album'),
        COALESCE(s.artist, 'Unknown Artist'),
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

-- Initialize album processing status for existing albums
INSERT INTO album_processing_status (album_name, artist_name, song_count, processed_count)
SELECT
    COALESCE(album, 'Unknown Album') as album_name,
    COALESCE(artist, 'Unknown Artist') as artist_name,
    COUNT(*) as song_count,
    COUNT(*) FILTER (WHERE processing_status IN ('processed', 'skip')) as processed_count
FROM songs
GROUP BY COALESCE(album, 'Unknown Album'), COALESCE(artist, 'Unknown Artist')
ON CONFLICT (album_name, artist_name) DO NOTHING;
