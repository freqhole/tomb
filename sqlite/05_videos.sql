-- SQLite Videos Domain Schema
-- Videos, video playlists, and video-related tables

-- Videos table for video domain
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    media_blob_id TEXT NOT NULL,
    thumbnail_blob_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    duration INTEGER,
    width_px INTEGER,
    height_px INTEGER,
    fps REAL,
    bitrate INTEGER,
    video_codec TEXT,
    audio_codec TEXT,
    container_format TEXT,
    is_hdr BOOLEAN DEFAULT FALSE,
    color_profile TEXT,
    audio_channels INTEGER,
    audio_sample_rate INTEGER,
    subtitles_available BOOLEAN DEFAULT FALSE,
    watch_progress INTEGER DEFAULT 0,
    rating INTEGER,
    is_favorite BOOLEAN DEFAULT FALSE,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    deleted_at DATETIME,
    deleted_by TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1,

    CHECK (width_px > 0),
    CHECK (height_px > 0),
    CHECK (fps > 0),
    CHECK (bitrate > 0),
    CHECK (audio_channels > 0),
    CHECK (audio_sample_rate > 0),
    CHECK (rating >= 1 AND rating <= 5),
    CHECK (duration > 0),
    CHECK (watch_progress >= 0),
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL,
    FOREIGN KEY (deleted_by) REFERENCES users(id)
);

-- Indexes for videos table
CREATE INDEX IF NOT EXISTS idx_videos_media_blob_id ON videos(media_blob_id);
CREATE INDEX IF NOT EXISTS idx_videos_title ON videos(title) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_duration ON videos(duration) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_video_codec ON videos(video_codec) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_container_format ON videos(container_format) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_rating ON videos(rating) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_is_favorite ON videos(is_favorite) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_is_hdr ON videos(is_hdr) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_deleted_at ON videos(deleted_at);
CREATE INDEX IF NOT EXISTS idx_videos_active ON videos(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_dimensions ON videos(width_px, height_px) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_videos_in_progress ON videos(watch_progress, updated_at) WHERE watch_progress > 0 AND deleted_at IS NULL;

-- Video playlists table
CREATE TABLE IF NOT EXISTS video_playlists (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_by TEXT NOT NULL,
    thumbnail_blob_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,

    CHECK (length(name) > 0),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL
);

-- Indexes for video_playlists
CREATE INDEX IF NOT EXISTS idx_video_playlists_name ON video_playlists(name);
CREATE INDEX IF NOT EXISTS idx_video_playlists_created_by ON video_playlists(created_by);
CREATE INDEX IF NOT EXISTS idx_video_playlists_is_public ON video_playlists(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_video_playlists_created_at ON video_playlists(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_playlists_deleted_at ON video_playlists(deleted_at);

-- Video playlist videos junction table
CREATE TABLE IF NOT EXISTS video_playlist_videos (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    playlist_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (position > 0),
    FOREIGN KEY (playlist_id) REFERENCES video_playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    UNIQUE (playlist_id, video_id),
    UNIQUE (playlist_id, position)
);

-- Indexes for video_playlist_videos
CREATE INDEX IF NOT EXISTS idx_video_playlist_videos_playlist ON video_playlist_videos(playlist_id);
CREATE INDEX IF NOT EXISTS idx_video_playlist_videos_video ON video_playlist_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_video_playlist_videos_position ON video_playlist_videos(playlist_id, position);

-- Video chapters table
CREATE TABLE IF NOT EXISTS video_chapters (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    description TEXT,
    thumbnail_blob_id TEXT,
    chapter_type TEXT DEFAULT 'user',
    metadata TEXT DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    CHECK (chapter_type IN ('user', 'auto', 'imported')),
    CHECK (start_time >= 0),
    CHECK (end_time IS NULL OR end_time > start_time),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL
);

-- Indexes for video_chapters
CREATE INDEX IF NOT EXISTS idx_video_chapters_video_id ON video_chapters(video_id);
CREATE INDEX IF NOT EXISTS idx_video_chapters_start_time ON video_chapters(video_id, start_time);
CREATE INDEX IF NOT EXISTS idx_video_chapters_type ON video_chapters(chapter_type);

-- Views for common queries
CREATE VIEW IF NOT EXISTS active_videos AS
SELECT * FROM videos WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS active_video_playlists AS
SELECT * FROM video_playlists WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS videos_with_files AS
SELECT
    v.*,
    mb.mime,
    mb.size,
    mb.local_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size
FROM videos v
JOIN media_blobs mb ON v.media_blob_id = mb.id
LEFT JOIN media_blobs thumb ON v.thumbnail_blob_id = thumb.id
WHERE v.deleted_at IS NULL
AND mb.deleted_at IS NULL;

-- Trigger to update updated_at timestamp on videos
CREATE TRIGGER IF NOT EXISTS update_videos_updated_at
    AFTER UPDATE ON videos
    FOR EACH ROW
    BEGIN
        UPDATE videos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to update updated_at timestamp on video_playlists
CREATE TRIGGER IF NOT EXISTS update_video_playlists_updated_at
    AFTER UPDATE ON video_playlists
    FOR EACH ROW
    BEGIN
        UPDATE video_playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to update updated_at timestamp on video_chapters
CREATE TRIGGER IF NOT EXISTS update_video_chapters_updated_at
    AFTER UPDATE ON video_chapters
    FOR EACH ROW
    BEGIN
        UPDATE video_chapters SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to maintain video playlist positions on delete
CREATE TRIGGER IF NOT EXISTS maintain_video_playlist_positions_delete
    AFTER DELETE ON video_playlist_videos
    FOR EACH ROW
    BEGIN
        UPDATE video_playlist_videos
        SET position = position - 1
        WHERE playlist_id = OLD.playlist_id
        AND position > OLD.position;
    END;
