-- Music Domain Tables
-- This migration creates the music domain tables for songs and playlists

-- Create songs table for music domain
CREATE TABLE songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    waveform_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    track_number INTEGER,
    disc_number INTEGER DEFAULT 1,
    duration INTERVAL,
    genre TEXT,
    year INTEGER,
    bpm INTEGER CHECK (bpm > 0 AND bpm <= 300),
    key_signature TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_favorite BOOLEAN DEFAULT false,
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT txid_current()
);

-- Add comments for songs table
COMMENT ON TABLE songs IS 'Music domain: songs and track metadata';
COMMENT ON COLUMN songs.media_blob_id IS 'Reference to the actual audio file blob';
COMMENT ON COLUMN songs.thumbnail_blob_id IS 'Reference to album art/cover image blob';
COMMENT ON COLUMN songs.waveform_blob_id IS 'Reference to generated audio waveform visualization blob';
COMMENT ON COLUMN songs.album_artist IS 'Album artist (different from track artist for compilations)';
COMMENT ON COLUMN songs.disc_number IS 'Disc number for multi-disc albums';
COMMENT ON COLUMN songs.bpm IS 'Beats per minute for tempo';
COMMENT ON COLUMN songs.key_signature IS 'Musical key (e.g., "C major", "A minor")';
COMMENT ON COLUMN songs.tags IS 'User-defined tags for organization';
COMMENT ON COLUMN songs.metadata IS 'Extended metadata (lyrics, mood, instruments, etc.)';

-- Create indexes for songs table
CREATE INDEX idx_songs_media_blob_id ON songs(media_blob_id);
CREATE INDEX idx_songs_title ON songs(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_artist ON songs(artist) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_album ON songs(album) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_album_artist ON songs(album_artist) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_genre ON songs(genre) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_year ON songs(year) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_rating ON songs(rating) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_is_favorite ON songs(is_favorite) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_deleted_at ON songs(deleted_at);
CREATE INDEX idx_songs_active ON songs(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_version ON songs(version);
CREATE INDEX idx_songs_created_at ON songs(created_at) WHERE deleted_at IS NULL;

-- Composite indexes for common queries
CREATE INDEX idx_songs_album_track ON songs(album, disc_number, track_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_artist_album ON songs(artist, album) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_search ON songs(title, artist, album) WHERE deleted_at IS NULL;

-- GIN index for tags array
CREATE INDEX idx_songs_tags ON songs USING GIN(tags) WHERE deleted_at IS NULL;

-- GIN index for metadata JSONB
CREATE INDEX idx_songs_metadata ON songs USING GIN(metadata) WHERE deleted_at IS NULL;

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

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_songs_updated_at
    BEFORE UPDATE ON songs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create playlists table
CREATE TABLE playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    client_id TEXT,
    is_public BOOLEAN DEFAULT false,
    is_collaborative BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT txid_current()
);

-- Add comments for playlists table
COMMENT ON TABLE playlists IS 'Music playlists for organizing songs';
COMMENT ON COLUMN playlists.media_blob_id IS 'Reference to exported playlist file blob (optional)';
COMMENT ON COLUMN playlists.thumbnail_blob_id IS 'Reference to playlist cover art blob';
COMMENT ON COLUMN playlists.client_id IS 'Client application that created this playlist';
COMMENT ON COLUMN playlists.is_public IS 'Whether playlist is visible to other users';
COMMENT ON COLUMN playlists.is_collaborative IS 'Whether other users can add/remove songs';
COMMENT ON COLUMN playlists.metadata IS 'Playlist metadata (mood, genre, auto-generated info, etc.)';

-- Create indexes for playlists table
CREATE INDEX idx_playlists_title ON playlists(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_client_id ON playlists(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_is_public ON playlists(is_public) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_deleted_at ON playlists(deleted_at);
CREATE INDEX idx_playlists_active ON playlists(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_version ON playlists(version);
CREATE INDEX idx_playlists_created_at ON playlists(created_at) WHERE deleted_at IS NULL;

-- GIN index for playlist metadata
CREATE INDEX idx_playlists_metadata ON playlists USING GIN(metadata) WHERE deleted_at IS NULL;

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

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_playlists_updated_at
    BEFORE UPDATE ON playlists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create playlist_songs join table
CREATE TABLE playlist_songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by_client_id TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Add comments for playlist_songs table
COMMENT ON TABLE playlist_songs IS 'Many-to-many relationship between playlists and songs';
COMMENT ON COLUMN playlist_songs.position IS 'Order of song within playlist (1-based)';
COMMENT ON COLUMN playlist_songs.created_at IS 'When this song was added to the playlist';
COMMENT ON COLUMN playlist_songs.added_by_client_id IS 'Client that added this song to the playlist';
COMMENT ON COLUMN playlist_songs.metadata IS 'Song-specific metadata within this playlist context';

-- Create indexes for playlist_songs table
CREATE INDEX idx_playlist_songs_playlist_id ON playlist_songs(playlist_id);
CREATE INDEX idx_playlist_songs_song_id ON playlist_songs(song_id);
CREATE INDEX idx_playlist_songs_position ON playlist_songs(playlist_id, position);
CREATE INDEX idx_playlist_songs_created_at ON playlist_songs(created_at);

-- Unique constraints for playlist_songs
CREATE UNIQUE INDEX idx_playlist_songs_unique_song ON playlist_songs(playlist_id, song_id);
CREATE UNIQUE INDEX idx_playlist_songs_unique_position ON playlist_songs(playlist_id, position);

-- Function to automatically maintain playlist positions
CREATE OR REPLACE FUNCTION maintain_playlist_positions()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- If no position specified, add to end
        IF NEW.position IS NULL THEN
            SELECT COALESCE(MAX(position), 0) + 1
            INTO NEW.position
            FROM playlist_songs
            WHERE playlist_id = NEW.playlist_id;
        ELSE
            -- Shift existing positions to make room
            UPDATE playlist_songs
            SET position = position + 1
            WHERE playlist_id = NEW.playlist_id
            AND position >= NEW.position
            AND id != NEW.id;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- If position changed, reorder accordingly
        IF OLD.position != NEW.position THEN
            -- Moving to later position
            IF NEW.position > OLD.position THEN
                UPDATE playlist_songs
                SET position = position - 1
                WHERE playlist_id = NEW.playlist_id
                AND position > OLD.position
                AND position <= NEW.position
                AND id != NEW.id;
            -- Moving to earlier position
            ELSE
                UPDATE playlist_songs
                SET position = position + 1
                WHERE playlist_id = NEW.playlist_id
                AND position >= NEW.position
                AND position < OLD.position
                AND id != NEW.id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- Close gaps in position sequence
        UPDATE playlist_songs
        SET position = position - 1
        WHERE playlist_id = OLD.playlist_id
        AND position > OLD.position;
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to maintain playlist positions
CREATE TRIGGER maintain_playlist_positions_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON playlist_songs
    FOR EACH ROW
    EXECUTE FUNCTION maintain_playlist_positions();

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
    position INTEGER,
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
    media_blob_id UUID,
    thumbnail_id UUID,
    waveform_id UUID
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
    media_blob_id UUID,
    thumbnail_id UUID,
    waveform_id UUID
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
