-- music_playlistz.db - playlist domain tables

-- playlists
CREATE TABLE playlistz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 0,
  thumbnail_blob_id TEXT,         -- reference to media_blobz.id for primary playlist image
  created_by_rowid INTEGER,       -- reference to user_accountz.rowid
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE playlist_songz (
  playlist_rowid INTEGER NOT NULL,
  song_rowid INTEGER NOT NULL,
  position INTEGER NOT NULL,      -- order in playlist
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  added_by TEXT,

  -- constraints
  UNIQUE(playlist_rowid, position),
  FOREIGN KEY (playlist_rowid) REFERENCES playlistz(rowid),
  FOREIGN KEY (song_rowid) REFERENCES songz(rowid)
);

-- playlist image collections
CREATE TABLE playlist_imagez (
  playlist_rowid INTEGER NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,

  -- constraints
  UNIQUE(playlist_rowid, media_blob_id),
  FOREIGN KEY (playlist_rowid) REFERENCES playlistz(rowid)
  -- No FK for media_blob_id - flexible string reference for images

);

-- indexes for playlistz
CREATE INDEX idx_playlistz_title ON playlistz(title);
CREATE INDEX idx_playlistz_created_by ON playlistz(created_by_rowid);
CREATE INDEX idx_playlistz_created_at ON playlistz(created_at DESC);
CREATE INDEX idx_playlistz_public ON playlistz(is_public) WHERE is_public = 1;
CREATE INDEX idx_playlistz_deleted_at ON playlistz(deleted_at) WHERE deleted_at IS NOT NULL;

-- indexes for playlist_songz
CREATE INDEX idx_playlist_songz_playlist ON playlist_songz(playlist_rowid);
CREATE INDEX idx_playlist_songz_song ON playlist_songz(song_rowid);
CREATE INDEX idx_playlist_songz_position ON playlist_songz(playlist_rowid, position);
CREATE INDEX idx_playlist_songz_added_at ON playlist_songz(added_at DESC);

-- indexes for playlist_imagez
CREATE INDEX idx_playlist_imagez_playlist ON playlist_imagez(playlist_rowid);
CREATE INDEX idx_playlist_imagez_blob ON playlist_imagez(media_blob_id);
CREATE INDEX idx_playlist_imagez_primary ON playlist_imagez(playlist_rowid, is_primary);

-- triggers for automatic audit field updates
CREATE TRIGGER trg_playlistz_updated_at
AFTER UPDATE ON playlistz
FOR EACH ROW
BEGIN
  UPDATE playlistz SET updated_at = unixepoch() WHERE rowid = NEW.rowid;
END;
