-- SQLite Music Domain Schema
-- Songs, playlists, and music-related tables

-- Songs table
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    track_number INTEGER,
    disc_number INTEGER,
    duration INTEGER,
    genre TEXT,
    year INTEGER,
    is_favorite BOOLEAN DEFAULT FALSE,
    rating INTEGER,
    media_blob_id TEXT NOT NULL,
    thumbnail_blob_id TEXT,
    waveform_blob_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,

    CHECK (track_number > 0),
    CHECK (disc_number > 0),
    CHECK (duration > 0),
    CHECK (year > 1800 AND year <= 2100),
    CHECK (rating >= 1 AND rating <= 5),
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL,
    FOREIGN KEY (waveform_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL
);

-- Indexes for songs
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
CREATE INDEX IF NOT EXISTS idx_songs_album_artist ON songs(album_artist);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year);
CREATE INDEX IF NOT EXISTS idx_songs_is_favorite ON songs(is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_songs_rating ON songs(rating) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_songs_media_blob ON songs(media_blob_id);
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON songs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_songs_deleted_at ON songs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_songs_album_order ON songs(album, disc_number, track_number);

-- Playlists table
CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_by TEXT NOT NULL,
    media_blob_id TEXT,
    thumbnail_blob_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,

    CHECK (length(name) > 0),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL
);

-- Indexes for playlists
CREATE INDEX IF NOT EXISTS idx_playlists_name ON playlists(name);
CREATE INDEX IF NOT EXISTS idx_playlists_created_by ON playlists(created_by);
CREATE INDEX IF NOT EXISTS idx_playlists_is_public ON playlists(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_playlists_created_at ON playlists(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playlists_deleted_at ON playlists(deleted_at);

-- Playlist songs junction table
CREATE TABLE IF NOT EXISTS playlist_songs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    playlist_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (position > 0),
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE (playlist_id, song_id),
    UNIQUE (playlist_id, position)
);

-- Indexes for playlist_songs
CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_song ON playlist_songs(song_id);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_position ON playlist_songs(playlist_id, position);

-- Music jobs table (for processing music files)
CREATE TABLE IF NOT EXISTS music_jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    media_blob_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    result_data TEXT,
    processing_node TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,

    CHECK (job_type IN ('extract_metadata', 'generate_waveform', 'analyze_audio', 'convert_format')),
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    CHECK (priority >= 1 AND priority <= 10),
    CHECK (retry_count >= 0),
    CHECK (max_retries >= 0),
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE
);

-- Indexes for music_jobs
CREATE INDEX IF NOT EXISTS idx_music_jobs_media_blob ON music_jobs(media_blob_id);
CREATE INDEX IF NOT EXISTS idx_music_jobs_status ON music_jobs(status);
CREATE INDEX IF NOT EXISTS idx_music_jobs_priority ON music_jobs(priority DESC);
CREATE INDEX IF NOT EXISTS idx_music_jobs_created_at ON music_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_music_jobs_pending ON music_jobs(status, priority DESC) WHERE status = 'pending';

-- Views for common queries (SQLite supports views)
CREATE VIEW IF NOT EXISTS active_songs AS
SELECT * FROM songs WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS active_playlists AS
SELECT * FROM playlists WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS songs_with_files AS
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

-- Trigger to update updated_at timestamp on songs
CREATE TRIGGER IF NOT EXISTS update_songs_updated_at
    AFTER UPDATE ON songs
    FOR EACH ROW
    BEGIN
        UPDATE songs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to update updated_at timestamp on playlists
CREATE TRIGGER IF NOT EXISTS update_playlists_updated_at
    AFTER UPDATE ON playlists
    FOR EACH ROW
    BEGIN
        UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to update updated_at timestamp on music_jobs
CREATE TRIGGER IF NOT EXISTS update_music_jobs_updated_at
    AFTER UPDATE ON music_jobs
    FOR EACH ROW
    BEGIN
        UPDATE music_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to maintain playlist positions on delete
CREATE TRIGGER IF NOT EXISTS maintain_playlist_positions_delete
    AFTER DELETE ON playlist_songs
    FOR EACH ROW
    BEGIN
        UPDATE playlist_songs
        SET position = position - 1
        WHERE playlist_id = OLD.playlist_id
        AND position > OLD.position;
    END;
