-- 002: music entities - artists, albums, songs, genres, tags

-- artists
CREATE TABLE artistz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  bio TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX idx_artistz_name ON artistz(name);
CREATE INDEX idx_artistz_created_at ON artistz(created_at DESC);

CREATE TRIGGER trg_artistz_updated_at
AFTER UPDATE ON artistz
FOR EACH ROW
BEGIN
  UPDATE artistz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- genres (flat structure - albums have many genres via junction table)
CREATE TABLE genrez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT
);

CREATE UNIQUE INDEX idx_genrez_name ON genrez(name);
CREATE INDEX idx_genrez_created_at ON genrez(created_at DESC);
CREATE INDEX idx_genrez_deleted_at ON genrez(deleted_at);

-- tags (for albums)
CREATE TABLE tagz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT
);

CREATE UNIQUE INDEX idx_tagz_name ON tagz(name);
CREATE INDEX idx_tagz_created_at ON tagz(created_at DESC);
CREATE INDEX idx_tagz_deleted_at ON tagz(deleted_at);

-- albums
CREATE TABLE albumz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  album_type TEXT DEFAULT 'album',
  release_date TEXT,
  label TEXT,
  song_count INTEGER DEFAULT 0,
  total_duration INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  CHECK (album_type IN ('album', 'single', 'compilation'))
);

CREATE INDEX idx_albumz_title ON albumz(title);
CREATE INDEX idx_albumz_deleted_at ON albumz(deleted_at);

-- songs
CREATE TABLE songz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,
  title TEXT NOT NULL,
  track_number INTEGER NOT NULL DEFAULT 1,
  disc_number INTEGER NOT NULL DEFAULT 1,
  duration INTEGER,
  bpm INTEGER,
  track_artist TEXT,
  metadata TEXT,
  lyrics TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,

  CHECK (bpm >= 0 AND bpm <= 999),
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_songz_title ON songz(title);
CREATE INDEX idx_songz_media_blob_id ON songz(media_blob_id);
CREATE INDEX idx_songz_created_at ON songz(created_at DESC);
CREATE INDEX idx_songz_deleted_at ON songz(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER trg_songz_updated_at
AFTER UPDATE ON songz
FOR EACH ROW
BEGIN
  UPDATE songz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- playlists
CREATE TABLE playlistz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 0,
  created_by_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX idx_playlistz_title ON playlistz(title);
CREATE INDEX idx_playlistz_created_by ON playlistz(created_by_id);
CREATE INDEX idx_playlistz_created_at ON playlistz(created_at DESC);
CREATE INDEX idx_playlistz_public ON playlistz(is_public) WHERE is_public = 1;
CREATE INDEX idx_playlistz_deleted_at ON playlistz(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER trg_playlistz_updated_at
AFTER UPDATE ON playlistz
FOR EACH ROW
BEGIN
  UPDATE playlistz SET updated_at = unixepoch() WHERE id = NEW.id;
END;
