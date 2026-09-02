-- 061: user_favoritez - drop target_type CHECK entirely
--
-- per docs/video-domain-phase1-data-model.md's "entity_type validation: rust
-- enum, no SQL CHECK" design: target_type is validated by matching against
-- the FavoriteTarget rust enum (grimoire/src/music/users/models.rs) at the
-- api/serde boundary, which is a stronger, compiler-enforced-exhaustive
-- guarantee than a sql allowlist that has to be kept in sync by hand every
-- time a new domain (video, and later photos/ebooks/...) adds a variant.
--
-- sqlite can't drop a CHECK constraint in place, so the table is rebuilt
-- (same columns/indexes otherwise).

PRAGMA foreign_keys = OFF;

CREATE TABLE user_favoritez_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, target_type, target_id)
);

INSERT INTO user_favoritez_new (id, user_id, target_type, target_id, created_at)
SELECT id, user_id, target_type, target_id, created_at
FROM user_favoritez;

DROP TABLE user_favoritez;
ALTER TABLE user_favoritez_new RENAME TO user_favoritez;

CREATE INDEX idx_user_favoritez_user_id ON user_favoritez(user_id);
CREATE INDEX idx_user_favoritez_target ON user_favoritez(target_type, target_id);
CREATE INDEX idx_user_favoritez_created ON user_favoritez(created_at DESC);
CREATE INDEX idx_user_favoritez_user_type ON user_favoritez(user_id, target_type);

PRAGMA foreign_keys = ON;
