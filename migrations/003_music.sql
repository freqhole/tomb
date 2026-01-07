-- music.db - music domain tables

-- normalized artist table
CREATE TABLE artistz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT
);

-- normalized album table
CREATE TABLE albumz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  album_type TEXT DEFAULT 'album',
  release_date TEXT,
  release_date_precision TEXT,    -- year/month/day (spotify schema)
  label TEXT,
  genre_id TEXT,                  -- reference to genrez.id
  song_count INTEGER DEFAULT 0,   -- computed from songz count
  total_duration INTEGER DEFAULT 0, -- computed from songz duration sum
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,

  -- constraints
  CHECK (album_type IN ('album', 'single', 'compilation')),
  FOREIGN KEY (genre_id) REFERENCES genrez(id)
);

-- normalized song (or track) table
CREATE TABLE songz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,    -- reference to media_blobz.id
  thumbnail_blob_id TEXT,         -- reference to media_blobz.id
  waveform_blob_id TEXT,          -- reference to media_blobz.id
  title TEXT NOT NULL,
  track_number INTEGER NOT NULL DEFAULT 1,
  disc_number INTEGER NOT NULL DEFAULT 1,
  duration INTEGER,               -- seconds from interval
  year INTEGER,
  bpm INTEGER,
  key_signature TEXT,
  metadata TEXT,                  -- json from existing jsonb
  lyrics TEXT,                    -- song lyrics extracted from metadata
  processing_status TEXT DEFAULT 'unprocessed',
  processing_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,

  -- constraints
  CHECK (bpm >= 0 AND bpm <= 999),
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id),
  FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobz(id),
  FOREIGN KEY (waveform_blob_id) REFERENCES media_blobz(id)
);

-- image collections for entities
CREATE TABLE artist_imagez (
  artist_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,

  -- constraints
  UNIQUE(artist_id, media_blob_id),
  FOREIGN KEY (artist_id) REFERENCES artistz(id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE TABLE album_imagez (
  album_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,

  -- constraints
  UNIQUE(album_id, media_blob_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE TABLE song_imagez (
  song_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,

  -- constraints
  UNIQUE(song_id, media_blob_id),
  FOREIGN KEY (song_id) REFERENCES songz(id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

-- relationship tables
CREATE TABLE artist_songz (
  artist_id TEXT NOT NULL,
  song_id TEXT NOT NULL,

  -- constraints
  UNIQUE(artist_id, song_id),
  FOREIGN KEY (artist_id) REFERENCES artistz(id),
  FOREIGN KEY (song_id) REFERENCES songz(id)
);

CREATE TABLE album_songz (
  album_id TEXT NOT NULL,
  song_id TEXT NOT NULL,

  -- constraints
  UNIQUE(album_id, song_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (song_id) REFERENCES songz(id)
);

CREATE TABLE artist_albumz (
  artist_id TEXT NOT NULL,
  album_id TEXT NOT NULL,

  -- constraints
  UNIQUE(artist_id, album_id),
  FOREIGN KEY (artist_id) REFERENCES artistz(id),
  FOREIGN KEY (album_id) REFERENCES albumz(id)
);

-- genre normalization tables
CREATE TABLE genrez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sub_genrez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  parent_genre_id TEXT,          -- optional parent genre
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),

  -- constraints
  FOREIGN KEY (parent_genre_id) REFERENCES genrez(id)
);

CREATE TABLE album_sub_genrez (
  album_id TEXT NOT NULL,
  sub_genre_id TEXT NOT NULL,

  -- constraints
  UNIQUE(album_id, sub_genre_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (sub_genre_id) REFERENCES sub_genrez(id)
);

-- tag normalization tables (moved to albums)
CREATE TABLE tagz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE album_tagz (
  album_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,

  -- constraints
  UNIQUE(album_id, tag_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (tag_id) REFERENCES tagz(id)
);

-- indexes for artistz
CREATE INDEX idx_artistz_name ON artistz(name);
CREATE INDEX idx_artistz_created_at ON artistz(created_at DESC);

-- indexes for albumz
CREATE INDEX idx_albumz_title ON albumz(title);
CREATE INDEX idx_albumz_album_type ON albumz(album_type);
CREATE INDEX idx_albumz_release_date ON albumz(release_date);
CREATE INDEX idx_albumz_genre_id ON albumz(genre_id);
CREATE INDEX idx_albumz_created_at ON albumz(created_at DESC);

-- indexes for songz
CREATE INDEX idx_songz_title ON songz(title);
CREATE INDEX idx_songz_media_blob_id ON songz(media_blob_id);
CREATE INDEX idx_songz_processing_status ON songz(processing_status);
CREATE INDEX idx_songz_created_at ON songz(created_at DESC);
CREATE INDEX idx_songz_deleted_at ON songz(deleted_at) WHERE deleted_at IS NOT NULL;

-- indexes for image tables
CREATE INDEX idx_artist_imagez_artist ON artist_imagez(artist_id);
CREATE INDEX idx_artist_imagez_blob ON artist_imagez(media_blob_id);
CREATE INDEX idx_artist_imagez_primary ON artist_imagez(artist_id, is_primary);

CREATE INDEX idx_album_imagez_album ON album_imagez(album_id);
CREATE INDEX idx_album_imagez_blob ON album_imagez(media_blob_id);
CREATE INDEX idx_album_imagez_primary ON album_imagez(album_id, is_primary);

CREATE INDEX idx_song_imagez_song ON song_imagez(song_id);
CREATE INDEX idx_song_imagez_blob ON song_imagez(media_blob_id);
CREATE INDEX idx_song_imagez_primary ON song_imagez(song_id, is_primary);

-- indexes for relationship tables
CREATE INDEX idx_artist_songz_artist ON artist_songz(artist_id);
CREATE INDEX idx_artist_songz_song ON artist_songz(song_id);

CREATE INDEX idx_album_songz_album ON album_songz(album_id);
CREATE INDEX idx_album_songz_song ON album_songz(song_id);

CREATE INDEX idx_artist_albumz_artist ON artist_albumz(artist_id);
CREATE INDEX idx_artist_albumz_album ON artist_albumz(album_id);

-- triggers for automatic audit field updates
CREATE TRIGGER trg_artistz_updated_at
AFTER UPDATE ON artistz
FOR EACH ROW
BEGIN
  UPDATE artistz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER trg_albumz_updated_at
AFTER UPDATE ON albumz
FOR EACH ROW
BEGIN
  UPDATE albumz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER trg_songz_updated_at
AFTER UPDATE ON songz
FOR EACH ROW
BEGIN
  UPDATE songz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- indexes for genrez
CREATE UNIQUE INDEX idx_genrez_name ON genrez(name);
CREATE INDEX idx_genrez_created_at ON genrez(created_at DESC);

-- indexes for sub_genrez
CREATE UNIQUE INDEX idx_sub_genrez_name ON sub_genrez(name);
CREATE INDEX idx_sub_genrez_parent ON sub_genrez(parent_genre_id);
CREATE INDEX idx_sub_genrez_created_at ON sub_genrez(created_at DESC);

-- indexes for album_sub_genrez
CREATE INDEX idx_album_sub_genrez_album ON album_sub_genrez(album_id);
CREATE INDEX idx_album_sub_genrez_genre ON album_sub_genrez(sub_genre_id);

-- indexes for tagz
CREATE UNIQUE INDEX idx_tagz_name ON tagz(name);
CREATE INDEX idx_tagz_created_at ON tagz(created_at DESC);

-- indexes for album_tagz
CREATE INDEX idx_album_tagz_album ON album_tagz(album_id);
CREATE INDEX idx_album_tagz_tag ON album_tagz(tag_id);

-- triggers for computed columns
CREATE TRIGGER update_album_stats_insert
AFTER INSERT ON album_songz
BEGIN
  UPDATE albumz
  SET song_count = (
    SELECT COUNT(*) FROM album_songz WHERE album_id = NEW.album_id
  ),
  total_duration = (
    SELECT COALESCE(SUM(s.duration), 0)
    FROM album_songz acs
    JOIN songz s ON s.id = acs.song_id
    WHERE acs.album_id = NEW.album_id
  )
  WHERE id = NEW.album_id;
END;

CREATE TRIGGER update_album_stats_delete
AFTER DELETE ON album_songz
BEGIN
  UPDATE albumz
  SET song_count = (
    SELECT COUNT(*) FROM album_songz WHERE album_id = OLD.album_id
  ),
  total_duration = (
    SELECT COALESCE(SUM(s.duration), 0)
    FROM album_songz acs
    JOIN songz s ON s.id = acs.song_id
    WHERE acs.album_id = OLD.album_id
  )
  WHERE id = OLD.album_id;
END;

CREATE TRIGGER update_album_stats_song_duration
AFTER UPDATE OF duration ON songz
BEGIN
  UPDATE albumz
  SET total_duration = (
    SELECT COALESCE(SUM(s.duration), 0)
    FROM album_songz acs
    JOIN songz s ON s.id = acs.song_id
    WHERE acs.album_id IN (
      SELECT album_id FROM album_songz WHERE song_id = NEW.id
    )
  )
  WHERE id IN (
    SELECT album_id FROM album_songz WHERE song_id = NEW.id
  );
END;
