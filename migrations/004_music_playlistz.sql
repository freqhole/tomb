-- music_playlistz.db - playlist domain tables

-- playlists
CREATE TABLE playlistz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 0,
  thumbnail_blob_id TEXT,         -- reference to media_blobz.id for primary playlist image
  created_by_id TEXT,             -- reference to user_accountz.id
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE playlist_songz (
  playlist_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  position INTEGER NOT NULL,      -- order in playlist
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  added_by TEXT,

  -- constraints
  UNIQUE(playlist_id, position),
  FOREIGN KEY (playlist_id) REFERENCES playlistz(id),
  FOREIGN KEY (song_id) REFERENCES songz(id)
);

-- playlist image collections
CREATE TABLE playlist_imagez (
  playlist_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,

  -- constraints
  UNIQUE(playlist_id, media_blob_id),
  FOREIGN KEY (playlist_id) REFERENCES playlistz(id)
  -- No FK for media_blob_id - flexible string reference for images

);

-- indexes for playlistz
CREATE INDEX idx_playlistz_title ON playlistz(title);
CREATE INDEX idx_playlistz_created_by ON playlistz(created_by_id);
CREATE INDEX idx_playlistz_created_at ON playlistz(created_at DESC);
CREATE INDEX idx_playlistz_public ON playlistz(is_public) WHERE is_public = 1;
CREATE INDEX idx_playlistz_deleted_at ON playlistz(deleted_at) WHERE deleted_at IS NOT NULL;

-- indexes for playlist_songz
CREATE INDEX idx_playlist_songz_playlist ON playlist_songz(playlist_id);
CREATE INDEX idx_playlist_songz_song ON playlist_songz(song_id);
CREATE INDEX idx_playlist_songz_position ON playlist_songz(playlist_id, position);
CREATE INDEX idx_playlist_songz_added_at ON playlist_songz(added_at DESC);

-- indexes for playlist_imagez
CREATE INDEX idx_playlist_imagez_playlist ON playlist_imagez(playlist_id);
CREATE INDEX idx_playlist_imagez_blob ON playlist_imagez(media_blob_id);
CREATE INDEX idx_playlist_imagez_primary ON playlist_imagez(playlist_id, is_primary);

-- triggers for automatic audit field updates
CREATE TRIGGER trg_playlistz_updated_at
AFTER UPDATE ON playlistz
FOR EACH ROW
BEGIN
  UPDATE playlistz SET updated_at = unixepoch() WHERE id = NEW.id;
END;
