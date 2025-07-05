-- SQLite Media Schema
-- Media blobs, thumbnail jobs, and analytics tables

-- Media blobs storage
CREATE TABLE IF NOT EXISTS media_blobs (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    data BLOB,
    size INTEGER,
    mime TEXT,
    source_client_id TEXT,
    local_path TEXT,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,

    CHECK (length(id) >= 7 AND length(id) <= 16),
    CHECK (length(sha256) = 64),
    CHECK (data IS NULL OR length(data) <= 10485760)
);

-- Indexes for media_blobs
CREATE INDEX IF NOT EXISTS idx_media_blobs_sha256 ON media_blobs(sha256);
CREATE INDEX IF NOT EXISTS idx_media_blobs_client_id ON media_blobs(source_client_id);
CREATE INDEX IF NOT EXISTS idx_media_blobs_created_at ON media_blobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_blobs_local_path ON media_blobs(local_path);
CREATE INDEX IF NOT EXISTS idx_media_blobs_mime ON media_blobs(mime);
CREATE INDEX IF NOT EXISTS idx_media_blobs_deleted_at ON media_blobs(deleted_at);

-- Thumbnail jobs table
CREATE TABLE IF NOT EXISTS thumbnail_jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    media_blob_id TEXT NOT NULL,
    job_type TEXT NOT NULL DEFAULT 'thumbnail',
    target_width INTEGER,
    target_height INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    thumbnail_blob_id TEXT,
    processing_node TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,

    CHECK (job_type IN ('thumbnail', 'waveform', 'preview')),
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    CHECK (priority >= 1 AND priority <= 10),
    CHECK (target_width > 0 AND target_height > 0),
    CHECK (retry_count >= 0),
    CHECK (max_retries >= 0),
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL
);

-- Indexes for thumbnail_jobs
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_media_blob ON thumbnail_jobs(media_blob_id);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_status ON thumbnail_jobs(status);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_priority ON thumbnail_jobs(priority DESC);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_created_at ON thumbnail_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_pending ON thumbnail_jobs(status, priority DESC) WHERE status = 'pending';

-- Analytics table for request tracking
CREATE TABLE IF NOT EXISTS request_analytics (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    request_id TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER,
    user_agent TEXT,
    ip_address TEXT,
    request_data TEXT,
    response_size INTEGER,
    error_message TEXT,
    trace_id TEXT,
    span_id TEXT,

    CHECK (length(method) <= 10),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for analytics
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON request_analytics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_user_id ON request_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_path ON request_analytics(path);
CREATE INDEX IF NOT EXISTS idx_analytics_status ON request_analytics(status_code);
CREATE INDEX IF NOT EXISTS idx_analytics_trace_id ON request_analytics(trace_id);

-- Media analytics table
CREATE TABLE IF NOT EXISTS media_analytics (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    media_blob_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    user_id TEXT,
    session_id TEXT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    client_info TEXT,
    metadata TEXT DEFAULT '{}',

    CHECK (event_type IN ('upload', 'download', 'view', 'delete', 'share', 'favorite', 'play', 'pause', 'seek', 'complete')),
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for media_analytics
CREATE INDEX IF NOT EXISTS idx_media_analytics_blob_id ON media_analytics(media_blob_id);
CREATE INDEX IF NOT EXISTS idx_media_analytics_event_type ON media_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_media_analytics_user_id ON media_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_media_analytics_timestamp ON media_analytics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_media_analytics_session ON media_analytics(session_id);

-- Trigger to update updated_at timestamp on media_blobs
CREATE TRIGGER IF NOT EXISTS update_media_blobs_updated_at
    AFTER UPDATE ON media_blobs
    FOR EACH ROW
    BEGIN
        UPDATE media_blobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to update updated_at timestamp on thumbnail_jobs
CREATE TRIGGER IF NOT EXISTS update_thumbnail_jobs_updated_at
    AFTER UPDATE ON thumbnail_jobs
    FOR EACH ROW
    BEGIN
        UPDATE thumbnail_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
