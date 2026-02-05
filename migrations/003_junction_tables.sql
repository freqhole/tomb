-- 003: junction tables - relationships between music entities

-- artist <-> album (many-to-many)
CREATE TABLE artist_albumz (
  artist_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  UNIQUE(artist_id, album_id),
  FOREIGN KEY (artist_id) REFERENCES artistz(id),
  FOREIGN KEY (album_id) REFERENCES albumz(id)
);

CREATE INDEX idx_artist_albumz_artist ON artist_albumz(artist_id);
CREATE INDEX idx_artist_albumz_album ON artist_albumz(album_id);

-- artist <-> song (many-to-many)
CREATE TABLE artist_songz (
  artist_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  PRIMARY KEY (artist_id, song_id),
  FOREIGN KEY (artist_id) REFERENCES artistz(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songz(id) ON DELETE CASCADE
);

-- album <-> song (many-to-many)
CREATE TABLE album_songz (
  album_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  PRIMARY KEY (album_id, song_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songz(id) ON DELETE CASCADE
);

-- album <-> genre (many-to-many)
CREATE TABLE album_genrez (
  album_id TEXT NOT NULL,
  genre_id TEXT NOT NULL,
  UNIQUE(album_id, genre_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (genre_id) REFERENCES genrez(id)
);

CREATE INDEX idx_album_genrez_album_id ON album_genrez(album_id);
CREATE INDEX idx_album_genrez_genre_id ON album_genrez(genre_id);

-- album <-> tag (many-to-many)
CREATE TABLE album_tagz (
  album_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  UNIQUE(album_id, tag_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (tag_id) REFERENCES tagz(id)
);

CREATE INDEX idx_album_tagz_album ON album_tagz(album_id);
CREATE INDEX idx_album_tagz_tag ON album_tagz(tag_id);
CREATE INDEX idx_album_tagz_lookup ON album_tagz(album_id, tag_id);
CREATE INDEX idx_album_tagz_reverse ON album_tagz(tag_id, album_id);

-- playlist <-> song (many-to-many with position)
CREATE TABLE playlist_songz (
  playlist_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  added_by TEXT,
  PRIMARY KEY (playlist_id, song_id),
  FOREIGN KEY (playlist_id) REFERENCES playlistz(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songz(id) ON DELETE CASCADE
);

CREATE INDEX idx_playlist_songz_position ON playlist_songz(playlist_id, position);
CREATE INDEX idx_playlist_songz_song_id ON playlist_songz(song_id);

-- auto-append new songs to end of playlist
CREATE TRIGGER trg_playlist_songz_auto_append
AFTER INSERT ON playlist_songz
WHEN NEW.position IS NULL OR NEW.position = 0
BEGIN
  UPDATE playlist_songz
  SET position = (
    SELECT COALESCE(MAX(position), 0) + 1
    FROM playlist_songz
    WHERE playlist_id = NEW.playlist_id
  )
  WHERE rowid = NEW.rowid;
END;

-- close gaps when songs are removed from playlist
CREATE TRIGGER trg_playlist_songz_close_gaps_on_delete
AFTER DELETE ON playlist_songz
BEGIN
  UPDATE playlist_songz
  SET position = position - 1
  WHERE playlist_id = OLD.playlist_id
    AND position > OLD.position;
END;

-- triggers to update album stats when songs change
CREATE TRIGGER trg_album_songz_insert_count
AFTER INSERT ON album_songz
BEGIN
    UPDATE albumz
    SET song_count = (
        SELECT COUNT(*)
        FROM album_songz
        WHERE album_songz.album_id = NEW.album_id
    ),
    updated_at = unixepoch()
    WHERE id = NEW.album_id;
END;

CREATE TRIGGER trg_album_songz_delete_count
AFTER DELETE ON album_songz
BEGIN
    UPDATE albumz
    SET song_count = (
        SELECT COUNT(*)
        FROM album_songz
        WHERE album_songz.album_id = OLD.album_id
    ),
    updated_at = unixepoch()
    WHERE id = OLD.album_id;
END;

-- update album total_duration when song duration changes
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
