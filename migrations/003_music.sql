-- music.db - music domain tables

-- normalized artist table
CREATE TABLE artistz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  sort_name TEXT,
  musicbrainz_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  created_by TEXT,
  updated_by TEXT
);

-- normalized album table
CREATE TABLE albumz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  album_type TEXT DEFAULT 'album',
  release_date TEXT,
  release_date_precision TEXT,    -- year/month/day (spotify schema)
  label TEXT,
  genre_rowid INTEGER,            -- reference to genrez.rowid
  song_count INTEGER DEFAULT 0,   -- computed from songz count
  total_duration INTEGER DEFAULT 0, -- computed from songz duration sum
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT
);

-- keep most existing songz columns, preserve complexity
CREATE TABLE songz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,    -- reference to media_blobz.id
  thumbnail_blob_id TEXT,         -- reference to media_blobz.id
  waveform_blob_id TEXT,          -- reference to media_blobz.id
  title TEXT NOT NULL,
  artist TEXT,                    -- denormalized, normalize later
  album TEXT,                     -- denormalized, normalize later
  album_artist TEXT,
  track_number INTEGER,
  disc_number INTEGER DEFAULT 1,
  duration INTEGER,               -- seconds from interval
  year INTEGER,
  bpm INTEGER,
  key_signature TEXT,
  rating INTEGER,
  is_favorite INTEGER DEFAULT 0,
  tags TEXT,                      -- json array as text
  metadata TEXT,                  -- json from existing jsonb
  processing_status TEXT DEFAULT 'unprocessed',
  processing_notes TEXT,
  sub_genres TEXT,                -- json array as text, normalize later
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,

  -- constraints
  CHECK (bpm >= 0 AND bpm <= 300),
  CHECK (rating >= 1 AND rating <= 5)
);

-- playlists
CREATE TABLE playlistz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 0,
  created_by_rowid INTEGER,       -- reference to user_accountz.rowid
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE playlist_songz (
  playlist_rowid INTEGER NOT NULL,
  song_rowid INTEGER NOT NULL,
  position INTEGER NOT NULL,      -- order in playlist
  added_at INTEGER,

  -- constraints
  UNIQUE(playlist_rowid, position)
);

-- relationship tables
CREATE TABLE artist_songz (
  artist_rowid INTEGER NOT NULL,
  song_rowid INTEGER NOT NULL,

  -- constraints
  UNIQUE(artist_rowid, song_rowid)
);

CREATE TABLE album_songz (
  album_rowid INTEGER NOT NULL,
  song_rowid INTEGER NOT NULL,

  -- constraints
  UNIQUE(album_rowid, song_rowid)
);

CREATE TABLE artist_albumz (
  artist_rowid INTEGER NOT NULL,
  album_rowid INTEGER NOT NULL,

  -- constraints
  UNIQUE(artist_rowid, album_rowid)
);

-- genre normalization tables
CREATE TABLE genrez (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE sub_genrez (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  parent_genre_rowid INTEGER,    -- optional parent genre
  created_at INTEGER
);

CREATE TABLE album_sub_genrez (
  album_rowid INTEGER NOT NULL,
  sub_genre_rowid INTEGER NOT NULL,

  -- constraints
  UNIQUE(album_rowid, sub_genre_rowid)
);

-- tag normalization tables
CREATE TABLE tagz (
  rowid INTEGER PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE song_tagz (
  song_rowid INTEGER NOT NULL,
  tag_rowid INTEGER NOT NULL,

  -- constraints
  UNIQUE(song_rowid, tag_rowid)
);

-- indexes for artistz
CREATE INDEX idx_artistz_name ON artistz(name);
CREATE INDEX idx_artistz_created_at ON artistz(created_at DESC);

-- indexes for albumz
CREATE INDEX idx_albumz_title ON albumz(title);
CREATE INDEX idx_albumz_album_type ON albumz(album_type);
CREATE INDEX idx_albumz_release_date ON albumz(release_date);
CREATE INDEX idx_albumz_genre_rowid ON albumz(genre_rowid);
CREATE INDEX idx_albumz_created_at ON albumz(created_at DESC);

-- indexes for songz
CREATE INDEX idx_songz_title ON songz(title);
CREATE INDEX idx_songz_artist ON songz(artist);
CREATE INDEX idx_songz_album ON songz(album);
CREATE INDEX idx_songz_media_blob_id ON songz(media_blob_id);
CREATE INDEX idx_songz_processing_status ON songz(processing_status);
CREATE INDEX idx_songz_created_at ON songz(created_at DESC);
CREATE INDEX idx_songz_deleted_at ON songz(deleted_at) WHERE deleted_at IS NOT NULL;

-- indexes for playlistz
CREATE INDEX idx_playlistz_title ON playlistz(title);
CREATE INDEX idx_playlistz_created_by ON playlistz(created_by_rowid);
CREATE INDEX idx_playlistz_created_at ON playlistz(created_at DESC);
CREATE INDEX idx_playlistz_public ON playlistz(is_public) WHERE is_public = 1;

-- indexes for playlist_songz
CREATE INDEX idx_playlist_songz_playlist ON playlist_songz(playlist_rowid);
CREATE INDEX idx_playlist_songz_song ON playlist_songz(song_rowid);
CREATE INDEX idx_playlist_songz_position ON playlist_songz(playlist_rowid, position);

-- indexes for relationship tables
CREATE INDEX idx_artist_songz_artist ON artist_songz(artist_rowid);
CREATE INDEX idx_artist_songz_song ON artist_songz(song_rowid);

CREATE INDEX idx_album_songz_album ON album_songz(album_rowid);
CREATE INDEX idx_album_songz_song ON album_songz(song_rowid);

CREATE INDEX idx_artist_albumz_artist ON artist_albumz(artist_rowid);
CREATE INDEX idx_artist_albumz_album ON artist_albumz(album_rowid);

-- triggers for automatic audit field updates
CREATE TRIGGER trg_artistz_updated_at
AFTER UPDATE ON artistz
FOR EACH ROW
BEGIN
  UPDATE artistz SET updated_at = unixepoch() WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER trg_albumz_updated_at
AFTER UPDATE ON albumz
FOR EACH ROW
BEGIN
  UPDATE albumz SET updated_at = unixepoch() WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER trg_songz_updated_at
AFTER UPDATE ON songz
FOR EACH ROW
BEGIN
  UPDATE songz SET updated_at = unixepoch() WHERE rowid = NEW.rowid;
END;

-- indexes for genrez
CREATE UNIQUE INDEX idx_genrez_name ON genrez(name);
CREATE INDEX idx_genrez_created_at ON genrez(created_at DESC);

-- indexes for sub_genrez
CREATE UNIQUE INDEX idx_sub_genrez_name ON sub_genrez(name);
CREATE INDEX idx_sub_genrez_parent ON sub_genrez(parent_genre_rowid);
CREATE INDEX idx_sub_genrez_created_at ON sub_genrez(created_at DESC);

-- indexes for album_sub_genrez
CREATE INDEX idx_album_sub_genrez_album ON album_sub_genrez(album_rowid);
CREATE INDEX idx_album_sub_genrez_genre ON album_sub_genrez(sub_genre_rowid);

-- indexes for tagz
CREATE UNIQUE INDEX idx_tagz_name ON tagz(name);
CREATE INDEX idx_tagz_created_at ON tagz(created_at DESC);

-- indexes for song_tagz
CREATE INDEX idx_song_tagz_song ON song_tagz(song_rowid);
CREATE INDEX idx_song_tagz_tag ON song_tagz(tag_rowid);

-- triggers for computed columns
CREATE TRIGGER update_album_stats_insert
AFTER INSERT ON album_songz
BEGIN
  UPDATE albumz
  SET song_count = (
    SELECT COUNT(*) FROM album_songz WHERE album_rowid = NEW.album_rowid
  ),
  total_duration = (
    SELECT COALESCE(SUM(s.duration), 0)
    FROM album_songz acs
    JOIN songz s ON s.rowid = acs.song_rowid
    WHERE acs.album_rowid = NEW.album_rowid
  )
  WHERE rowid = NEW.album_rowid;
END;

CREATE TRIGGER update_album_stats_delete
AFTER DELETE ON album_songz
BEGIN
  UPDATE albumz
  SET song_count = (
    SELECT COUNT(*) FROM album_songz WHERE album_rowid = OLD.album_rowid
  ),
  total_duration = (
    SELECT COALESCE(SUM(s.duration), 0)
    FROM album_songz acs
    JOIN songz s ON s.rowid = acs.song_rowid
    WHERE acs.album_rowid = OLD.album_rowid
  )
  WHERE rowid = OLD.album_rowid;
END;

CREATE TRIGGER update_album_stats_song_duration
AFTER UPDATE OF duration ON songz
BEGIN
  UPDATE albumz
  SET total_duration = (
    SELECT COALESCE(SUM(s.duration), 0)
    FROM album_songz acs
    JOIN songz s ON s.rowid = acs.song_rowid
    WHERE acs.album_rowid IN (
      SELECT album_rowid FROM album_songz WHERE song_rowid = NEW.rowid
    )
  )
  WHERE rowid IN (
    SELECT album_rowid FROM album_songz WHERE song_rowid = NEW.rowid
  );
END;
