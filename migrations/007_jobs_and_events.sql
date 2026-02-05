-- 007: jobs and events - background jobs and media analytics

-- job sessions (for batch operations)
CREATE TABLE job_sessionz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'Active',
  progress TEXT DEFAULT '{"current":0,"total":0}',
  last_checkpoint TEXT,
  batch_size INTEGER DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT
);

CREATE INDEX idx_job_sessionz_status ON job_sessionz(status);
CREATE INDEX idx_job_sessionz_type ON job_sessionz(job_type);
CREATE INDEX idx_job_sessionz_created_at ON job_sessionz(created_at DESC);

CREATE TRIGGER trg_job_sessionz_updated_at
AFTER UPDATE ON job_sessionz
FOR EACH ROW
BEGIN
  UPDATE job_sessionz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- individual jobs
CREATE TABLE jobz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  session_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'Pending',
  parameters TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  scheduled_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  created_by TEXT,
  CHECK (status IN ('Pending', 'Running', 'Completed', 'Failed', 'Cancelled')),
  CHECK (retry_count >= 0),
  CHECK (max_retries >= 0),
  FOREIGN KEY (session_id) REFERENCES job_sessionz(id)
);

CREATE INDEX idx_jobz_status ON jobz(status);
CREATE INDEX idx_jobz_type ON jobz(job_type);
CREATE INDEX idx_jobz_session_id ON jobz(session_id);
CREATE INDEX idx_jobz_scheduled_at ON jobz(scheduled_at);
CREATE INDEX idx_jobz_queue ON jobz(status, scheduled_at) WHERE status = 'Pending';
CREATE INDEX idx_jobz_retry ON jobz(retry_count, max_retries) WHERE status = 'Failed';

-- media events (play, pause, seek, etc.)
CREATE TABLE media_eventz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_blob_id TEXT NOT NULL,
    user_id TEXT,
    event_type TEXT NOT NULL,
    event_data TEXT,
    session_id TEXT DEFAULT (lower(hex(randomblob(8)))),
    user_agent TEXT,
    client_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    client_timestamp INTEGER,
    FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id),
    CHECK (event_type IN (
        'play', 'pause', 'resume', 'seek', 'complete', 'stop',
        'rate', 'favorite', 'unfavorite', 'skip', 'add'
    ))
) STRICT;

CREATE INDEX idx_media_eventz_blob ON media_eventz(media_blob_id);
CREATE INDEX idx_media_eventz_user ON media_eventz(user_id);
CREATE INDEX idx_media_eventz_type ON media_eventz(event_type);
CREATE INDEX idx_media_eventz_created ON media_eventz(created_at DESC);
CREATE INDEX idx_media_eventz_session ON media_eventz(session_id);
CREATE INDEX idx_media_eventz_user_created ON media_eventz(user_id, created_at DESC);
CREATE INDEX idx_media_eventz_blob_type ON media_eventz(media_blob_id, event_type);

CREATE TRIGGER trg_media_eventz_updated_at
AFTER UPDATE ON media_eventz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE media_eventz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- music play events (denormalized for analytics)
CREATE TABLE music_play_eventz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    media_event_id TEXT NOT NULL,
    song_id TEXT NOT NULL,
    album_id TEXT,
    artist_id TEXT,
    playlist_id TEXT,
    user_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (media_event_id) REFERENCES media_eventz(id),
    FOREIGN KEY (song_id) REFERENCES songz(id),
    FOREIGN KEY (album_id) REFERENCES albumz(id),
    FOREIGN KEY (artist_id) REFERENCES artistz(id),
    FOREIGN KEY (playlist_id) REFERENCES playlistz(id),
    FOREIGN KEY (user_id) REFERENCES user_accountz(id)
) STRICT;

CREATE INDEX idx_music_play_eventz_song ON music_play_eventz(song_id);
CREATE INDEX idx_music_play_eventz_album ON music_play_eventz(album_id);
CREATE INDEX idx_music_play_eventz_artist ON music_play_eventz(artist_id);
CREATE INDEX idx_music_play_eventz_playlist ON music_play_eventz(playlist_id);
CREATE INDEX idx_music_play_eventz_user ON music_play_eventz(user_id);
CREATE INDEX idx_music_play_eventz_session ON music_play_eventz(session_id);
CREATE INDEX idx_music_play_eventz_created ON music_play_eventz(created_at DESC);
CREATE INDEX idx_music_play_eventz_song_created ON music_play_eventz(song_id, created_at DESC);
CREATE INDEX idx_music_play_eventz_user_created ON music_play_eventz(user_id, created_at DESC);
