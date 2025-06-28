-- Add local_path to get_playlist_songs function for audio playback
-- This migration updates the existing get_playlist_songs function to include the local_path field

-- Drop existing function first to avoid return type conflict
DROP FUNCTION IF EXISTS get_playlist_songs(UUID);

CREATE OR REPLACE FUNCTION get_playlist_songs(playlist_uuid UUID)
RETURNS TABLE (
    song_id UUID,
    "position" INTEGER,
    title TEXT,
    artist TEXT,
    album TEXT,
    track_number INTEGER,
    disc_number INTEGER,
    duration INTERVAL,
    created_at TIMESTAMPTZ,
    media_blob_id UUID,
    audio_mime TEXT,
    audio_size BIGINT,
    local_path TEXT,
    thumbnail_id UUID,
    thumbnail_mime TEXT,
    waveform_id UUID,
    waveform_mime TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        ps.position,
        s.title,
        s.artist,
        s.album,
        s.track_number,
        s.disc_number,
        s.duration,
        ps.created_at,
        s.media_blob_id,
        mb.mime,
        mb.size,
        mb.local_path,
        s.thumbnail_blob_id,
        thumb.mime,
        s.waveform_blob_id,
        wave.mime
    FROM playlist_songs ps
    JOIN songs s ON ps.song_id = s.id
    JOIN media_blobs mb ON s.media_blob_id = mb.id
    LEFT JOIN media_blobs thumb ON s.thumbnail_blob_id = thumb.id
    LEFT JOIN media_blobs wave ON s.waveform_blob_id = wave.id
    WHERE ps.playlist_id = playlist_uuid
    AND s.deleted_at IS NULL
    AND mb.deleted_at IS NULL
    ORDER BY ps.position;
END;
$$ LANGUAGE plpgsql;

-- Create function to get individual song with media info for playback
-- Drop existing function first if it exists
DROP FUNCTION IF EXISTS get_song_with_media(UUID);

CREATE OR REPLACE FUNCTION get_song_with_media(song_uuid UUID)
RETURNS TABLE (
    song_id UUID,
    title TEXT,
    artist TEXT,
    album TEXT,
    track_number INTEGER,
    disc_number INTEGER,
    duration INTERVAL,
    genre TEXT,
    year INTEGER,
    is_favorite BOOLEAN,
    rating INTEGER,
    created_at TIMESTAMPTZ,
    media_blob_id UUID,
    audio_mime TEXT,
    audio_size BIGINT,
    local_path TEXT,
    thumbnail_id UUID,
    thumbnail_mime TEXT,
    waveform_id UUID,
    waveform_mime TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        s.artist,
        s.album,
        s.track_number,
        s.disc_number,
        s.duration,
        s.genre,
        s.year,
        s.is_favorite,
        s.rating,
        s.created_at,
        s.media_blob_id,
        mb.mime,
        mb.size,
        mb.local_path,
        s.thumbnail_blob_id,
        thumb.mime,
        s.waveform_blob_id,
        wave.mime
    FROM songs s
    JOIN media_blobs mb ON s.media_blob_id = mb.id
    LEFT JOIN media_blobs thumb ON s.thumbnail_blob_id = thumb.id
    LEFT JOIN media_blobs wave ON s.waveform_blob_id = wave.id
    WHERE s.id = song_uuid
    AND s.deleted_at IS NULL
    AND mb.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;
