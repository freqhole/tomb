-- Music Domain Functions and Views
-- This migration creates views, functions, triggers, and complex logic for the music domain

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_songs_updated_at
    BEFORE UPDATE ON songs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_playlists_updated_at
    BEFORE UPDATE ON playlists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for active songs
CREATE VIEW active_songs AS
SELECT * FROM songs WHERE deleted_at IS NULL;

-- Create view for songs with file information
CREATE VIEW songs_with_files AS
SELECT
    s.*,
    mb.mime,
    mb.size,
    mb.local_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size,
    wave.id as waveform_id,
    wave.mime as waveform_mime,
    wave.size as waveform_size
FROM songs s
JOIN media_blobs mb ON s.media_blob_id = mb.id
LEFT JOIN media_blobs thumb ON s.thumbnail_blob_id = thumb.id
LEFT JOIN media_blobs wave ON s.waveform_blob_id = wave.id
WHERE s.deleted_at IS NULL
AND mb.deleted_at IS NULL;

-- Create view for songs with default album track ordering
CREATE VIEW songs_ordered AS
SELECT * FROM songs
WHERE deleted_at IS NULL
ORDER BY
    album NULLS LAST,
    disc_number NULLS LAST,
    track_number NULLS LAST,
    title;

-- Create view for active playlists
CREATE VIEW active_playlists AS
SELECT * FROM playlists WHERE deleted_at IS NULL;

-- Create view for playlists with file information
CREATE VIEW playlists_with_files AS
SELECT
    p.*,
    mb.mime as playlist_file_mime,
    mb.size as playlist_file_size,
    mb.local_path as playlist_file_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size
FROM playlists p
LEFT JOIN media_blobs mb ON p.media_blob_id = mb.id AND mb.deleted_at IS NULL
LEFT JOIN media_blobs thumb ON p.thumbnail_blob_id = thumb.id AND thumb.deleted_at IS NULL
WHERE p.deleted_at IS NULL;

-- Function to automatically maintain playlist positions (simplified to avoid infinite loops)
CREATE OR REPLACE FUNCTION maintain_playlist_positions()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- If no position specified, add to end
        IF NEW."position" IS NULL THEN
            SELECT COALESCE(MAX("position"), 0) + 1
            INTO NEW."position"
            FROM playlist_songs
            WHERE playlist_id = NEW.playlist_id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- Close gaps in position sequence after deletion
        UPDATE playlist_songs
        SET "position" = "position" - 1
        WHERE playlist_id = OLD.playlist_id
        AND "position" > OLD."position";
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger only for INSERT and DELETE (not UPDATE to avoid recursion)
CREATE TRIGGER maintain_playlist_positions_trigger
    BEFORE INSERT OR DELETE ON playlist_songs
    FOR EACH ROW
    EXECUTE FUNCTION maintain_playlist_positions();

-- Create a separate function for handling position reordering safely
CREATE OR REPLACE FUNCTION reorder_playlist_positions(
    target_playlist_id UUID,
    song_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
    current_song_id UUID;
    new_position INTEGER;
BEGIN
    -- Temporarily disable the trigger
    ALTER TABLE playlist_songs DISABLE TRIGGER maintain_playlist_positions_trigger;

    -- Update positions for all songs in the provided order
    FOR i IN 1..array_length(song_ids, 1) LOOP
        current_song_id := song_ids[i];
        new_position := i;

        UPDATE playlist_songs
        SET "position" = new_position
        WHERE playlist_id = target_playlist_id
        AND playlist_songs.song_id = current_song_id;
    END LOOP;

    -- Re-enable the trigger
    ALTER TABLE playlist_songs ENABLE TRIGGER maintain_playlist_positions_trigger;

EXCEPTION
    WHEN OTHERS THEN
        -- Re-enable trigger even if there's an error
        ALTER TABLE playlist_songs ENABLE TRIGGER maintain_playlist_positions_trigger;
        RAISE;
END;
$$ LANGUAGE plpgsql;

-- Add comments explaining the approach
COMMENT ON FUNCTION maintain_playlist_positions() IS
'Simplified trigger that only handles INSERT/DELETE to avoid recursive UPDATE issues';

COMMENT ON FUNCTION reorder_playlist_positions(UUID, UUID[]) IS
'Safe function for bulk reordering that temporarily disables trigger to avoid conflicts';

-- Create view for playlist with song counts and duration
CREATE VIEW playlist_summary AS
SELECT
    p.*,
    COUNT(ps.id) as song_count,
    SUM(s.duration) as total_duration,
    MAX(ps.created_at) as last_modified,
    STRING_AGG(s.title, ', ' ORDER BY ps.position) FILTER (WHERE ps.position <= 3) as first_song_titles,
    CASE WHEN COUNT(ps.id) > 3 THEN CONCAT('... and ', COUNT(ps.id) - 3, ' more') ELSE '' END as more_songs_indicator
FROM playlists p
LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
LEFT JOIN songs s ON ps.song_id = s.id AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id;

-- Create view for playlist with all song titles (for single playlist rendering)
CREATE VIEW playlist_with_all_songs AS
SELECT
    p.*,
    COUNT(ps.id) as song_count,
    SUM(s.duration) as total_duration,
    MAX(ps.created_at) as last_modified,
    STRING_AGG(s.title, ', ' ORDER BY ps.position) as all_song_titles,
    ARRAY_AGG(s.title ORDER BY ps.position) as song_titles_array,
    ARRAY_AGG(s.artist ORDER BY ps.position) as song_artists_array,
    ARRAY_AGG(s.duration ORDER BY ps.position) as song_durations_array
FROM playlists p
LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
LEFT JOIN songs s ON ps.song_id = s.id AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id;

-- Create view for complete playlist data (single playlist with full song details)
CREATE VIEW playlist_complete AS
SELECT
    p.*,
    COUNT(ps.id) as song_count,
    SUM(s.duration) as total_duration,
    MAX(ps.created_at) as last_modified,
    STRING_AGG(s.title, ', ' ORDER BY ps.position) as all_song_titles,
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'song_id', s.id,
            'position', ps.position,
            'title', s.title,
            'artist', s.artist,
            'album', s.album,
            'track_number', s.track_number,
            'disc_number', s.disc_number,
            'duration', EXTRACT(EPOCH FROM s.duration),
            'media_blob_id', s.media_blob_id,
            'thumbnail_id', s.thumbnail_blob_id,
            'waveform_id', s.waveform_blob_id,
            'created_at', ps.created_at
        ) ORDER BY ps.position
    ) FILTER (WHERE s.id IS NOT NULL) as songs_json
FROM playlists p
LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
LEFT JOIN songs s ON ps.song_id = s.id AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id;

-- Create function to get playlist with ordered songs including media blob info
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
    media_blob_id VARCHAR(16),
    audio_mime TEXT,
    audio_size BIGINT,
    local_path TEXT,
    thumbnail_id VARCHAR(16),
    thumbnail_mime TEXT,
    waveform_id VARCHAR(16),
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
        s.thumbnail_blob_id AS thumbnail_id,
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
    media_blob_id VARCHAR(16),
    audio_mime TEXT,
    audio_size BIGINT,
    thumbnail_id VARCHAR(16),
    thumbnail_mime TEXT,
    thumbnail_size BIGINT,
    waveform_id VARCHAR(16),
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

-- Create function to get songs sorted by album order (disc + track)
CREATE OR REPLACE FUNCTION get_songs_by_album_order(
    album_filter TEXT DEFAULT NULL,
    artist_filter TEXT DEFAULT NULL,
    max_results INTEGER DEFAULT 100
)
RETURNS TABLE (
    song_id UUID,
    title TEXT,
    artist TEXT,
    album TEXT,
    disc_number INTEGER,
    track_number INTEGER,
    duration INTERVAL,
    media_blob_id VARCHAR(16),
    thumbnail_id VARCHAR(16),
    waveform_id VARCHAR(16)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        s.artist,
        s.album,
        s.disc_number,
        s.track_number,
        s.duration,
        s.media_blob_id,
        s.thumbnail_blob_id,
        s.waveform_blob_id
    FROM songs s
    WHERE s.deleted_at IS NULL
    AND (album_filter IS NULL OR s.album ILIKE '%' || album_filter || '%')
    AND (artist_filter IS NULL OR s.artist ILIKE '%' || artist_filter || '%')
    ORDER BY
        s.album,
        s.disc_number NULLS LAST,
        s.track_number NULLS LAST,
        s.title
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Create view for album summaries with track ordering
CREATE VIEW album_summary AS
SELECT
    album,
    album_artist,
    artist, -- First artist encountered (for mixed albums)
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
     AND s2.thumbnail_blob_id IS NOT NULL
     AND s2.deleted_at IS NULL
     ORDER BY disc_number NULLS LAST, track_number NULLS LAST
     LIMIT 1) as album_thumbnail_id
FROM songs s
WHERE deleted_at IS NULL
GROUP BY album, album_artist, artist
HAVING album IS NOT NULL;

-- Create function to get complete album with all tracks
CREATE OR REPLACE FUNCTION get_album_tracks(
    album_name TEXT,
    artist_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    song_id UUID,
    title TEXT,
    artist TEXT,
    disc_number INTEGER,
    track_number INTEGER,
    duration INTERVAL,
    genre TEXT,
    year INTEGER,
    rating INTEGER,
    is_favorite BOOLEAN,
    media_blob_id VARCHAR(16),
    thumbnail_id VARCHAR(16),
    waveform_id VARCHAR(16)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.title,
        s.artist,
        s.disc_number,
        s.track_number,
        s.duration,
        s.genre,
        s.year,
        s.rating,
        s.is_favorite,
        s.media_blob_id,
        s.thumbnail_blob_id,
        s.waveform_blob_id
    FROM songs s
    WHERE s.deleted_at IS NULL
    AND s.album = album_name
    AND (artist_name IS NULL OR s.album_artist = artist_name OR s.artist = artist_name)
    ORDER BY
        s.disc_number NULLS LAST,
        s.track_number NULLS LAST,
        s.title;
END;
$$ LANGUAGE plpgsql;

-- Create function to get artist discography with album ordering
CREATE OR REPLACE FUNCTION get_artist_albums(
    artist_name TEXT,
    max_results INTEGER DEFAULT 50
)
RETURNS TABLE (
    album TEXT,
    year INTEGER,
    track_count BIGINT,
    total_duration INTERVAL,
    avg_rating DECIMAL,
    album_thumbnail_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.album,
        MIN(s.year) as year,
        COUNT(*) as track_count,
        SUM(s.duration) as total_duration,
        AVG(s.rating) FILTER (WHERE s.rating IS NOT NULL) as avg_rating,
        (SELECT thumbnail_blob_id FROM songs s2
         WHERE s2.album = s.album
         AND (s2.album_artist = artist_name OR s2.artist = artist_name)
         AND s2.thumbnail_blob_id IS NOT NULL
         AND s2.deleted_at IS NULL
         ORDER BY disc_number NULLS LAST, track_number NULLS LAST
         LIMIT 1) as album_thumbnail_id
    FROM songs s
    WHERE s.deleted_at IS NULL
    AND (s.album_artist = artist_name OR s.artist = artist_name)
    AND s.album IS NOT NULL
    GROUP BY s.album
    ORDER BY MIN(s.year) NULLS LAST, s.album
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;
