-- 004: image junction tables - linking images to entities

-- artist images
CREATE TABLE artist_imagez (
  artist_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,
  UNIQUE(artist_id, media_blob_id),
  FOREIGN KEY (artist_id) REFERENCES artistz(id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_artist_imagez_artist ON artist_imagez(artist_id);
CREATE INDEX idx_artist_imagez_blob ON artist_imagez(media_blob_id);
CREATE INDEX idx_artist_imagez_primary ON artist_imagez(artist_id, is_primary);

-- album images
CREATE TABLE album_imagez (
  album_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER DEFAULT 0,
  UNIQUE(album_id, media_blob_id),
  FOREIGN KEY (album_id) REFERENCES albumz(id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_album_imagez_album ON album_imagez(album_id);
CREATE INDEX idx_album_imagez_blob ON album_imagez(media_blob_id);
CREATE INDEX idx_album_imagez_primary ON album_imagez(album_id, is_primary);

-- song images
CREATE TABLE song_imagez (
  song_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (song_id, media_blob_id),
  FOREIGN KEY (song_id) REFERENCES songz(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_song_imagez_song_id ON song_imagez(song_id);
CREATE INDEX idx_song_imagez_primary ON song_imagez(song_id, is_primary) WHERE is_primary = 1;

-- playlist images
CREATE TABLE playlist_imagez (
  playlist_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, media_blob_id),
  FOREIGN KEY (playlist_id) REFERENCES playlistz(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_playlist_imagez_playlist_id ON playlist_imagez(playlist_id);
CREATE INDEX idx_playlist_imagez_primary ON playlist_imagez(playlist_id, is_primary) WHERE is_primary = 1;
