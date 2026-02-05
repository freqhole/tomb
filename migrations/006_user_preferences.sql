-- 006: user preferences - favorites and ratings

-- user favorites (songs, artists, albums, genres, playlists)
CREATE TABLE user_favoritez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('song', 'artist', 'album', 'genre', 'playlist')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, target_type, target_id)
);

CREATE INDEX idx_user_favoritez_user_id ON user_favoritez(user_id);
CREATE INDEX idx_user_favoritez_target ON user_favoritez(target_type, target_id);
CREATE INDEX idx_user_favoritez_created ON user_favoritez(created_at DESC);
CREATE INDEX idx_user_favoritez_user_type ON user_favoritez(user_id, target_type);

-- user ratings (songs, artists, albums - 1-5 stars)
CREATE TABLE user_ratingz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('song', 'artist', 'album')),
  target_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, target_type, target_id)
);

CREATE INDEX idx_user_ratingz_user_id ON user_ratingz(user_id);
CREATE INDEX idx_user_ratingz_target ON user_ratingz(target_type, target_id);
CREATE INDEX idx_user_ratingz_rating ON user_ratingz(rating);
CREATE INDEX idx_user_ratingz_updated ON user_ratingz(updated_at DESC);
CREATE INDEX idx_user_ratingz_user_type ON user_ratingz(user_id, target_type);

CREATE TRIGGER trg_user_ratingz_updated_at
AFTER UPDATE ON user_ratingz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE user_ratingz SET updated_at = unixepoch() WHERE id = NEW.id;
END;
