-- 062: user_ratingz - drop target_type CHECK entirely (adds 'video' support)
--
-- same rationale as migration 061: target_type is validated by matching
-- against the RatingTarget rust enum (grimoire/src/music/users/models.rs),
-- not a sql allowlist. the rating range CHECK (1-5) is unrelated to entity
-- type and is preserved as-is.
--
-- sqlite can't drop a CHECK constraint in place, so the table is rebuilt
-- (same columns/indexes/trigger otherwise).

PRAGMA foreign_keys = OFF;

CREATE TABLE user_ratingz_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, target_type, target_id)
);

INSERT INTO user_ratingz_new (id, user_id, target_type, target_id, rating, created_at, updated_at)
SELECT id, user_id, target_type, target_id, rating, created_at, updated_at
FROM user_ratingz;

DROP TABLE user_ratingz;
ALTER TABLE user_ratingz_new RENAME TO user_ratingz;

CREATE INDEX idx_user_ratingz_user_id ON user_ratingz(user_id);
CREATE INDEX idx_user_ratingz_target ON user_ratingz(target_type, target_id);
CREATE INDEX idx_user_ratingz_rating ON user_ratingz(rating);
CREATE INDEX idx_user_ratingz_updated ON user_ratingz(updated_at DESC);
CREATE INDEX idx_user_ratingz_user_type ON user_ratingz(user_id, target_type);
CREATE INDEX idx_user_ratingz_created_at ON user_ratingz(created_at DESC);

CREATE TRIGGER trg_user_ratingz_updated_at
AFTER UPDATE ON user_ratingz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE user_ratingz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

PRAGMA foreign_keys = ON;
